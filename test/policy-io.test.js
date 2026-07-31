import assert from 'node:assert/strict';
import test from 'node:test';
import {
    POLICY_CONFIG_FORMAT_VERSION,
    POLICY_CONFIG_KIND,
    POLICY_IO_LIMITS,
    PolicyIoError,
    createPolicyDocument,
    parsePolicyDocument,
    preparePolicyImport,
    serializePolicyDocument,
} from '../src/policy-io.js';

function comparisonPolicy(overrides = {}) {
    return {
        version: 2,
        profiles: [{
            id: 'global',
            label: '전역 정책',
            enabled: true,
            priority: 7,
            scope: { kind: 'global', key: null },
            groupDefinitions: [{
                id: 'output-language',
                label: '출력 언어',
                mode: 'alternative',
                categories: ['language'],
            }],
            matchers: [{
                id: 'language-name',
                enabled: true,
                groupDefinitionId: 'output-language',
                kind: 'template',
                pattern: '{group} | {option}',
                fixedGroup: null,
                fixedOption: null,
                target: 'configured',
                order: 0,
            }],
            manualAssignments: [{
                id: 'manual-korean',
                groupDefinitionId: 'output-language',
                group: '출력 언어',
                option: '한국어',
                sourceIdentity: {
                    identifier: 'language-korean',
                    fingerprint: null,
                    sourceId: null,
                    label: '출력언어 | 한국어',
                },
            }],
        }],
        ...overrides,
    };
}

function ruleSettings() {
    return {
        enabled: {
            context: true,
            duplicates: true,
            language: true,
            format: true,
            role: true,
            directives: true,
            largeSource: true,
            unmatched: true,
        },
        contextWarning: 0.75,
        contextCritical: 0.9,
        largeSourceTokens: 1000,
        largeSourceShare: 0.4,
        minimumSentenceLength: 20,
    };
}

function reviews() {
    return {
        version: 1,
        decisions: [{
            findingKey: 'finding:v1:0123456789abcdef',
            decision: 'false-positive',
            updatedAt: '2026-07-31T00:00:00.000Z',
        }],
        ignores: [{
            suppressionKey: 'suppression:v1:fedcba9876543210',
            scope: 'preset',
            scopeKey: 'scope:preset:0123456789abcdef',
            label: '테스트 프리셋',
            updatedAt: null,
        }],
        audit: [{
            at: '2026-07-31T00:00:00.000Z',
            action: 'private.audit',
            targetKey: 'finding:v1:0123456789abcdef',
            rawPrompt: 'DO-NOT-EXPORT-AUDIT',
        }],
    };
}

function document(overrides = {}) {
    const created = createPolicyDocument({
        ruleSettings: ruleSettings(),
        comparisonPolicy: comparisonPolicy(),
        reviews: reviews(),
        exportedAt: 1_775_088_000_000,
        extensionVersion: '0.9.1',
    });
    return {
        ...created,
        ...overrides,
    };
}

function withComparisonData(base, data) {
    return {
        ...base,
        components: {
            ...base.components,
            comparisonPolicy: {
                schemaVersion: 2,
                data,
            },
        },
    };
}

function clone(value) {
    return structuredClone(value);
}

test('versioned policy export round-trips canonically and excludes audit records', () => {
    const serialized = serializePolicyDocument({
        ruleSettings: ruleSettings(),
        comparisonPolicy: comparisonPolicy(),
        reviews: reviews(),
        exportedAt: 1_775_088_000_000,
        extensionVersion: '0.9.1',
    });
    assert.equal(serialized.includes('DO-NOT-EXPORT-AUDIT'), false);

    const parsed = parsePolicyDocument(serialized);
    assert.equal(parsed.kind, POLICY_CONFIG_KIND);
    assert.equal(parsed.formatVersion, POLICY_CONFIG_FORMAT_VERSION);
    assert.equal(parsed.components.ruleSettings.schemaVersion, 1);
    assert.equal(parsed.components.comparisonPolicy.schemaVersion, 2);
    assert.equal(parsed.components.reviews.schemaVersion, 1);
    assert.equal('audit' in parsed.components.reviews.data, false);
    assert.equal(parsed.components.comparisonPolicy.data.profiles[0].enabled, true);
    assert.equal(parsed.components.comparisonPolicy.data.profiles[0].priority, 7);
    assert.equal(
        parsed.components.comparisonPolicy.data.profiles[0]
            .manualAssignments[0].sourceIdentity.identifier,
        'language-korean',
    );
    assert.deepEqual(parsePolicyDocument(JSON.stringify(parsed)), parsed);
});

test('flat legacy manual identities are accepted but emitted in canonical nested form', () => {
    const base = document();
    const raw = clone(base.components.comparisonPolicy.data);
    const assignment = raw.profiles[0].manualAssignments[0];
    assignment.sourceIdentifier = assignment.sourceIdentity.identifier;
    assignment.sourceLabel = assignment.sourceIdentity.label;
    delete assignment.sourceIdentity;

    const parsed = parsePolicyDocument(JSON.stringify(withComparisonData(base, raw)));
    const normalized = parsed.components.comparisonPolicy.data
        .profiles[0].manualAssignments[0];
    assert.deepEqual(normalized.sourceIdentity, {
        identifier: 'language-korean',
        fingerprint: null,
        sourceId: null,
        label: '출력언어 | 한국어',
    });
    assert.equal('sourceIdentifier' in normalized, false);
});

test('invalid imports fail atomically without modifying caller-owned state', () => {
    const currentState = {
        marker: 'keep',
        ruleSettings: { custom: 'unchanged' },
        comparisonPolicy: { custom: 'unchanged' },
        reviews: {
            ...reviews(),
            audit: [{
                at: '2026-07-31T00:00:00.000Z',
                action: 'decision.valid',
                targetKey: 'finding:v1:0123456789abcdef',
            }],
        },
    };
    const before = clone(currentState);
    const invalid = document({ formatVersion: 999 });
    assert.throws(
        () => preparePolicyImport(JSON.stringify(invalid), currentState),
        (error) => (
            error instanceof PolicyIoError
            && error.code === 'unsupported-format-version'
        ),
    );
    assert.deepEqual(currentState, before);

    const prepared = preparePolicyImport(JSON.stringify(document()), currentState);
    assert.notEqual(prepared.nextState, currentState);
    assert.deepEqual(currentState, before);
    assert.equal(prepared.nextState.reviews.audit.length, 1);
    assert.equal(prepared.nextState.reviews.audit[0].action, 'decision.valid');
    assert.equal(prepared.nextState.reviews.audit[0].targetKey, before.reviews.audit[0].targetKey);
    assert.equal(prepared.nextState.marker, 'keep');
});

test('envelope and component versions are strict', () => {
    const cases = [
        ['invalid-kind', { ...document(), kind: 'other-document' }],
        ['unsupported-format-version', { ...document(), formatVersion: 2 }],
        ['unsupported-schema-version', (() => {
            const value = document();
            value.components.ruleSettings.schemaVersion = 2;
            return value;
        })()],
        ['unsupported-schema-version', (() => {
            const value = document();
            value.components.comparisonPolicy.schemaVersion = 3;
            return value;
        })()],
        ['unsupported-schema-version', (() => {
            const value = document();
            value.components.reviews.schemaVersion = 2;
            return value;
        })()],
        ['unsupported-schema-version', (() => {
            const value = document();
            value.components.comparisonPolicy.data.version = 3;
            return value;
        })()],
        ['unknown-field', { ...document(), futureField: true }],
    ];
    for (const [code, value] of cases) {
        assert.throws(
            () => parsePolicyDocument(JSON.stringify(value)),
            (error) => error instanceof PolicyIoError && error.code === code,
            code,
        );
    }
});

test('input bytes, nesting, node count, and prototype keys are bounded', () => {
    assert.throws(
        () => parsePolicyDocument(`{"padding":"${'x'.repeat(POLICY_IO_LIMITS.inputBytes)}"}`),
        (error) => error.code === 'input-too-large',
    );

    let nested = { value: true };
    for (let index = 0; index < POLICY_IO_LIMITS.depth + 1; index += 1) {
        nested = { nested };
    }
    assert.throws(
        () => parsePolicyDocument(nested),
        (error) => error.code === 'document-too-deep',
    );

    assert.throws(
        () => parsePolicyDocument({
            values: Array.from({ length: POLICY_IO_LIMITS.nodes + 1 }, () => 0),
        }),
        (error) => error.code === 'document-too-complex',
    );

    const unsafe = JSON.parse(JSON.stringify(document()));
    unsafe.components.comparisonPolicy.data.profiles[0]
        .groupDefinitions[0].constructor = { polluted: true };
    assert.throws(
        () => parsePolicyDocument(JSON.stringify(unsafe)),
        (error) => error.code === 'unsafe-key',
    );
    assert.equal({}.polluted, undefined);
});

test('profile, matcher, manual assignment, and review count limits are strict', () => {
    const base = document();
    const global = base.components.comparisonPolicy.data.profiles[0];

    const tooManyProfiles = clone(base.components.comparisonPolicy.data);
    tooManyProfiles.profiles = Array.from(
        { length: POLICY_IO_LIMITS.profiles + 1 },
        (_, index) => ({
            ...clone(global),
            id: `profile-${index}`,
            scope: index === 0
                ? { kind: 'global', key: null }
                : { kind: 'chat', key: `scope-v1:${index}` },
        }),
    );
    assert.throws(
        () => parsePolicyDocument(withComparisonData(base, tooManyProfiles)),
        (error) => error.code === 'too-many-profiles',
    );

    const tooManyMatchers = clone(base.components.comparisonPolicy.data);
    tooManyMatchers.profiles[0].matchers = Array.from(
        { length: POLICY_IO_LIMITS.matchersPerProfile + 1 },
        (_, index) => ({
            ...clone(global.matchers[0]),
            id: `matcher-${index}`,
            order: index,
        }),
    );
    assert.throws(
        () => parsePolicyDocument(withComparisonData(base, tooManyMatchers)),
        (error) => error.code === 'too-many-matchers',
    );

    const tooManyManual = clone(base.components.comparisonPolicy.data);
    tooManyManual.profiles[0].manualAssignments = Array.from(
        { length: POLICY_IO_LIMITS.manualAssignmentsPerProfile + 1 },
        (_, index) => ({
            ...clone(global.manualAssignments[0]),
            id: `manual-${index}`,
            sourceIdentity: {
                ...global.manualAssignments[0].sourceIdentity,
                identifier: `source-${index}`,
            },
        }),
    );
    assert.throws(
        () => parsePolicyDocument(withComparisonData(base, tooManyManual)),
        (error) => error.code === 'too-many-manual-assignments',
    );

    const tooManyGroups = clone(base.components.comparisonPolicy.data);
    tooManyGroups.profiles[0].groupDefinitions = Array.from(
        { length: POLICY_IO_LIMITS.groupDefinitionsPerProfile + 1 },
        (_, index) => ({
            ...clone(global.groupDefinitions[0]),
            id: `group-${index}`,
        }),
    );
    tooManyGroups.profiles[0].matchers = [];
    tooManyGroups.profiles[0].manualAssignments = [];
    assert.throws(
        () => parsePolicyDocument(withComparisonData(base, tooManyGroups)),
        (error) => error.code === 'too-many-groups',
    );

    const tooManyReviews = document();
    tooManyReviews.components.reviews.data.decisions = Array.from(
        { length: POLICY_IO_LIMITS.reviews + 1 },
        (_, index) => ({
            findingKey: `finding:v1:${index.toString(16).padStart(16, '0')}`,
            decision: 'valid',
            updatedAt: null,
        }),
    );
    tooManyReviews.components.reviews.data.ignores = [];
    assert.throws(
        () => parsePolicyDocument(tooManyReviews),
        (error) => error.code === 'too-many-reviews',
    );
});

test('aggregate matcher and assignment limits apply across profiles', () => {
    const base = document();
    const makeProfile = (profileIndex, matcherCount, assignmentCount) => ({
        id: `profile-${profileIndex}`,
        label: `Profile ${profileIndex}`,
        enabled: true,
        priority: profileIndex,
        scope: profileIndex === 0
            ? { kind: 'global', key: null }
            : { kind: 'chat', key: `chat-${profileIndex}` },
        groupDefinitions: [{
            id: 'group',
            label: 'Group',
            mode: 'alternative',
            categories: ['*'],
        }],
        matchers: Array.from({ length: matcherCount }, (_, index) => ({
            id: `matcher-${index}`,
            enabled: true,
            groupDefinitionId: 'group',
            kind: 'template',
            pattern: '{group}|{option}',
            fixedGroup: null,
            fixedOption: null,
            target: 'configured',
            order: index,
        })),
        manualAssignments: Array.from({ length: assignmentCount }, (_, index) => ({
            id: `manual-${index}`,
            groupDefinitionId: 'group',
            group: 'Group',
            option: null,
            sourceIdentifier: `source-${profileIndex}-${index}`,
        })),
    });

    const matcherHeavy = {
        version: 2,
        profiles: Array.from({ length: 6 }, (_, index) => (
            makeProfile(index, 84, 0)
        )),
    };
    assert.throws(
        () => parsePolicyDocument(withComparisonData(base, matcherHeavy)),
        (error) => error.code === 'too-many-matchers',
    );

    const assignmentHeavy = {
        version: 2,
        profiles: Array.from({ length: 5 }, (_, index) => (
            makeProfile(index, 0, 401)
        )),
    };
    assert.throws(
        () => parsePolicyDocument(withComparisonData(base, assignmentHeavy)),
        (error) => error.code === 'too-many-manual-assignments',
    );
});

test('normalized output has an independent 768 KiB storage ceiling', () => {
    const base = document();
    const profiles = Array.from({ length: 4 }, (_, profileIndex) => ({
        id: `profile-${profileIndex}`,
        label: 'Profile',
        enabled: true,
        priority: 0,
        scope: profileIndex === 0
            ? { kind: 'global', key: null }
            : { kind: 'chat', key: `chat-${profileIndex}` },
        groupDefinitions: [{
            id: 'group',
            label: 'Group',
            mode: 'alternative',
            categories: ['*'],
        }],
        matchers: [],
        manualAssignments: Array.from({ length: 500 }, (_, index) => ({
            id: `manual-${index}`,
            groupDefinitionId: 'group',
            group: 'Group',
            option: null,
            sourceIdentifier: `source-${profileIndex}-${index}`,
            sourceLabel: 'x'.repeat(256),
        })),
    }));
    const input = JSON.stringify(withComparisonData(base, {
        version: 2,
        profiles,
    }));
    assert.equal(
        new TextEncoder().encode(input).length < POLICY_IO_LIMITS.inputBytes,
        true,
    );
    assert.throws(
        () => parsePolicyDocument(input),
        (error) => error.code === 'normalized-too-large',
    );
});

test('omitting the optional reviews component preserves current local reviews', () => {
    const exported = document();
    delete exported.components.reviews;
    const current = { reviews: reviews() };
    const prepared = preparePolicyImport(exported, current);
    assert.equal(prepared.document.components.reviews, undefined);
    assert.equal(prepared.nextState.reviews, current.reviews);
});

test('duplicate IDs, dangling group references, and invalid policy values are rejected', () => {
    const base = document();
    const mutations = [
        ['duplicate-id', (data) => {
            data.profiles[0].matchers.push(clone(data.profiles[0].matchers[0]));
        }],
        ['dangling-group-reference', (data) => {
            data.profiles[0].matchers[0].groupDefinitionId = 'missing-group';
        }],
        ['invalid-scope', (data) => {
            data.profiles[0].scope = { kind: 'workspace', key: 'x' };
        }],
        ['invalid-mode', (data) => {
            data.profiles[0].groupDefinitions[0].mode = 'silence-everything';
        }],
        ['invalid-categories', (data) => {
            data.profiles[0].groupDefinitions[0].categories = ['private-category'];
        }],
        ['unsafe-regex', (data) => {
            Object.assign(data.profiles[0].matchers[0], {
                kind: 'regex',
                pattern: '(?:(?:a+))+$',
            });
        }],
        ['unknown-field', (data) => {
            data.profiles[0].unknown = true;
        }],
        ['unknown-field', (data) => {
            data.profiles[0].manualAssignments[0].rawPrompt = 'private';
        }],
    ];

    for (const [code, mutate] of mutations) {
        const data = clone(base.components.comparisonPolicy.data);
        mutate(data);
        assert.throws(
            () => parsePolicyDocument(withComparisonData(base, data)),
            (error) => error instanceof PolicyIoError && error.code === code,
            code,
        );
    }
});

test('every persisted policy ID is capped at 128 normalized characters', () => {
    const base = document();
    const longId = 'x'.repeat(129);
    const mutations = [
        (data) => {
            data.profiles[0].id = longId;
        },
        (data) => {
            data.profiles[0].groupDefinitions[0].id = longId;
            data.profiles[0].matchers[0].groupDefinitionId = longId;
            data.profiles[0].manualAssignments[0].groupDefinitionId = longId;
        },
        (data) => {
            data.profiles[0].matchers[0].id = longId;
        },
        (data) => {
            data.profiles[0].manualAssignments[0].id = longId;
        },
    ];

    for (const mutate of mutations) {
        const data = clone(base.components.comparisonPolicy.data);
        mutate(data);
        assert.throws(
            () => parsePolicyDocument(withComparisonData(base, data)),
            (error) => error.code === 'string-too-long',
        );
    }
});

test('manual assignments require an explicit non-empty group label', () => {
    const base = document();
    for (const invalidGroup of [null, '', '   ']) {
        const data = clone(base.components.comparisonPolicy.data);
        data.profiles[0].manualAssignments[0].group = invalidGroup;
        assert.throws(
            () => parsePolicyDocument(withComparisonData(base, data)),
            (error) => error.code === 'invalid-string',
        );
    }
});

test('import rejects canonical data that the runtime normalizer would alter', () => {
    const base = document();
    const data = clone(base.components.comparisonPolicy.data);
    data.profiles[0].scope = { kind: 'chat', key: 'chat-without-global-policy' };
    // The runtime normalizer would silently prepend its default global
    // profile. Import must reject instead of changing the document.
    assert.throws(
        () => parsePolicyDocument(withComparisonData(base, data)),
        (error) => error.code === 'normalization-mismatch',
    );
});

test('review audit and invalid review identities are rejected on import', () => {
    const withAudit = document();
    withAudit.components.reviews.data.audit = [];
    assert.throws(
        () => parsePolicyDocument(withAudit),
        (error) => error.code === 'unknown-field',
    );

    const invalid = document();
    invalid.components.reviews.data.decisions[0].findingKey = 'finding:v1:raw-prompt';
    assert.throws(
        () => parsePolicyDocument(invalid),
        (error) => error.code === 'invalid-review',
    );
});
