import { migrateSnapshot, migrateTimeline } from './migrations.js';

const INDEX_KEY = 'chat-index';
const MUTATION_LOCK_KEY = 'storage-mutation';
const SUMMARY_KEY = 'storage-summary:v1';
const SUMMARY_VERSION = 1;
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

export class SnapshotStore {
    constructor({
        namespace,
        maxSnapshotsPerChat = 100,
        summaryYield = yieldToMainThread,
        summaryYieldBudgetMs = SUMMARY_YIELD_BUDGET_MS,
    }) {
        this.namespace = namespace;
        this.maxSnapshotsPerChat = maxSnapshotsPerChat;
        this.summaryYield = summaryYield;
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

    timelineKey(chatId) {
        return `timeline:${chatId || '__global__'}`;
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

    async readTimelineUnlocked(chatId, { invalidateSummaryOnMigration = true } = {}) {
        const key = this.timelineKey(chatId);
        const stored = await this.read(key, []);
        const { snapshots, changed } = migrateTimeline(stored);
        if (changed) {
            await this.write(key, snapshots);
            if (invalidateSummaryOnMigration) {
                this.mutationRevision += 1;
                await this.remove(SUMMARY_KEY);
            }
        }
        return snapshots;
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
        const key = this.timelineKey(chatId);
        await this.withLock(MUTATION_LOCK_KEY, async () => {
            this.mutationRevision += 1;
            await this.withLock(key, async () => {
                const timeline = await this.readTimelineUnlocked(chatId);
                const next = [...timeline.filter((item) => item.id !== normalizedSnapshot.id), normalizedSnapshot]
                    .sort((left, right) => left.timestamp - right.timestamp)
                    .slice(-this.maxSnapshotsPerChat);
                const retained = new Set(next);
                const removed = timeline.filter((item) => !retained.has(item));
                const includesNewSnapshot = retained.has(normalizedSnapshot);
                const byteDelta = (
                    (includesNewSnapshot ? approximateJsonBytes(normalizedSnapshot) : 0)
                    - removed.reduce((total, item) => total + approximateJsonBytes(item), 0)
                );
                await this.write(key, next);
                await this.addChatToIndex(chatId);
                await this.updateCompleteSummary({
                    chatDelta: timeline.length === 0 && next.length > 0 ? 1 : 0,
                    snapshotDelta: next.length - timeline.length,
                    byteDelta,
                });
            });
        });
        return normalizedSnapshot;
    }

    async getTimeline(chatId) {
        const key = this.timelineKey(chatId);
        return this.withLock(key, () => this.readTimelineUnlocked(chatId));
    }

    async getLatest(chatId) {
        const timeline = await this.getTimeline(chatId);
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
        const key = this.timelineKey(chatId);
        return this.withLock(MUTATION_LOCK_KEY, () => (
            this.withLock(key, async () => {
                this.mutationRevision += 1;
                const timeline = await this.readTimelineUnlocked(chatId);
                const next = timeline.filter((snapshot) => !ids.has(snapshot.id));
                const deletedCount = timeline.length - next.length;
                if (next.length === timeline.length) {
                    if (timeline.length === 0) await this.removeChatFromIndex(chatId);
                    return 0;
                }
                const removed = timeline.filter((snapshot) => ids.has(snapshot.id));
                if (next.length > 0) {
                    await this.write(key, next);
                } else {
                    await this.remove(key);
                    await this.removeChatFromIndex(chatId);
                }
                await this.updateCompleteSummary({
                    chatDelta: next.length === 0 ? -1 : 0,
                    snapshotDelta: -deletedCount,
                    byteDelta: -removed.reduce(
                        (total, item) => total + approximateJsonBytes(item),
                        0,
                    ),
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

    async clearAll() {
        return this.withLock(MUTATION_LOCK_KEY, async () => {
            this.mutationRevision += 1;
            const keys = await this.storageKeys();
            const timelineKeys = keys.filter((key) => (
                typeof key === 'string' && key.startsWith('timeline:')
            ));
            let snapshotCount = 0;
            for (const key of timelineKeys) {
                await this.withLock(key, async () => {
                    const stored = await this.read(key, []);
                    snapshotCount += Array.isArray(stored) ? stored.length : 0;
                    await this.remove(key);
                });
            }
            await this.withLock(INDEX_KEY, () => this.remove(INDEX_KEY));
            await this.remove(SUMMARY_KEY);
            return {
                chatCount: timelineKeys.length,
                snapshotCount,
            };
        });
    }

    async clearTimeline(chatId) {
        const key = this.timelineKey(chatId);
        await this.withLock(MUTATION_LOCK_KEY, () => (
            this.withLock(key, async () => {
                this.mutationRevision += 1;
                const timeline = await this.readTimelineUnlocked(chatId);
                await this.remove(key);
                await this.removeChatFromIndex(chatId);
                if (timeline.length > 0) {
                    await this.updateCompleteSummary({
                        chatDelta: -1,
                        snapshotDelta: -timeline.length,
                        byteDelta: -timeline.reduce(
                            (total, item) => total + approximateJsonBytes(item),
                            0,
                        ),
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
        const chatIds = await this.getChatIds();
        const timelines = await Promise.all(chatIds.map(async (chatId) => ({
            chatId,
            timeline: await this.getTimeline(chatId),
        })));
        return timelines.filter(({ timeline }) => timeline.length > 0);
    }

    async getAllStoredTimelines() {
        const keys = await this.storageKeys();
        const timelineKeys = keys.filter((key) => (
            typeof key === 'string' && key.startsWith('timeline:')
        ));
        const timelines = await Promise.all(timelineKeys.map(async (key) => {
            const chatId = key.slice('timeline:'.length);
            const timeline = await this.withLock(
                key,
                () => this.readTimelineUnlocked(chatId),
            );
            return { chatId, timeline };
        }));
        return timelines.filter(({ timeline }) => timeline.length > 0);
    }

    async getStorageSummary() {
        const [keys, storedSummary] = await Promise.all([
            this.storageKeys(),
            this.read(SUMMARY_KEY, null),
        ]);
        const timelineKeyCount = keys.filter((key) => (
            typeof key === 'string' && key.startsWith('timeline:')
        )).length;
        const summary = normalizeStoredSummary(storedSummary);
        if (summary && summary.timelineRecordCount === timelineKeyCount) {
            return {
                ...this.getStatus(),
                ...summary,
                rebuilding: Boolean(this.summaryRebuildPromise),
                maxSnapshotsPerChat: this.maxSnapshotsPerChat,
            };
        }
        if (timelineKeyCount === 0) {
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
            chatCount: timelineKeyCount,
            snapshotCount: null,
            approximateBytes: null,
            maxSnapshotsPerChat: this.maxSnapshotsPerChat,
        };
    }

    async performStorageSummaryRebuild() {
        const revision = this.mutationRevision;
        const keys = await this.storageKeys();
        const timelineKeys = keys.filter((key) => (
            typeof key === 'string' && key.startsWith('timeline:')
        ));
        let chatCount = 0;
        let snapshotCount = 0;
        let approximateBytes = 0;
        let lastYieldAt = Date.now();

        for (const key of timelineKeys) {
            if (revision !== this.mutationRevision) return this.getStorageSummary();
            const chatId = key.slice('timeline:'.length);
            const timeline = await this.withLock(
                key,
                () => this.readTimelineUnlocked(
                    chatId,
                    { invalidateSummaryOnMigration: false },
                ),
            );
            if (timeline.length === 0) continue;
            chatCount += 1;
            snapshotCount += timeline.length;
            for (const snapshot of timeline) {
                approximateBytes += approximateJsonBytes(snapshot);
                if (Date.now() - lastYieldAt >= this.summaryYieldBudgetMs) {
                    await this.summaryYield();
                    lastYieldAt = Date.now();
                    if (revision !== this.mutationRevision) {
                        return this.getStorageSummary();
                    }
                }
            }
        }

        const summary = {
            version: SUMMARY_VERSION,
            complete: true,
            chatCount,
            timelineRecordCount: timelineKeys.length,
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
