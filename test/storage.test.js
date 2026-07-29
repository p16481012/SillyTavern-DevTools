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
