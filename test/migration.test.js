import assert from 'node:assert/strict';
import test from 'node:test';
import {
    migrateSnapshot,
    migrateV5ToV6,
    SnapshotMigrationError,
} from '../src/migrations.js';
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

test('v1 snapshots migrate through schema v5, v6, and v7 without changing captured text', () => {
    const original = legacySnapshot();
    const migrated = migrateSnapshot(original);

    assert.equal(original.schemaVersion, 1);
    assert.equal(migrated.schemaVersion, 7);
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
        availability: 'legacy-unavailable',
        locations: [],
        locationCount: 0,
        locationsTruncated: false,
    });
    assert.equal(migrated.providerTrace.selectedSource.value, 'unknown');
    assert.equal(migrated.providerTrace.upstreamProvider.status, 'unknown');
    assert.equal(migrated.usage.status, 'unavailable');
    assert.deepEqual(migrated.stats.structured, {
        toolSchemas: 0,
        toolCalls: 0,
        toolResults: 0,
        multimodalParts: 0,
        multimodalEstimatedTokens: 0,
        multimodalEstimateCoverage: null,
    });
});

test('legacy storage settings skip oversized template regexes without failing migration', async () => {
    const literal = 'word '.repeat(4_000);
    const oversized = {
        ...legacySnapshot(),
        finalText: `${literal}VALUE tail sentence`,
        sources: [{
            id: 'large-template',
            type: 'system',
            label: 'Large template',
            content: `${literal}{{slot}} tail sentence`,
            attribution: 'unmatched',
        }],
    };
    const migrated = migrateSnapshot(oversized);

    assert.equal(migrated.schemaVersion, 7);
    assert.equal(migrated.sources[0].attribution, 'unmatched');
    assert.deepEqual(migrated.sources[0].ranges, []);
    assert.deepEqual(migrated.sources[0].provenance, {
        method: 'unmatched',
        confidence: 0,
        availability: 'legacy-unavailable',
        locations: [],
        locationCount: 0,
        locationsTruncated: false,
    });

    const store = new SnapshotStore({ namespace: 'test', maxSnapshotsPerChat: 100 });
    store.memory.set(store.timelineKey('chat'), [
        oversized,
        { ...legacySnapshot(), id: 'newer', timestamp: 2 },
    ]);
    const preview = await store.getRetentionPrunePreview(1);
    assert.equal(preview.snapshotCount, 1);
    await store.applyRetentionLimit(1, { expectedRevision: preview.revision });
    assert.deepEqual((await store.getTimeline('chat')).map(({ id }) => id), ['newer']);
});

test('timeline reads persist one-time schema migration', async () => {
    const store = new SnapshotStore({ namespace: 'test' });
    store.memory.set(store.timelineKey('chat'), [legacySnapshot()]);

    const timeline = await store.getTimeline('chat');
    assert.equal(timeline[0].schemaVersion, 7);
    assert.equal(store.memory.has(store.timelineKey('chat')), false);
    assert.equal(
        store.memory.get(store.timelineIndexKey('chat')).version,
        2,
    );
    assert.equal(
        store.memory.get(store.snapshotKey('chat', 'legacy')).schemaVersion,
        7,
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

    assert.equal(migrated.schemaVersion, 7);
    assert.equal(migrated.request.body.model, 'test-model');
    assert.equal(migrated.capture.requestStatus, 'captured');
    assert.equal(migrated.capture.generationStatus, 'unknown');
});

test('v5 migration is non-mutating, records legacy provenance honestly, and is idempotent', () => {
    const original = {
        ...legacySnapshot(),
        schemaVersion: 5,
        api: 'openai',
        provider: 'openrouter',
        generationType: 'normal',
        capture: {
            eventName: 'CHAT_COMPLETION_SETTINGS_READY',
            stage: 'backend-request-ready',
            fallback: false,
        },
        sources: [{
            id: 'prefill',
            type: 'assistant_prefill',
            content: 'Continue here',
            ranges: [{ start: 0, end: 10 }],
            attribution: 'derived',
            metadata: { inferred: true },
            provenance: {
                method: 'assistant-prefill-inferred',
                confidence: 0.5,
                messageIndexes: [0],
            },
        }],
    };
    const before = structuredClone(original);
    const migrated = migrateSnapshot(original);

    assert.deepEqual(original, before);
    assert.notEqual(migrated, original);
    assert.equal(migrated.schemaVersion, 7);
    assert.equal(migrated.capture.migratedFrom, 5);
    assert.equal(migrated.sources[0].metadata.prefillStatus, 'inferred');
    assert.equal(migrated.sources[0].provenance.availability, 'legacy-unavailable');
    assert.deepEqual(migrated.sources[0].provenance.locations, []);
    assert.equal(migrated.providerTrace.selectedSource.value, 'openrouter');
    assert.equal(migrated.providerTrace.selectedSource.status, 'legacy-fallback');
    assert.deepEqual(migrated.providerTrace.upstreamProvider, {
        value: null,
        status: 'unknown',
        evidencePointer: null,
    });
    assert.equal(migrated.usage.status, 'unavailable');
    assert.equal(migrateSnapshot(migrated), migrated);
    assert.deepEqual(JSON.parse(JSON.stringify(migrated)), migrated);
});

test('the v5 to v6 step stays pinned to schema 6 before the v7 migration', () => {
    const v5 = {
        ...legacySnapshot(),
        schemaVersion: 5,
    };
    const v6 = migrateV5ToV6(v5);

    assert.equal(v6.schemaVersion, 6);
    assert.equal(v6.usage, undefined);
    assert.equal(migrateSnapshot(v6).schemaVersion, 7);
});

test('corrupt legacy ranges fail at a record boundary without mutating the source', () => {
    const corrupt = {
        ...legacySnapshot(),
        schemaVersion: 5,
        sources: [{
            id: 'broken',
            type: 'system',
            content: 'Legacy source',
            ranges: [{ start: 9, end: 2 }],
        }],
    };
    const before = structuredClone(corrupt);

    assert.throws(
        () => migrateSnapshot(corrupt),
        (error) => (
            error instanceof SnapshotMigrationError
            && error.code === 'invalid-source-ranges'
        ),
    );
    assert.deepEqual(corrupt, before);
});

test('corrupt v6 provenance pointers are rejected at the same record boundary', () => {
    const corrupt = {
        schemaVersion: 6,
        id: 'corrupt-v6',
        timestamp: 1,
        finalText: 'text',
        sources: [{
            id: 'source',
            type: 'system',
            content: 'text',
            ranges: [{ start: 0, end: 4 }],
            provenance: {
                method: 'exact',
                confidence: 1,
                availability: 'available',
                locations: [{
                    jsonPointer: '/payload/~2broken',
                    messageIndex: 0,
                    role: 'system',
                    valueRange: { start: 0, end: 4 },
                    finalRange: { start: 0, end: 4 },
                }],
                locationCount: 1,
                locationsTruncated: false,
            },
        }],
    };

    assert.throws(
        () => migrateSnapshot(corrupt),
        (error) => (
            error instanceof SnapshotMigrationError
            && error.code === 'invalid-provenance-locations'
        ),
    );
});

function v6SnapshotWithLocation(location = {}, source = {}) {
    return {
        schemaVersion: 6,
        id: 'v6-location',
        timestamp: 1,
        finalText: 'text',
        payload: [{ role: 'system', content: 'text' }],
        sources: [{
            id: 'source',
            type: 'system',
            content: 'text',
            ranges: [{ start: 0, end: 4 }],
            provenance: {
                method: 'exact',
                confidence: 1,
                availability: 'available',
                locations: [{
                    jsonPointer: '/payload/0/content',
                    messageIndex: 0,
                    role: 'system',
                    valueRange: { start: 0, end: 4 },
                    finalRange: { start: 0, end: 4 },
                    ...location,
                }],
                locationCount: 1,
                locationsTruncated: false,
            },
            ...source,
        }],
    };
}

test('valid v6 provenance migrates once and its v7 result is idempotent', () => {
    const valid = v6SnapshotWithLocation();
    const migrated = migrateSnapshot(valid);
    assert.notStrictEqual(migrated, valid);
    assert.equal(migrated.schemaVersion, 7);
    assert.equal(migrated.usage.status, 'unavailable');
    assert.strictEqual(migrateSnapshot(migrated), migrated);
});

test('v6 to v7 strips raw correlation ids and replaces legacy usage with a local estimate', () => {
    const original = {
        ...v6SnapshotWithLocation(),
        timestamp: 500,
        capture: {
            correlationId: 'raw-capture-id',
            hadCorrelationId: false,
        },
        request: {
            body: {
                request_id: 'raw-root-id',
                responseId: 'raw-root-response-id',
                id: 'unrelated-root-domain-id',
                metadata: {
                    generation_id: 'raw-metadata-id',
                    id: 'unrelated-metadata-domain-id',
                },
                domain: {
                    request_id: 'unrelated-nested-domain-id',
                    responseId: 'unrelated-nested-response-id',
                },
            },
            settings: {
                requestId: 'raw-settings-id',
                model: 'example-model',
                domain: { request_id: 'unrelated-settings-domain-id' },
            },
            bodyKeys: ['request_id', 'responseId', 'id', 'metadata', 'domain'],
            correlationId: 'raw-request-record-id',
            hadCorrelationId: false,
        },
        stats: { totalTokens: 42 },
        usage: {
            status: 'provider-reported',
            responseId: 'raw-usage-id',
            outputTokens: 999,
            cost: { amount: 123 },
        },
    };
    const before = structuredClone(original);
    const migrated = migrateSnapshot(original);

    assert.deepEqual(original, before);
    assert.equal(migrated.schemaVersion, 7);
    assert.equal(migrated.capture.correlationId, null);
    assert.equal(migrated.capture.hadCorrelationId, true);
    assert.equal(migrated.request.correlationId, null);
    assert.equal(migrated.request.hadCorrelationId, true);
    assert.equal(Object.hasOwn(migrated.request.body, 'request_id'), false);
    assert.equal(Object.hasOwn(migrated.request.body, 'responseId'), false);
    assert.equal(Object.hasOwn(migrated.request.body.metadata, 'generation_id'), false);
    assert.equal(Object.hasOwn(migrated.request.settings, 'requestId'), false);
    assert.equal(migrated.request.body.id, 'unrelated-root-domain-id');
    assert.equal(migrated.request.body.metadata.id, 'unrelated-metadata-domain-id');
    assert.equal(migrated.request.body.domain.request_id, 'unrelated-nested-domain-id');
    assert.equal(migrated.request.body.domain.responseId, 'unrelated-nested-response-id');
    assert.equal(
        migrated.request.settings.domain.request_id,
        'unrelated-settings-domain-id',
    );
    assert.deepEqual(migrated.request.bodyKeys, ['id', 'metadata', 'domain']);
    assert.deepEqual(migrated.usage, {
        status: 'local-estimate',
        inputTokens: 42,
        outputTokens: null,
        cachedInputTokens: null,
        totalTokens: null,
        sourceEvent: 'legacy-snapshot-token-count',
        correlatedAt: 500,
        cost: {
            status: 'unavailable',
            amount: null,
            currency: null,
            priceSource: null,
            priceAsOf: null,
        },
    });
    assert.equal(JSON.stringify(migrated).includes('raw-usage-id'), false);
    assert.equal(JSON.stringify(migrated).includes('999'), false);
    assert.equal(JSON.stringify(migrated).includes('123'), false);
    assert.strictEqual(migrateSnapshot(migrated), migrated);
});

test('canonical v7 validation rejects malformed usage and raw correlation ids', () => {
    const valid = migrateSnapshot({
        ...v6SnapshotWithLocation(),
        stats: { totalTokens: 4 },
    });
    const malformedUsage = {
        ...valid,
        usage: {
            ...valid.usage,
            outputTokens: 2,
        },
    };
    assert.throws(
        () => migrateSnapshot(malformedUsage),
        (error) => (
            error instanceof SnapshotMigrationError
            && error.code === 'invalid-usage'
        ),
    );
    assert.throws(
        () => migrateSnapshot({
            ...valid,
            request: {
                body: { request_id: 'raw-id' },
                settings: {},
                correlationId: null,
            },
        }),
        (error) => (
            error instanceof SnapshotMigrationError
            && error.code === 'raw-correlation-id'
        ),
    );
});

test('v6 provenance rejects malformed, oversized, missing, and contradictory locations', () => {
    const cases = [{
        name: 'malformed explicit value range',
        snapshot: v6SnapshotWithLocation({
            valueRange: { start: '0', end: 4 },
        }),
    }, {
        name: 'malformed explicit final range',
        snapshot: v6SnapshotWithLocation({
            finalRange: { start: 2, end: 2 },
        }),
    }, {
        name: 'oversized pointer',
        snapshot: v6SnapshotWithLocation({
            jsonPointer: `/${'x'.repeat(1_024)}`,
        }),
    }, {
        name: 'oversized role',
        snapshot: v6SnapshotWithLocation({
            role: 's'.repeat(65),
        }),
    }, {
        name: 'missing pointer target',
        snapshot: v6SnapshotWithLocation({
            jsonPointer: '/payload/1/content',
            messageIndex: 1,
        }),
    }, {
        name: 'value range outside pointer target',
        snapshot: v6SnapshotWithLocation({
            valueRange: { start: 0, end: 5 },
        }),
    }, {
        name: 'final range outside final text',
        snapshot: v6SnapshotWithLocation({
            finalRange: { start: 0, end: 5 },
        }),
    }, {
        name: 'final range contradicts source range and content',
        snapshot: {
            ...v6SnapshotWithLocation({
                valueRange: null,
                finalRange: { start: 4, end: 8 },
            }, {
                ranges: [{ start: 0, end: 4 }],
            }),
            finalText: 'textmore',
        },
    }];

    for (const { name, snapshot } of cases) {
        assert.throws(
            () => migrateSnapshot(snapshot),
            (error) => (
                error instanceof SnapshotMigrationError
                && error.code === 'invalid-provenance-locations'
            ),
            name,
        );
    }
});

test('v6 provider evidence pointers must resolve within the snapshot', () => {
    const corrupt = {
        ...v6SnapshotWithLocation(),
        providerTrace: {
            selectedSource: {
                value: 'openrouter',
                status: 'captured',
                evidencePointer: '/request/body/chat_completion_source',
            },
            upstreamProvider: {
                value: null,
                status: 'unknown',
                evidencePointer: null,
            },
        },
    };

    assert.throws(
        () => migrateSnapshot(corrupt),
        (error) => (
            error instanceof SnapshotMigrationError
            && error.code === 'invalid-provider-trace'
        ),
    );
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
