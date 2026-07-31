import { migrateSnapshot } from './migrations.js';

const INDEX_KEY = 'chat-index';
const MUTATION_LOCK_KEY = 'storage-mutation';
const SUMMARY_KEY = 'storage-summary:v1';
const SUMMARY_VERSION = 1;
const TIMELINE_INDEX_VERSION = 2;
const LEGACY_TIMELINE_PREFIX = 'timeline:';
const TIMELINE_INDEX_PREFIX = 'timeline-index:v2:';
const SNAPSHOT_PREFIX = 'snapshot:v2:';
const SUMMARY_YIELD_BUDGET_MS = 8;

function approximateJsonBytes(value) {
    try {
        return new TextEncoder().encode(JSON.stringify(value)).length;
    } catch {
        return 0;
    }
}

function normalizeStoredSummary(value) {
    if (
        !value
        || typeof value !== 'object'
        || value.version !== SUMMARY_VERSION
        || value.complete !== true
        || !Number.isFinite(value.chatCount)
        || !Number.isFinite(value.snapshotCount)
        || !Number.isFinite(value.approximateBytes)
    ) {
        return null;
    }
    return {
        version: SUMMARY_VERSION,
        complete: true,
        chatCount: Math.max(0, Math.trunc(value.chatCount)),
        timelineRecordCount: Math.max(
            0,
            Math.trunc(value.timelineRecordCount ?? value.chatCount),
        ),
        snapshotCount: Math.max(0, Math.trunc(value.snapshotCount)),
        approximateBytes: Math.max(0, Math.trunc(value.approximateBytes)),
        updatedAt: Number(value.updatedAt) || null,
    };
}

function emptyStoredSummary() {
    return {
        version: SUMMARY_VERSION,
        complete: true,
        chatCount: 0,
        timelineRecordCount: 0,
        snapshotCount: 0,
        approximateBytes: 0,
        updatedAt: Date.now(),
    };
}

function yieldToMainThread() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function encodeKeyPart(value) {
    return encodeURIComponent(String(value ?? ''));
}

function decodeKeyPart(value) {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function normalizeTimelineEntry(value) {
    if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !value.id) {
        return null;
    }
    return {
        id: value.id,
        timestamp: Number(value.timestamp) || 0,
        approximateBytes: Math.max(0, Math.trunc(Number(value.approximateBytes) || 0)),
    };
}

function normalizeTimelineIndex(value, chatId) {
    if (
        !value
        || typeof value !== 'object'
        || value.version !== TIMELINE_INDEX_VERSION
        || !Array.isArray(value.entries)
    ) {
        return null;
    }
    const entriesById = new Map();
    for (const rawEntry of value.entries) {
        const entry = normalizeTimelineEntry(rawEntry);
        if (entry) entriesById.set(entry.id, entry);
    }
    return {
        version: TIMELINE_INDEX_VERSION,
        chatId,
        entries: [...entriesById.values()]
            .sort((left, right) => left.timestamp - right.timestamp),
        updatedAt: Number(value.updatedAt) || null,
    };
}

function emptyTimelineIndex(chatId) {
    return {
        version: TIMELINE_INDEX_VERSION,
        chatId,
        entries: [],
        updatedAt: Date.now(),
    };
}

function timelineEntry(snapshot, approximateBytes = approximateJsonBytes(snapshot)) {
    return {
        id: snapshot.id,
        timestamp: Number(snapshot.timestamp) || 0,
        approximateBytes,
    };
}

function normalizeReadLimit(value, maximum) {
    if (value == null || value === '') return maximum;
    const number = Number(value);
    if (!Number.isFinite(number)) return maximum;
    return Math.min(maximum, Math.max(1, Math.trunc(number)));
}

function normalizeRetentionLimit(value, fallback = 100) {
    const number = Number(value);
    return Number.isFinite(number)
        ? Math.max(1, Math.trunc(number))
        : fallback;
}

function sumEntryBytes(entries) {
    return entries.reduce(
        (total, entry) => total + (Number(entry.approximateBytes) || 0),
        0,
    );
}

function legacySnapshotRecords(value) {
    const snapshotsById = new Map();
    for (const snapshot of Array.isArray(value) ? value : []) {
        if (
            snapshot
            && typeof snapshot === 'object'
            && typeof snapshot.id === 'string'
            && snapshot.id
        ) {
            snapshotsById.set(snapshot.id, snapshot);
        }
    }
    return [...snapshotsById.values()]
        .sort((left, right) => (Number(left.timestamp) || 0) - (Number(right.timestamp) || 0));
}

function legacyRetentionEntry(snapshot) {
    return {
        id: snapshot.id,
        timestamp: Number(snapshot.timestamp) || 0,
        approximateBytes: null,
        legacySnapshot: snapshot,
    };
}

function retentionEntryBytes(entry) {
    return Number.isFinite(entry?.approximateBytes)
        ? Math.max(0, Number(entry.approximateBytes))
        : approximateJsonBytes(entry?.legacySnapshot);
}

export class SnapshotStore {
    constructor({
        namespace,
        maxSnapshotsPerChat = 100,
        summaryYield = yieldToMainThread,
        migrationYield = yieldToMainThread,
        summaryYieldBudgetMs = SUMMARY_YIELD_BUDGET_MS,
    }) {
        this.namespace = namespace;
        this.maxSnapshotsPerChat = normalizeRetentionLimit(maxSnapshotsPerChat);
        this.summaryYield = summaryYield;
        this.migrationYield = migrationYield;
        this.summaryYieldBudgetMs = Math.max(0, Number(summaryYieldBudgetMs) || 0);
        this.backend = null;
        this.backendStatus = {
            type: 'memory',
            persistent: false,
            driver: null,
            fallbackReason: 'localforage-unavailable',
        };
        this.memory = new Map();
        this.locks = new Map();
        this.mutationRevision = 0;
        this.summaryRebuildPromise = null;
    }

    async initialize() {
        const localforage = globalThis.SillyTavern?.libs?.localforage;
        if (!localforage?.createInstance) return this.getStatus();
        try {
            const backend = localforage.createInstance({
                name: 'ST_DevTools',
                storeName: 'snapshots_v1',
                description: 'Read-only prompt timeline snapshots.',
            });
            await backend.ready?.();
            this.backend = backend;
            const driver = typeof backend.driver === 'function'
                ? backend.driver()
                : null;
            this.backendStatus = {
                type: String(driver).toLocaleLowerCase().includes('indexeddb')
                    || driver === 'asyncStorage'
                    ? 'indexeddb'
                    : 'persistent',
                persistent: true,
                driver,
                fallbackReason: null,
            };
        } catch {
            this.backend = null;
            this.backendStatus = {
                type: 'memory',
                persistent: false,
                driver: null,
                fallbackReason: 'backend-initialization-failed',
            };
        }
        return this.getStatus();
    }

    getStatus() {
        return { ...this.backendStatus };
    }

    setMaxSnapshotsPerChat(value) {
        this.maxSnapshotsPerChat = normalizeRetentionLimit(
            value,
            this.maxSnapshotsPerChat,
        );
        return this.maxSnapshotsPerChat;
    }

    timelineKey(chatId) {
        return `${LEGACY_TIMELINE_PREFIX}${chatId || '__global__'}`;
    }

    timelineIndexKey(chatId) {
        return `${TIMELINE_INDEX_PREFIX}${encodeKeyPart(chatId || '__global__')}`;
    }

    snapshotKey(chatId, snapshotId) {
        return `${SNAPSHOT_PREFIX}${encodeKeyPart(chatId || '__global__')}:${
            encodeKeyPart(snapshotId)
        }`;
    }

    chatIdFromTimelineIndexKey(key) {
        if (typeof key !== 'string' || !key.startsWith(TIMELINE_INDEX_PREFIX)) {
            return null;
        }
        return decodeKeyPart(key.slice(TIMELINE_INDEX_PREFIX.length));
    }

    chatIdFromLegacyTimelineKey(key) {
        if (typeof key !== 'string' || !key.startsWith(LEGACY_TIMELINE_PREFIX)) {
            return null;
        }
        return key.slice(LEGACY_TIMELINE_PREFIX.length);
    }

    async read(key, fallback) {
        if (this.backend) {
            return (await this.backend.getItem(key)) ?? fallback;
        }
        return this.memory.has(key) ? this.memory.get(key) : fallback;
    }

    async write(key, value) {
        if (this.backend) {
            await this.backend.setItem(key, value);
            return;
        }
        this.memory.set(key, value);
    }

    async remove(key) {
        if (this.backend) {
            await this.backend.removeItem(key);
            return;
        }
        this.memory.delete(key);
    }

    async withLock(key, operation) {
        const previous = this.locks.get(key) ?? Promise.resolve();
        const current = previous
            .catch(() => undefined)
            .then(operation);
        this.locks.set(key, current);
        try {
            return await current;
        } finally {
            if (this.locks.get(key) === current) {
                this.locks.delete(key);
            }
        }
    }

    async maybeYield(lastYieldAt, yieldOperation = this.summaryYield) {
        if (Date.now() - lastYieldAt < this.summaryYieldBudgetMs) {
            return lastYieldAt;
        }
        await yieldOperation();
        return Date.now();
    }

    async readTimelineIndexUnlocked(chatId) {
        const indexKey = this.timelineIndexKey(chatId);
        const legacyKey = this.timelineKey(chatId);
        const storedIndex = normalizeTimelineIndex(
            await this.read(indexKey, null),
            chatId,
        );
        if (storedIndex) {
            return storedIndex;
        }

        const legacyStored = await this.read(legacyKey, null);
        if (!Array.isArray(legacyStored)) {
            return emptyTimelineIndex(chatId);
        }

        this.mutationRevision += 1;
        return this.migrateLegacyTimelineUnlocked(
            chatId,
            legacySnapshotRecords(legacyStored),
            this.maxSnapshotsPerChat,
        );
    }

    async migrateLegacyTimelineUnlocked(chatId, legacyRecords, limit) {
        const indexKey = this.timelineIndexKey(chatId);
        const legacyKey = this.timelineKey(chatId);
        const retained = legacyRecords.slice(-normalizeRetentionLimit(
            limit,
            this.maxSnapshotsPerChat,
        ));
        const entries = [];
        let lastYieldAt = Date.now();

        for (const legacySnapshot of retained) {
            const snapshot = migrateSnapshot(legacySnapshot);
            const bytes = approximateJsonBytes(snapshot);
            await this.write(this.snapshotKey(chatId, snapshot.id), snapshot);
            entries.push(timelineEntry(snapshot, bytes));
            lastYieldAt = await this.maybeYield(lastYieldAt, this.migrationYield);
        }

        const migratedIndex = {
            version: TIMELINE_INDEX_VERSION,
            chatId,
            entries,
            updatedAt: Date.now(),
        };
        if (entries.length > 0) {
            await this.write(indexKey, migratedIndex);
            await this.addChatToIndex(chatId);
        } else {
            await this.remove(indexKey);
            await this.removeChatFromIndex(chatId);
        }
        await this.remove(legacyKey);
        return migratedIndex;
    }

    async readSnapshotUnlocked(chatId, snapshotId) {
        const stored = await this.read(this.snapshotKey(chatId, snapshotId), null);
        if (!stored) return null;
        return migrateSnapshot(stored);
    }

    async writeTimelineIndex(chatId, entries) {
        const key = this.timelineIndexKey(chatId);
        if (entries.length === 0) {
            await this.remove(key);
            return;
        }
        await this.write(key, {
            version: TIMELINE_INDEX_VERSION,
            chatId,
            entries,
            updatedAt: Date.now(),
        });
    }

    async updateCompleteSummary({ chatDelta = 0, snapshotDelta = 0, byteDelta = 0 }) {
        try {
            const summary = normalizeStoredSummary(await this.read(SUMMARY_KEY, null));
            if (!summary) return false;
            await this.write(SUMMARY_KEY, {
                ...summary,
                chatCount: Math.max(0, summary.chatCount + chatDelta),
                timelineRecordCount: Math.max(
                    0,
                    summary.timelineRecordCount + chatDelta,
                ),
                snapshotCount: Math.max(0, summary.snapshotCount + snapshotDelta),
                approximateBytes: Math.max(0, summary.approximateBytes + byteDelta),
                updatedAt: Date.now(),
            });
            return true;
        } catch {
            try {
                await this.remove(SUMMARY_KEY);
            } catch {
                // Snapshot persistence remains successful even if optional metadata cannot update.
            }
            return false;
        }
    }

    async addChatToIndex(chatId) {
        await this.withLock(INDEX_KEY, async () => {
            const chatIndex = await this.read(INDEX_KEY, []);
            if (!chatIndex.includes(chatId)) {
                await this.write(INDEX_KEY, [...chatIndex, chatId]);
            }
        });
    }

    async removeChatFromIndex(chatId) {
        await this.withLock(INDEX_KEY, async () => {
            const chatIndex = await this.read(INDEX_KEY, []);
            const next = chatIndex.filter((item) => item !== chatId);
            if (next.length === chatIndex.length) return;
            if (next.length > 0) {
                await this.write(INDEX_KEY, next);
            } else {
                await this.remove(INDEX_KEY);
            }
        });
    }

    async addSnapshot(snapshot) {
        const normalizedSnapshot = migrateSnapshot(snapshot);
        const chatId = normalizedSnapshot.chatId || '__global__';
        const indexKey = this.timelineIndexKey(chatId);
        await this.withLock(MUTATION_LOCK_KEY, async () => {
            this.mutationRevision += 1;
            await this.withLock(indexKey, async () => {
                const index = await this.readTimelineIndexUnlocked(chatId);
                const previousEntries = index.entries;
                const bytes = approximateJsonBytes(normalizedSnapshot);
                const candidate = timelineEntry(normalizedSnapshot, bytes);
                const nextEntries = [
                    ...previousEntries.filter((entry) => entry.id !== candidate.id),
                    candidate,
                ]
                    .sort((left, right) => left.timestamp - right.timestamp)
                    .slice(-this.maxSnapshotsPerChat);
                const retainedIds = new Set(nextEntries.map(({ id }) => id));
                const includesCandidate = retainedIds.has(candidate.id);
                const removedEntries = previousEntries.filter(
                    (entry) => !retainedIds.has(entry.id),
                );

                if (includesCandidate) {
                    await this.write(
                        this.snapshotKey(chatId, normalizedSnapshot.id),
                        normalizedSnapshot,
                    );
                }
                await this.writeTimelineIndex(chatId, nextEntries);
                for (const entry of removedEntries) {
                    await this.remove(this.snapshotKey(chatId, entry.id));
                }
                if (nextEntries.length > 0) {
                    await this.addChatToIndex(chatId);
                } else {
                    await this.removeChatFromIndex(chatId);
                }
                await this.updateCompleteSummary({
                    chatDelta: previousEntries.length === 0 && nextEntries.length > 0 ? 1 : 0,
                    snapshotDelta: nextEntries.length - previousEntries.length,
                    byteDelta: sumEntryBytes(nextEntries) - sumEntryBytes(previousEntries),
                });
            });
        });
        return normalizedSnapshot;
    }

    async getTimelinePage(chatId, { limit = this.maxSnapshotsPerChat } = {}) {
        const normalizedChatId = chatId || '__global__';
        const indexKey = this.timelineIndexKey(normalizedChatId);
        return this.withLock(MUTATION_LOCK_KEY, () => (
            this.withLock(indexKey, async () => {
                const index = await this.readTimelineIndexUnlocked(normalizedChatId);
                const readLimit = normalizeReadLimit(limit, this.maxSnapshotsPerChat);
                const selectedEntries = index.entries.slice(-readLimit);
                const snapshots = (await Promise.all(selectedEntries.map(
                    (entry) => this.readSnapshotUnlocked(normalizedChatId, entry.id),
                ))).filter(Boolean);
                return {
                    snapshots,
                    totalCount: index.entries.length,
                    loadedCount: snapshots.length,
                    limit: readLimit,
                };
            })
        ));
    }

    async getTimeline(chatId, options = {}) {
        return (await this.getTimelinePage(chatId, options)).snapshots;
    }

    async getSnapshot(chatId, snapshotId) {
        const normalizedChatId = chatId || '__global__';
        const indexKey = this.timelineIndexKey(normalizedChatId);
        return this.withLock(MUTATION_LOCK_KEY, () => (
            this.withLock(indexKey, async () => {
                const index = await this.readTimelineIndexUnlocked(normalizedChatId);
                if (!index.entries.some(({ id }) => id === snapshotId)) return null;
                return this.readSnapshotUnlocked(normalizedChatId, snapshotId);
            })
        ));
    }

    async getLatest(chatId) {
        const timeline = await this.getTimeline(chatId, { limit: 1 });
        return timeline.at(-1) ?? null;
    }

    async deleteSnapshot(chatId, snapshotId) {
        return (await this.deleteSnapshots(chatId, [snapshotId])) > 0;
    }

    async deleteSnapshots(chatId, snapshotIds) {
        const ids = new Set(
            [...(snapshotIds ?? [])].filter((snapshotId) => (
                typeof snapshotId === 'string' && snapshotId
            )),
        );
        if (ids.size === 0) return 0;
        const normalizedChatId = chatId || '__global__';
        const indexKey = this.timelineIndexKey(normalizedChatId);
        return this.withLock(MUTATION_LOCK_KEY, () => (
            this.withLock(indexKey, async () => {
                this.mutationRevision += 1;
                const index = await this.readTimelineIndexUnlocked(normalizedChatId);
                const previousEntries = index.entries;
                const nextEntries = previousEntries.filter((entry) => !ids.has(entry.id));
                const removedEntries = previousEntries.filter((entry) => ids.has(entry.id));
                const deletedCount = removedEntries.length;
                if (deletedCount === 0) {
                    if (previousEntries.length === 0) {
                        await this.removeChatFromIndex(normalizedChatId);
                    }
                    return 0;
                }

                await this.writeTimelineIndex(normalizedChatId, nextEntries);
                for (const entry of removedEntries) {
                    await this.remove(this.snapshotKey(normalizedChatId, entry.id));
                }
                if (nextEntries.length > 0) {
                    await this.addChatToIndex(normalizedChatId);
                } else {
                    await this.removeChatFromIndex(normalizedChatId);
                }
                await this.updateCompleteSummary({
                    chatDelta: nextEntries.length === 0 ? -1 : 0,
                    snapshotDelta: -deletedCount,
                    byteDelta: -sumEntryBytes(removedEntries),
                });
                return deletedCount;
            })
        ));
    }

    async storageKeys() {
        if (this.backend && typeof this.backend.keys === 'function') {
            return this.backend.keys();
        }
        return [...this.memory.keys()];
    }

    timelineContainers(keys) {
        const containers = new Map();
        for (const key of keys) {
            const indexedChatId = this.chatIdFromTimelineIndexKey(key);
            if (indexedChatId != null) {
                containers.set(indexedChatId, { chatId: indexedChatId, indexKey: key });
                continue;
            }
            const legacyChatId = this.chatIdFromLegacyTimelineKey(key);
            if (legacyChatId != null && !containers.has(legacyChatId)) {
                containers.set(legacyChatId, { chatId: legacyChatId, legacyKey: key });
            }
        }
        return [...containers.values()];
    }

    async retentionEntriesForContainer(container) {
        if (container.indexKey) {
            return normalizeTimelineIndex(
                await this.read(container.indexKey, null),
                container.chatId,
            )?.entries ?? [];
        }
        if (container.legacyKey) {
            const stored = await this.read(container.legacyKey, []);
            return legacySnapshotRecords(stored).map(legacyRetentionEntry);
        }
        return [];
    }

    async getRetentionPrunePreview(value) {
        const limit = normalizeRetentionLimit(value, this.maxSnapshotsPerChat);
        return this.withLock(MUTATION_LOCK_KEY, async () => {
            const containers = this.timelineContainers(await this.storageKeys());
            let affectedChatCount = 0;
            let snapshotCount = 0;
            let approximateBytes = 0;
            let lastYieldAt = Date.now();

            for (const container of containers) {
                const entries = await this.retentionEntriesForContainer(container);
                const removedEntries = entries.slice(
                    0,
                    Math.max(0, entries.length - limit),
                );
                if (removedEntries.length === 0) continue;
                affectedChatCount += 1;
                snapshotCount += removedEntries.length;
                approximateBytes += removedEntries.reduce(
                    (total, entry) => total + retentionEntryBytes(entry),
                    0,
                );
                lastYieldAt = await this.maybeYield(lastYieldAt);
            }

            return {
                limit,
                affectedChatCount,
                snapshotCount,
                approximateBytes,
                revision: this.mutationRevision,
            };
        });
    }

    async applyRetentionLimit(value, { expectedRevision = null } = {}) {
        const limit = normalizeRetentionLimit(value, this.maxSnapshotsPerChat);
        if (limit >= this.maxSnapshotsPerChat) {
            this.maxSnapshotsPerChat = limit;
            return {
                limit,
                affectedChatCount: 0,
                snapshotCount: 0,
                approximateBytes: 0,
            };
        }

        return this.withLock(MUTATION_LOCK_KEY, async () => {
            if (
                Number.isFinite(expectedRevision)
                && expectedRevision !== this.mutationRevision
            ) {
                const error = new Error('Snapshot retention preview is stale.');
                error.code = 'retention-preview-stale';
                throw error;
            }
            this.mutationRevision += 1;
            const containers = this.timelineContainers(await this.storageKeys());
            let affectedChatCount = 0;
            let snapshotCount = 0;
            let approximateBytes = 0;

            try {
                for (const container of containers) {
                    const { chatId } = container;
                    const indexKey = this.timelineIndexKey(chatId);
                    await this.withLock(indexKey, async () => {
                        if (container.legacyKey && !container.indexKey) {
                            const stored = await this.read(container.legacyKey, []);
                            const records = legacySnapshotRecords(stored);
                            const removedRecords = records.slice(
                                0,
                                Math.max(0, records.length - limit),
                            );
                            if (removedRecords.length === 0) return;
                            await this.migrateLegacyTimelineUnlocked(chatId, records, limit);
                            for (const snapshot of removedRecords) {
                                await this.remove(this.snapshotKey(chatId, snapshot.id));
                            }
                            affectedChatCount += 1;
                            snapshotCount += removedRecords.length;
                            approximateBytes += removedRecords.reduce(
                                (total, snapshot) => total + approximateJsonBytes(snapshot),
                                0,
                            );
                            return;
                        }
                        const index = await this.readTimelineIndexUnlocked(chatId);
                        const removedEntries = index.entries.slice(
                            0,
                            Math.max(0, index.entries.length - limit),
                        );
                        if (removedEntries.length === 0) return;
                        const retainedEntries = index.entries.slice(-limit);

                        await this.writeTimelineIndex(chatId, retainedEntries);
                        for (const entry of removedEntries) {
                            await this.remove(this.snapshotKey(chatId, entry.id));
                        }
                        affectedChatCount += 1;
                        snapshotCount += removedEntries.length;
                        approximateBytes += sumEntryBytes(removedEntries);
                    });
                }

                await this.updateCompleteSummary({
                    snapshotDelta: -snapshotCount,
                    byteDelta: -approximateBytes,
                });
                this.maxSnapshotsPerChat = limit;
                return {
                    limit,
                    affectedChatCount,
                    snapshotCount,
                    approximateBytes,
                };
            } catch (error) {
                try {
                    await this.remove(SUMMARY_KEY);
                } catch {
                    // A later summary rebuild will retry if metadata cleanup also fails.
                }
                throw error;
            }
        });
    }

    async clearAll() {
        return this.withLock(MUTATION_LOCK_KEY, async () => {
            this.mutationRevision += 1;
            const keys = await this.storageKeys();
            const containers = this.timelineContainers(keys);
            let chatCount = 0;
            let snapshotCount = 0;

            for (const container of containers) {
                if (container.indexKey) {
                    const index = normalizeTimelineIndex(
                        await this.read(container.indexKey, null),
                        container.chatId,
                    );
                    if (index?.entries.length) {
                        chatCount += 1;
                        snapshotCount += index.entries.length;
                    }
                } else if (container.legacyKey) {
                    const stored = await this.read(container.legacyKey, []);
                    const count = Array.isArray(stored) ? stored.length : 0;
                    if (count > 0) {
                        chatCount += 1;
                        snapshotCount += count;
                    }
                }
            }

            const dataKeys = keys.filter((key) => (
                typeof key === 'string'
                && (
                    key.startsWith(LEGACY_TIMELINE_PREFIX)
                    || key.startsWith(TIMELINE_INDEX_PREFIX)
                    || key.startsWith(SNAPSHOT_PREFIX)
                    || key === INDEX_KEY
                    || key === SUMMARY_KEY
                )
            ));
            for (const key of dataKeys) {
                await this.remove(key);
            }
            return { chatCount, snapshotCount };
        });
    }

    async clearTimeline(chatId) {
        const normalizedChatId = chatId || '__global__';
        const indexKey = this.timelineIndexKey(normalizedChatId);
        await this.withLock(MUTATION_LOCK_KEY, () => (
            this.withLock(indexKey, async () => {
                this.mutationRevision += 1;
                const index = await this.readTimelineIndexUnlocked(normalizedChatId);
                const entries = index.entries;
                await this.remove(indexKey);
                await this.remove(this.timelineKey(normalizedChatId));
                for (const entry of entries) {
                    await this.remove(this.snapshotKey(normalizedChatId, entry.id));
                }
                await this.removeChatFromIndex(normalizedChatId);
                if (entries.length > 0) {
                    await this.updateCompleteSummary({
                        chatDelta: -1,
                        snapshotDelta: -entries.length,
                        byteDelta: -sumEntryBytes(entries),
                    });
                }
            })
        ));
    }

    async getChatIds() {
        return this.withLock(INDEX_KEY, async () => {
            const chatIds = await this.read(INDEX_KEY, []);
            return [...new Set(chatIds.filter((chatId) => typeof chatId === 'string' && chatId))];
        });
    }

    async getAllTimelines() {
        return this.getAllStoredTimelines();
    }

    async getAllStoredTimelines() {
        const [keys, indexedChatIds] = await Promise.all([
            this.storageKeys(),
            this.getChatIds(),
        ]);
        const chatIds = new Set(indexedChatIds);
        for (const { chatId } of this.timelineContainers(keys)) {
            chatIds.add(chatId);
        }
        const timelines = [];
        for (const chatId of chatIds) {
            const timeline = await this.getTimeline(
                chatId,
                { limit: this.maxSnapshotsPerChat },
            );
            if (timeline.length > 0) timelines.push({ chatId, timeline });
        }
        return timelines;
    }

    async getStorageSummary() {
        const storedSummary = normalizeStoredSummary(await this.read(SUMMARY_KEY, null));
        if (storedSummary) {
            return {
                ...this.getStatus(),
                ...storedSummary,
                rebuilding: Boolean(this.summaryRebuildPromise),
                maxSnapshotsPerChat: this.maxSnapshotsPerChat,
            };
        }

        const keys = await this.storageKeys();
        const containers = this.timelineContainers(keys);
        if (containers.length === 0) {
            const empty = emptyStoredSummary();
            return {
                ...this.getStatus(),
                ...empty,
                rebuilding: false,
                maxSnapshotsPerChat: this.maxSnapshotsPerChat,
            };
        }
        return {
            ...this.getStatus(),
            complete: false,
            rebuilding: Boolean(this.summaryRebuildPromise),
            chatCount: containers.length,
            snapshotCount: null,
            approximateBytes: null,
            maxSnapshotsPerChat: this.maxSnapshotsPerChat,
        };
    }

    async performStorageSummaryRebuild() {
        const revision = this.mutationRevision;
        const keys = await this.storageKeys();
        const containers = this.timelineContainers(keys);
        let chatCount = 0;
        let snapshotCount = 0;
        let approximateBytes = 0;
        let lastYieldAt = Date.now();

        for (const container of containers) {
            if (revision !== this.mutationRevision) return this.getStorageSummary();
            if (container.indexKey) {
                const index = normalizeTimelineIndex(
                    await this.read(container.indexKey, null),
                    container.chatId,
                );
                if (index?.entries.length) {
                    chatCount += 1;
                    snapshotCount += index.entries.length;
                    approximateBytes += sumEntryBytes(index.entries);
                }
            } else if (container.legacyKey) {
                const stored = await this.read(container.legacyKey, []);
                const snapshots = legacySnapshotRecords(stored);
                if (snapshots.length > 0) {
                    chatCount += 1;
                    snapshotCount += snapshots.length;
                    for (const snapshot of snapshots) {
                        approximateBytes += approximateJsonBytes(snapshot);
                        lastYieldAt = await this.maybeYield(lastYieldAt);
                        if (revision !== this.mutationRevision) {
                            return this.getStorageSummary();
                        }
                    }
                }
            }
            lastYieldAt = await this.maybeYield(lastYieldAt);
        }

        const summary = {
            version: SUMMARY_VERSION,
            complete: true,
            chatCount,
            timelineRecordCount: containers.length,
            snapshotCount,
            approximateBytes,
            updatedAt: Date.now(),
        };
        let committed = false;
        await this.withLock(MUTATION_LOCK_KEY, async () => {
            if (revision !== this.mutationRevision) return;
            await this.write(SUMMARY_KEY, summary);
            committed = true;
        });
        return committed
            ? {
                ...this.getStatus(),
                ...summary,
                rebuilding: false,
                maxSnapshotsPerChat: this.maxSnapshotsPerChat,
            }
            : this.getStorageSummary();
    }

    async rebuildStorageSummary() {
        if (this.summaryRebuildPromise) return this.summaryRebuildPromise;
        this.summaryRebuildPromise = this.performStorageSummaryRebuild();
        try {
            return await this.summaryRebuildPromise;
        } finally {
            this.summaryRebuildPromise = null;
        }
    }
}
