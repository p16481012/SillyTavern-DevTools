import assert from 'node:assert/strict';
import test from 'node:test';
import {
    applyAutomaticRetentionMaintenance,
    automaticRetentionPolicyFromPreferences,
} from '../src/retention-maintenance.js';
import { SnapshotStore } from '../src/storage.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function snapshot(id, timestamp, content = id) {
    return {
        schemaVersion: 4,
        id,
        chatId: 'chat',
        timestamp,
        finalText: content,
        sources: [],
        stats: { structured: {} },
    };
}

async function importWithoutInterimRetention(store, values) {
    await store.runExclusiveImport(async (facade) => {
        for (const value of values) {
            await facade.addSnapshot(value);
        }
    });
}

test('automatic maintenance never applies the configured count as a GC stage', async () => {
    const store = new SnapshotStore({
        namespace: 'test',
        maxSnapshotsPerChat: 1,
    });
    await importWithoutInterimRetention(store, [
        snapshot('first', 1),
        snapshot('second', 2),
    ]);

    const result = await applyAutomaticRetentionMaintenance(store, {
        timelineRetentionLimit: 1,
        timelineReadLimit: 1,
        retentionMaxAgeDays: 0,
        retentionMaxBytes: 0,
    });

    assert.equal(result, null);
    assert.equal((await store.getTimelinePage('chat')).totalCount, 2);
    assert.equal(store.maxSnapshotsPerChat, 1);
    assert.deepEqual(automaticRetentionPolicyFromPreferences({
        timelineRetentionLimit: 1,
    }), {
        maxSnapshotsPerChat: 5_000,
        maxAgeDays: 0,
        maxTotalBytes: 0,
    });
});

test('automatic maintenance still applies age and byte limits then restores capture count', async () => {
    const now = Date.now();
    const ageStore = new SnapshotStore({
        namespace: 'age-test',
        maxSnapshotsPerChat: 1,
    });
    await importWithoutInterimRetention(ageStore, [
        snapshot('old', now - (3 * DAY_MS)),
        snapshot('fresh', now),
    ]);

    const ageResult = await applyAutomaticRetentionMaintenance(ageStore, {
        timelineRetentionLimit: 1,
        timelineReadLimit: 1,
        retentionMaxAgeDays: 1,
        retentionMaxBytes: 0,
    });
    assert.equal(ageResult.deletedCount, 1);
    assert.deepEqual(
        (await ageStore.getAllStoredTimelines())[0].timeline.map(({ id }) => id),
        ['fresh'],
    );
    assert.equal(ageStore.maxSnapshotsPerChat, 1);

    const byteStore = new SnapshotStore({
        namespace: 'byte-test',
        maxSnapshotsPerChat: 1,
    });
    await importWithoutInterimRetention(byteStore, [
        snapshot('smaller', now, 'a'.repeat(100)),
        snapshot('latest', now + 1, 'b'.repeat(100)),
    ]);
    const index = byteStore.memory.get(byteStore.timelineIndexKey('chat'));
    const latestBytes = index.entries.find(({ id }) => id === 'latest')
        .approximateBytes;
    const byteResult = await applyAutomaticRetentionMaintenance(byteStore, {
        timelineRetentionLimit: 1,
        timelineReadLimit: 1,
        retentionMaxAgeDays: 0,
        retentionMaxBytes: latestBytes + 1,
    });
    assert.equal(byteResult.deletedCount, 1);
    assert.deepEqual(
        (await byteStore.getAllStoredTimelines())[0].timeline.map(({ id }) => id),
        ['latest'],
    );
    assert.equal(byteStore.maxSnapshotsPerChat, 1);
});
