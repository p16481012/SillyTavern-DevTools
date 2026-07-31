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

test('v1 snapshots migrate to schema v5 without changing captured text', () => {
    const original = legacySnapshot();
    const migrated = migrateSnapshot(original);

    assert.equal(original.schemaVersion, 1);
    assert.equal(migrated.schemaVersion, 5);
    assert.equal(migrated.capture.requestStatus, 'prompt-only-timeout');
    assert.equal(migrated.capture.generationStatus, 'unknown');
    assert.equal(migrated.finalText, original.finalText);
    assert.deepEqual(migrated.sources[0].ranges, [{ start: 0, end: 13 }]);
    assert.equal(migrated.capture.fallback, true);
    assert.equal(migrated.capture.migratedFrom, 1);
    assert.equal(migrated.request.body, null);
    assert.deepEqual(migrated.sources[0].provenance, {
        method: 'exact',
        confidence: 1,
    });
    assert.deepEqual(migrated.stats.structured, {
        toolSchemas: 0,
        toolCalls: 0,
        toolResults: 0,
        multimodalParts: 0,
        multimodalEstimatedTokens: 0,
        multimodalEstimateCoverage: null,
    });
});

test('timeline reads persist one-time schema migration', async () => {
    const store = new SnapshotStore({ namespace: 'test' });
    store.memory.set(store.timelineKey('chat'), [legacySnapshot()]);

    const timeline = await store.getTimeline('chat');
    assert.equal(timeline[0].schemaVersion, 5);
    assert.equal(store.memory.has(store.timelineKey('chat')), false);
    assert.equal(
        store.memory.get(store.timelineIndexKey('chat')).version,
        2,
    );
    assert.equal(
        store.memory.get(store.snapshotKey('chat', 'legacy')).schemaVersion,
        5,
    );
});

test('an interrupted timeline layout migration keeps the legacy record for retry', async () => {
    const store = new SnapshotStore({ namespace: 'test' });
    const legacyKey = store.timelineKey('chat');
    const indexKey = store.timelineIndexKey('chat');
    store.memory.set(legacyKey, [legacySnapshot()]);
    const write = store.write.bind(store);
    let failIndexWrite = true;
    store.write = async (key, value) => {
        if (key === indexKey && failIndexWrite) {
            throw new Error('simulated index failure');
        }
        return write(key, value);
    };

    await assert.rejects(store.getTimeline('chat'), /simulated index failure/);
    assert.equal(store.memory.has(legacyKey), true);
    assert.equal(store.memory.has(indexKey), false);

    failIndexWrite = false;
    const timeline = await store.getTimeline('chat');
    assert.deepEqual(timeline.map(({ id }) => id), ['legacy']);
    assert.equal(store.memory.has(legacyKey), false);
});

test('timeline layout migration and clearAll cannot resurrect cleared records', async () => {
    let migrationStarted;
    let releaseMigration;
    const started = new Promise((resolve) => {
        migrationStarted = resolve;
    });
    const held = new Promise((resolve) => {
        releaseMigration = resolve;
    });
    const store = new SnapshotStore({
        namespace: 'test',
        summaryYieldBudgetMs: 0,
        migrationYield: async () => {
            migrationStarted();
            await held;
        },
    });
    store.memory.set(store.timelineKey('chat'), [legacySnapshot()]);

    const reading = store.getTimeline('chat');
    await started;
    const clearing = store.clearAll();
    releaseMigration();

    assert.deepEqual((await reading).map(({ id }) => id), ['legacy']);
    assert.deepEqual(await clearing, { chatCount: 1, snapshotCount: 1 });
    assert.deepEqual(await store.storageKeys(), []);
});

test('v4 request captures gain lifecycle defaults without losing request data', () => {
    const migrated = migrateSnapshot({
        ...legacySnapshot(),
        schemaVersion: 4,
        capture: {
            eventName: 'CHAT_COMPLETION_SETTINGS_READY',
            stage: 'backend-request-ready',
            fallback: false,
        },
        request: {
            body: { model: 'test-model' },
            settings: { model: 'test-model' },
            bodyKeys: ['model'],
            redactedPaths: [],
            omittedMediaPaths: [],
        },
    });

    assert.equal(migrated.schemaVersion, 5);
    assert.equal(migrated.request.body.model, 'test-model');
    assert.equal(migrated.capture.requestStatus, 'captured');
    assert.equal(migrated.capture.generationStatus, 'unknown');
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
