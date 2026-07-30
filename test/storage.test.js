import assert from 'node:assert/strict';
import test from 'node:test';
import { SnapshotStore } from '../src/storage.js';

function snapshot(id, chatId, timestamp) {
    return {
        schemaVersion: 4,
        id,
        chatId,
        timestamp,
        sources: [],
        stats: { structured: {} },
    };
}

function yieldStorageOperations(store) {
    const read = store.read.bind(store);
    const write = store.write.bind(store);
    store.read = async (...args) => {
        await Promise.resolve();
        return read(...args);
    };
    store.write = async (...args) => {
        await Promise.resolve();
        return write(...args);
    };
}

test('per-chat lock preserves simultaneous snapshots instead of losing an update', async () => {
    const store = new SnapshotStore({ namespace: 'test' });
    yieldStorageOperations(store);

    await Promise.all([
        store.addSnapshot(snapshot('a', 'chat', 1)),
        store.addSnapshot(snapshot('b', 'chat', 2)),
    ]);

    assert.deepEqual(
        (await store.getTimeline('chat')).map(({ id }) => id),
        ['a', 'b'],
    );
});

test('chat index serializes simultaneous chats and removes empty timelines', async () => {
    const store = new SnapshotStore({ namespace: 'test' });
    yieldStorageOperations(store);

    await Promise.all([
        store.addSnapshot(snapshot('a', 'chat-a', 1)),
        store.addSnapshot(snapshot('b', 'chat-b', 2)),
    ]);
    assert.deepEqual((await store.getChatIds()).sort(), ['chat-a', 'chat-b']);
    assert.equal((await store.getAllTimelines()).length, 2);

    await store.deleteSnapshot('chat-a', 'a');
    await store.clearTimeline('chat-b');
    assert.deepEqual(await store.getChatIds(), []);
    assert.deepEqual(await store.getAllTimelines(), []);
});

test('deleting from a missing timeline also cleans a stale chat index', async () => {
    const store = new SnapshotStore({ namespace: 'test' });
    store.memory.set('chat-index', ['stale']);

    assert.equal(await store.deleteSnapshot('stale', 'missing'), false);
    assert.deepEqual(await store.getChatIds(), []);
});

test('bulk deletion removes selected snapshots in one locked batch and keeps the rest ordered', async () => {
    const store = new SnapshotStore({ namespace: 'test' });
    await Promise.all([
        store.addSnapshot(snapshot('a', 'chat', 1)),
        store.addSnapshot(snapshot('b', 'chat', 2)),
        store.addSnapshot(snapshot('c', 'chat', 3)),
        store.addSnapshot(snapshot('d', 'chat', 4)),
    ]);

    assert.equal(await store.deleteSnapshots('chat', ['b', 'd', 'missing', 'b']), 2);
    assert.deepEqual(
        (await store.getTimeline('chat')).map(({ id }) => id),
        ['a', 'c'],
    );
    assert.deepEqual(await store.getChatIds(), ['chat']);

    assert.equal(await store.deleteSnapshots('chat', ['a', 'c']), 2);
    assert.deepEqual(await store.getTimeline('chat'), []);
    assert.deepEqual(await store.getChatIds(), []);
});

test('a simultaneous final delete and add keeps the surviving chat indexed', async () => {
    const store = new SnapshotStore({ namespace: 'test' });
    yieldStorageOperations(store);
    await store.addSnapshot(snapshot('old', 'chat', 1));

    await Promise.all([
        store.deleteSnapshot('chat', 'old'),
        store.addSnapshot(snapshot('new', 'chat', 2)),
    ]);

    assert.deepEqual(
        (await store.getTimeline('chat')).map(({ id }) => id),
        ['new'],
    );
    assert.deepEqual(await store.getChatIds(), ['chat']);
});

test('storage status reports an explicit memory fallback without localforage', async () => {
    const previous = globalThis.SillyTavern;
    delete globalThis.SillyTavern;
    try {
        const store = new SnapshotStore({ namespace: 'test' });
        assert.deepEqual(await store.initialize(), {
            type: 'memory',
            persistent: false,
            driver: null,
            fallbackReason: 'localforage-unavailable',
        });
    } finally {
        globalThis.SillyTavern = previous;
    }
});

test('storage status records a ready IndexedDB backend', async () => {
    const previous = globalThis.SillyTavern;
    const values = new Map();
    globalThis.SillyTavern = {
        libs: {
            localforage: {
                createInstance() {
                    return {
                        async ready() {},
                        driver: () => 'asyncStorage',
                        getItem: async (key) => values.get(key) ?? null,
                        setItem: async (key, value) => values.set(key, value),
                        removeItem: async (key) => values.delete(key),
                        keys: async () => [...values.keys()],
                    };
                },
            },
        },
    };
    try {
        const store = new SnapshotStore({ namespace: 'test' });
        await store.initialize();
        assert.equal(store.getStatus().type, 'indexeddb');
        assert.equal(store.getStatus().persistent, true);
    } finally {
        globalThis.SillyTavern = previous;
    }
});

test('storage summary counts every timeline and clearAll removes indexed and stale keys', async () => {
    const store = new SnapshotStore({ namespace: 'test' });
    await store.addSnapshot(snapshot('a', 'chat-a', 1));
    await store.addSnapshot(snapshot('b', 'chat-b', 2));
    store.memory.set('timeline:stale-chat', [snapshot('stale', 'stale-chat', 3)]);

    const summary = await store.getStorageSummary();
    assert.equal(summary.type, 'memory');
    assert.equal(summary.chatCount, 3);
    assert.equal(summary.snapshotCount, 3);
    assert.equal(summary.approximateBytes > 0, true);

    assert.deepEqual(await store.clearAll(), {
        chatCount: 3,
        snapshotCount: 3,
    });
    assert.deepEqual(await store.storageKeys(), []);
    assert.deepEqual(await store.getAllTimelines(), []);
});
