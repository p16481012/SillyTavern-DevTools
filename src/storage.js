import { migrateSnapshot, migrateTimeline } from './migrations.js';

const INDEX_KEY = 'chat-index';

export class SnapshotStore {
    constructor({ namespace, maxSnapshotsPerChat = 100 }) {
        this.namespace = namespace;
        this.maxSnapshotsPerChat = maxSnapshotsPerChat;
        this.backend = null;
        this.memory = new Map();
        this.locks = new Map();
    }

    async initialize() {
        const localforage = globalThis.SillyTavern?.libs?.localforage;
        if (localforage?.createInstance) {
            this.backend = localforage.createInstance({
                name: 'ST_DevTools',
                storeName: 'snapshots_v1',
                description: 'Read-only prompt timeline snapshots.',
            });
        }
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

    async readTimelineUnlocked(chatId) {
        const key = this.timelineKey(chatId);
        const stored = await this.read(key, []);
        const { snapshots, changed } = migrateTimeline(stored);
        if (changed) {
            await this.write(key, snapshots);
        }
        return snapshots;
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
        await this.withLock(key, async () => {
            const timeline = await this.readTimelineUnlocked(chatId);
            const next = [...timeline.filter((item) => item.id !== normalizedSnapshot.id), normalizedSnapshot]
                .sort((left, right) => left.timestamp - right.timestamp)
                .slice(-this.maxSnapshotsPerChat);
            await this.write(key, next);
            await this.addChatToIndex(chatId);
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
        return this.withLock(key, async () => {
            const timeline = await this.readTimelineUnlocked(chatId);
            const next = timeline.filter((snapshot) => !ids.has(snapshot.id));
            const deletedCount = timeline.length - next.length;
            if (next.length === timeline.length) {
                if (timeline.length === 0) await this.removeChatFromIndex(chatId);
                return 0;
            }
            if (next.length > 0) {
                await this.write(key, next);
            } else {
                await this.remove(key);
                await this.removeChatFromIndex(chatId);
            }
            return deletedCount;
        });
    }

    async clearTimeline(chatId) {
        const key = this.timelineKey(chatId);
        await this.withLock(key, async () => {
            await this.remove(key);
            await this.removeChatFromIndex(chatId);
        });
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
}
