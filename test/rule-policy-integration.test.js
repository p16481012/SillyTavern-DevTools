import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeSnapshotDetailed } from '../src/rules.js';

const languageOptions = [
    ['ko', '출력언어 | 한국어', '반드시 한국어로 답변하세요.'],
    ['ja', '출력언어 | 일본어', 'Always respond in Japanese.'],
    ['en', '출력언어 | 영어', 'Always respond in English.'],
];

function configuredSource(identifier, label, content, overrides = {}) {
    return {
        id: `utility:${identifier}`,
        type: 'utility',
        label,
        content,
        tokenCount: 10,
        attribution: 'exact',
        included: true,
        configuredEnabled: true,
        ranges: [],
        metadata: {
            sourceKind: 'configuredPrompt',
            identifier,
            name: label,
            enabled: true,
            configuredEnabled: true,
        },
        ...overrides,
    };
}

function snapshot(sources) {
    let cursor = 0;
    const mappedSources = sources.map((source) => {
        if (source.included === false || source.configuredEnabled === false) return source;
        const start = cursor;
        cursor += source.content.length;
        const mapped = { ...source, ranges: [{ start, end: cursor }] };
        cursor += 1;
        return mapped;
    });
    return {
        finalText: mappedSources
            .filter((source) => source.included !== false && source.configuredEnabled !== false)
            .map(({ content }) => content)
            .join('\n'),
        stats: { totalTokens: 100, contextUsage: 0.1 },
        sources: mappedSources,
    };
}

function templatePolicy(overrides = {}) {
    return {
        nameRules: [{
            id: 'language-options',
            enabled: true,
            kind: 'template',
            pattern: '{group} | {option}',
            mode: 'alternative',
            categories: ['*'],
            target: 'configured',
            ...overrides,
        }],
    };
}

test('three active language alternatives skip internal conflicts and emit one group warning', () => {
    const sources = languageOptions.map((values) => configuredSource(...values));
    const analysis = analyzeSnapshotDetailed(snapshot(sources), undefined, templatePolicy());

    assert.equal(analysis.findings.some(({ id }) => id === 'language-conflict'), false);
    assert.equal(analysis.comparison.suppressedComparisons.length, 3);
    assert.equal(analysis.comparison.groupWarnings.length, 1);
    assert.equal(
        analysis.findings.filter(({ id }) => id.startsWith('multiple-active:')).length,
        1,
    );
    assert.deepEqual(
        new Set(analysis.comparison.groups[0].activeOptions),
        new Set(['한국어', '일본어', '영어']),
    );
});

test('ignore mode hides both internal conflicts and the group activation warning', () => {
    const sources = languageOptions.map((values) => configuredSource(...values));
    const analysis = analyzeSnapshotDetailed(
        snapshot(sources),
        undefined,
        templatePolicy({ mode: 'ignore' }),
    );

    assert.equal(analysis.findings.some(({ id }) => id === 'language-conflict'), false);
    assert.equal(analysis.findings.some(({ id }) => id.startsWith('multiple-active:')), false);
    assert.equal(analysis.comparison.groupWarnings.length, 0);
    assert.equal(analysis.comparison.suppressedComparisons.length, 3);
});

test('large alternative groups preserve exact totals while bounding comparison records', () => {
    const sources = Array.from({ length: 500 }, (_, index) => configuredSource(
        `language-${index}`,
        `출력언어 | 옵션 ${index}`,
        index % 2 === 0
            ? '반드시 한국어로 답변하세요.'
            : 'Always respond in English.',
    ));
    const analysis = analyzeSnapshotDetailed(
        snapshot(sources),
        { enabled: { duplicates: false } },
        templatePolicy(),
    );

    assert.equal(analysis.comparison.suppressedComparisonCount, 62_500);
    assert.equal(analysis.comparison.suppressedComparisons.length, 100);
    assert.equal(analysis.comparison.suppressedComparisonsTruncated, true);
    assert.equal(analysis.comparison.suppressedComparisonsOmitted, 62_400);
});

test('only prompts included in the actual request participate in comparisons', () => {
    const [korean, japanese, english] = languageOptions.map(
        (values) => configuredSource(...values),
    );
    japanese.included = false;
    english.configuredEnabled = false;
    english.metadata = {
        ...english.metadata,
        enabled: false,
        configuredEnabled: false,
    };

    const analysis = analyzeSnapshotDetailed(
        snapshot([korean, japanese, english]),
        undefined,
        templatePolicy(),
    );

    assert.equal(analysis.findings.some(({ id }) => id === 'language-conflict'), false);
    assert.equal(analysis.comparison.groupWarnings.length, 0);
    assert.deepEqual(
        new Set(analysis.comparison.skippedSources.map(({ reason }) => reason)),
        new Set(['not-in-request', 'configured-disabled']),
    );
});

test('alternative members still compare with a prompt outside their group', () => {
    const [korean, , english] = languageOptions.map(
        (values) => configuredSource(...values),
    );
    const external = {
        id: 'request:external',
        type: 'requestMessage',
        label: '외부 시스템 지시',
        content: 'Always respond in Japanese.',
        tokenCount: 10,
        attribution: 'exact',
        included: true,
        ranges: [],
        metadata: { sourceKind: 'requestMessage' },
    };
    const analysis = analyzeSnapshotDetailed(
        snapshot([korean, english, external]),
        undefined,
        templatePolicy(),
    );

    const language = analysis.findings.filter(({ ruleId }) => ruleId === 'language');
    assert.equal(language.length, 2);
    assert.equal(language.every(({ severity }) => severity === 'critical'), true);
    assert.deepEqual(
        new Set(language.flatMap(({ sourceIds }) => sourceIds)),
        new Set(['utility:ko', 'utility:en', 'request:external']),
    );
    assert.equal(language.every(({ sourceIds }) => sourceIds.length === 2), true);
    assert.equal(analysis.comparison.suppressedComparisons.length, 1);
    assert.equal(language.every(({ finalRanges }) => finalRanges.length === 2), true);
    assert.equal(analysis.instructions.relations.length, 2);
    assert.equal(analysis.instructions.clusters.length, 1);
});

test('manual assignments support arbitrary naming and override name parsing', () => {
    const korean = configuredSource('ko', 'custom L:한글', '반드시 한국어로 답변하세요.');
    const english = configuredSource('en', 'English response preset', 'Always respond in English.');
    const analysis = analyzeSnapshotDetailed(snapshot([korean, english]), undefined, {
        nameRules: [{
            id: 'wrong-name-rule',
            kind: 'template',
            pattern: '{group}:{option}',
            mode: 'normal',
            categories: ['*'],
            target: 'configured',
        }],
        manualAssignments: [
            {
                sourceIdentifier: 'ko',
                group: '출력 언어',
                option: '한국어',
                mode: 'alternative',
                categories: ['language'],
            },
            {
                sourceIdentifier: 'en',
                group: '출력 언어',
                option: '영어',
                mode: 'alternative',
                categories: ['language'],
            },
        ],
    });

    assert.equal(analysis.findings.some(({ id }) => id === 'language-conflict'), false);
    assert.equal(analysis.comparison.suppressedComparisons.length, 1);
    assert.equal(analysis.comparison.groups[0].group, '출력 언어');
});

test('category scopes suppress only the checks selected by the user', () => {
    const [korean, , english] = languageOptions.map(
        (values) => configuredSource(...values),
    );
    const analysis = analyzeSnapshotDetailed(
        snapshot([korean, english]),
        undefined,
        templatePolicy({ categories: ['format'] }),
    );

    assert.equal(analysis.findings.some(({ id }) => id === 'language-conflict'), true);
    assert.equal(analysis.comparison.suppressedComparisons.length, 0);
});

test('disabled and chat-history text cannot create a false language conflict', () => {
    const active = configuredSource('en', 'Active English', 'Always respond in English.');
    const disabled = configuredSource(
        'ko',
        'Disabled Korean',
        '반드시 한국어로 답변하세요.',
        {
            included: false,
            configuredEnabled: false,
            metadata: {
                sourceKind: 'configuredPrompt',
                identifier: 'ko',
                name: 'Disabled Korean',
                enabled: false,
                configuredEnabled: false,
            },
        },
    );
    const history = {
        id: 'history:1',
        type: 'chat_history',
        label: '과거 메시지',
        content: 'Always respond in Japanese.',
        tokenCount: 10,
        attribution: 'exact',
        included: true,
    };

    const analysis = analyzeSnapshotDetailed(snapshot([active, disabled, history]));

    assert.equal(analysis.findings.some(({ id }) => id === 'language-conflict'), false);
    assert.deepEqual(
        new Set(analysis.comparison.skippedSources.map(({ reason }) => reason)),
        new Set(['configured-disabled', 'source-type:chat_history']),
    );
});
