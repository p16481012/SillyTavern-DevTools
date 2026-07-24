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

test('v1 snapshots migrate to schema v2 without changing captured text', () => {
    const original = legacySnapshot();
    const migrated = migrateSnapshot(original);

    assert.equal(original.schemaVersion, 1);
    assert.equal(migrated.schemaVersion, 2);
    assert.equal(migrated.finalText, original.finalText);
    assert.deepEqual(migrated.sources[0].ranges, [{ start: 0, end: 13 }]);
    assert.equal(migrated.capture.fallback, true);
    assert.equal(migrated.capture.migratedFrom, 1);
    assert.equal(migrated.request.body, null);
});

test('timeline reads persist one-time schema migration', async () => {
    const store = new SnapshotStore({ namespace: 'test' });
    store.memory.set(store.timelineKey('chat'), [legacySnapshot()]);

    const timeline = await store.getTimeline('chat');
    assert.equal(timeline[0].schemaVersion, 2);
    assert.equal(store.memory.get(store.timelineKey('chat'))[0].schemaVersion, 2);
});
