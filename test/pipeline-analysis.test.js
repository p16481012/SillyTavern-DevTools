import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildRangeSegments,
    buildTimelineAnalysis,
    compareLoreEntries,
    compareSnapshotSources,
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
