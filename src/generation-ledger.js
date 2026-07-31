const DEFAULT_MAX_PENDING_PER_TYPE = 64;
const DEFAULT_MAX_UNLINKED_RECORDS = 64;
const DEFAULT_SESSION_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_SESSIONS = 256;
const DEFAULT_MAX_BUFFERED_PUBLIC_IDS = 512;

function normalizePublicId(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const normalized = String(value).trim();
    return normalized && normalized.length <= 256 ? normalized : null;
}

function normalizePromptType(value) {
    return value === 'chat-completion' ? 'chat-completion' : 'text-completion';
}

function normalizeGenerationType(value) {
    if (typeof value !== 'string') return 'unknown';
    return value.length > 0 && value.length <= 64 ? value : 'unknown';
}

function boundedInteger(value, fallback, minimum = 1, maximum = 4096) {
    const numeric = Number(value);
    return Number.isFinite(numeric)
        ? Math.min(maximum, Math.max(minimum, Math.trunc(numeric)))
        : fallback;
}

function isObjectIdentity(value) {
    return value !== null
        && (typeof value === 'object' || typeof value === 'function');
}

/**
 * Keeps volatile generation correlation state out of persisted snapshots.
 *
 * Handles returned by this class are opaque object identities. Callers may keep
 * them in memory, but must persist only `getSessionView()` and claim metadata.
 */
export class GenerationLedger {
    #now;
    #maxPendingPerType;
    #maxUnlinkedRecords;
    #sessionTimeoutMs;
    #maxSessions;
    #maxBufferedPublicIds;
    #sessionOrdinal = 0;
    #sessions = new Set();
    #sessionByHandle = new WeakMap();
    #promptByHandle = new WeakMap();
    #publicSessions = new Map();
    #pendingByType = new Map([
        ['chat-completion', []],
        ['text-completion', []],
    ]);
    #claimedRequestObjects = new WeakSet();
    #claimedRequestIds = new Set();
    #unboundLore = [];
    #publicLore = new Map();
    #unlinkedLore = [];
    #publicUsage = new Map();
    #unlinkedUsage = [];

    constructor({
        now = () => Date.now(),
        maxPendingPerType = DEFAULT_MAX_PENDING_PER_TYPE,
        maxUnlinkedRecords = DEFAULT_MAX_UNLINKED_RECORDS,
        sessionTimeoutMs = DEFAULT_SESSION_TIMEOUT_MS,
        maxSessions = DEFAULT_MAX_SESSIONS,
        maxBufferedPublicIds = DEFAULT_MAX_BUFFERED_PUBLIC_IDS,
    } = {}) {
        this.#now = typeof now === 'function' ? now : () => Date.now();
        this.#maxPendingPerType = boundedInteger(
            maxPendingPerType,
            DEFAULT_MAX_PENDING_PER_TYPE,
        );
        this.#maxUnlinkedRecords = boundedInteger(
            maxUnlinkedRecords,
            DEFAULT_MAX_UNLINKED_RECORDS,
        );
        this.#sessionTimeoutMs = boundedInteger(
            sessionTimeoutMs,
            DEFAULT_SESSION_TIMEOUT_MS,
            1,
            86_400_000,
        );
        this.#maxSessions = boundedInteger(maxSessions, DEFAULT_MAX_SESSIONS);
        this.#maxBufferedPublicIds = boundedInteger(
            maxBufferedPublicIds,
            DEFAULT_MAX_BUFFERED_PUBLIC_IDS,
        );
    }

    beginGeneration({
        publicId = null,
        generationType = 'unknown',
        startedAt = this.#now(),
    } = {}) {
        this.expire(startedAt);
        const session = this.#createSession({
            publicId: normalizePublicId(publicId),
            generationType,
            status: 'started',
            statusEvent: 'GENERATION_STARTED',
            statusUpdatedAt: startedAt,
            active: true,
        });
        return session.handle;
    }

    recordLore(value, {
        publicId = null,
        sessionHandle = null,
        recordedAt = this.#now(),
    } = {}) {
        this.expire(recordedAt);
        const normalizedId = normalizePublicId(publicId);
        const explicitSession = this.#sessionByHandle.get(sessionHandle);
        if (explicitSession) {
            explicitSession.lore = value;
            explicitSession.lastUpdatedAt = recordedAt;
            return { status: 'linked', sessionHandle: explicitSession.handle };
        }

        if (normalizedId) {
            const exact = this.#uniquePublicSession(normalizedId);
            if (exact) {
                exact.lore = value;
                exact.lastUpdatedAt = recordedAt;
                return { status: 'linked', sessionHandle: exact.handle };
            }
            if (!this.#publicSessions.has(normalizedId)) {
                const records = this.#publicLore.get(normalizedId) ?? [];
                records.push({ value, recordedAt });
                this.#publicLore.set(
                    normalizedId,
                    records.slice(-this.#maxUnlinkedRecords),
                );
                this.#trimPublicBuffer(this.#publicLore, 'lore');
                return { status: 'pending', sessionHandle: null };
            }
            this.#appendUnlinkedLore(value, 'ambiguous-public-id', true, recordedAt);
            return { status: 'unlinked', reason: 'ambiguous-public-id', sessionHandle: null };
        }

        const active = this.#activeSessions();
        if (active.length === 1) {
            active[0].lore = value;
            active[0].lastUpdatedAt = recordedAt;
            return { status: 'linked', sessionHandle: active[0].handle };
        }
        if (active.length === 0) {
            this.#unboundLore.push({ value, recordedAt });
            this.#unboundLore = this.#unboundLore.slice(-this.#maxUnlinkedRecords);
            return { status: 'pending', sessionHandle: null };
        }
        this.#appendUnlinkedLore(value, 'ambiguous-active-session', false, recordedAt);
        return { status: 'unlinked', reason: 'ambiguous-active-session', sessionHandle: null };
    }

    openPrompt({
        promptType,
        publicId = null,
        value = null,
        openedAt = this.#now(),
    }) {
        this.expire(openedAt);
        const type = normalizePromptType(promptType);
        const normalizedId = normalizePublicId(publicId);
        const session = this.#selectPromptSession(normalizedId, openedAt);
        session.promptCount += 1;
        session.lastUpdatedAt = openedAt;

        const handle = Object.freeze({});
        const prompt = {
            handle,
            promptType: type,
            publicId: normalizedId,
            value,
            session,
            openedAt,
            claimed: false,
            settled: false,
            expired: false,
        };
        this.#promptByHandle.set(handle, prompt);
        const pending = this.#pendingByType.get(type);
        pending.push(prompt);
        if (pending.length > this.#maxPendingPerType) {
            for (const overflow of pending.splice(
                0,
                pending.length - this.#maxPendingPerType,
            )) {
                overflow.expired = true;
            }
        }

        let activatedLore = session.lore;
        session.lore = null;
        if (activatedLore == null && session.implicit && this.#unboundLore.length > 0) {
            activatedLore = this.#unboundLore.pop().value;
            this.#unboundLore = [];
        }
        return {
            promptHandle: handle,
            sessionHandle: session.handle,
            value,
            activatedLore,
            session: this.#sessionView(session),
        };
    }

    claimRequest({
        promptType,
        publicId = null,
        requestIdentity = null,
        acceptValue = null,
        claimedAt = this.#now(),
    }) {
        this.expire(claimedAt);
        const normalizedId = normalizePublicId(publicId);
        const type = normalizePromptType(promptType);
        if (
            isObjectIdentity(requestIdentity)
            && this.#claimedRequestObjects.has(requestIdentity)
        ) {
            return { status: 'duplicate', reason: 'duplicate-request-object' };
        }
        if (normalizedId && this.#claimedRequestIds.has(normalizedId)) {
            return { status: 'duplicate', reason: 'duplicate-public-id' };
        }

        const available = this.#pendingByType.get(type).filter(
            (prompt) => (
                !prompt.settled
                && !prompt.claimed
                && !prompt.expired
                && (
                    typeof acceptValue !== 'function'
                    || acceptValue(prompt.value)
                )
            ),
        );
        let prompt = null;
        let method = null;
        if (normalizedId) {
            const exact = available.filter((candidate) => candidate.publicId === normalizedId);
            const publicSessions = this.#publicSessions.get(normalizedId);
            if (exact.length !== 1 || (publicSessions && publicSessions.size !== 1)) {
                return {
                    status: exact.length > 1 || (publicSessions && publicSessions.size > 1)
                        ? 'ambiguous'
                        : 'unmatched',
                    reason: exact.length > 1 || (publicSessions && publicSessions.size > 1)
                        ? 'ambiguous-public-id'
                        : 'public-id-not-found',
                };
            }
            [prompt] = exact;
            method = 'explicit-id';
        } else {
            prompt = available.find((candidate) => candidate.publicId == null) ?? null;
            if (!prompt) {
                return { status: 'unmatched', reason: 'fifo-candidate-not-found' };
            }
            method = 'fifo';
        }

        prompt.claimed = true;
        prompt.session.lastUpdatedAt = claimedAt;
        if (isObjectIdentity(requestIdentity)) {
            this.#claimedRequestObjects.add(requestIdentity);
        }
        if (normalizedId) {
            this.#claimedRequestIds.add(normalizedId);
            while (this.#claimedRequestIds.size > this.#maxPendingPerType * 8) {
                this.#claimedRequestIds.delete(this.#claimedRequestIds.values().next().value);
            }
        }
        return {
            status: 'matched',
            method,
            promptHandle: prompt.handle,
            sessionHandle: prompt.session.handle,
            value: prompt.value,
            session: this.#sessionView(prompt.session),
        };
    }

    settlePrompt(promptHandle, { settledAt = this.#now() } = {}) {
        const prompt = this.#promptByHandle.get(promptHandle);
        if (!prompt || prompt.settled) return false;
        prompt.settled = true;
        prompt.session.lastUpdatedAt = settledAt;
        const pending = this.#pendingByType.get(prompt.promptType);
        const index = pending.indexOf(prompt);
        if (index >= 0) pending.splice(index, 1);
        return true;
    }

    completeGeneration({
        status,
        statusEvent,
        publicId = null,
        sessionHandle = null,
        completedAt = this.#now(),
    }) {
        this.expire(completedAt);
        const normalizedId = normalizePublicId(publicId);
        let session = this.#sessionByHandle.get(sessionHandle) ?? null;
        if (!session && normalizedId) {
            session = this.#uniquePublicSession(normalizedId);
            if (!session) {
                return {
                    status: this.#publicSessions.has(normalizedId) ? 'ambiguous' : 'unmatched',
                    reason: this.#publicSessions.has(normalizedId)
                        ? 'ambiguous-public-id'
                        : 'public-id-not-found',
                    snapshotEntries: [],
                };
            }
        }
        if (!session) {
            const active = this.#activeSessions();
            if (active.length !== 1) {
                return {
                    status: active.length > 1 ? 'ambiguous' : 'unmatched',
                    reason: active.length > 1
                        ? 'ambiguous-active-session'
                        : 'active-session-not-found',
                    snapshotEntries: [],
                };
            }
            [session] = active;
        }
        if (session.status === 'stopped' && status === 'ended') {
            session.active = false;
            return {
                status: 'unchanged',
                reason: 'stopped-is-terminal',
                sessionHandle: session.handle,
                session: this.#sessionView(session),
                snapshotEntries: [...session.snapshots.entries()],
            };
        }
        session.status = typeof status === 'string' && status ? status : 'unknown';
        session.statusEvent = typeof statusEvent === 'string' ? statusEvent : null;
        session.statusUpdatedAt = completedAt;
        session.lastUpdatedAt = completedAt;
        session.active = false;
        this.#flushPublicUsage(session);
        return {
            status: 'matched',
            sessionHandle: session.handle,
            session: this.#sessionView(session),
            snapshotEntries: [...session.snapshots.entries()],
            usageRecords: this.getUsageRecords(session.handle),
        };
    }

    registerSnapshot(sessionHandle, snapshot) {
        const session = this.#sessionByHandle.get(sessionHandle);
        if (!session || !snapshot?.id) return this.getSessionView(sessionHandle);
        session.snapshots.set(snapshot.id, snapshot);
        while (session.snapshots.size > this.#maxPendingPerType) {
            session.snapshots.delete(session.snapshots.keys().next().value);
        }
        session.lastUpdatedAt = this.#now();
        return this.#sessionView(session);
    }

    replaceSnapshot(sessionHandle, snapshot) {
        return this.registerSnapshot(sessionHandle, snapshot);
    }

    getSessionView(sessionHandle) {
        return this.#sessionView(this.#sessionByHandle.get(sessionHandle));
    }

    getUsageRecords(sessionHandle) {
        const session = this.#sessionByHandle.get(sessionHandle);
        if (!session) return [];
        return session.usageRecords.map((record) => ({ ...record }));
    }

    getSnapshotEntries(sessionHandle) {
        const session = this.#sessionByHandle.get(sessionHandle);
        return session ? [...session.snapshots.entries()] : [];
    }

    recordUsage(usage, {
        publicId = null,
        eventName = null,
        unlinkedUsage = usage,
        recordedAt = this.#now(),
    } = {}) {
        this.expire(recordedAt);
        const normalizedId = normalizePublicId(publicId);
        if (!normalizedId) {
            const record = this.#appendUnlinkedUsage(
                unlinkedUsage,
                'missing-public-id',
                false,
                eventName,
                recordedAt,
            );
            return { status: 'unlinked', reason: record.reason, record };
        }
        const sessions = this.#publicSessions.get(normalizedId);
        if (sessions?.size > 1) {
            const record = this.#appendUnlinkedUsage(
                unlinkedUsage,
                'ambiguous-public-id',
                true,
                eventName,
                recordedAt,
            );
            return { status: 'unlinked', reason: record.reason, record };
        }
        const session = sessions?.size === 1 ? [...sessions][0] : null;
        if (session && !session.active) {
            const record = this.#attachUsage(session, usage, eventName, recordedAt);
            return {
                status: 'linked',
                sessionHandle: session.handle,
                session: this.#sessionView(session),
                record,
            };
        }
        const records = this.#publicUsage.get(normalizedId) ?? [];
        records.push({ usage, unlinkedUsage, eventName, recordedAt });
        this.#publicUsage.set(
            normalizedId,
            records.slice(-this.#maxUnlinkedRecords),
        );
        this.#trimPublicBuffer(this.#publicUsage, 'usage');
        return { status: 'pending', reason: session ? 'session-active' : 'session-not-found' };
    }

    recordLocalUsage(usage, {
        sessionHandle = null,
        eventName = null,
        unlinkedUsage = usage,
        generationType = null,
        recordedAt = this.#now(),
    } = {}) {
        this.expire(recordedAt);
        let session = this.#sessionByHandle.get(sessionHandle) ?? null;
        let correlationMethod = 'session-handle';
        if (sessionHandle && !session) {
            const record = this.#appendUnlinkedUsage(
                unlinkedUsage,
                'invalid-session-handle',
                false,
                eventName,
                recordedAt,
            );
            return { status: 'unlinked', reason: record.reason, record };
        }
        if (!session) {
            const normalizedType = normalizeGenerationType(generationType);
            const allActive = this.#activeSessions();
            const active = normalizedType === 'unknown'
                ? allActive
                : allActive.filter(
                    (candidate) => candidate.generationType === normalizedType,
                );
            if (active.length !== 1) {
                const reason = active.length > 1
                    ? normalizedType === 'unknown'
                        ? 'ambiguous-active-session'
                        : 'ambiguous-generation-type'
                    : normalizedType === 'unknown'
                        ? 'active-session-not-found'
                        : 'generation-type-session-not-found';
                const record = this.#appendUnlinkedUsage(
                    unlinkedUsage,
                    reason,
                    false,
                    eventName,
                    recordedAt,
                );
                return { status: 'unlinked', reason, record };
            }
            [session] = active;
            correlationMethod = 'single-active-session';
        }
        const record = this.#attachUsage(
            session,
            usage,
            eventName,
            recordedAt,
            correlationMethod,
            false,
        );
        return {
            status: 'linked',
            sessionHandle: session.handle,
            session: this.#sessionView(session),
            record,
        };
    }

    drainUnlinkedUsage() {
        const records = this.#unlinkedUsage.map((record) => ({ ...record }));
        this.#unlinkedUsage = [];
        return records;
    }

    drainUnlinkedLore() {
        const records = this.#unlinkedLore.map((record) => ({ ...record }));
        this.#unlinkedLore = [];
        return records;
    }

    expire(now = this.#now()) {
        const expired = [];
        for (const session of this.#sessions) {
            if (!session.active || now - session.lastUpdatedAt < this.#sessionTimeoutMs) continue;
            session.active = false;
            session.status = 'timeout';
            session.statusEvent = 'LEDGER_TIMEOUT';
            session.statusUpdatedAt = now;
            session.lastUpdatedAt = now;
            this.#flushPublicUsage(session);
            expired.push({
                sessionHandle: session.handle,
                session: this.#sessionView(session),
                snapshotEntries: [...session.snapshots.entries()],
            });
        }
        const staleInactive = [...this.#sessions]
            .filter((session) => (
                !session.active
                && now - session.lastUpdatedAt >= this.#sessionTimeoutMs
                && !this.#sessionHasPendingPrompt(session)
            ))
            .sort((left, right) => (
                left.lastUpdatedAt - right.lastUpdatedAt
                || left.ordinal - right.ordinal
            ));
        for (const session of staleInactive) this.#evictSession(session);
        return expired;
    }

    #createSession({
        publicId,
        generationType,
        status,
        statusEvent,
        statusUpdatedAt,
        active,
        implicit = false,
    }) {
        this.#ensureSessionCapacity();
        const handle = Object.freeze({});
        if (this.#sessions.size >= this.#maxSessions) {
            const overflow = {
                handle,
                publicId,
                publicIdCollision: false,
                generationType: normalizeGenerationType(generationType),
                status: 'overflow',
                statusEvent: 'LEDGER_CAPACITY_EXCEEDED',
                statusUpdatedAt,
                startedAt: statusUpdatedAt,
                lastUpdatedAt: statusUpdatedAt,
                active: false,
                implicit: true,
                overflow: true,
                ordinal: ++this.#sessionOrdinal,
                promptCount: 0,
                lore: null,
                snapshots: new Map(),
                usageRecords: [],
            };
            this.#sessionByHandle.set(handle, overflow);
            return overflow;
        }
        const session = {
            handle,
            publicId,
            publicIdCollision: false,
            generationType: normalizeGenerationType(generationType),
            status,
            statusEvent,
            statusUpdatedAt,
            startedAt: statusUpdatedAt,
            lastUpdatedAt: statusUpdatedAt,
            active,
            implicit,
            overflow: false,
            ordinal: ++this.#sessionOrdinal,
            promptCount: 0,
            lore: null,
            snapshots: new Map(),
            usageRecords: [],
        };
        this.#sessions.add(session);
        this.#sessionByHandle.set(handle, session);
        if (publicId) this.#bindPublicId(session, publicId);
        return session;
    }

    #selectPromptSession(publicId, now) {
        if (publicId) {
            const exact = this.#uniquePublicSession(publicId);
            if (exact && exact.promptCount === 0) return exact;
            if (!this.#publicSessions.has(publicId)) {
                const unbound = this.#activeSessions().filter(
                    (session) => !session.publicId && session.promptCount === 0,
                );
                if (unbound.length === 1) {
                    this.#bindPublicId(unbound[0], publicId);
                    return unbound[0];
                }
            }
            return this.#createSession({
                publicId,
                generationType: 'unknown',
                status: 'unknown',
                statusEvent: null,
                statusUpdatedAt: now,
                active: true,
                implicit: true,
            });
        }

        const candidates = this.#activeSessions().filter(
            (session) => session.promptCount === 0,
        );
        if (candidates.length === 1) return candidates[0];
        return this.#createSession({
            publicId: null,
            generationType: 'unknown',
            status: 'unknown',
            statusEvent: null,
            statusUpdatedAt: now,
            active: candidates.length === 0,
            implicit: true,
        });
    }

    #bindPublicId(session, publicId) {
        if (session.overflow) return;
        session.publicId = publicId;
        const sessions = this.#publicSessions.get(publicId) ?? new Set();
        sessions.add(session);
        this.#publicSessions.set(publicId, sessions);
        if (sessions.size > 1) {
            for (const candidate of sessions) candidate.publicIdCollision = true;
            this.#flushAmbiguousPublicBuffers(publicId);
            return;
        }
        const lore = this.#publicLore.get(publicId);
        if (lore?.length) session.lore = lore[lore.length - 1].value;
        this.#publicLore.delete(publicId);
        if (!session.active) this.#flushPublicUsage(session);
    }

    #uniquePublicSession(publicId) {
        const sessions = this.#publicSessions.get(publicId);
        return sessions?.size === 1 ? [...sessions][0] : null;
    }

    #activeSessions() {
        return [...this.#sessions].filter((session) => session.active);
    }

    #sessionView(session) {
        if (!session) return null;
        return Object.freeze({
            generationType: session.generationType,
            status: session.status,
            statusEvent: session.statusEvent,
            statusUpdatedAt: session.statusUpdatedAt,
            hasPublicId: Boolean(session.publicId),
            publicIdCollision: session.publicIdCollision,
            overflow: Boolean(session.overflow),
            usageRecordCount: session.usageRecords.length,
        });
    }

    #sessionHasPendingPrompt(session) {
        for (const pending of this.#pendingByType.values()) {
            if (pending.some((prompt) => !prompt.settled && prompt.session === session)) {
                return true;
            }
        }
        return false;
    }

    #ensureSessionCapacity() {
        if (this.#sessions.size < this.#maxSessions) return;
        const removable = [...this.#sessions]
            .filter((session) => !session.active && !this.#sessionHasPendingPrompt(session))
            .sort((left, right) => (
                left.lastUpdatedAt - right.lastUpdatedAt
                || left.ordinal - right.ordinal
            ));
        while (this.#sessions.size >= this.#maxSessions && removable.length > 0) {
            this.#evictSession(removable.shift());
        }
    }

    #evictSession(session) {
        if (!this.#sessions.has(session)) return false;
        if (session.active || this.#sessionHasPendingPrompt(session)) return false;
        this.#sessions.delete(session);
        if (session.publicId) {
            const sessions = this.#publicSessions.get(session.publicId);
            sessions?.delete(session);
            if (sessions?.size === 0) this.#publicSessions.delete(session.publicId);
            if (sessions?.size === 1) {
                const [remaining] = sessions;
                remaining.publicIdCollision = false;
            }
        }
        session.snapshots.clear();
        session.usageRecords = [];
        return true;
    }

    #trimPublicBuffer(buffer, kind) {
        while (buffer.size > this.#maxBufferedPublicIds) {
            const oldestId = buffer.keys().next().value;
            const records = buffer.get(oldestId) ?? [];
            buffer.delete(oldestId);
            for (const record of records) {
                if (kind === 'usage') {
                    this.#appendUnlinkedUsage(
                        record.unlinkedUsage ?? record.usage,
                        'buffer-overflow',
                        true,
                        record.eventName,
                        record.recordedAt,
                    );
                } else {
                    this.#appendUnlinkedLore(
                        record.value,
                        'buffer-overflow',
                        true,
                        record.recordedAt,
                    );
                }
            }
        }
    }

    #attachUsage(
        session,
        usage,
        eventName,
        recordedAt,
        correlationMethod = 'explicit-id',
        hasPublicId = true,
    ) {
        const record = {
            usage,
            eventName: typeof eventName === 'string' ? eventName : null,
            recordedAt,
            correlationMethod,
            hasPublicId,
        };
        session.usageRecords.push(record);
        session.lastUpdatedAt = Math.max(session.lastUpdatedAt, recordedAt);
        return { ...record };
    }

    #flushPublicUsage(session) {
        if (!session.publicId || session.publicIdCollision) return;
        const sessions = this.#publicSessions.get(session.publicId);
        if (sessions?.size !== 1) return;
        const records = this.#publicUsage.get(session.publicId) ?? [];
        this.#publicUsage.delete(session.publicId);
        for (const record of records) {
            this.#attachUsage(
                session,
                record.usage,
                record.eventName,
                record.recordedAt,
            );
        }
    }

    #flushAmbiguousPublicBuffers(publicId) {
        const usage = this.#publicUsage.get(publicId) ?? [];
        this.#publicUsage.delete(publicId);
        for (const record of usage) {
            this.#appendUnlinkedUsage(
                record.unlinkedUsage ?? record.usage,
                'ambiguous-public-id',
                true,
                record.eventName,
                record.recordedAt,
            );
        }
        const lore = this.#publicLore.get(publicId) ?? [];
        this.#publicLore.delete(publicId);
        for (const record of lore) {
            this.#appendUnlinkedLore(
                record.value,
                'ambiguous-public-id',
                true,
                record.recordedAt,
            );
        }
    }

    #appendUnlinkedUsage(usage, reason, hasPublicId, eventName, recordedAt) {
        const record = {
            usage,
            reason,
            hasPublicId,
            eventName: typeof eventName === 'string' ? eventName : null,
            recordedAt,
        };
        this.#unlinkedUsage.push(record);
        this.#unlinkedUsage = this.#unlinkedUsage.slice(-this.#maxUnlinkedRecords);
        return { ...record };
    }

    #appendUnlinkedLore(value, reason, hasPublicId, recordedAt) {
        const record = { value, reason, hasPublicId, recordedAt };
        this.#unlinkedLore.push(record);
        this.#unlinkedLore = this.#unlinkedLore.slice(-this.#maxUnlinkedRecords);
        return record;
    }
}
