import assert from 'node:assert/strict';
import test from 'node:test';
import {
    annotateSourcesWithPolicies,
    buildBulkManualAssignments,
    comparisonScopeKeyEquals,
    compareSourcePair,
    migrateComparisonPolicySettings,
    normalizeComparisonPolicySettings,
    previewNameMatcher,
    resolveComparisonPolicyContext,
    sourceFingerprint,
} from '../src/comparison-policy.js';
import { scopeFingerprint } from '../src/profile-context.js';

function configured(identifier, label, overrides = {}) {
    return {
        id: `utility:${identifier}`,
        type: 'utility',
        label,
        content: `Instruction ${identifier}`,
        included: true,
        configuredEnabled: true,
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

function profile(kind, key, {
    id = `${kind}-profile`,
    mode = 'alternative',
    pattern = '{group} | {option}',
    manualAssignments = [],
    priority = 0,
} = {}) {
    return {
        id,
        label: id,
        enabled: true,
        priority,
        scope: { kind, key: kind === 'global' ? null : key },
        groupDefinitions: [{
            id: `${id}-group`,
            label: '그룹 동작',
            mode,
            categories: ['*'],
        }],
        matchers: pattern ? [{
            id: `${id}-matcher`,
            enabled: true,
            groupDefinitionId: `${id}-group`,
            kind: 'template',
            pattern,
            fixedGroup: null,
            fixedOption: null,
            target: 'configured',
        }] : [],
        manualAssignments,
    };
}

test('v1 settings migrate deterministically and remain compatible with legacy aliases', () => {
    const v1 = {
        version: 1,
        nameRules: [{
            id: 'language',
            kind: 'template',
            pattern: '{group} | {option}',
            mode: 'ignore',
            categories: ['language'],
        }],
        manualAssignments: [{
            id: 'manual-ko',
            sourceIdentifier: 'ko',
            group: '출력 언어',
            option: '한국어',
            mode: 'alternative',
            categories: ['language'],
        }],
    };

    const first = migrateComparisonPolicySettings(v1);
    const second = migrateComparisonPolicySettings(first);

    assert.deepEqual(second, first);
    assert.equal(first.version, 2);
    assert.equal(first.profiles.length, 1);
    assert.equal(first.profiles[0].groupDefinitions.length, 2);
    assert.equal(first.profiles[0].matchers[0].groupDefinitionId.startsWith('group:'), true);
    assert.equal(first.nameRules[0].mode, 'ignore');
    assert.equal(first.manualAssignments[0].sourceIdentifier, 'ko');

    const [korean, japanese] = annotateSourcesWithPolicies([
        configured('ko', '출력 언어 | 한국어'),
        configured('ja', '출력 언어 | 일본어'),
    ], v1);
    assert.equal(korean.comparisonPolicy.origin, 'manual');
    assert.equal(japanese.comparisonPolicy.origin, 'rule');
});

test('v1 matchers with different separators still share one compatible behavior group', () => {
    const settings = {
        nameRules: [{
            id: 'pipe',
            kind: 'template',
            pattern: '{group} | {option}',
            mode: 'alternative',
            categories: ['language'],
        }, {
            id: 'heart',
            kind: 'template',
            pattern: '{group}❤️{option}',
            mode: 'alternative',
            categories: ['language'],
        }],
    };
    const [pipe, heart] = annotateSourcesWithPolicies([
        configured('ko', '출력언어 | 한국어'),
        configured('ja', '출력언어❤️일본어'),
    ], settings);

    assert.equal(pipe.comparisonPolicy.groupDefinitionId, heart.comparisonPolicy.groupDefinitionId);
    assert.equal(compareSourcePair(pipe, heart, 'language').compare, false);
});

test('v1 matcher and manual assignment with the same behavior keep one comparison group', () => {
    const settings = {
        version: 1,
        nameRules: [{
            id: 'language-rule',
            kind: 'template',
            pattern: '{group} | {option}',
            mode: 'alternative',
            categories: ['language'],
        }],
        manualAssignments: [{
            id: 'manual-custom',
            sourceIdentifier: 'custom',
            group: '출력언어',
            option: '사용자 지정',
            mode: 'alternative',
            categories: ['language'],
        }],
    };
    const migrated = migrateComparisonPolicySettings(settings);
    const [ruleMatched, manuallyMatched] = annotateSourcesWithPolicies([
        configured('ko', '출력언어 | 한국어'),
        configured('custom', '사용자 지정 프롬프트'),
    ], settings);

    assert.equal(migrated.profiles[0].groupDefinitions.length, 1);
    assert.equal(
        ruleMatched.comparisonPolicy.groupDefinitionId,
        manuallyMatched.comparisonPolicy.groupDefinitionId,
    );
    assert.equal(compareSourcePair(ruleMatched, manuallyMatched, 'language').compare, false);
});

test('v2 normalization is idempotent and preserves global profile metadata', () => {
    const raw = {
        version: 2,
        profiles: [{
            id: 'custom-global',
            label: '사용자 전역',
            enabled: false,
            priority: 77,
            scope: { kind: 'global', key: null },
            groupDefinitions: [{
                id: 'unused-group',
                label: '나중에 사용할 그룹',
                mode: 'normal',
                categories: ['*'],
            }, {
                id: 'language-group',
                label: '출력 언어 대안',
                mode: 'alternative',
                categories: ['language'],
            }],
            matchers: [{
                id: 'language-rule',
                enabled: true,
                groupDefinitionId: 'language-group',
                kind: 'template',
                pattern: '{group} | {option}',
                fixedGroup: null,
                fixedOption: null,
                target: 'configured',
                order: 0,
            }],
            manualAssignments: [],
        }],
    };

    const once = normalizeComparisonPolicySettings(raw);
    const twice = normalizeComparisonPolicySettings(once);

    assert.deepEqual(twice, once);
    assert.deepEqual(twice.profiles[0], once.profiles[0]);
    assert.equal(twice.profiles[0].id, 'custom-global');
    assert.equal(twice.profiles[0].label, '사용자 전역');
    assert.equal(twice.profiles[0].enabled, false);
    assert.equal(twice.profiles[0].priority, 77);
    assert.deepEqual(
        twice.profiles[0].groupDefinitions.map(({ id, label }) => ({ id, label })),
        [{
            id: 'unused-group',
            label: '나중에 사용할 그룹',
        }, {
            id: 'language-group',
            label: '출력 언어 대안',
        }],
    );
});

test('group behavior is separated from matcher parsing in v2', () => {
    const settings = normalizeComparisonPolicySettings({
        version: 2,
        profiles: [profile('global', null, { mode: 'ignore' })],
    });
    const global = settings.profiles[0];

    assert.equal(Object.hasOwn(global.matchers[0], 'mode'), false);
    assert.equal(Object.hasOwn(global.matchers[0], 'categories'), false);
    assert.equal(global.groupDefinitions[0].mode, 'ignore');
    assert.deepEqual(global.groupDefinitions[0].categories, ['*']);
});

test('profile precedence is chat then character then preset then global', () => {
    const source = configured('ko', '출력 언어 | 한국어');
    const profiles = [
        profile('global', null, { id: 'global', mode: 'normal' }),
        profile('preset', 'preset-key', { id: 'preset', mode: 'alternative' }),
        profile('character', 'character-key', { id: 'character', mode: 'ignore' }),
        profile('chat', 'chat-key', { id: 'chat', mode: 'alternative' }),
    ];
    const context = {
        profileContext: {
            global: { key: '*', label: '전체' },
            preset: { key: 'preset-key', label: 'Preset' },
            character: { key: 'character-key', label: 'Character' },
            chat: { key: 'chat-key', label: 'Chat' },
        },
    };

    const [chat] = annotateSourcesWithPolicies([source], { version: 2, profiles }, context);
    assert.equal(chat.comparisonPolicy.profileId, 'chat');
    assert.equal(chat.comparisonPolicy.precedence, 300);
    assert.equal(chat.comparisonPolicy.trace.profileScope, 'chat');

    const withoutChat = structuredClone(context);
    withoutChat.profileContext.chat = null;
    const [character] = annotateSourcesWithPolicies(
        [source],
        { version: 2, profiles },
        withoutChat,
    );
    assert.equal(character.comparisonPolicy.profileId, 'character');
});

test('scope keys are canonicalized and compared consistently across UI and core', () => {
    const settings = normalizeComparisonPolicySettings({
        version: 2,
        profiles: [
            profile('global', null, { id: 'global' }),
            profile('chat', 'SCOPE-V1:10:ABCDEF1234567890', { id: 'chat' }),
        ],
    });
    assert.equal(
        settings.profiles.find(({ id }) => id === 'chat').scope.key,
        'scope-v1:10:abcdef1234567890',
    );
    assert.equal(
        comparisonScopeKeyEquals(
            'SCOPE-V1:10:ABCDEF1234567890',
            'scope-v1:10:abcdef1234567890',
        ),
        true,
    );
});

test('a nonmatching higher profile falls back and manual beats matcher in one profile', () => {
    const source = configured('ko', '출력 언어 | 한국어');
    const global = profile('global', null, { id: 'global', mode: 'normal' });
    const chat = profile('chat', 'chat-key', {
        id: 'chat',
        mode: 'ignore',
        pattern: '다른 이름: {option}',
        manualAssignments: [{
            id: 'chat-manual',
            groupDefinitionId: 'chat-group',
            group: '직접 그룹',
            option: '직접 옵션',
            sourceIdentity: { identifier: 'ko' },
        }],
    });

    const [manual] = annotateSourcesWithPolicies(
        [source],
        { version: 2, profiles: [global, chat] },
        { profileContext: { chat: { key: 'chat-key' } } },
    );
    assert.equal(manual.comparisonPolicy.origin, 'manual');
    assert.equal(manual.comparisonPolicy.profileId, 'chat');

    chat.manualAssignments = [];
    const [fallback] = annotateSourcesWithPolicies(
        [source],
        { version: 2, profiles: [global, chat] },
        { profileContext: { chat: { key: 'chat-key' } } },
    );
    assert.equal(fallback.comparisonPolicy.profileId, 'global');
    assert.equal(fallback.comparisonPolicy.origin, 'rule');
});

test('snapshot profileContext shape and raw context fallbacks are accepted', () => {
    assert.deepEqual(resolveComparisonPolicyContext({
        chatId: 'raw-chat',
        preset: { name: 'Raw preset' },
        profileContext: {
            chat: { key: 'scope-v1:chat', label: '채팅' },
            preset: { key: 'scope-v1:preset', label: '프리셋' },
            character: null,
        },
    }), {
        global: { key: '*', label: '전체' },
        preset: { key: 'scope-v1:preset', label: '프리셋' },
        character: null,
        chat: { key: 'scope-v1:chat', label: '채팅' },
    });
    assert.equal(resolveComparisonPolicyContext({
        snapshot: { chatId: 'raw-chat', preset: { name: 'Raw preset' } },
        characterKey: 'raw-character',
    }).character.key, scopeFingerprint('character', 'raw-character'));
    assert.equal(
        resolveComparisonPolicyContext({
            snapshot: { chatId: 'raw-chat', preset: { name: 'Raw preset' } },
        }).chat.key,
        scopeFingerprint('chat', 'raw-chat'),
    );
    assert.equal(
        resolveComparisonPolicyContext({
            snapshot: { chatId: 'raw-chat', preset: { name: 'Raw preset' } },
        }).preset.key,
        scopeFingerprint('preset', 'Raw preset'),
    );
});

test('identifier assignments win and an ambiguous fallback fingerprint is not applied', () => {
    const first = configured('one', '같은 이름', {
        id: 'utility:0',
        metadata: {
            sourceKind: 'configuredPrompt',
            identifier: null,
            name: '같은 이름',
        },
    });
    const second = configured('two', '같은 이름', {
        id: 'utility:1',
        metadata: {
            sourceKind: 'configuredPrompt',
            identifier: null,
            name: '같은 이름',
        },
    });
    const fingerprint = sourceFingerprint(first);
    assert.equal(fingerprint, sourceFingerprint(second));
    const global = profile('global', null, {
        id: 'global',
        pattern: null,
        manualAssignments: [{
            id: 'ambiguous',
            groupDefinitionId: 'global-group',
            group: '그룹',
            option: '옵션',
            sourceIdentity: { fingerprint },
        }],
    });
    const annotated = annotateSourcesWithPolicies(
        [first, second],
        { version: 2, profiles: [global] },
    );

    assert.equal(annotated.every(({ comparisonPolicy }) => comparisonPolicy === null), true);
    assert.equal(
        annotated.every(({ comparisonPolicyTrace }) => (
            comparisonPolicyTrace.status === 'ambiguous-fingerprint'
        )),
        true,
    );

    first.metadata.identifier = 'stable-one';
    global.manualAssignments.unshift({
        id: 'identifier',
        groupDefinitionId: 'global-group',
        group: '식별자 그룹',
        option: '식별자 옵션',
        sourceIdentity: { identifier: 'stable-one' },
    });
    const [identified] = annotateSourcesWithPolicies(
        [first, second],
        { version: 2, profiles: [global] },
    );
    assert.equal(identified.comparisonPolicy.assignmentId, 'identifier');
    assert.equal(identified.comparisonPolicy.trace.sourceMatch, 'identifier');
});

test('source fingerprints survive source id and Unicode whitespace changes', () => {
    const first = {
        id: 'utility:1',
        type: 'utility',
        label: '출력　언어',
        labelKey: 'source.configuredPrompt',
        metadata: { sourceKind: 'configuredPrompt', role: 'system', position: 3 },
    };
    const reordered = {
        ...first,
        id: 'utility:99',
        label: '출력 언어',
    };
    assert.equal(sourceFingerprint(first), sourceFingerprint(reordered));
    assert.notEqual(
        sourceFingerprint(first),
        sourceFingerprint({
            ...reordered,
            metadata: { ...reordered.metadata, position: 4 },
        }),
    );

    const identified = configured('stable-id', '원래 이름');
    const renamed = configured('stable-id', '바뀐 이름', { id: 'utility:200' });
    assert.equal(sourceFingerprint(identified), sourceFingerprint(renamed));
});

test('previewNameMatcher reports safe errors and caps multi-source matches', () => {
    const sources = Array.from(
        { length: 5 },
        (_, index) => configured(String(index), `그룹 | 옵션 ${index}`),
    );
    const preview = previewNameMatcher({
        kind: 'template',
        pattern: '{group} | {option}',
        target: 'configured',
        enabled: true,
    }, sources, {
        id: 'group',
        mode: 'alternative',
        categories: ['language'],
    }, { limit: 2 });
    assert.equal(preview.error, null);
    assert.equal(preview.matches.length, 2);
    assert.equal(preview.totalMatches, 5);
    assert.equal(preview.truncated, true);

    const unsafe = previewNameMatcher({
        kind: 'regex',
        pattern: '(a+)+$',
        target: 'all',
        enabled: true,
    }, sources);
    assert.equal(unsafe.error, 'unsafe-regex');
    assert.deepEqual(unsafe.matches, []);
});

test('bulk assignments preserve identifiers and add fingerprints for old sources', () => {
    const identified = configured('ko', '한국어');
    const legacy = {
        id: 'utility:old',
        type: 'utility',
        label: '과거 프롬프트',
        content: 'Instruction',
        metadata: { sourceKind: 'configuredPrompt' },
    };
    const assignments = buildBulkManualAssignments([identified, legacy], {
        groupDefinitionId: 'language-group',
        group: '출력 언어',
    });

    assert.equal(assignments.length, 2);
    assert.equal(assignments[0].sourceIdentity.identifier, 'ko');
    assert.match(assignments[1].sourceIdentity.fingerprint, /^source-v1:/u);
    assert.equal(assignments[1].option, '과거 프롬프트');
});

test('dangling references, duplicate ids, and excessive collections normalize safely', () => {
    const settings = normalizeComparisonPolicySettings({
        version: 2,
        profiles: [{
            id: 'global',
            scope: { kind: 'global' },
            groupDefinitions: [
                { id: 'kept', mode: 'normal' },
                { id: 'kept', mode: 'ignore' },
            ],
            matchers: [
                { id: 'kept', groupDefinitionId: 'kept', pattern: '{group}:{option}' },
                { id: 'kept', groupDefinitionId: 'kept', pattern: '{group}|{option}' },
                { id: 'dangling', groupDefinitionId: 'missing', pattern: '{group}:{option}' },
            ],
            manualAssignments: [{
                id: 'dangling',
                groupDefinitionId: 'missing',
                group: '그룹',
                sourceIdentity: { identifier: 'x' },
            }],
        }],
    });
    const global = settings.profiles[0];

    assert.equal(global.groupDefinitions.length, 1);
    assert.equal(global.matchers.length, 1);
    assert.equal(global.manualAssignments.length, 0);
});

test('profiles namespace groups while legacy global alternatives still compare compatibly', () => {
    const sources = [
        configured('ko', '출력언어 | 한국어'),
        configured('ja', '출력언어 | 일본어'),
    ];
    const legacy = annotateSourcesWithPolicies(sources, {
        nameRules: [{
            kind: 'template',
            pattern: '{group} | {option}',
            mode: 'alternative',
        }],
    });
    assert.equal(compareSourcePair(legacy[0], legacy[1], 'language').compare, false);

    const globalOnly = profile('global', null, { id: 'global' });
    const chatOnly = profile('chat', 'chat-key', { id: 'chat' });
    const [globalSource] = annotateSourcesWithPolicies(
        [sources[0]],
        { version: 2, profiles: [globalOnly] },
    );
    const [chatSource] = annotateSourcesWithPolicies(
        [sources[1]],
        { version: 2, profiles: [chatOnly] },
        { profileContext: { chat: { key: 'chat-key' } } },
    );
    assert.equal(compareSourcePair(globalSource, chatSource, 'language').compare, true);
});

test('different group definitions never merge only because their captured names match', () => {
    const settings = {
        version: 2,
        profiles: [{
            id: 'global',
            scope: { kind: 'global' },
            groupDefinitions: [
                { id: 'first-group', label: '첫 그룹', mode: 'alternative' },
                { id: 'second-group', label: '둘째 그룹', mode: 'alternative' },
            ],
            matchers: [
                {
                    id: 'first',
                    groupDefinitionId: 'first-group',
                    kind: 'template',
                    pattern: 'A {group} | {option}',
                },
                {
                    id: 'second',
                    groupDefinitionId: 'second-group',
                    kind: 'template',
                    pattern: 'B {group} | {option}',
                },
            ],
        }],
    };
    const [first, second] = annotateSourcesWithPolicies([
        configured('first', 'A 출력언어 | 한국어'),
        configured('second', 'B 출력언어 | 일본어'),
    ], settings);

    assert.notEqual(
        first.comparisonPolicy.groupInstanceKey,
        second.comparisonPolicy.groupInstanceKey,
    );
    assert.equal(compareSourcePair(first, second, 'language').compare, true);
});

test('name matching is bounded to the source-name prefix', () => {
    const source = configured('long', `${'가'.repeat(2048)} | 옵션`);
    const preview = previewNameMatcher({
        kind: 'template',
        pattern: '{group} | {option}',
        target: 'configured',
        enabled: true,
    }, [source]);

    assert.equal(preview.totalMatches, 0);
});
