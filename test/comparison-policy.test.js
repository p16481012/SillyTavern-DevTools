import assert from 'node:assert/strict';
import test from 'node:test';
import {
    DEFAULT_COMPARISON_POLICY_SETTINGS,
    annotateSourcesWithPolicies,
    compareSourcePair,
    normalizeComparisonPolicySettings,
    sourceEligibility,
    sourceIsEligible,
    summarizeAlternativeGroups,
} from '../src/comparison-policy.js';

function configured(id, label, overrides = {}) {
    return {
        id: `utility:${id}`,
        type: 'utility',
        label,
        content: `Instruction ${id}`,
        included: true,
        configuredEnabled: true,
        metadata: {
            sourceKind: 'configuredPrompt',
            identifier: id,
            name: label,
            enabled: true,
            configuredEnabled: true,
        },
        ...overrides,
    };
}

test('comparison policy defaults do not infer groups', () => {
    const [source] = annotateSourcesWithPolicies(
        [configured('ko', '출력언어 | 한국어')],
        DEFAULT_COMPARISON_POLICY_SETTINGS,
    );
    assert.equal(source.comparisonPolicy, null);
});

test('template rules support arbitrary literal separators and Unicode groups', () => {
    const settings = {
        nameRules: [
            {
                id: 'pipe',
                kind: 'template',
                pattern: '{group} | {option}',
                mode: 'alternative',
                categories: ['language'],
            },
            {
                id: 'heart',
                kind: 'template',
                pattern: '{group}❤️{option}',
                mode: 'alternative',
            },
        ],
    };
    const [pipe, heart] = annotateSourcesWithPolicies([
        configured('ko', '출력언어 | 한글'),
        configured('ja', '출력언어❤️일본어'),
    ], settings);
    assert.equal(pipe.comparisonPolicy.group, '출력언어');
    assert.equal(pipe.comparisonPolicy.option, '한글');
    assert.deepEqual(pipe.comparisonPolicy.categories, ['language']);
    assert.equal(heart.comparisonPolicy.group, '출력언어');
    assert.equal(heart.comparisonPolicy.option, '일본어');
});

test('bracket templates and a fixed group are supported', () => {
    const [bracket, fixed] = annotateSourcesWithPolicies([
        configured('ko', '[출력언어] 한글'),
        configured('custom', 'custom L:English'),
    ], {
        nameRules: [{
            id: 'bracket',
            kind: 'template',
            pattern: '[{group}] {option}',
        }, {
            id: 'fixed',
            kind: 'template',
            pattern: 'custom L:{option}',
            fixedGroup: '출력언어',
        }],
    });
    assert.equal(bracket.comparisonPolicy.group, '출력언어');
    assert.equal(bracket.comparisonPolicy.option, '한글');
    assert.equal(fixed.comparisonPolicy.group, '출력언어');
    assert.equal(fixed.comparisonPolicy.option, 'English');
});

test('advanced regex rules accept named captures', () => {
    const [source] = annotateSourcesWithPolicies([
        configured('ko', 'LANG::Korean'),
    ], {
        nameRules: [{
            id: 'regex',
            kind: 'regex',
            pattern: '^(?<group>[^:]+)::(?<option>.+)$',
        }],
    });
    assert.equal(source.comparisonPolicy.group, 'LANG');
    assert.equal(source.comparisonPolicy.option, 'Korean');
});

test('manual identifiers take precedence over the first matching name rule', () => {
    const [source] = annotateSourcesWithPolicies([
        configured('ko', '출력언어 | 한글'),
    ], {
        nameRules: [{
            id: 'name',
            kind: 'template',
            pattern: '{group} | {option}',
            mode: 'alternative',
        }],
        manualAssignments: [{
            id: 'manual',
            sourceIdentifier: 'ko',
            group: '사용자 그룹',
            option: '직접 지정',
            mode: 'ignore',
        }],
    });
    assert.equal(source.comparisonPolicy.origin, 'manual');
    assert.equal(source.comparisonPolicy.group, '사용자 그룹');
    assert.equal(source.comparisonPolicy.mode, 'ignore');
});

test('identifier assignments win over earlier label-only assignments', () => {
    const source = configured('language-prompt', '출력언어 | 한국어');
    const [annotated] = annotateSourcesWithPolicies([source], {
        manualAssignments: [
            {
                sourceLabel: '출력언어 | 한국어',
                group: '이름 기반 그룹',
                option: '한국어',
            },
            {
                sourceIdentifier: 'language-prompt',
                group: '식별자 기반 그룹',
                option: '한국어',
            },
        ],
    });

    assert.equal(annotated.comparisonPolicy.group, '식별자 기반 그룹');
    assert.equal(annotated.comparisonPolicy.origin, 'manual');
});

test('the first enabled name rule wins and configured targets do not affect other sources', () => {
    const generic = {
        id: 'character:1',
        type: 'character',
        label: '출력언어 | 캐릭터',
        content: 'Character content',
        included: true,
        metadata: {},
    };
    const [source, character] = annotateSourcesWithPolicies([
        configured('ko', '출력언어 | 한글'),
        generic,
    ], {
        nameRules: [{
            id: 'disabled',
            enabled: false,
            kind: 'template',
            pattern: '{group} | {option}',
            fixedGroup: '잘못된 그룹',
        }, {
            id: 'first',
            kind: 'template',
            pattern: '{group} | {option}',
            fixedGroup: '첫 그룹',
            target: 'configured',
        }, {
            id: 'second',
            kind: 'template',
            pattern: '{group} | {option}',
            fixedGroup: '두 번째 그룹',
            target: 'all',
        }],
    });
    assert.equal(source.comparisonPolicy.group, '첫 그룹');
    assert.equal(character.comparisonPolicy.group, '두 번째 그룹');
});

test('all-source name rules never classify final output or chat history as options', () => {
    const sources = annotateSourcesWithPolicies([
        {
            id: 'final',
            type: 'final',
            label: 'Final Prompt',
            content: 'Always respond in English.',
        },
        {
            id: 'history',
            type: 'chat_history',
            label: 'History',
            content: 'Always respond in Korean.',
        },
    ], {
        nameRules: [{
            id: 'all',
            kind: 'template',
            pattern: '{option}',
            fixedGroup: '출력 언어',
            target: 'all',
        }],
    });

    assert.equal(sources[0].comparisonPolicy, null);
    assert.equal(sources[1].comparisonPolicy, null);
});

test('same alternative group is suppressed only for selected categories', () => {
    const [korean, japanese] = annotateSourcesWithPolicies([
        configured('ko', '출력언어 | 한글'),
        configured('ja', '출력언어 | 일본어'),
    ], {
        nameRules: [{
            kind: 'template',
            pattern: '{group} | {option}',
            mode: 'alternative',
            categories: ['Language'],
        }],
    });
    assert.equal(compareSourcePair(korean, japanese, 'language').compare, false);
    assert.equal(compareSourcePair(korean, japanese, 'format').compare, true);
});

test('members remain comparable to sources outside their alternative group', () => {
    const [korean, external] = annotateSourcesWithPolicies([
        configured('ko', '출력언어 | 한글'),
        configured('external', '외부 지시'),
    ], {
        nameRules: [{
            kind: 'template',
            pattern: '{group} | {option}',
        }],
    });
    assert.equal(compareSourcePair(korean, external, 'language').compare, true);
});

test('disabled and omitted configured prompts are not eligible', () => {
    assert.deepEqual(
        sourceEligibility(configured('disabled', 'Disabled', {
            configuredEnabled: false,
            metadata: {
                sourceKind: 'configuredPrompt',
                identifier: 'disabled',
                enabled: false,
            },
        })),
        { eligible: false, reason: 'configured-disabled' },
    );
    assert.deepEqual(
        sourceEligibility(configured('omitted', 'Omitted', { included: false })),
        { eligible: false, reason: 'not-in-request' },
    );
});

test('generic disabled sources are not eligible when rules target all sources', () => {
    assert.equal(sourceIsEligible({
        id: 'generic-disabled',
        type: 'extension',
        content: 'Always respond in English.',
        enabled: false,
    }), false);
    assert.equal(sourceIsEligible({
        id: 'metadata-disabled',
        type: 'extension',
        content: 'Always respond in English.',
        metadata: { enabled: false },
    }), false);
});

test('alternative groups report one group-level warning when multiple options are active', () => {
    const annotated = annotateSourcesWithPolicies([
        configured('ko', '출력언어 | 한글'),
        configured('ja', '출력언어 | 일본어'),
        configured('en', '출력언어 | 영어', { included: false }),
    ], {
        nameRules: [{
            kind: 'template',
            pattern: '{group} | {option}',
            mode: 'alternative',
        }],
    });
    const summary = summarizeAlternativeGroups(annotated);
    assert.equal(summary.groups.length, 1);
    assert.deepEqual(summary.groups[0].activeOptions, ['한글', '일본어']);
    assert.equal(summary.warnings.length, 1);
    assert.deepEqual(summary.warnings[0].sourceIds, ['utility:ko', 'utility:ja']);
});

test('ignore groups suppress internal comparisons without active-option warnings', () => {
    const annotated = annotateSourcesWithPolicies([
        configured('ko', '출력언어 | 한글'),
        configured('ja', '출력언어 | 일본어'),
    ], {
        nameRules: [{
            kind: 'template',
            pattern: '{group} | {option}',
            mode: 'ignore',
        }],
    });
    assert.equal(compareSourcePair(annotated[0], annotated[1], 'language').reason, 'same-ignore-group');
    assert.equal(summarizeAlternativeGroups(annotated).warnings.length, 0);
});

test('invalid and damaged settings normalize safely without matching', () => {
    const normalized = normalizeComparisonPolicySettings({
        nameRules: [{
            kind: 'regex',
            pattern: '(',
            categories: null,
            mode: 'unknown',
        }],
        manualAssignments: [{ sourceIdentifier: 'x', group: '' }],
    });
    assert.equal(normalized.nameRules[0].mode, 'alternative');
    assert.deepEqual(normalized.nameRules[0].categories, ['*']);
    assert.deepEqual(normalized.manualAssignments, []);
    const [source] = annotateSourcesWithPolicies([configured('x', 'anything')], normalized);
    assert.equal(source.comparisonPolicy, null);
});
