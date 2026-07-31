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

function jsonBytes(value) {
    return new TextEncoder().encode(JSON.stringify(value)).length;
}

function seedIndexedSnapshot(store, value, approximateBytes = jsonBytes(value)) {
    const chatId = value.chatId;
    store.memory.set(store.snapshotKey(chatId, value.id), value);
    store.memory.set(store.timelineIndexKey(chatId), {
        version: 2,
        chatId,
        entries: [{
            id: value.id,
            timestamp: value.timestamp,
            approximateBytes,
        }],
        updatedAt: value.timestamp,
    });
    store.memory.set('chat-index', [chatId]);
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

test('timeline pages read only the requested newest snapshot records', async () => {
    const store = new SnapshotStore({ namespace: 'test' });
    for (let index = 1; index <= 8; index += 1) {
        await store.addSnapshot(snapshot(`snapshot-${index}`, 'chat', index));
    }
    const read = store.read.bind(store);
    const snapshotReads = [];
    store.read = async (key, ...args) => {
        if (String(key).startsWith('snapshot:v2:')) snapshotReads.push(key);
        return read(key, ...args);
    };

    const page = await store.getTimelinePage('chat', { limit: 3 });

    assert.deepEqual(page.snapshots.map(({ id }) => id), [
        'snapshot-6',
        'snapshot-7',
        'snapshot-8',
    ]);
    assert.equal(page.totalCount, 8);
    assert.equal(page.loadedCount, 3);
    assert.equal(page.limit, 3);
    assert.equal(snapshotReads.length, 3);
});

test('adding a snapshot updates its record and lightweight index without reading old records', async () => {
    const store = new SnapshotStore({ namespace: 'test' });
    await store.addSnapshot(snapshot('a', 'chat', 1));
    await store.addSnapshot(snapshot('b', 'chat', 2));
    const read = store.read.bind(store);
    const write = store.write.bind(store);
    const snapshotReads = [];
    const snapshotWrites = [];
    store.read = async (key, ...args) => {
        if (String(key).startsWith('snapshot:v2:')) snapshotReads.push(key);
        return read(key, ...args);
    };
    store.write = async (key, value) => {
        if (String(key).startsWith('snapshot:v2:')) snapshotWrites.push(key);
        return write(key, value);
    };

    await store.addSnapshot(snapshot('c', 'chat', 3));

    assert.deepEqual(snapshotReads, []);
    assert.deepEqual(snapshotWrites, [store.snapshotKey('chat', 'c')]);
    assert.equal(store.memory.has(store.timelineKey('chat')), false);
    assert.equal(store.memory.get(store.timelineIndexKey('chat')).entries.length, 3);
});

test('retention preview and pruning use lightweight indexes across every chat', async () => {
    const store = new SnapshotStore({ namespace: 'test', maxSnapshotsPerChat: 100 });
    for (let index = 1; index <= 5; index += 1) {
        await store.addSnapshot(snapshot(`a-${index}`, 'chat-a', index));
    }
    for (let index = 1; index <= 3; index += 1) {
        await store.addSnapshot(snapshot(`b-${index}`, 'chat-b', index));
    }
    const before = await store.rebuildStorageSummary();
    const read = store.read.bind(store);
    let snapshotReads = 0;
    store.read = async (key, ...args) => {
        if (String(key).startsWith('snapshot:v2:')) snapshotReads += 1;
        return read(key, ...args);
    };

    const preview = await store.getRetentionPrunePreview(2);
    assert.equal(preview.limit, 2);
    assert.equal(preview.affectedChatCount, 2);
    assert.equal(preview.snapshotCount, 4);
    assert.equal(preview.approximateBytes > 0, true);
    assert.equal(Number.isInteger(preview.revision), true);
    assert.equal(snapshotReads, 0);

    const result = await store.applyRetentionLimit(2, {
        expectedRevision: preview.revision,
    });
    assert.deepEqual(result, {
        limit: preview.limit,
        affectedChatCount: preview.affectedChatCount,
        snapshotCount: preview.snapshotCount,
        approximateBytes: preview.approximateBytes,
    });
    assert.equal(store.maxSnapshotsPerChat, 2);
    assert.equal(snapshotReads, 0);
    assert.deepEqual(
        store.memory.get(store.timelineIndexKey('chat-a')).entries.map(({ id }) => id),
        ['a-4', 'a-5'],
    );
    assert.deepEqual(
        store.memory.get(store.timelineIndexKey('chat-b')).entries.map(({ id }) => id),
        ['b-2', 'b-3'],
    );
    assert.equal(store.memory.has(store.snapshotKey('chat-a', 'a-1')), false);
    assert.equal(store.memory.has(store.snapshotKey('chat-b', 'b-1')), false);

    const after = await store.getStorageSummary();
    assert.equal(after.snapshotCount, 4);
    assert.equal(after.approximateBytes < before.approximateBytes, true);
});

test('retention pruning rejects a stale preview before deleting newer data', async () => {
    const store = new SnapshotStore({ namespace: 'test', maxSnapshotsPerChat: 100 });
    for (let index = 1; index <= 3; index += 1) {
        await store.addSnapshot(snapshot(`snapshot-${index}`, 'chat', index));
    }
    const preview = await store.getRetentionPrunePreview(2);
    await store.addSnapshot(snapshot('snapshot-4', 'chat', 4));

    await assert.rejects(
        store.applyRetentionLimit(2, { expectedRevision: preview.revision }),
        (error) => error?.code === 'retention-preview-stale',
    );
    assert.equal(store.maxSnapshotsPerChat, 100);
    assert.equal((await store.getTimeline('chat')).length, 4);
});

test('retention pruning migrates legacy arrays and keeps only their newest records', async () => {
    const store = new SnapshotStore({ namespace: 'test', maxSnapshotsPerChat: 100 });
    store.memory.set('timeline:legacy-chat', [
        snapshot('old-1', 'legacy-chat', 1),
        snapshot('old-2', 'legacy-chat', 2),
        snapshot('new-1', 'legacy-chat', 3),
        snapshot('new-2', 'legacy-chat', 4),
    ]);

    const preview = await store.getRetentionPrunePreview(2);
    assert.equal(preview.affectedChatCount, 1);
    assert.equal(preview.snapshotCount, 2);

    await store.applyRetentionLimit(2);
    assert.equal(store.memory.has('timeline:legacy-chat'), false);
    assert.deepEqual(
        (await store.getTimeline('legacy-chat')).map(({ id }) => id),
        ['new-1', 'new-2'],
    );
});

test('retention pruning never migrates legacy records that will be discarded', async () => {
    const store = new SnapshotStore({ namespace: 'test', maxSnapshotsPerChat: 100 });
    const discarded = snapshot('discarded', 'legacy-chat', 1);
    Object.defineProperty(discarded, 'sources', {
        enumerable: true,
        get() {
            throw new Error('discarded legacy snapshot must not be migrated');
        },
    });
    store.memory.set('timeline:legacy-chat', [
        discarded,
        snapshot('retained', 'legacy-chat', 2),
    ]);

    const preview = await store.getRetentionPrunePreview(1);
    assert.equal(preview.snapshotCount, 1);
    assert.equal(store.memory.has(store.timelineIndexKey('legacy-chat')), false);
    assert.equal(store.memory.has('timeline:legacy-chat'), true);

    await store.applyRetentionLimit(1, { expectedRevision: preview.revision });
    assert.equal(store.memory.has('timeline:legacy-chat'), false);
    assert.deepEqual(
        (await store.getTimeline('legacy-chat')).map(({ id }) => id),
        ['retained'],
    );
});

test('a capture concurrent with retention pruning still obeys the new limit', async () => {
    const store = new SnapshotStore({ namespace: 'test', maxSnapshotsPerChat: 100 });
    yieldStorageOperations(store);
    for (let index = 1; index <= 5; index += 1) {
        await store.addSnapshot(snapshot(`snapshot-${index}`, 'chat', index));
    }

    await Promise.all([
        store.applyRetentionLimit(2),
        store.addSnapshot(snapshot('snapshot-6', 'chat', 6)),
    ]);

    assert.equal(store.maxSnapshotsPerChat, 2);
    assert.deepEqual(
        (await store.getTimeline('chat')).map(({ id }) => id),
        ['snapshot-5', 'snapshot-6'],
    );
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

    const initial = await store.getStorageSummary();
    assert.equal(initial.complete, false);
    assert.equal(initial.chatCount, 3);
    assert.equal(initial.snapshotCount, null);
    assert.equal(initial.approximateBytes, null);

    const summary = await store.rebuildStorageSummary();
    assert.equal(summary.type, 'memory');
    assert.equal(summary.complete, true);
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

test('fast storage summary never reads snapshot timeline values', async () => {
    const store = new SnapshotStore({ namespace: 'test' });
    store.memory.set('timeline:chat-a', [snapshot('a', 'chat-a', 1)]);
    store.memory.set('timeline:chat-b', [snapshot('b', 'chat-b', 2)]);
    const read = store.read.bind(store);
    let timelineReads = 0;
    store.read = async (key, ...args) => {
        if (String(key).startsWith('timeline:')) timelineReads += 1;
        return read(key, ...args);
    };

    const summary = await store.getStorageSummary();

    assert.equal(summary.complete, false);
    assert.equal(summary.chatCount, 2);
    assert.equal(summary.snapshotCount, null);
    assert.equal(timelineReads, 0);
});

test('v2 summary rebuild reads lightweight indexes without loading snapshot records', async () => {
    const store = new SnapshotStore({ namespace: 'test' });
    await store.addSnapshot(snapshot('a', 'chat', 1));
    await store.addSnapshot(snapshot('b', 'chat', 2));
    const read = store.read.bind(store);
    let snapshotReads = 0;
    store.read = async (key, ...args) => {
        if (String(key).startsWith('snapshot:v2:')) snapshotReads += 1;
        return read(key, ...args);
    };

    const summary = await store.rebuildStorageSummary();

    assert.equal(summary.snapshotCount, 2);
    assert.equal(snapshotReads, 0);
});

test('a cached complete summary does not enumerate storage keys', async () => {
    const store = new SnapshotStore({ namespace: 'test' });
    await store.addSnapshot(snapshot('a', 'chat', 1));
    await store.rebuildStorageSummary();
    store.storageKeys = async () => {
        throw new Error('key enumeration should not run');
    };

    const summary = await store.getStorageSummary();

    assert.equal(summary.complete, true);
    assert.equal(summary.snapshotCount, 1);
});

test('concurrent summary rebuild requests share one timeline scan', async () => {
    const store = new SnapshotStore({ namespace: 'test' });
    store.memory.set('timeline:chat-a', [snapshot('a', 'chat-a', 1)]);
    store.memory.set('timeline:chat-b', [snapshot('b', 'chat-b', 2)]);
    const read = store.read.bind(store);
    let timelineReads = 0;
    store.read = async (key, ...args) => {
        if (String(key).startsWith('timeline:')) {
            timelineReads += 1;
            await Promise.resolve();
        }
        return read(key, ...args);
    };

    const [first, second] = await Promise.all([
        store.rebuildStorageSummary(),
        store.rebuildStorageSummary(),
    ]);

    assert.equal(first.snapshotCount, 2);
    assert.equal(second.snapshotCount, 2);
    assert.equal(timelineReads, 2);
});

test('complete storage metadata updates incrementally after mutations', async () => {
    const store = new SnapshotStore({ namespace: 'test' });
    await store.addSnapshot(snapshot('a', 'chat', 1));
    await store.addSnapshot(snapshot('b', 'chat', 2));
    const rebuilt = await store.rebuildStorageSummary();

    const replacement = {
        ...snapshot('a', 'chat', 3),
        finalText: 'replacement text with a different byte length',
    };
    await store.addSnapshot(replacement);
    const afterReplacement = await store.getStorageSummary();
    assert.equal(afterReplacement.complete, true);
    assert.equal(afterReplacement.chatCount, 1);
    assert.equal(afterReplacement.snapshotCount, 2);
    assert.notEqual(afterReplacement.approximateBytes, rebuilt.approximateBytes);

    await store.deleteSnapshot('chat', 'b');
    const afterDelete = await store.getStorageSummary();
    assert.equal(afterDelete.complete, true);
    assert.equal(afterDelete.snapshotCount, 1);
    assert.equal(afterDelete.approximateBytes < afterReplacement.approximateBytes, true);

    await store.clearTimeline('chat');
    const afterClear = await store.getStorageSummary();
    assert.equal(afterClear.complete, true);
    assert.equal(afterClear.chatCount, 0);
    assert.equal(afterClear.snapshotCount, 0);
    assert.equal(afterClear.approximateBytes, 0);
});

test('an empty store reports zero without creating persistent metadata', async () => {
    const store = new SnapshotStore({ namespace: 'test' });
    const empty = await store.getStorageSummary();
    assert.equal(empty.complete, true);
    assert.equal(empty.snapshotCount, 0);
    assert.deepEqual(await store.storageKeys(), []);
});

test('optional summary metadata failures do not fail snapshot persistence', async () => {
    const store = new SnapshotStore({ namespace: 'test' });
    await store.addSnapshot(snapshot('existing', 'chat', 1));
    await store.rebuildStorageSummary();
    const write = store.write.bind(store);
    store.write = async (key, value) => {
        if (key === 'storage-summary:v1') throw new Error('metadata unavailable');
        return write(key, value);
    };

    await store.addSnapshot(snapshot('saved', 'chat', 2));

    assert.deepEqual(
        (await store.getTimeline('chat')).map(({ id }) => id),
        ['existing', 'saved'],
    );
    const summary = await store.getStorageSummary();
    assert.equal(summary.complete, false);
    assert.equal(summary.chatCount, 1);
});

test('empty orphan timeline records do not keep summary rebuilding forever', async () => {
    const store = new SnapshotStore({ namespace: 'test' });
    store.memory.set('timeline:empty-orphan', []);

    const rebuilt = await store.rebuildStorageSummary();
    const cached = await store.getStorageSummary();

    assert.equal(rebuilt.complete, true);
    assert.equal(rebuilt.chatCount, 0);
    assert.equal(rebuilt.timelineRecordCount, 1);
    assert.equal(cached.complete, true);
    assert.equal(cached.snapshotCount, 0);
});

test('a mutation during background rebuild discards stale metadata safely', async () => {
    let announceYield;
    let releaseYield;
    const yielded = new Promise((resolve) => {
        announceYield = resolve;
    });
    const held = new Promise((resolve) => {
        releaseYield = resolve;
    });
    const store = new SnapshotStore({
        namespace: 'test',
        summaryYieldBudgetMs: 0,
        summaryYield: async () => {
            announceYield();
            await held;
        },
    });
    store.memory.set('timeline:chat', [snapshot('old', 'chat', 1)]);

    const rebuilding = store.rebuildStorageSummary();
    await yielded;
    await store.addSnapshot(snapshot('new', 'chat', 2));
    releaseYield();

    const discarded = await rebuilding;
    assert.equal(discarded.complete, false);

    const rebuilt = await store.rebuildStorageSummary();
    assert.equal(rebuilt.complete, true);
    assert.equal(rebuilt.snapshotCount, 2);
});

test('reading a legacy indexed snapshot writes its migration back only once', async () => {
    const store = new SnapshotStore({ namespace: 'test' });
    const legacy = {
        ...snapshot('legacy', 'chat', 1),
        finalText: 'legacy prompt',
    };
    seedIndexedSnapshot(store, legacy);
    const recordKey = store.snapshotKey('chat', 'legacy');
    const write = store.write.bind(store);
    let recordWrites = 0;
    store.write = async (key, value) => {
        if (key === recordKey) recordWrites += 1;
        return write(key, value);
    };

    const first = await store.getSnapshot('chat', 'legacy');
    const persisted = store.memory.get(recordKey);
    const second = await store.getSnapshot('chat', 'legacy');

    assert.notStrictEqual(first, legacy);
    assert.strictEqual(first, persisted);
    assert.strictEqual(second, persisted);
    assert.equal(recordWrites, 1);
});

test('lazy snapshot migration reconciles index bytes and a complete summary', async () => {
    const store = new SnapshotStore({ namespace: 'test' });
    const legacy = {
        ...snapshot('legacy', 'chat', 1),
        finalText: 'a legacy prompt whose migrated representation is larger',
    };
    seedIndexedSnapshot(store, legacy, 1);
    const before = await store.rebuildStorageSummary();
    assert.equal(before.approximateBytes, 1);

    const page = await store.getTimelinePage('chat');
    const persisted = store.memory.get(store.snapshotKey('chat', 'legacy'));
    const expectedBytes = jsonBytes(persisted);
    const index = store.memory.get(store.timelineIndexKey('chat'));
    const summary = await store.getStorageSummary();

    assert.deepEqual(page.snapshots.map(({ id }) => id), ['legacy']);
    assert.equal(index.entries[0].approximateBytes, expectedBytes);
    assert.equal(summary.complete, true);
    assert.equal(summary.approximateBytes, expectedBytes);
});

test('malformed records are isolated without deleting raw data or hiding healthy siblings', async () => {
    const store = new SnapshotStore({ namespace: 'test' });
    const healthy = snapshot('healthy', 'chat', 1);
    const corruptRecords = Array.from({ length: 25 }, (_, index) => ({
        schemaVersion: 1,
        id: `corrupt-${index + 1}`,
        chatId: 'chat',
        timestamp: index + 2,
        sources: { invalid: true },
        privateSentinel: `must-not-leak-${index + 1}`,
    }));
    const entries = [healthy, ...corruptRecords].map((value) => {
        store.memory.set(store.snapshotKey('chat', value.id), value);
        return {
            id: value.id,
            timestamp: value.timestamp,
            approximateBytes: jsonBytes(value),
        };
    });
    store.memory.set(store.timelineIndexKey('chat'), {
        version: 2,
        chatId: 'chat',
        entries,
        updatedAt: 30,
    });
    store.memory.set('chat-index', ['chat']);
    const preservedRaw = store.memory.get(store.snapshotKey('chat', 'corrupt-1'));

    const page = await store.getTimelinePage('chat');

    assert.deepEqual(page.snapshots.map(({ id }) => id), ['healthy']);
    assert.equal(page.corruptCount, 25);
    assert.equal(page.corruptEntries.length, 20);
    assert.deepEqual(
        Object.keys(page.corruptEntries[0]).sort(),
        ['id', 'message'],
    );
    assert.equal(
        JSON.stringify(page.corruptEntries).includes('must-not-leak'),
        false,
    );
    assert.strictEqual(
        store.memory.get(store.snapshotKey('chat', 'corrupt-1')),
        preservedRaw,
    );
    assert.equal(await store.getSnapshot('chat', 'corrupt-1'), null);
    assert.strictEqual(
        store.memory.get(store.snapshotKey('chat', 'corrupt-1')),
        preservedRaw,
    );
});

test('legacy array migration preserves every malformed record and indexes it for warning', async () => {
    const store = new SnapshotStore({ namespace: 'test' });
    const healthy = snapshot('healthy', 'legacy-chat', 1);
    const malformedWithId = {
        schemaVersion: 5,
        id: 'malformed',
        chatId: 'legacy-chat',
        timestamp: 2,
        finalText: 'broken',
        sources: { invalid: true },
        privateSentinel: 'keep-malformed-verbatim',
    };
    const idless = {
        schemaVersion: 5,
        chatId: 'legacy-chat',
        timestamp: 3,
        finalText: 'idless',
        sources: [],
        privateSentinel: 'keep-idless-verbatim',
    };
    const primitive = 'keep-primitive-verbatim';
    store.memory.set(store.timelineKey('legacy-chat'), [
        healthy,
        malformedWithId,
        idless,
        primitive,
    ]);

    const page = await store.getTimelinePage('legacy-chat');
    const index = store.memory.get(store.timelineIndexKey('legacy-chat'));
    const syntheticEntries = index.entries.filter(
        ({ id }) => id.startsWith('__legacy-corrupt-v1-'),
    );

    assert.deepEqual(page.snapshots.map(({ id }) => id), ['healthy']);
    assert.equal(page.totalCount, 4);
    assert.equal(page.corruptCount, 3);
    assert.equal(index.entries.length, 4);
    assert.equal(syntheticEntries.length, 2);
    assert.strictEqual(
        store.memory.get(store.snapshotKey('legacy-chat', 'malformed')),
        malformedWithId,
    );
    assert.deepEqual(
        syntheticEntries.map(({ id }) => (
            store.memory.get(store.snapshotKey('legacy-chat', id))
        )),
        [primitive, idless],
    );
    assert.equal(store.memory.has(store.timelineKey('legacy-chat')), false);
});

test('retrying an interrupted idless legacy migration reuses its synthetic record id', async () => {
    const store = new SnapshotStore({ namespace: 'test' });
    const legacyKey = store.timelineKey('chat');
    const indexKey = store.timelineIndexKey('chat');
    const idless = {
        schemaVersion: 5,
        chatId: 'chat',
        timestamp: 1,
        finalText: 'idless',
        sources: [],
        privateSentinel: 'keep-on-retry',
    };
    store.memory.set(legacyKey, [idless]);
    const write = store.write.bind(store);
    let failIndexWrite = true;
    store.write = async (key, value) => {
        if (key === indexKey && failIndexWrite) {
            throw new Error('simulated index failure');
        }
        return write(key, value);
    };

    await assert.rejects(
        store.getTimelinePage('chat'),
        /simulated index failure/,
    );
    const firstRecordKeys = [...store.memory.keys()].filter(
        (key) => key.startsWith('snapshot:v2:'),
    );
    assert.equal(firstRecordKeys.length, 1);
    assert.equal(store.memory.has(legacyKey), true);

    failIndexWrite = false;
    const page = await store.getTimelinePage('chat');
    const secondRecordKeys = [...store.memory.keys()].filter(
        (key) => key.startsWith('snapshot:v2:'),
    );
    assert.deepEqual(secondRecordKeys, firstRecordKeys);
    assert.equal(page.corruptCount, 1);
    assert.strictEqual(store.memory.get(firstRecordKeys[0]), idless);
    assert.equal(store.memory.has(legacyKey), false);
});
