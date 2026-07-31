import assert from 'node:assert/strict';
import test from 'node:test';

import { compareDiagnosticReports } from '../src/diagnostic-compare.js';
import { buildTimelineDiagnostics } from '../src/diagnostics.js';

function diagnosticSnapshot(id, {
    timestamp,
    provider = 'openai',
    model = 'model-a',
    tokens = 10,
    stage = 'request-ready',
} = {}) {
    return {
        id,
        timestamp,
        api: 'openai',
        provider,
        model,
        promptType: 'chat-completion',
        generationType: 'normal',
        schemaVersion: 6,
        extensionVersion: '0.10.0',
        capture: {
            stage,
            fallback: false,
            correlationMethod: 'explicit-id',
            correlationId: 'private-id',
        },
        request: {
            bodyKeys: ['messages'],
            redactedPaths: [],
            omittedMediaPaths: [],
        },
        stats: {
            totalTokens: tokens,
            structured: {},
        },
        sources: [],
    };
}

test('diagnostic comparison reports bounded metadata changes without raw ids', () => {
    const before = buildTimelineDiagnostics([
        diagnosticSnapshot('same-private-id', {
            timestamp: 1,
            tokens: 10,
        }),
        diagnosticSnapshot('removed-private-id', {
            timestamp: 2,
            tokens: 20,
        }),
    ], { generatedAt: 100 });
    const after = buildTimelineDiagnostics([
        diagnosticSnapshot('same-private-id', {
            timestamp: 1,
            provider: 'claude',
            model: 'model-b',
            tokens: 15,
        }),
        diagnosticSnapshot('added-private-id', {
            timestamp: 3,
            tokens: 30,
        }),
    ], { generatedAt: 200 });

    const result = compareDiagnosticReports(before, after);
    assert.equal(result.compatible, true);
    assert.equal(result.snapshots.addedCount, 1);
    assert.equal(result.snapshots.removedCount, 1);
    assert.equal(result.snapshots.changedCount, 1);
    assert.deepEqual(
        result.snapshots.changed[0].fields.map(({ field }) => field),
        ['provider', 'model', 'tokens.prompt'],
    );
    assert.doesNotMatch(JSON.stringify(result), /same-private-id|added-private-id/);
    assert.equal(
        result.summary.countMaps.providerCounts.some(
            ({ key }) => key === 'claude',
        ),
        true,
    );
});

test('scope and report-version differences are explicit', () => {
    const before = buildTimelineDiagnostics([], { generatedAt: 100 });
    const after = buildTimelineDiagnostics([], { generatedAt: 200 });
    after.scope = 'all-chat-timelines';
    after.summary.chatCount = 0;
    after.chats = [];
    after.reportVersion = 1;
    delete after.privacy.chatIdValuesIncluded;

    const result = compareDiagnosticReports(before, after);
    assert.equal(result.compatible, false);
    assert.deepEqual(result.warnings, [
        'scope-mismatch',
        'report-version-mismatch',
    ]);
});

test('a report-version mismatch alone is incompatible', () => {
    const before = buildTimelineDiagnostics([], { generatedAt: 100 });
    const after = structuredClone(before);
    after.generatedAt = 200;
    after.reportVersion = 1;
    delete after.privacy.chatIdValuesIncluded;

    const result = compareDiagnosticReports(before, after);
    assert.equal(result.compatible, false);
    assert.deepEqual(result.warnings, ['report-version-mismatch']);
});

test('duplicate private snapshot ids retain deterministic occurrence matching', () => {
    const before = buildTimelineDiagnostics([
        diagnosticSnapshot('duplicate-private-id', {
            timestamp: 1,
            tokens: 10,
        }),
        diagnosticSnapshot('duplicate-private-id', {
            timestamp: 2,
            tokens: 20,
        }),
    ], { generatedAt: 100 });
    const after = buildTimelineDiagnostics([
        diagnosticSnapshot('duplicate-private-id', {
            timestamp: 1,
            tokens: 11,
        }),
        diagnosticSnapshot('duplicate-private-id', {
            timestamp: 2,
            tokens: 20,
        }),
    ], { generatedAt: 200 });

    const result = compareDiagnosticReports(before, after);
    assert.equal(result.snapshots.addedCount, 0);
    assert.equal(result.snapshots.removedCount, 0);
    assert.equal(result.snapshots.changedCount, 1);
    assert.equal(
        result.snapshots.changed[0].fields.some(
            ({ field }) => field === 'tokens.prompt',
        ),
        true,
    );
    assert.doesNotMatch(JSON.stringify(result), /duplicate-private-id/u);
});

test('count-map output is deterministic, bounded, and marks truncation', () => {
    const before = buildTimelineDiagnostics([], { generatedAt: 100 });
    const after = structuredClone(before);
    after.generatedAt = 200;
    after.summary.apiCounts = Object.fromEntries(
        Array.from({ length: 250 }, (_, index) => [
            `api-${String(249 - index).padStart(3, '0')}`,
            1,
        ]),
    );
    after.summary.apiCounts['x'.repeat(500)] = 1;

    const result = compareDiagnosticReports(before, after);
    const changes = result.summary.countMaps.apiCounts;
    assert.equal(changes.length, 200);
    assert.equal(changes[0].key, 'api-000');
    assert.equal(changes.at(-1).key, 'api-199');
    assert.deepEqual(result.summary.countMapTruncation.apiCounts, {
        totalChanges: 251,
        shownChanges: 200,
    });
    assert.equal(JSON.stringify(result).includes('x'.repeat(129)), false);
});

test('diagnostic comparison rejects reports containing prompt content', () => {
    const before = buildTimelineDiagnostics([], { generatedAt: 100 });
    const after = structuredClone(before);
    after.generatedAt = 200;
    after.finalText = '비공개 프롬프트';
    assert.throws(
        () => compareDiagnosticReports(before, after),
        /finalText/u,
    );
});
