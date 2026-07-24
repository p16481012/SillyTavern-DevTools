import { migrateSnapshot, migrateTimeline } from './migrations.js';

const INDEX_KEY = 'chat-index';

export class SnapshotStore {
    constructor({ namespace, maxSnapshotsPerChat = 100 }) {
        this.namespace = namespace;
        this.maxSnapshotsPerChat = maxSnapshotsPerChat;
        this.backend = null;
        this.memory = new Map();
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

    async addSnapshot(snapshot) {
        const normalizedSnapshot = migrateSnapshot(snapshot);
        const chatId = normalizedSnapshot.chatId || '__global__';
        const key = this.timelineKey(chatId);
        const timeline = await this.read(key, []);
        const next = [...timeline.filter((item) => item.id !== normalizedSnapshot.id), normalizedSnapshot]
            .sort((left, right) => left.timestamp - right.timestamp)
            .slice(-this.maxSnapshotsPerChat);
        await this.write(key, next);

        const chatIndex = await this.read(INDEX_KEY, []);
        if (!chatIndex.includes(chatId)) {
            await this.write(INDEX_KEY, [...chatIndex, chatId]);
        }
        return normalizedSnapshot;
    }

    async getTimeline(chatId) {
        const key = this.timelineKey(chatId);
        const stored = await this.read(key, []);
        const { snapshots, changed } = migrateTimeline(stored);
        if (changed) {
            await this.write(key, snapshots);
        }
        return snapshots;
    }

    async getLatest(chatId) {
        const timeline = await this.getTimeline(chatId);
        return timeline.at(-1) ?? null;
    }

    async deleteSnapshot(chatId, snapshotId) {
        const key = this.timelineKey(chatId);
        const timeline = await this.getTimeline(chatId);
        const next = timeline.filter((snapshot) => snapshot.id !== snapshotId);
        if (next.length === timeline.length) {
            return false;
        }
        if (next.length > 0) {
            await this.write(key, next);
        } else if (this.backend) {
            await this.backend.removeItem(key);
        } else {
            this.memory.delete(key);
        }
        return true;
    }

    async clearTimeline(chatId) {
        const key = this.timelineKey(chatId);
        if (this.backend) {
            await this.backend.removeItem(key);
        } else {
            this.memory.delete(key);
        }
    }
}
