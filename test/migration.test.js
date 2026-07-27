import assert from 'node:assert/strict';
import test from 'node:test';
import { migrateSnapshot } from '../src/migrations.js';
import { SnapshotStore } from '../src/storage.js';

function legacySnapshot() {
    return {
        schemaVersion: 1,
        id: 'legacy',
        timestamp: 1,
        chatId: 'chat',
        promptType: 'chat-completion',
        finalText: 'Legacy source',
        sources: [{
            id: 'source',
            type: 'system',
            label: 'Legacy',
            content: 'Legacy source',
            attribution: 'exact',
        }],
    };
}

test('v1 snapshots migrate to schema v3 without changing captured text', () => {
    const original = legacySnapshot();
    const migrated = migrateSnapshot(original);

    assert.equal(original.schemaVersion, 1);
    assert.equal(migrated.schemaVersion, 3);
    assert.equal(migrated.finalText, original.finalText);
    assert.deepEqual(migrated.sources[0].ranges, [{ start: 0, end: 13 }]);
    assert.equal(migrated.capture.fallback, true);
    assert.equal(migrated.capture.migratedFrom, 1);
    assert.equal(migrated.request.body, null);
    assert.deepEqual(migrated.stats.structured, {
        toolSchemas: 0,
        toolCalls: 0,
        toolResults: 0,
        multimodalParts: 0,
    });
});

test('timeline reads persist one-time schema migration', async () => {
    const store = new SnapshotStore({ namespace: 'test' });
    store.memory.set(store.timelineKey('chat'), [legacySnapshot()]);

    const timeline = await store.getTimeline('chat');
    assert.equal(timeline[0].schemaVersion, 3);
    assert.equal(store.memory.get(store.timelineKey('chat'))[0].schemaVersion, 3);
});

test('deleteSnapshot removes only the selected snapshot and cleans up an empty timeline', async () => {
    const store = new SnapshotStore({ namespace: 'test' });
    const first = legacySnapshot();
    const second = { ...legacySnapshot(), id: 'second', timestamp: 2 };
    store.memory.set(store.timelineKey('chat'), [first, second]);

    assert.equal(await store.deleteSnapshot('chat', 'missing'), false);
    assert.equal(await store.deleteSnapshot('chat', 'legacy'), true);
    assert.deepEqual((await store.getTimeline('chat')).map(({ id }) => id), ['second']);
    assert.equal(await store.deleteSnapshot('chat', 'second'), true);
    assert.equal(store.memory.has(store.timelineKey('chat')), false);
});

test('snapshot storage retains the newest 100 items and replaces duplicate ids', async () => {
    const store = new SnapshotStore({ namespace: 'test', maxSnapshotsPerChat: 100 });
    for (let index = 0; index < 125; index += 1) {
        await store.addSnapshot({
            schemaVersion: 2,
            id: `snapshot-${index}`,
            timestamp: index,
            chatId: 'chat',
        });
    }

    let timeline = await store.getTimeline('chat');
    assert.equal(timeline.length, 100);
    assert.equal(timeline[0].id, 'snapshot-25');
    assert.equal(timeline.at(-1).id, 'snapshot-124');

    await store.addSnapshot({
        schemaVersion: 2,
        id: 'snapshot-50',
        timestamp: 200,
        chatId: 'chat',
        marker: 'replacement',
    });
    timeline = await store.getTimeline('chat');
    assert.equal(timeline.length, 100);
    assert.equal(timeline.filter(({ id }) => id === 'snapshot-50').length, 1);
    assert.equal(timeline.at(-1).marker, 'replacement');
});
