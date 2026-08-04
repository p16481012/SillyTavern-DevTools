import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildRangeSegments,
    buildTimelineAnalysis,
    compareLoreEntries,
    compareSnapshotSources,
    largestIncludedSource,
    pairAlternativeSourceReplacements,
} from '../src/pipeline-analysis.js';

function source({
    id,
    type = 'system',
    field,
    content,
    tokenCount,
    attribution = 'exact',
    ranges = [],
    identifier,
    comparisonPolicy,
}) {
    const metadata = {
        ...(field === undefined ? {} : { field }),
        ...(identifier === undefined ? {} : { identifier }),
    };
    return {
        id,
        type,
        label: field ?? identifier,
        metadata,
        content,
        tokenCount,
        attribution,
        ranges,
        ...(comparisonPolicy ? { comparisonPolicy } : {}),
    };
}

function comparisonPolicy({
    group = '출력 언어',
    groupKey = 'output-language',
    groupInstanceKey = 'global:language:output-language',
    option,
    mode = 'alternative',
} = {}) {
    return {
        mode,
        group,
        groupKey,
        groupInstanceKey,
        option,
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

test('same source identifier remains a changed source before replacement pairing', () => {
    const policy = comparisonPolicy({ option: '한국어' });
    const changes = compareSnapshotSources(
        snapshot({
            id: 'base',
            timestamp: 1,
            totalTokens: 2,
            sources: [source({
                id: 'volatile-before',
                identifier: 'language-korean',
                content: '한국어로 답하세요.',
                tokenCount: 2,
                comparisonPolicy: policy,
            })],
        }),
        snapshot({
            id: 'compare',
            timestamp: 2,
            totalTokens: 3,
            sources: [source({
                id: 'volatile-after',
                identifier: 'language-korean',
                content: '항상 한국어로 답하세요.',
                tokenCount: 3,
                comparisonPolicy: policy,
            })],
        }),
    );

    assert.equal(changes.length, 1);
    assert.equal(changes[0].status, 'changed');
    assert.equal(changes[0].replacement, undefined);
});

test('same source identifier reports an alternative policy option-only change', () => {
    const before = source({
        id: 'stable-language',
        identifier: 'stable-language',
        content: 'Keep the same content.',
        tokenCount: 4,
        comparisonPolicy: comparisonPolicy({ option: '한국어' }),
    });
    const after = source({
        id: 'stable-language',
        identifier: 'stable-language',
        content: 'Keep the same content.',
        tokenCount: 4,
        comparisonPolicy: comparisonPolicy({ option: '영어' }),
    });

    const changes = compareSnapshotSources(
        snapshot({ id: 'base', timestamp: 1, totalTokens: 4, sources: [before] }),
        snapshot({ id: 'compare', timestamp: 2, totalTokens: 4, sources: [after] }),
    );

    assert.equal(changes.length, 1);
    assert.equal(changes[0].status, 'changed');
    assert.deepEqual(changes[0].changeKinds, ['option']);
    assert.deepEqual(changes[0].optionChange, {
        beforeGroup: '출력 언어',
        afterGroup: '출력 언어',
        beforeOption: '한국어',
        afterOption: '영어',
    });
    assert.equal(changes[0].replacement, undefined);
});

test('one alternative option switch is paired as a replacement', () => {
    const before = source({
        id: 'language-korean',
        identifier: 'language-korean',
        content: '한국어로 답하세요.',
        tokenCount: 2,
        comparisonPolicy: comparisonPolicy({ option: '한국어' }),
    });
    const after = source({
        id: 'language-english',
        identifier: 'language-english',
        content: 'Always answer in English.',
        tokenCount: 4,
        comparisonPolicy: comparisonPolicy({ option: '영어' }),
    });
    const changes = compareSnapshotSources(
        snapshot({ id: 'base', timestamp: 1, totalTokens: 2, sources: [before] }),
        snapshot({ id: 'compare', timestamp: 2, totalTokens: 4, sources: [after] }),
    );

    assert.equal(changes.length, 1);
    assert.equal(changes[0].status, 'replaced');
    assert.equal(changes[0].before, before);
    assert.equal(changes[0].after, after);
    assert.equal(changes[0].source, after);
    assert.equal(changes[0].tokenDelta, 2);
    assert.deepEqual(changes[0].replacement, {
        mode: 'alternative',
        group: '출력 언어',
        groupKey: 'output-language',
        groupInstanceKey: 'global:language:output-language',
        beforeOption: '한국어',
        afterOption: '영어',
    });
});

test('same alternative option under renamed identifiers remains added and removed', () => {
    const changes = compareSnapshotSources(
        snapshot({
            id: 'base',
            timestamp: 1,
            totalTokens: 1,
            sources: [source({
                id: 'language-korean-old',
                identifier: 'language-korean-old',
                content: '한국어',
                tokenCount: 1,
                comparisonPolicy: comparisonPolicy({ option: '한국어' }),
            })],
        }),
        snapshot({
            id: 'compare',
            timestamp: 2,
            totalTokens: 1,
            sources: [source({
                id: 'language-korean-new',
                identifier: 'language-korean-new',
                content: '한국어',
                tokenCount: 1,
                comparisonPolicy: comparisonPolicy({ option: '한국어' }),
            })],
        }),
    );

    assert.deepEqual(changes.map(({ status }) => status).sort(), ['added', 'removed']);
});

test('replacement requires exactly one active option per alternative group', () => {
    const retained = source({
        id: 'language-shared',
        identifier: 'language-shared',
        content: '공통 언어 지시',
        tokenCount: 1,
        comparisonPolicy: comparisonPolicy({ option: '공통' }),
    });
    const changes = compareSnapshotSources(
        snapshot({
            id: 'base',
            timestamp: 1,
            totalTokens: 2,
            sources: [
                retained,
                source({
                    id: 'language-korean',
                    identifier: 'language-korean',
                    content: '한국어',
                    tokenCount: 1,
                    comparisonPolicy: comparisonPolicy({ option: '한국어' }),
                }),
            ],
        }),
        snapshot({
            id: 'compare',
            timestamp: 2,
            totalTokens: 2,
            sources: [
                retained,
                source({
                    id: 'language-english',
                    identifier: 'language-english',
                    content: '영어',
                    tokenCount: 1,
                    comparisonPolicy: comparisonPolicy({ option: '영어' }),
                }),
            ],
        }),
    );

    assert.deepEqual(changes.map(({ status }) => status).sort(), ['added', 'removed']);
});

test('different alternative groups remain added and removed', () => {
    const changes = compareSnapshotSources(
        snapshot({
            id: 'base',
            timestamp: 1,
            totalTokens: 1,
            sources: [source({
                id: 'language-korean',
                identifier: 'language-korean',
                content: '한국어',
                tokenCount: 1,
                comparisonPolicy: comparisonPolicy({ option: '한국어' }),
            })],
        }),
        snapshot({
            id: 'compare',
            timestamp: 2,
            totalTokens: 1,
            sources: [source({
                id: 'format-json',
                identifier: 'format-json',
                content: 'JSON',
                tokenCount: 1,
                comparisonPolicy: comparisonPolicy({
                    group: '출력 형식',
                    groupKey: 'output-format',
                    groupInstanceKey: 'global:format:output-format',
                    option: 'JSON',
                }),
            })],
        }),
    );

    assert.deepEqual(changes.map(({ status }) => status), ['removed', 'added']);
});

test('missing and internal-ignore policies fall back to added and removed', () => {
    const ungrouped = compareSnapshotSources(
        snapshot({
            id: 'base',
            timestamp: 1,
            totalTokens: 1,
            sources: [source({
                id: 'plain-before',
                identifier: 'plain-before',
                content: 'before',
                tokenCount: 1,
            })],
        }),
        snapshot({
            id: 'compare',
            timestamp: 2,
            totalTokens: 1,
            sources: [source({
                id: 'plain-after',
                identifier: 'plain-after',
                content: 'after',
                tokenCount: 1,
            })],
        }),
    );
    const ignored = pairAlternativeSourceReplacements([
        {
            key: 'before',
            status: 'removed',
            before: source({
                id: 'ignored-before',
                identifier: 'ignored-before',
                content: 'before',
                tokenCount: 1,
                comparisonPolicy: comparisonPolicy({ option: 'A', mode: 'ignore' }),
            }),
            after: null,
        },
        {
            key: 'after',
            status: 'added',
            before: null,
            after: source({
                id: 'ignored-after',
                identifier: 'ignored-after',
                content: 'after',
                tokenCount: 1,
                comparisonPolicy: comparisonPolicy({ option: 'B', mode: 'ignore' }),
            }),
        },
    ]);

    assert.deepEqual(ungrouped.map(({ status }) => status), ['removed', 'added']);
    assert.deepEqual(ignored.map(({ status }) => status), ['removed', 'added']);
});

test('ambiguous many-to-many alternative switches safely fall back', () => {
    const policyFor = (option) => comparisonPolicy({ option });
    const baseSources = ['korean', 'japanese'].map((option) => source({
        id: `language-${option}`,
        identifier: `language-${option}`,
        content: option,
        tokenCount: 1,
        comparisonPolicy: policyFor(option),
    }));
    const compareSources = ['english', 'german'].map((option) => source({
        id: `language-${option}`,
        identifier: `language-${option}`,
        content: option,
        tokenCount: 1,
        comparisonPolicy: policyFor(option),
    }));
    const changes = compareSnapshotSources(
        snapshot({ id: 'base', timestamp: 1, totalTokens: 2, sources: baseSources }),
        snapshot({ id: 'compare', timestamp: 2, totalTokens: 2, sources: compareSources }),
    );

    assert.deepEqual(
        changes.map(({ status }) => status),
        ['removed', 'removed', 'added', 'added'],
    );
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
