import { migrateSnapshot } from './migrations.js';
import { deepClone } from './model.js';
import {
    normalizeRetentionPolicy,
    planRetentionGc,
} from './retention-policy.js';
import {
    inspectStorageIntegrityState,
    integrityRepairTargetMetadata,
} from './storage-integrity.js';

const INDEX_KEY = 'chat-index';
const MUTATION_LOCK_KEY = 'storage-mutation';
const SUMMARY_KEY = 'storage-summary:v1';
const SUMMARY_VERSION = 1;
const TIMELINE_INDEX_VERSION = 2;
const LEGACY_TIMELINE_PREFIX = 'timeline:';
const TIMELINE_INDEX_PREFIX = 'timeline-index:v2:';
const SNAPSHOT_PREFIX = 'snapshot:v2:';
const SUMMARY_YIELD_BUDGET_MS = 8;
const CORRUPT_ENTRY_LIMIT = 20;
const INTEGRITY_METADATA_LIMIT = 100;
const MAX_POLICY_SNAPSHOTS_PER_CHAT = 5_000;
const MAX_POLICY_AGE_DAYS = 3_650;
const MAX_POLICY_TOTAL_BYTES = 2_147_483_648;
const CORRUPT_ENTRY_ID_MAX_LENGTH = 256;
const CORRUPT_SNAPSHOT_MESSAGE = '저장된 스냅샷을 변환하지 못했습니다.';
const MISSING_SNAPSHOT_MESSAGE = '저장된 스냅샷 레코드를 찾을 수 없습니다.';

function approximateJsonBytes(value) {
    try {
        return new TextEncoder().encode(JSON.stringify(value)).length;
    } catch {
        return 0;
    }
}

function rawStorageValueFingerprint(value) {
    try {
        return JSON.stringify(value);
    } catch {
        return null;
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

function attachStorageChatId(snapshot, chatId) {
    if (!snapshot || typeof snapshot !== 'object') return snapshot;
    Object.defineProperty(snapshot, 'storageChatId', {
        configurable: true,
        enumerable: false,
        writable: false,
        value: String(chatId || '__global__'),
    });
    return snapshot;
}

function snapshotMatchesStoragePartition(snapshot, chatId) {
    if ((snapshot?.chatId || '__global__') === chatId) return true;
    return (
        ['redacted', 'metadata'].includes(snapshot?.privacy?.mode)
        && snapshot?.privacy?.rawChatIdIncluded === false
        && /^chat-[0-9a-f]{24}$/u.test(String(snapshot?.chatId ?? ''))
    );
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

function normalizeStoreRetentionPolicy(value, fallbackCount = 100) {
    const source = value && typeof value === 'object' ? value : {};
    const normalized = normalizeRetentionPolicy({
        maxSnapshotsPerChat:
            source.maxSnapshotsPerChat
            ?? source.timelineRetentionLimit
            ?? fallbackCount,
        maxAgeDays: source.maxAgeDays ?? source.retentionMaxAgeDays ?? 0,
        maxTotalBytes: source.maxTotalBytes ?? source.retentionMaxBytes ?? 0,
    });
    return {
        maxSnapshotsPerChat: Math.min(
            MAX_POLICY_SNAPSHOTS_PER_CHAT,
            normalized.maxSnapshotsPerChat,
        ),
        maxAgeDays: Math.min(MAX_POLICY_AGE_DAYS, normalized.maxAgeDays),
        maxTotalBytes: Math.min(
            MAX_POLICY_TOTAL_BYTES,
            normalized.maxTotalBytes,
        ),
    };
}

function sumEntryBytes(entries) {
    return entries.reduce(
        (total, entry) => total + (Number(entry.approximateBytes) || 0),
        0,
    );
}

function timelineEntriesEqual(left, right) {
    if (left.length !== right.length) return false;
    return left.every((entry, index) => (
        entry.id === right[index]?.id
        && entry.timestamp === right[index]?.timestamp
        && entry.approximateBytes === right[index]?.approximateBytes
    ));
}

function legacyRecordFingerprint(value) {
    let serialized;
    try {
        serialized = JSON.stringify(value);
    } catch {
        serialized = Object.prototype.toString.call(value);
    }
    const input = serialized ?? String(value);
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function legacySnapshotRecords(value) {
    const rawRecords = Array.isArray(value) ? value : [];
    const lastIndexById = new Map();
    for (const [index, snapshot] of rawRecords.entries()) {
        if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) {
            const id = typeof snapshot.id === 'string' ? snapshot.id : '';
            if (id) lastIndexById.set(id, index);
        }
    }

    const reservedIds = new Set(lastIndexById.keys());
    const records = rawRecords.map((legacySnapshot, originalIndex) => {
        const rawId = legacySnapshot
            && typeof legacySnapshot === 'object'
            && !Array.isArray(legacySnapshot)
            && typeof legacySnapshot.id === 'string'
            ? legacySnapshot.id
            : '';
        const keepsOriginalId = Boolean(rawId)
            && lastIndexById.get(rawId) === originalIndex;
        let id = rawId;
        if (!keepsOriginalId) {
            const base = `__legacy-corrupt-v1-${originalIndex}-${
                legacyRecordFingerprint(legacySnapshot)
            }`;
            id = base;
            let collision = 1;
            while (reservedIds.has(id)) {
                id = `${base}-${collision}`;
                collision += 1;
            }
        }
        reservedIds.add(id);
        return {
            id,
            timestamp: Number(legacySnapshot?.timestamp) || 0,
            originalIndex,
            legacySnapshot,
        };
    });
    return records.sort(
        (left, right) => left.timestamp - right.timestamp
            || left.originalIndex - right.originalIndex,
    );
}

function legacyRecordMatchesStored(record, stored, chatId) {
    if (stored == null) return false;
    try {
        if (JSON.stringify(record.legacySnapshot) === JSON.stringify(stored)) {
            return true;
        }
    } catch {
        return record.legacySnapshot === stored;
    }
    try {
        const legacy = migrateSnapshot(record.legacySnapshot);
        const current = migrateSnapshot(stored);
        return (
            legacy
            && current
            && typeof legacy === 'object'
            && typeof current === 'object'
            && legacy.id === record.id
            && current.id === record.id
            && snapshotMatchesStoragePartition(current, chatId)
            && JSON.stringify(legacy) === JSON.stringify(current)
        );
    } catch {
        return false;
    }
}

function legacyRetentionEntry(record) {
    return {
        id: record.id,
        timestamp: record.timestamp,
        approximateBytes: null,
        legacySnapshot: record.legacySnapshot,
    };
}

function conflictingLegacyRetentionEntry(record, chatId, approximateBytes) {
    return {
        id: `__legacy-conflict-v1-${record.originalIndex}-${
            legacyRecordFingerprint(record.legacySnapshot)
        }`,
        chatId,
        timestamp: record.timestamp,
        approximateBytes,
        healthy: false,
        protected: true,
    };
}

function retentionEntryBytes(entry) {
    return Number.isFinite(entry?.approximateBytes)
        ? Math.max(0, Number(entry.approximateBytes))
        : approximateJsonBytes(entry?.legacySnapshot);
}

function corruptEntryMetadata(snapshotId, message) {
    return {
        id: String(snapshotId ?? '').slice(0, CORRUPT_ENTRY_ID_MAX_LENGTH),
        message,
    };
}

function unavailableOriginStorage(reason) {
    return {
        available: false,
        scope: 'browser-origin',
        scopeLabel: '브라우저 오리진 전체',
        usage: null,
        quota: null,
        reason,
    };
}

function normalizeOriginStorageEstimate(value) {
    const usage = Number(value?.usage);
    const quota = Number(value?.quota);
    if (!Number.isFinite(usage) && !Number.isFinite(quota)) {
        return unavailableOriginStorage('estimate-unavailable');
    }
    return {
        available: true,
        scope: 'browser-origin',
        scopeLabel: '브라우저 오리진 전체',
        usage: Number.isFinite(usage) ? Math.max(0, Math.trunc(usage)) : null,
        quota: Number.isFinite(quota) ? Math.max(0, Math.trunc(quota)) : null,
        reason: null,
    };
}

export class SnapshotStore {
    constructor({
        namespace,
        maxSnapshotsPerChat = 100,
        summaryYield = yieldToMainThread,
        migrationYield = yieldToMainThread,
        summaryYieldBudgetMs = SUMMARY_YIELD_BUDGET_MS,
        storageEstimate = undefined,
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
        this.storageEstimate = storageEstimate === undefined
            ? globalThis.navigator?.storage?.estimate?.bind(
                globalThis.navigator.storage,
            ) ?? null
            : storageEstimate;
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
                type: String(driver).toLowerCase().includes('indexeddb')
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

    async getStorageQuotaStatus() {
        if (typeof this.storageEstimate !== 'function') {
            return unavailableOriginStorage('api-unavailable');
        }
        try {
            return normalizeOriginStorageEstimate(await this.storageEstimate());
        } catch {
            return unavailableOriginStorage('estimate-failed');
        }
    }

    async getStorageStatus() {
        const [summary, originStorage] = await Promise.all([
            this.getStorageSummary(),
            this.getStorageQuotaStatus(),
        ]);
        return {
            backend: this.getStatus(),
            extensionStorage: {
                scope: 'st-devtools-estimate',
                scopeLabel: 'ST DevTools 추정 사용량',
                approximateBytes: summary.approximateBytes,
                snapshotCount: summary.snapshotCount,
                chatCount: summary.chatCount,
                complete: summary.complete,
            },
            originStorage,
        };
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

    snapshotPartsFromKey(key) {
        if (typeof key !== 'string' || !key.startsWith(SNAPSHOT_PREFIX)) {
            return null;
        }
        const encoded = key.slice(SNAPSHOT_PREFIX.length);
        const separator = encoded.indexOf(':');
        if (separator <= 0 || separator >= encoded.length - 1) return null;
        const chatId = decodeKeyPart(encoded.slice(0, separator));
        const id = decodeKeyPart(encoded.slice(separator + 1));
        return chatId && id ? { chatId, id } : null;
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

        for (const record of retained) {
            let storedSnapshot = record.legacySnapshot;
            try {
                const migrated = migrateSnapshot(record.legacySnapshot);
                if (
                    migrated
                    && typeof migrated === 'object'
                    && !Array.isArray(migrated)
                    && migrated.id === record.id
                ) {
                    storedSnapshot = migrated;
                }
            } catch {
                // Preserve malformed legacy data verbatim so the indexed reader can
                // isolate it and surface a corruption warning without losing evidence.
            }
            const bytes = approximateJsonBytes(storedSnapshot);
            await this.write(
                this.snapshotKey(chatId, record.id),
                storedSnapshot,
            );
            entries.push({
                id: record.id,
                timestamp: record.timestamp,
                approximateBytes: bytes,
            });
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
        if (!stored) {
            return {
                id: snapshotId,
                snapshot: null,
                approximateBytes: null,
                migrated: false,
                missing: true,
                corruptEntry: corruptEntryMetadata(
                    snapshotId,
                    MISSING_SNAPSHOT_MESSAGE,
                ),
            };
        }

        let snapshot;
        try {
            snapshot = migrateSnapshot(stored);
            if (
                !snapshot
                || typeof snapshot !== 'object'
                || snapshot.id !== snapshotId
                || !snapshotMatchesStoragePartition(snapshot, chatId)
            ) {
                throw new TypeError('Invalid migrated snapshot.');
            }
        } catch {
            return {
                id: snapshotId,
                snapshot: null,
                approximateBytes: null,
                migrated: false,
                missing: false,
                corruptEntry: corruptEntryMetadata(
                    snapshotId,
                    CORRUPT_SNAPSHOT_MESSAGE,
                ),
            };
        }

        const migrated = snapshot !== stored;
        return {
            id: snapshotId,
            snapshot: attachStorageChatId(snapshot, chatId),
            approximateBytes: migrated ? approximateJsonBytes(snapshot) : null,
            migrated,
            missing: false,
            corruptEntry: null,
        };
    }

    async reconcileReadSnapshotsUnlocked(chatId, index, readResults) {
        const byteCounts = new Map();
        let migrated = false;
        for (const result of readResults) {
            if (result.snapshot && Number.isFinite(result.approximateBytes)) {
                byteCounts.set(result.id, result.approximateBytes);
            }
            migrated ||= result.migrated;
        }

        let byteDelta = 0;
        let indexChanged = false;
        const nextEntries = index.entries.map((entry) => {
            if (!byteCounts.has(entry.id)) return entry;
            const approximateBytes = byteCounts.get(entry.id);
            if (approximateBytes === entry.approximateBytes) return entry;
            indexChanged = true;
            byteDelta += approximateBytes - entry.approximateBytes;
            return { ...entry, approximateBytes };
        });

        if (migrated || indexChanged) {
            this.mutationRevision += 1;
        }
        if (indexChanged) {
            await this.writeTimelineIndex(chatId, nextEntries);
            await this.updateCompleteSummary({ byteDelta });
        }
        for (const result of readResults) {
            if (!result.migrated) continue;
            await this.write(
                this.snapshotKey(chatId, result.id),
                result.snapshot,
            );
        }
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

    async addSnapshotUnlocked(snapshot, {
        partitionChatId = null,
        skipRetention = false,
    } = {}) {
        const normalizedSnapshot = migrateSnapshot(snapshot);
        const chatId = String(
            partitionChatId
            ?? normalizedSnapshot.storageChatId
            ?? normalizedSnapshot.chatId
            ?? '__global__',
        );
        attachStorageChatId(normalizedSnapshot, chatId);
        const indexKey = this.timelineIndexKey(chatId);
        this.mutationRevision += 1;
        await this.withLock(indexKey, async () => {
                const index = await this.readTimelineIndexUnlocked(chatId);
                const previousEntries = index.entries;
                const bytes = approximateJsonBytes(normalizedSnapshot);
                const candidate = timelineEntry(normalizedSnapshot, bytes);
                const orderedEntries = [
                    ...previousEntries.filter((entry) => entry.id !== candidate.id),
                    candidate,
                ]
                    .sort((left, right) => left.timestamp - right.timestamp);
                let removalsNeeded = skipRetention
                    ? 0
                    : Math.max(
                        0,
                        orderedEntries.length - this.maxSnapshotsPerChat,
                    );
                const removedIds = new Set();
                for (const entry of orderedEntries) {
                    if (removalsNeeded === 0) break;
                    if (entry.id === candidate.id) continue;
                    const result = await this.readSnapshotUnlocked(chatId, entry.id);
                    if (!result.snapshot && !result.missing) {
                        // Keep corrupt raw records available for explicit repair.
                        continue;
                    }
                    removedIds.add(entry.id);
                    removalsNeeded -= 1;
                }
                const nextEntries = orderedEntries.filter(
                    (entry) => !removedIds.has(entry.id),
                );
                const removedEntries = previousEntries.filter(
                    (entry) => removedIds.has(entry.id),
                );

                await this.write(
                    this.snapshotKey(chatId, normalizedSnapshot.id),
                    normalizedSnapshot,
                );
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
        return normalizedSnapshot;
    }

    async addSnapshot(snapshot, options = {}) {
        return this.withLock(
            MUTATION_LOCK_KEY,
            () => this.addSnapshotUnlocked(snapshot, options),
        );
    }

    async updateSnapshot(chatId, snapshotId, updater) {
        if (
            typeof snapshotId !== 'string'
            || !snapshotId
            || typeof updater !== 'function'
        ) {
            throw new TypeError('Snapshot update requires an id and updater.');
        }
        const normalizedChatId = chatId || '__global__';
        const indexKey = this.timelineIndexKey(normalizedChatId);
        return this.withLock(MUTATION_LOCK_KEY, () => (
            this.withLock(indexKey, async () => {
                const index = await this.readTimelineIndexUnlocked(normalizedChatId);
                const previousEntry = index.entries.find(
                    ({ id }) => id === snapshotId,
                );
                if (!previousEntry) {
                    return {
                        updated: false,
                        reason: 'not-found',
                        snapshot: null,
                    };
                }

                const stored = await this.readSnapshotUnlocked(
                    normalizedChatId,
                    snapshotId,
                );
                if (!stored.snapshot) {
                    return {
                        updated: false,
                        reason: stored.missing ? 'not-found' : 'corrupt',
                        snapshot: null,
                    };
                }

                const editable = deepClone(stored.snapshot);
                const candidate = await updater(editable);
                if (candidate == null) {
                    return {
                        updated: false,
                        reason: 'unchanged',
                        snapshot: stored.snapshot,
                    };
                }
                const normalized = migrateSnapshot(candidate);
                if (
                    !normalized
                    || typeof normalized !== 'object'
                    || normalized.id !== snapshotId
                    || !snapshotMatchesStoragePartition(
                        normalized,
                        normalizedChatId,
                    )
                ) {
                    throw new TypeError(
                        'Snapshot update cannot change its storage identity.',
                    );
                }

                const nextBytes = approximateJsonBytes(normalized);
                const nextEntry = timelineEntry(normalized, nextBytes);
                const nextEntries = index.entries
                    .map((entry) => (
                        entry.id === snapshotId ? nextEntry : entry
                    ))
                    .sort((left, right) => left.timestamp - right.timestamp);
                this.mutationRevision += 1;
                await this.write(
                    this.snapshotKey(normalizedChatId, snapshotId),
                    normalized,
                );
                await this.writeTimelineIndex(normalizedChatId, nextEntries);
                await this.updateCompleteSummary({
                    byteDelta: nextBytes
                        - (Number(previousEntry.approximateBytes) || 0),
                });
                return {
                    updated: true,
                    reason: null,
                    snapshot: attachStorageChatId(
                        normalized,
                        normalizedChatId,
                    ),
                };
            })
        ));
    }

    async getTimelinePageUnlocked(chatId, {
        limit = this.maxSnapshotsPerChat,
        allowAboveRetention = false,
    } = {}) {
        const normalizedChatId = chatId || '__global__';
        const indexKey = this.timelineIndexKey(normalizedChatId);
        return this.withLock(indexKey, async () => {
                const index = await this.readTimelineIndexUnlocked(normalizedChatId);
                const readLimit = normalizeReadLimit(
                    limit,
                    allowAboveRetention
                        ? MAX_POLICY_SNAPSHOTS_PER_CHAT
                        : this.maxSnapshotsPerChat,
                );
                const selectedEntries = index.entries.slice(-readLimit);
                const readResults = await Promise.all(selectedEntries.map(
                    (entry) => this.readSnapshotUnlocked(normalizedChatId, entry.id),
                ));
                await this.reconcileReadSnapshotsUnlocked(
                    normalizedChatId,
                    index,
                    readResults,
                );
                const snapshots = readResults
                    .map((result) => result.snapshot)
                    .filter(Boolean);
                const corruptResults = readResults
                    .map((result) => result.corruptEntry)
                    .filter(Boolean);
                return {
                    snapshots,
                    totalCount: index.entries.length,
                    loadedCount: snapshots.length,
                    limit: readLimit,
                    corruptCount: corruptResults.length,
                    corruptEntries: corruptResults.slice(0, CORRUPT_ENTRY_LIMIT),
                };
        });
    }

    async getTimelinePage(chatId, options = {}) {
        return this.withLock(
            MUTATION_LOCK_KEY,
            () => this.getTimelinePageUnlocked(chatId, {
                limit: options.limit,
            }),
        );
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
                const result = await this.readSnapshotUnlocked(
                    normalizedChatId,
                    snapshotId,
                );
                await this.reconcileReadSnapshotsUnlocked(
                    normalizedChatId,
                    index,
                    [result],
                );
                return result.snapshot;
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

    async captureRawStorageStateUnlocked() {
        const state = new Map();
        for (const key of await this.storageKeys()) {
            state.set(key, await this.read(key, null));
        }
        return state;
    }

    async restoreRawStorageStateUnlocked(state) {
        for (const key of await this.storageKeys()) {
            await this.remove(key);
        }
        for (const [key, value] of state) {
            await this.write(key, value);
        }
        const restoredKeys = (await this.storageKeys()).sort();
        const expectedKeys = [...state.keys()].sort();
        if (
            restoredKeys.length !== expectedKeys.length
            || restoredKeys.some((key, index) => key !== expectedKeys[index])
        ) {
            throw new Error('Raw snapshot storage rollback verification failed.');
        }
        for (const [key, expected] of state) {
            const actual = await this.read(key, null);
            const expectedFingerprint = rawStorageValueFingerprint(expected);
            const actualFingerprint = rawStorageValueFingerprint(actual);
            if (
                expectedFingerprint == null
                    ? actual !== expected
                    : actualFingerprint !== expectedFingerprint
            ) {
                throw new Error('Raw snapshot storage rollback verification failed.');
            }
        }
        this.mutationRevision += 1;
    }

    async runExclusiveImport(operation) {
        if (typeof operation !== 'function') {
            throw new TypeError('Exclusive import operation must be a function.');
        }
        return this.withLock(MUTATION_LOCK_KEY, async () => {
            const rawState = await this.captureRawStorageStateUnlocked();
            const facade = Object.freeze({
                getAllStoredTimelines: () => this.getAllStoredTimelinesUnlocked(),
                addSnapshot: (snapshot, options = {}) => this.addSnapshotUnlocked(
                    snapshot,
                    { ...options, skipRetention: true },
                ),
                clearAll: () => this.clearAllUnlocked(),
            });
            try {
                return await operation(facade);
            } catch (error) {
                try {
                    await this.restoreRawStorageStateUnlocked(rawState);
                } catch {
                    const rollbackError = new Error(
                        'Exclusive snapshot import rollback failed.',
                    );
                    rollbackError.code = 'import-rollback-failed';
                    throw rollbackError;
                }
                throw error;
            }
        });
    }

    async collectStorageIntegrityStateUnlocked({
        metadataLimit = INTEGRITY_METADATA_LIMIT,
    } = {}) {
        const keys = await this.storageKeys();
        const indexes = [];
        const currentIndexes = new Map();
        const records = [];
        let lastYieldAt = Date.now();

        for (const key of keys) {
            const chatId = this.chatIdFromTimelineIndexKey(key);
            if (chatId == null) continue;
            const rawIndex = await this.read(key, null);
            const normalized = normalizeTimelineIndex(rawIndex, chatId);
            indexes.push({
                chatId,
                valid: Boolean(normalized),
                entries: normalized?.entries ?? [],
            });
            currentIndexes.set(chatId, normalized);
            lastYieldAt = await this.maybeYield(lastYieldAt);
        }

        for (const key of keys) {
            const parts = this.snapshotPartsFromKey(key);
            if (!parts) continue;
            const stored = await this.read(key, null);
            let normalized = null;
            let errorCode = 'corrupt-record';
            try {
                normalized = migrateSnapshot(stored);
                if (
                    !normalized
                    || typeof normalized !== 'object'
                    || Array.isArray(normalized)
                    || normalized.id !== parts.id
                    || !snapshotMatchesStoragePartition(normalized, parts.chatId)
                ) {
                    normalized = null;
                    errorCode = 'record-identity-mismatch';
                }
            } catch (error) {
                errorCode = typeof error?.code === 'string'
                    ? error.code
                    : 'snapshot-migration-failed';
            }
            records.push({
                chatId: parts.chatId,
                id: parts.id,
                valid: Boolean(normalized),
                timestamp: Number(normalized?.timestamp) || 0,
                approximateBytes: approximateJsonBytes(stored),
                errorCode,
            });
            lastYieldAt = await this.maybeYield(lastYieldAt);
        }

        const extraSummary = {
            chatCount: 0,
            timelineRecordCount: 0,
            snapshotCount: 0,
            approximateBytes: 0,
        };
        const legacyChatIds = [];
        const legacyRetentionEntries = [];
        const legacyContainers = [];
        const validRecordChatIds = new Set(
            records
                .filter(({ valid }) => valid)
                .map(({ chatId }) => chatId),
        );
        for (const key of keys) {
            const chatId = this.chatIdFromLegacyTimelineKey(key);
            if (chatId == null) continue;
            const stored = await this.read(key, null);
            if (!Array.isArray(stored)) continue;
            const legacyRecords = legacySnapshotRecords(stored);
            if (
                currentIndexes.get(chatId)
                || (
                    currentIndexes.has(chatId)
                    && validRecordChatIds.has(chatId)
                )
            ) {
                let duplicate = true;
                let conflictBytes = 0;
                const conflictRetentionEntries = [];
                for (const record of legacyRecords) {
                    const current = await this.read(
                        this.snapshotKey(chatId, record.id),
                        null,
                    );
                    if (!legacyRecordMatchesStored(record, current, chatId)) {
                        duplicate = false;
                    }
                    const approximateBytes = approximateJsonBytes(
                        record.legacySnapshot,
                    );
                    conflictBytes += approximateBytes;
                    conflictRetentionEntries.push(
                        conflictingLegacyRetentionEntry(
                            record,
                            chatId,
                            approximateBytes,
                        ),
                    );
                    lastYieldAt = await this.maybeYield(lastYieldAt);
                }
                legacyContainers.push({
                    chatId,
                    status: duplicate ? 'duplicate' : 'conflict',
                });
                if (!duplicate) {
                    legacyRetentionEntries.push(...conflictRetentionEntries);
                    extraSummary.timelineRecordCount += 1;
                    extraSummary.snapshotCount += legacyRecords.length;
                    extraSummary.approximateBytes += conflictBytes;
                }
                continue;
            }
            extraSummary.timelineRecordCount += 1;
            if (legacyRecords.length > 0) {
                legacyChatIds.push(chatId);
                extraSummary.chatCount += 1;
                extraSummary.snapshotCount += legacyRecords.length;
                for (const record of legacyRecords) {
                    const approximateBytes = approximateJsonBytes(
                        record.legacySnapshot,
                    );
                    extraSummary.approximateBytes += approximateBytes;
                    let valid = false;
                    let timestamp = record.timestamp;
                    try {
                        const normalized = migrateSnapshot(record.legacySnapshot);
                        if (
                            normalized
                            && typeof normalized === 'object'
                            && !Array.isArray(normalized)
                            && normalized.id === record.id
                            && (normalized.chatId || '__global__') === chatId
                        ) {
                            valid = true;
                            timestamp = Number(normalized.timestamp)
                                || record.timestamp;
                        }
                    } catch {
                        // Corrupt legacy bodies remain outside all GC targets.
                    }
                    legacyRetentionEntries.push({
                        id: record.id,
                        chatId,
                        timestamp,
                        approximateBytes,
                        healthy: valid,
                        protected: !valid,
                    });
                    lastYieldAt = await this.maybeYield(lastYieldAt);
                }
            }
        }

        const diagnosis = inspectStorageIntegrityState({
            indexes,
            records,
            legacyContainers,
            extraSummary,
            metadataLimit,
        });
        const indexedEntriesByIdentity = new Map();
        for (const descriptor of indexes) {
            if (!descriptor.valid) continue;
            for (const entry of descriptor.entries) {
                indexedEntriesByIdentity.set(
                    `${descriptor.chatId.length}:${descriptor.chatId}${entry.id}`,
                    entry,
                );
            }
        }
        const retentionEntries = records.map((record) => {
            const indexedEntry = indexedEntriesByIdentity.get(
                `${record.chatId.length}:${record.chatId}${record.id}`,
            );
            return {
                id: record.id,
                chatId: record.chatId,
                timestamp: record.timestamp || indexedEntry?.timestamp || 0,
                approximateBytes: record.approximateBytes,
                healthy: record.valid,
                // Raw corrupt records and valid orphans count toward the total
                // byte budget, but integrity repair owns them and GC cannot.
                protected: !record.valid || !indexedEntry,
            };
        });
        const indexRepairNeeded = diagnosis.repairPlan.indexes.some((plannedIndex) => {
            const current = currentIndexes.get(plannedIndex.chatId);
            return !current || !timelineEntriesEqual(
                current.entries,
                plannedIndex.entries,
            );
        });
        const storedSummary = normalizeStoredSummary(
            await this.read(SUMMARY_KEY, null),
        );
        const plannedSummary = diagnosis.repairPlan.summary;
        const summaryRepairNeeded = storedSummary
            ? storedSummary.chatCount !== plannedSummary.chatCount
                || storedSummary.timelineRecordCount !== plannedSummary.timelineRecordCount
                || storedSummary.snapshotCount !== plannedSummary.snapshotCount
                || storedSummary.approximateBytes !== plannedSummary.approximateBytes
            : plannedSummary.chatCount > 0
                || plannedSummary.timelineRecordCount > 0
                || plannedSummary.snapshotCount > 0
                || plannedSummary.approximateBytes > 0;
        return {
            diagnosis,
            currentIndexes,
            legacyChatIds,
            retentionEntries: [...retentionEntries, ...legacyRetentionEntries],
            indexRepairNeeded,
            summaryRepairNeeded,
            needsRepair: diagnosis.counts.total > 0
                || indexRepairNeeded
                || summaryRepairNeeded,
        };
    }

    storageIntegrityPreview(state, revision = this.mutationRevision) {
        const { diagnosis } = state;
        const targetMetadata = integrityRepairTargetMetadata(
            diagnosis.repairPlan,
            INTEGRITY_METADATA_LIMIT,
        );
        return {
            revision,
            healthy: diagnosis.healthy && !state.needsRepair,
            repairNeeded: state.needsRepair,
            indexRepairNeeded: state.indexRepairNeeded,
            summaryRepairNeeded: state.summaryRepairNeeded,
            counts: diagnosis.counts,
            issues: diagnosis.issues,
            issuesTruncated: diagnosis.issuesTruncated,
            plannedSummary: { ...diagnosis.repairPlan.summary },
            ...targetMetadata,
        };
    }

    async inspectStorageIntegrity({
        metadataLimit = INTEGRITY_METADATA_LIMIT,
    } = {}) {
        return this.withLock(MUTATION_LOCK_KEY, async () => {
            const state = await this.collectStorageIntegrityStateUnlocked({
                metadataLimit,
            });
            return this.storageIntegrityPreview(state);
        });
    }

    async repairStorageIntegrity({
        expectedRevision = null,
        metadataLimit = INTEGRITY_METADATA_LIMIT,
    } = {}) {
        return this.withLock(MUTATION_LOCK_KEY, async () => {
            if (!Number.isFinite(expectedRevision)) {
                const error = new Error('A storage integrity preview is required.');
                error.code = 'integrity-preview-required';
                throw error;
            }
            if (
                expectedRevision !== this.mutationRevision
            ) {
                const error = new Error('Storage integrity preview is stale.');
                error.code = 'integrity-preview-stale';
                throw error;
            }

            const before = await this.collectStorageIntegrityStateUnlocked({
                metadataLimit,
            });
            const plan = before.diagnosis.repairPlan;
            if (!before.needsRepair) {
                return {
                    ...this.storageIntegrityPreview(before),
                    repaired: false,
                };
            }

            this.mutationRevision += 1;
            try {
                for (const plannedIndex of plan.indexes) {
                    const indexKey = this.timelineIndexKey(plannedIndex.chatId);
                    const current = before.currentIndexes.get(plannedIndex.chatId);
                    if (
                        current
                        && timelineEntriesEqual(current.entries, plannedIndex.entries)
                    ) {
                        continue;
                    }
                    await this.withLock(indexKey, () => (
                        this.writeTimelineIndex(
                            plannedIndex.chatId,
                            plannedIndex.entries,
                        )
                    ));
                }
                for (const chatId of plan.legacyChatIdsToRemove ?? []) {
                    await this.remove(this.timelineKey(chatId));
                }

                const activeChatIds = [
                    ...new Set([
                        ...plan.activeChatIds,
                        ...before.legacyChatIds,
                    ]),
                ].sort();
                await this.withLock(INDEX_KEY, async () => {
                    if (activeChatIds.length > 0) {
                        await this.write(INDEX_KEY, activeChatIds);
                    } else {
                        await this.remove(INDEX_KEY);
                    }
                });
                await this.write(SUMMARY_KEY, {
                    version: SUMMARY_VERSION,
                    complete: true,
                    ...plan.summary,
                    updatedAt: Date.now(),
                });
            } catch (error) {
                try {
                    await this.remove(SUMMARY_KEY);
                } catch {
                    // The next explicit diagnosis can safely retry partial index repairs.
                }
                throw error;
            }

            const after = await this.collectStorageIntegrityStateUnlocked({
                metadataLimit,
            });
            return {
                ...this.storageIntegrityPreview(after),
                repaired: true,
                previousCounts: before.diagnosis.counts,
            };
        });
    }

    retentionPolicyPlan(entries, policy, {
        now = Date.now(),
        protectedIds = [],
        newlyAddedId = null,
        revision = this.mutationRevision,
        targetMetadataLimit = INTEGRITY_METADATA_LIMIT,
        includeAllTargets = false,
    } = {}) {
        const options = {
            now,
            protectedIds,
            newlyAddedId,
            revision,
            targetMetadataLimit,
        };
        const report = planRetentionGc(entries, policy, options);
        if (!includeAllTargets || !report.targetsTruncated) {
            return {
                report,
                deletionTargets: report.targets,
            };
        }

        const deletionTargets = [...report.targets];
        let remaining = entries;
        let selected = report.targets;
        while (selected.length > 0) {
            const selectedKeys = new Set(selected.map((target) => (
                `${target.chatId.length}:${target.chatId}${target.id}`
            )));
            remaining = remaining.filter((entry) => !selectedKeys.has(
                `${entry.chatId.length}:${entry.chatId}${entry.id}`,
            ));
            const next = planRetentionGc(remaining, policy, {
                ...options,
                targetMetadataLimit: INTEGRITY_METADATA_LIMIT,
            });
            selected = next.targets;
            deletionTargets.push(...selected);
            if (!next.targetsTruncated) break;
        }
        if (deletionTargets.length !== report.deleteCount) {
            throw new Error('Could not enumerate the complete retention plan.');
        }
        return { report, deletionTargets };
    }

    retentionPolicyPreview(report, integrityState) {
        return {
            ...report,
            limit: report.policy.maxSnapshotsPerChat,
            affectedChatCount: report.affectedChats,
            snapshotCount: report.deleteCount,
            approximateBytes: report.deleteBytes,
            integrity: {
                healthy: integrityState.diagnosis.healthy
                    && !integrityState.needsRepair,
                repairNeeded: integrityState.needsRepair,
                counts: integrityState.diagnosis.counts,
                issues: integrityState.diagnosis.issues,
                issuesTruncated: integrityState.diagnosis.issuesTruncated,
            },
        };
    }

    async getRetentionPolicyPreview(value, options = {}) {
        const policy = normalizeStoreRetentionPolicy(
            value,
            this.maxSnapshotsPerChat,
        );
        return this.withLock(MUTATION_LOCK_KEY, async () => {
            // Integrity is always diagnosed before policy stages. Corrupt,
            // missing and orphan records are excluded from GC targets.
            const integrityState = await this.collectStorageIntegrityStateUnlocked({
                metadataLimit: options.metadataLimit,
            });
            const { report } = this.retentionPolicyPlan(
                integrityState.retentionEntries,
                policy,
                {
                    ...options,
                    revision: this.mutationRevision,
                },
            );
            return this.retentionPolicyPreview(report, integrityState);
        });
    }

    async applyRetentionPolicy(value, {
        expectedRevision = null,
        now = Date.now(),
        protectedIds = [],
        newlyAddedId = null,
        metadataLimit = INTEGRITY_METADATA_LIMIT,
    } = {}) {
        const policy = normalizeStoreRetentionPolicy(
            value,
            this.maxSnapshotsPerChat,
        );
        return this.withLock(MUTATION_LOCK_KEY, async () => {
            if (
                Number.isFinite(expectedRevision)
                && expectedRevision !== this.mutationRevision
            ) {
                const error = new Error('Snapshot retention preview is stale.');
                error.code = 'retention-preview-stale';
                throw error;
            }
            const integrityState = await this.collectStorageIntegrityStateUnlocked({
                metadataLimit,
            });
            const { report, deletionTargets } = this.retentionPolicyPlan(
                integrityState.retentionEntries,
                policy,
                {
                    now,
                    protectedIds,
                    newlyAddedId,
                    revision: this.mutationRevision,
                    targetMetadataLimit: metadataLimit,
                    includeAllTargets: true,
                },
            );
            const targetsByChat = new Map();
            for (const target of deletionTargets) {
                if (!targetsByChat.has(target.chatId)) {
                    targetsByChat.set(target.chatId, []);
                }
                targetsByChat.get(target.chatId).push(target);
            }

            this.mutationRevision += 1;
            let deletedCount = 0;
            let deletedBytes = 0;
            let migratedLegacy = false;
            try {
                for (const [chatId, targets] of targetsByChat) {
                    const indexKey = this.timelineIndexKey(chatId);
                    await this.withLock(indexKey, async () => {
                        const index = normalizeTimelineIndex(
                            await this.read(indexKey, null),
                            chatId,
                        );
                        const targetIds = new Set(targets.map(({ id }) => id));
                        if (!index) {
                            const legacyKey = this.timelineKey(chatId);
                            const legacyStored = await this.read(legacyKey, null);
                            if (!Array.isArray(legacyStored)) return;
                            const records = legacySnapshotRecords(legacyStored);
                            const removedRecords = records.filter(
                                ({ id }) => targetIds.has(id),
                            );
                            if (removedRecords.length === 0) return;
                            const retainedRecords = records.filter(
                                ({ id }) => !targetIds.has(id),
                            );
                            if (retainedRecords.length > 0) {
                                await this.migrateLegacyTimelineUnlocked(
                                    chatId,
                                    retainedRecords,
                                    retainedRecords.length,
                                );
                            } else {
                                await this.remove(legacyKey);
                                await this.remove(indexKey);
                                await this.removeChatFromIndex(chatId);
                            }
                            migratedLegacy = true;
                            deletedCount += removedRecords.length;
                            deletedBytes += removedRecords.reduce(
                                (total, record) => total
                                    + approximateJsonBytes(record.legacySnapshot),
                                0,
                            );
                            return;
                        }
                        const removedEntries = index.entries.filter(
                            ({ id }) => targetIds.has(id),
                        );
                        if (removedEntries.length === 0) return;
                        const retainedEntries = index.entries.filter(
                            ({ id }) => !targetIds.has(id),
                        );
                        await this.writeTimelineIndex(chatId, retainedEntries);
                        for (const entry of removedEntries) {
                            await this.remove(this.snapshotKey(chatId, entry.id));
                        }
                        if (retainedEntries.length > 0) {
                            await this.addChatToIndex(chatId);
                        } else {
                            await this.removeChatFromIndex(chatId);
                        }
                        deletedCount += removedEntries.length;
                        deletedBytes += sumEntryBytes(removedEntries);
                    });
                }
                if (migratedLegacy) {
                    await this.remove(SUMMARY_KEY);
                } else {
                    await this.updateCompleteSummary({
                        snapshotDelta: -deletedCount,
                        byteDelta: -deletedBytes,
                    });
                }
                this.maxSnapshotsPerChat = policy.maxSnapshotsPerChat;
            } catch (error) {
                try {
                    await this.remove(SUMMARY_KEY);
                } catch {
                    // A summary rebuild can retry after any interrupted policy apply.
                }
                throw error;
            }

            return {
                ...this.retentionPolicyPreview(report, integrityState),
                applied: true,
                deletedCount,
                deletedBytes,
            };
        });
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

    async getRetentionPrunePreview(value, options = {}) {
        if (value && typeof value === 'object') {
            return this.getRetentionPolicyPreview(value, options);
        }
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

    async applyRetentionLimit(value, options = {}) {
        const { expectedRevision = null } = options;
        if (value && typeof value === 'object') {
            return this.applyRetentionPolicy(value, options);
        }
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
                            for (const record of removedRecords) {
                                await this.remove(this.snapshotKey(chatId, record.id));
                            }
                            affectedChatCount += 1;
                            snapshotCount += removedRecords.length;
                            approximateBytes += removedRecords.reduce(
                                (total, record) => total
                                    + approximateJsonBytes(record.legacySnapshot),
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

    async clearAllUnlocked() {
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
    }

    async clearAll() {
        return this.withLock(
            MUTATION_LOCK_KEY,
            () => this.clearAllUnlocked(),
        );
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

    async getAllStoredTimelinesUnlocked() {
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
            const timeline = (
                await this.getTimelinePageUnlocked(
                chatId,
                {
                    limit: MAX_POLICY_SNAPSHOTS_PER_CHAT,
                    allowAboveRetention: true,
                },
                )
            ).snapshots;
            if (timeline.length > 0) timelines.push({ chatId, timeline });
        }
        return timelines;
    }

    async getAllStoredTimelines() {
        return this.withLock(
            MUTATION_LOCK_KEY,
            () => this.getAllStoredTimelinesUnlocked(),
        );
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
        let coexistingLegacyContainerCount = 0;
        const countedChatIds = new Set();
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
                    countedChatIds.add(container.chatId);
                    snapshotCount += index.entries.length;
                    approximateBytes += sumEntryBytes(index.entries);
                }
            } else if (container.legacyKey) {
                const stored = await this.read(container.legacyKey, []);
                const records = legacySnapshotRecords(stored);
                if (records.length > 0) {
                    chatCount += 1;
                    countedChatIds.add(container.chatId);
                    snapshotCount += records.length;
                    for (const record of records) {
                        approximateBytes += approximateJsonBytes(record.legacySnapshot);
                        lastYieldAt = await this.maybeYield(lastYieldAt);
                        if (revision !== this.mutationRevision) {
                            return this.getStorageSummary();
                        }
                    }
                }
            }
            lastYieldAt = await this.maybeYield(lastYieldAt);
        }

        const indexedContainerChatIds = new Set(
            containers
                .filter(({ indexKey }) => Boolean(indexKey))
                .map(({ chatId }) => chatId),
        );
        for (const key of keys) {
            const chatId = this.chatIdFromLegacyTimelineKey(key);
            if (chatId == null || !indexedContainerChatIds.has(chatId)) continue;
            const stored = await this.read(key, []);
            if (!Array.isArray(stored)) continue;
            const records = legacySnapshotRecords(stored);
            coexistingLegacyContainerCount += 1;
            if (records.length > 0 && !countedChatIds.has(chatId)) {
                countedChatIds.add(chatId);
                chatCount += 1;
            }
            snapshotCount += records.length;
            for (const record of records) {
                approximateBytes += approximateJsonBytes(record.legacySnapshot);
                lastYieldAt = await this.maybeYield(lastYieldAt);
                if (revision !== this.mutationRevision) {
                    return this.getStorageSummary();
                }
            }
        }

        const summary = {
            version: SUMMARY_VERSION,
            complete: true,
            chatCount,
            timelineRecordCount: containers.length + coexistingLegacyContainerCount,
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
