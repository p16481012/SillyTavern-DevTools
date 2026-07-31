import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildRangeSegments,
    buildTimelineAnalysis,
    compareLoreEntries,
    compareSnapshotSources,
    largestIncludedSource,
} from '../src/pipeline-analysis.js';

function source({
    id,
    type = 'system',
    field,
    content,
    tokenCount,
    attribution = 'exact',
    ranges = [],
}) {
    return {
        id,
        type,
        label: field,
        metadata: { field },
        content,
        tokenCount,
        attribution,
        ranges,
    };
}

function snapshot({
    id,
    timestamp,
    totalTokens,
    sources = [],
    lorebookEntries = [],
}) {
    return {
        id,
        timestamp,
        stats: { totalTokens },
        sources,
        lorebookEntries,
    };
}

test('compareLoreEntries reports activated, removed, and retained entries', () => {
    const alpha = { world: 'world', uid: 1, comment: 'Alpha' };
    const beta = { world: 'world', uid: 2, comment: 'Beta' };
    const gamma = { world: 'world', uid: 3, comment: 'Gamma' };

    const changes = compareLoreEntries([alpha, beta], [beta, gamma]);
    assert.deepEqual(changes.activated, [gamma]);
    assert.deepEqual(changes.removed, [alpha]);
    assert.deepEqual(changes.retained, [beta]);
});

test('compareLoreEntries reports same-UID content, key, position, and order changes', () => {
    const stableBefore = {
        world: 'world',
        uid: 7,
        key: ['alpha'],
        content: 'old lore',
        position: 2,
    };
    const stableAfter = {
        world: 'world',
        uid: 7,
        key: ['alpha', 'beta'],
        content: 'new lore',
        position: 4,
    };
    const changes = compareLoreEntries(
        [{ world: 'world', uid: 1 }, stableBefore],
        [stableAfter, { world: 'world', uid: 1 }],
    );

    assert.equal(changes.activated.length, 0);
    assert.equal(changes.removed.length, 0);
    assert.deepEqual(
        changes.changed.find(({ key }) => key === 'world:7')?.changes
            .map(({ field }) => field),
        ['content', 'key', 'position', 'order'],
    );
});

test('compareSnapshotSources uses stable metadata identities across captures', () => {
    const base = snapshot({
        id: 'base',
        timestamp: 1,
        totalTokens: 10,
        sources: [
            source({ id: 'volatile-a', field: 'main', content: 'old', tokenCount: 3 }),
            source({ id: 'removed-a', field: 'note', content: 'remove', tokenCount: 2 }),
        ],
    });
    const compare = snapshot({
        id: 'compare',
        timestamp: 2,
        totalTokens: 14,
        sources: [
            source({ id: 'volatile-b', field: 'main', content: 'new', tokenCount: 5 }),
            source({ id: 'added-b', field: 'persona', content: 'add', tokenCount: 1 }),
        ],
    });

    const changes = compareSnapshotSources(base, compare);
    assert.deepEqual(changes.map(({ status, tokenDelta }) => [status, tokenDelta]), [
        ['changed', 2],
        ['removed', -2],
        ['added', 1],
    ]);
});

test('compareSnapshotSources ignores disabled and request-omitted prompt changes', () => {
    const base = snapshot({
        id: 'base',
        timestamp: 1,
        totalTokens: 10,
        sources: [
            source({ id: 'included-a', field: 'main', content: 'old', tokenCount: 3 }),
            {
                ...source({
                    id: 'omitted-a',
                    field: 'optional',
                    content: 'omitted old',
                    tokenCount: 20,
                }),
                included: false,
                configuredEnabled: true,
            },
            {
                ...source({
                    id: 'disabled-a',
                    field: 'disabled',
                    content: 'disabled old',
                    tokenCount: 30,
                }),
                included: false,
                configuredEnabled: false,
            },
        ],
    });
    const compare = snapshot({
        id: 'compare',
        timestamp: 2,
        totalTokens: 12,
        sources: [
            source({ id: 'included-b', field: 'main', content: 'new', tokenCount: 5 }),
            {
                ...source({
                    id: 'omitted-b',
                    field: 'optional',
                    content: 'omitted new',
                    tokenCount: 40,
                }),
                included: false,
                configuredEnabled: true,
            },
            {
                ...source({
                    id: 'disabled-b',
                    field: 'disabled',
                    content: 'disabled new',
                    tokenCount: 60,
                }),
                included: false,
                configuredEnabled: false,
            },
            {
                ...source({
                    id: 'disabled-added',
                    field: 'disabled-added',
                    content: 'never sent',
                    tokenCount: 70,
                }),
                included: false,
                configuredEnabled: false,
            },
        ],
    });

    const changes = compareSnapshotSources(base, compare);
    assert.deepEqual(changes.map(({ source: item, status }) => [item.metadata.field, status]), [
        ['main', 'changed'],
    ]);
});

test('compareSnapshotSources reports a prompt removed when it leaves the actual request', () => {
    const baseSource = {
        ...source({ id: 'active', field: 'optional', content: 'active', tokenCount: 4 }),
        included: true,
        configuredEnabled: true,
    };
    const omittedSource = {
        ...source({ id: 'omitted', field: 'optional', content: 'active', tokenCount: 4 }),
        included: false,
        configuredEnabled: true,
    };

    const changes = compareSnapshotSources(
        snapshot({ id: 'base', timestamp: 1, totalTokens: 4, sources: [baseSource] }),
        snapshot({ id: 'compare', timestamp: 2, totalTokens: 0, sources: [omittedSource] }),
    );

    assert.equal(changes.length, 1);
    assert.equal(changes[0].status, 'removed');
    assert.equal(changes[0].source.metadata.field, 'optional');
});

test('compareSnapshotSources reports stable source metadata without exposing inactive text changes', () => {
    const before = {
        ...source({
            id: 'before',
            field: 'configured',
            content: 'private old draft',
            tokenCount: 10,
        }),
        included: false,
        configuredEnabled: false,
        metadata: {
            field: 'configured',
            identifier: 'stable-prompt',
            role: 'system',
            depth: 2,
            position: 'relative',
            promptOrder: 1,
        },
    };
    const after = {
        ...source({
            id: 'after',
            field: 'configured',
            content: 'private new draft',
            tokenCount: 99,
        }),
        included: false,
        configuredEnabled: false,
        metadata: {
            field: 'configured',
            identifier: 'stable-prompt',
            role: 'developer',
            depth: 4,
            position: 'absolute',
            promptOrder: 3,
        },
    };

    const changes = compareSnapshotSources(
        snapshot({ id: 'base', timestamp: 1, totalTokens: 0, sources: [before] }),
        snapshot({ id: 'compare', timestamp: 2, totalTokens: 0, sources: [after] }),
    );

    assert.equal(changes.length, 1);
    assert.deepEqual(changes[0].changeKinds, ['metadata']);
    assert.deepEqual(
        changes[0].metadataChanges.map(({ field }) => field),
        ['role', 'depth', 'position', 'promptOrder'],
    );
    assert.equal(changes[0].changeKinds.includes('content'), false);
    assert.equal(changes[0].changeKinds.includes('tokens'), false);
});

test('compareSnapshotSources treats enabled transitions as presence and metadata changes', () => {
    const before = {
        ...source({
            id: 'before',
            field: 'configured',
            content: 'same',
            tokenCount: 1,
        }),
        included: false,
        configuredEnabled: false,
        metadata: { field: 'configured', identifier: 'stable-prompt' },
    };
    const after = {
        ...before,
        id: 'after',
        included: true,
        configuredEnabled: true,
    };

    const [change] = compareSnapshotSources(
        snapshot({ id: 'base', timestamp: 1, totalTokens: 0, sources: [before] }),
        snapshot({ id: 'compare', timestamp: 2, totalTokens: 1, sources: [after] }),
    );

    assert.equal(change.status, 'added');
    assert.deepEqual(change.changeKinds, ['presence', 'metadata']);
    assert.deepEqual(change.metadataChanges, [{
        field: 'enabled',
        before: false,
        after: true,
    }]);
});

test('buildTimelineAnalysis calculates chronological token and lore deltas', () => {
    const alpha = { world: 'world', uid: 1 };
    const beta = { world: 'world', uid: 2 };
    const analyses = buildTimelineAnalysis([
        snapshot({
            id: 'second',
            timestamp: 2,
            totalTokens: 130,
            lorebookEntries: [beta],
        }),
        snapshot({
            id: 'first',
            timestamp: 1,
            totalTokens: 100,
            lorebookEntries: [alpha],
        }),
    ]);

    assert.deepEqual(analyses.map(({ snapshot: item }) => item.id), ['first', 'second']);
    assert.equal(analyses[0].previous, null);
    assert.equal(analyses[1].tokenDelta, 30);
    assert.deepEqual(analyses[1].lore.activated, [beta]);
    assert.deepEqual(analyses[1].lore.removed, [alpha]);
});

test('largest source ignores disabled and request-omitted prompts', () => {
    const largest = largestIncludedSource([
        {
            id: 'disabled',
            type: 'utility',
            tokenCount: 9000,
            included: false,
            configuredEnabled: false,
        },
        {
            id: 'active-but-omitted',
            type: 'utility',
            tokenCount: 8000,
            included: false,
            configuredEnabled: true,
        },
        {
            id: 'included',
            type: 'system',
            tokenCount: 120,
            included: true,
        },
        {
            id: 'final',
            type: 'final',
            tokenCount: 9999,
            included: true,
        },
    ]);

    assert.equal(largest?.id, 'included');
});

test('buildRangeSegments preserves text and supports overlapping source ranges', () => {
    const text = 'abcdefghij';
    const segments = buildRangeSegments(text, [
        source({
            id: 'alpha',
            field: 'alpha',
            content: 'bcdef',
            tokenCount: 1,
            ranges: [{ start: 1, end: 6 }],
        }),
        source({
            id: 'beta',
            field: 'beta',
            content: 'efgh',
            tokenCount: 1,
            ranges: [{ start: 4, end: 8 }],
        }),
    ]);

    assert.equal(segments.map(({ text: segment }) => segment).join(''), text);
    assert.deepEqual(segments.map(({ text: segment, sourceIds }) => [segment, sourceIds]), [
        ['a', []],
        ['bcd', ['alpha']],
        ['ef', ['alpha', 'beta']],
        ['gh', ['beta']],
        ['ij', []],
    ]);
});

test('buildRangeSegments preserves source order when a later source range starts first', () => {
    const segments = buildRangeSegments('abcdefghij', [
        source({
            id: 'first',
            field: 'first',
            content: 'fghij',
            tokenCount: 1,
            ranges: [{ start: 5, end: 10 }],
        }),
        source({
            id: 'second',
            field: 'second',
            content: 'abcdefghij',
            tokenCount: 1,
            ranges: [{ start: 0, end: 10 }],
        }),
    ]);

    assert.deepEqual(
        segments.find(({ start }) => start === 5)?.sourceIds,
        ['first', 'second'],
    );
});

test('100-snapshot timeline analysis stays bounded without eager source diffs', () => {
    const timeline = Array.from({ length: 100 }, (_, snapshotIndex) => snapshot({
        id: `snapshot-${snapshotIndex}`,
        timestamp: snapshotIndex,
        totalTokens: 1000 + snapshotIndex,
        sources: Array.from({ length: 25 }, (_, sourceIndex) => source({
            id: `source-${snapshotIndex}-${sourceIndex}`,
            field: `field-${sourceIndex}`,
            content: `content ${snapshotIndex} ${sourceIndex}`,
            tokenCount: sourceIndex + 1,
        })),
    }));

    const started = Date.now();
    const analyses = buildTimelineAnalysis(timeline, { includeSourceChanges: false });
    const duration = Date.now() - started;
    assert.equal(analyses.length, 100);
    assert.equal(analyses.every(({ sourceChanges }) => sourceChanges.length === 0), true);
    assert.ok(duration < 2000, `timeline analysis took ${duration}ms`);
});

test('range sweep handles many mappings while preserving the full text', () => {
    const text = 'x'.repeat(5000);
    const sources = Array.from({ length: 1000 }, (_, index) => source({
        id: `range-${index}`,
        field: `range-${index}`,
        content: 'x'.repeat(10),
        tokenCount: 1,
        ranges: [{ start: index * 4, end: (index * 4) + 10 }],
    }));

    const started = Date.now();
    const segments = buildRangeSegments(text, sources);
    const duration = Date.now() - started;
    assert.equal(segments.map(({ text: segment }) => segment).join(''), text);
    assert.ok(duration < 2000, `range segmentation took ${duration}ms`);
});
