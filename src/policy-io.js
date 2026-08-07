import {
    normalizeComparisonPolicySettings,
} from './comparison-policy.js';
import {
    FINDING_REVIEW_DOCUMENT_VERSION,
    normalizeFindingReviewDocument,
} from './finding-review.js';
import {
    RULE_DEFINITIONS,
    normalizeRuleSettings,
} from './rules.js';
import {
    USER_REGEX_MAX_LENGTH,
    validateUserRegex,
} from './regex-safety.js';

export const POLICY_CONFIG_KIND = 'st-devtools-rule-inspector-config';
export const POLICY_CONFIG_FORMAT_VERSION = 1;

export const POLICY_IO_LIMITS = Object.freeze({
    inputBytes: 1_048_576,
    normalizedBytes: 786_432,
    depth: 10,
    nodes: 20_000,
    profiles: 64,
    groupDefinitionsPerProfile: 100,
    matchersPerProfile: 100,
    matchersTotal: 500,
    manualAssignmentsPerProfile: 500,
    manualAssignmentsTotal: 2_000,
    reviews: 2_000,
});

const RULE_SETTINGS_SCHEMA_VERSION = 1;
const COMPARISON_POLICY_SCHEMA_VERSION = 2;
const REVIEWS_SCHEMA_VERSION = 1;
const STRING_ID_MAX_LENGTH = 128;
const STRING_LABEL_MAX_LENGTH = 256;
const TEMPLATE_MAX_LENGTH = 512;
const SCOPE_KEY_MAX_LENGTH = 256;
const GROUPS_TOTAL_LIMIT = 500;

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const PROFILE_SCOPES = new Set(['global', 'preset', 'character', 'chat']);
const POLICY_MODES = new Set(['alternative', 'ignore', 'normal']);
const MATCHER_KINDS = new Set(['template', 'regex']);
const MATCHER_TARGETS = new Set(['configured', 'all']);
const POLICY_CATEGORIES = new Set([
    '*',
    'language',
    'format',
    'tone',
    'role',
    'identity',
    'safety',
    'memory',
    'directives',
    'duplicates',
]);
const REVIEW_DECISIONS = new Set(['valid', 'false-positive']);

const RULE_SETTING_RANGES = Object.freeze({
    contextWarning: [0.1, 0.98],
    contextCritical: [0.11, 1],
    largeSourceTokens: [1, 1_000_000],
    largeSourceShare: [0.01, 1],
    minimumSentenceLength: [5, 500],
});

export class PolicyIoError extends Error {
    constructor(code, message = code) {
        super(message);
        this.name = 'PolicyIoError';
        this.code = code;
    }
}

function reject(code, message) {
    throw new PolicyIoError(code, message);
}

function hasOwn(value, key) {
    return Boolean(
        value
        && typeof value === 'object'
        && Object.prototype.hasOwnProperty.call(value, key),
    );
}

function plainObject(value, path) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        reject('invalid-object', `${path} must be an object.`);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        reject('invalid-object', `${path} must be a plain object.`);
    }
    return value;
}

function knownKeys(value, allowed, path) {
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) {
            reject('unknown-field', `${path}.${key} is not supported.`);
        }
    }
}

function normalizedText(value, maximum, path, { required = false } = {}) {
    if (value == null && !required) return '';
    if (typeof value !== 'string') {
        reject('invalid-string', `${path} must be a string.`);
    }
    const normalized = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
    if (required && !normalized) {
        reject('invalid-string', `${path} must not be empty.`);
    }
    if (normalized.length > maximum) {
        reject('string-too-long', `${path} is too long.`);
    }
    if (/[\0-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(normalized)) {
        reject('invalid-string', `${path} contains control characters.`);
    }
    return normalized;
}

function optionalNullableText(value, maximum, path) {
    if (value == null || value === '') return null;
    return normalizedText(value, maximum, path, { required: true });
}

function boundedPattern(value, maximum, path) {
    if (typeof value !== 'string') {
        reject('invalid-string', `${path} must be a string.`);
    }
    const pattern = value.trim();
    if (!pattern) reject('invalid-string', `${path} must not be empty.`);
    if (pattern.length > maximum) reject('string-too-long', `${path} is too long.`);
    if (pattern.includes('\0')) {
        reject('invalid-string', `${path} contains a null character.`);
    }
    return pattern;
}

function encodedBytes(value) {
    return new TextEncoder().encode(value).length;
}

function scanValue(value, state, depth = 0) {
    if (depth > POLICY_IO_LIMITS.depth) {
        reject('document-too-deep', 'The policy document is nested too deeply.');
    }
    state.nodes += 1;
    if (state.nodes > POLICY_IO_LIMITS.nodes) {
        reject('document-too-complex', 'The policy document contains too many values.');
    }
    if (!value || typeof value !== 'object') return;
    if (state.seen.has(value)) {
        reject('cyclic-document', 'The policy document contains a cycle.');
    }
    state.seen.add(value);
    for (const key of Object.keys(value)) {
        if (UNSAFE_KEYS.has(key)) {
            reject('unsafe-key', `The policy document contains an unsafe key: ${key}.`);
        }
        scanValue(value[key], state, depth + 1);
    }
    state.seen.delete(value);
}

function parseBoundedInput(input) {
    let parsed = input;
    if (typeof input === 'string') {
        if (encodedBytes(input) > POLICY_IO_LIMITS.inputBytes) {
            reject('input-too-large', 'The policy document exceeds 1 MiB.');
        }
        try {
            parsed = JSON.parse(input);
        } catch {
            reject('invalid-json', 'The policy document is not valid JSON.');
        }
    }
    scanValue(parsed, { nodes: 0, seen: new WeakSet() });
    if (typeof input !== 'string') {
        let serialized;
        try {
            serialized = JSON.stringify(parsed);
        } catch {
            reject('invalid-json', 'The policy document cannot be serialized.');
        }
        if (encodedBytes(serialized) > POLICY_IO_LIMITS.inputBytes) {
            reject('input-too-large', 'The policy document exceeds 1 MiB.');
        }
    }
    return plainObject(parsed, 'document');
}

function validateTimestamp(value, path) {
    if (!Number.isSafeInteger(value) || value < 0) {
        reject('invalid-timestamp', `${path} must be a non-negative integer timestamp.`);
    }
    return value;
}

function validateComponent(value, schemaVersion, path) {
    const component = plainObject(value, path);
    knownKeys(component, new Set(['schemaVersion', 'data']), path);
    if (component.schemaVersion !== schemaVersion) {
        reject('unsupported-schema-version', `${path} has an unsupported schema version.`);
    }
    if (!hasOwn(component, 'data')) {
        reject('missing-component-data', `${path}.data is required.`);
    }
    return component.data;
}

function validateRuleSettings(value) {
    const settings = plainObject(value, 'components.ruleSettings.data');
    knownKeys(
        settings,
        new Set(['enabled', ...Object.keys(RULE_SETTING_RANGES)]),
        'components.ruleSettings.data',
    );
    if (hasOwn(settings, 'enabled')) {
        const enabled = plainObject(
            settings.enabled,
            'components.ruleSettings.data.enabled',
        );
        const knownRuleIds = new Set(RULE_DEFINITIONS.map(({ id }) => id));
        knownKeys(enabled, knownRuleIds, 'components.ruleSettings.data.enabled');
        for (const [key, item] of Object.entries(enabled)) {
            if (typeof item !== 'boolean') {
                reject(
                    'invalid-rule-setting',
                    `components.ruleSettings.data.enabled.${key} must be boolean.`,
                );
            }
        }
    }
    for (const [key, [minimum, maximum]] of Object.entries(RULE_SETTING_RANGES)) {
        if (!hasOwn(settings, key)) continue;
        const number = settings[key];
        if (!Number.isFinite(number) || number < minimum || number > maximum) {
            reject(
                'invalid-rule-setting',
                `components.ruleSettings.data.${key} is outside its allowed range.`,
            );
        }
        if (
            ['largeSourceTokens', 'minimumSentenceLength'].includes(key)
            && !Number.isInteger(number)
        ) {
            reject(
                'invalid-rule-setting',
                `components.ruleSettings.data.${key} must be an integer.`,
            );
        }
    }
    if (
        hasOwn(settings, 'contextWarning')
        && hasOwn(settings, 'contextCritical')
        && settings.contextCritical <= settings.contextWarning
    ) {
        reject(
            'invalid-rule-setting',
            'contextCritical must be greater than contextWarning.',
        );
    }
    return normalizeRuleSettings(settings);
}

function validateCategories(value, path) {
    const raw = value === '*'
        ? ['*']
        : Array.isArray(value)
            ? value
            : null;
    if (!raw || raw.length === 0 || raw.length > POLICY_CATEGORIES.size) {
        reject('invalid-categories', `${path} has invalid categories.`);
    }
    const categories = [];
    for (let index = 0; index < raw.length; index += 1) {
        const category = normalizedText(
            raw[index],
            32,
            `${path}[${index}]`,
            { required: true },
        ).toLowerCase();
        if (!POLICY_CATEGORIES.has(category)) {
            reject('invalid-categories', `${path} contains an unknown category.`);
        }
        if (categories.includes(category)) {
            reject('invalid-categories', `${path} contains a duplicate category.`);
        }
        categories.push(category);
    }
    if (categories.includes('*') && categories.length !== 1) {
        reject('invalid-categories', `${path} cannot combine * with another category.`);
    }
    return categories;
}

function validateMode(value, path) {
    const mode = normalizedText(value, 32, path, { required: true });
    if (!POLICY_MODES.has(mode)) {
        reject('invalid-mode', `${path} has an unknown mode.`);
    }
    return mode;
}

function validateId(value, path) {
    return normalizedText(value, STRING_ID_MAX_LENGTH, path, { required: true });
}

function validateScope(profile, path) {
    const scope = plainObject(profile.scope, `${path}.scope`);
    knownKeys(scope, new Set(['kind', 'key']), `${path}.scope`);
    const kind = normalizedText(
        scope.kind,
        32,
        `${path}.scope.kind`,
        { required: true },
    );
    const key = scope.key;
    if (!PROFILE_SCOPES.has(kind)) {
        reject('invalid-scope', `${path}.scope has an unknown kind.`);
    }
    if (kind === 'global') {
        if (key != null && key !== '') {
            reject('invalid-scope', `${path}.scope.key must be null for global scope.`);
        }
        return { kind, key: null };
    }
    return {
        kind,
        key: normalizedText(
            key,
            SCOPE_KEY_MAX_LENGTH,
            `${path}.scope.key`,
            { required: true },
        ),
    };
}

function validateTemplate(pattern, fixedGroup, path) {
    const groupCount = pattern.split('{group}').length - 1;
    const optionCount = pattern.split('{option}').length - 1;
    if (
        (!fixedGroup && groupCount !== 1)
        || groupCount > 1
        || optionCount !== 1
    ) {
        reject('invalid-template', `${path}.pattern has an invalid template shape.`);
    }
}

function profileGroups(profile, path) {
    const raw = profile.groupDefinitions;
    if (!Array.isArray(raw)) {
        reject('invalid-groups', `${path}.groupDefinitions must be an array.`);
    }
    return raw;
}

function profileMatchers(profile, path) {
    const raw = profile.matchers;
    if (!Array.isArray(raw)) {
        reject('invalid-matchers', `${path}.matchers must be an array.`);
    }
    return raw;
}

function groupReference(value, path) {
    return validateId(value.groupDefinitionId, `${path}.groupDefinitionId`);
}

function validateGroup(value, path) {
    const group = plainObject(value, path);
    knownKeys(group, new Set(['id', 'label', 'mode', 'categories']), path);
    const id = validateId(group.id, `${path}.id`);
    return {
        id,
        label: optionalNullableText(
            group.label,
            STRING_LABEL_MAX_LENGTH,
            `${path}.label`,
        ) ?? id,
        mode: validateMode(group.mode, `${path}.mode`),
        categories: validateCategories(group.categories, `${path}.categories`),
    };
}

function validateMatcher(value, path) {
    const matcher = plainObject(value, path);
    knownKeys(
        matcher,
        new Set([
            'id',
            'enabled',
            'groupDefinitionId',
            'kind',
            'pattern',
            'fixedGroup',
            'fixedOption',
            'target',
            'order',
        ]),
        path,
    );
    const kind = normalizedText(
        matcher.kind,
        32,
        `${path}.kind`,
        { required: true },
    );
    if (!MATCHER_KINDS.has(kind)) {
        reject('invalid-matcher-kind', `${path}.kind is not supported.`);
    }
    const maximum = kind === 'regex' ? USER_REGEX_MAX_LENGTH : TEMPLATE_MAX_LENGTH;
    const pattern = boundedPattern(
        matcher.pattern,
        maximum,
        `${path}.pattern`,
    );
    const fixedGroup = optionalNullableText(
        matcher.fixedGroup,
        STRING_LABEL_MAX_LENGTH,
        `${path}.fixedGroup`,
    );
    if (kind === 'regex') {
        const validation = validateUserRegex(pattern);
        if (!validation.ok) {
            reject(validation.code, `${path}.pattern is not a safe regular expression.`);
        }
    } else {
        validateTemplate(pattern, fixedGroup, path);
    }
    const target = normalizedText(
        matcher.target ?? 'configured',
        32,
        `${path}.target`,
        { required: true },
    );
    if (!MATCHER_TARGETS.has(target)) {
        reject('invalid-target', `${path}.target is not supported.`);
    }
    if (hasOwn(matcher, 'enabled') && typeof matcher.enabled !== 'boolean') {
        reject('invalid-matcher', `${path}.enabled must be boolean.`);
    }
    const order = matcher.order ?? 0;
    if (!Number.isSafeInteger(order)) {
        reject('invalid-matcher', `${path}.order must be an integer.`);
    }
    return {
        id: validateId(matcher.id, `${path}.id`),
        enabled: matcher.enabled !== false,
        kind,
        pattern,
        fixedGroup,
        fixedOption: optionalNullableText(
            matcher.fixedOption,
            STRING_LABEL_MAX_LENGTH,
            `${path}.fixedOption`,
        ),
        target,
        groupDefinitionId: groupReference(matcher, path),
        order,
    };
}

function validateManualAssignment(value, path) {
    const assignment = plainObject(value, path);
    knownKeys(
        assignment,
        new Set([
            'id',
            'groupDefinitionId',
            'group',
            'option',
            'sourceIdentity',
            'sourceIdentifier',
            'sourceFingerprint',
            'sourceId',
            'sourceLabel',
        ]),
        path,
    );
    const sourceIdentity = assignment.sourceIdentity == null
        ? {}
        : plainObject(assignment.sourceIdentity, `${path}.sourceIdentity`);
    knownKeys(
        sourceIdentity,
        new Set(['identifier', 'fingerprint', 'sourceId', 'label']),
        `${path}.sourceIdentity`,
    );
    const identity = {
        identifier: optionalNullableText(
            assignment.sourceIdentifier ?? sourceIdentity.identifier,
            STRING_ID_MAX_LENGTH,
            `${path}.sourceIdentity.identifier`,
        ),
        fingerprint: optionalNullableText(
            assignment.sourceFingerprint ?? sourceIdentity.fingerprint,
            STRING_LABEL_MAX_LENGTH,
            `${path}.sourceIdentity.fingerprint`,
        ),
        sourceId: optionalNullableText(
            assignment.sourceId ?? sourceIdentity.sourceId,
            STRING_LABEL_MAX_LENGTH,
            `${path}.sourceIdentity.sourceId`,
        ),
        label: optionalNullableText(
            assignment.sourceLabel ?? sourceIdentity.label,
            STRING_LABEL_MAX_LENGTH,
            `${path}.sourceIdentity.label`,
        ),
    };
    if (!Object.values(identity).some(Boolean)) {
        reject('invalid-manual-assignment', `${path} has no source identity.`);
    }
    return {
        id: validateId(assignment.id, `${path}.id`),
        group: normalizedText(
            assignment.group,
            STRING_LABEL_MAX_LENGTH,
            `${path}.group`,
            { required: true },
        ),
        option: optionalNullableText(
            assignment.option,
            STRING_LABEL_MAX_LENGTH,
            `${path}.option`,
        ),
        groupDefinitionId: groupReference(assignment, path),
        sourceIdentity: identity,
    };
}

function structurallyEqual(left, right) {
    if (Object.is(left, right)) return true;
    if (Array.isArray(left) || Array.isArray(right)) {
        return (
            Array.isArray(left)
            && Array.isArray(right)
            && left.length === right.length
            && left.every((value, index) => structurallyEqual(value, right[index]))
        );
    }
    if (
        !left
        || !right
        || typeof left !== 'object'
        || typeof right !== 'object'
    ) {
        return false;
    }
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return (
        leftKeys.length === rightKeys.length
        && leftKeys.every((key, index) => (
            key === rightKeys[index]
            && structurallyEqual(left[key], right[key])
        ))
    );
}

function assertUniqueIds(values, path) {
    const ids = new Set();
    for (const value of values) {
        if (ids.has(value.id)) {
            reject('duplicate-id', `${path} contains duplicate id ${value.id}.`);
        }
        ids.add(value.id);
    }
}

function validateComparisonPolicy(value) {
    const policy = plainObject(value, 'components.comparisonPolicy.data');
    knownKeys(
        policy,
        new Set(['version', 'profiles']),
        'components.comparisonPolicy.data',
    );
    if (policy.version !== COMPARISON_POLICY_SCHEMA_VERSION) {
        reject(
            'unsupported-schema-version',
            'components.comparisonPolicy.data.version is not supported.',
        );
    }
    if (!Array.isArray(policy.profiles)) {
        reject('invalid-profiles', 'components.comparisonPolicy.data.profiles must be an array.');
    }
    if (policy.profiles.length > POLICY_IO_LIMITS.profiles) {
        reject('too-many-profiles', 'The policy contains too many profiles.');
    }

    let matcherTotal = 0;
    let manualTotal = 0;
    let groupTotal = 0;
    const normalizedProfiles = [];
    const profileIds = new Set();
    const unresolvedReferences = [];

    for (let profileIndex = 0; profileIndex < policy.profiles.length; profileIndex += 1) {
        const path = `components.comparisonPolicy.data.profiles[${profileIndex}]`;
        const rawProfile = plainObject(policy.profiles[profileIndex], path);
        knownKeys(
            rawProfile,
            new Set([
                'id',
                'label',
                'enabled',
                'priority',
                'scope',
                'groupDefinitions',
                'matchers',
                'manualAssignments',
            ]),
            path,
        );
        const id = validateId(rawProfile.id, `${path}.id`);
        if (profileIds.has(id)) {
            reject('duplicate-id', `${path}.id duplicates another profile.`);
        }
        profileIds.add(id);
        const rawGroups = profileGroups(rawProfile, path);
        if (rawGroups.length > POLICY_IO_LIMITS.groupDefinitionsPerProfile) {
            reject('too-many-groups', `${path} contains too many groups.`);
        }
        const groups = rawGroups.map((group, index) => (
            validateGroup(group, `${path}.groupDefinitions[${index}]`)
        ));
        const rawMatchers = profileMatchers(rawProfile, path);
        const rawManual = rawProfile.manualAssignments;
        if (!Array.isArray(rawManual)) {
            reject(
                'invalid-manual-assignments',
                `${path}.manualAssignments must be an array.`,
            );
        }
        if (rawMatchers.length > POLICY_IO_LIMITS.matchersPerProfile) {
            reject('too-many-matchers', `${path} contains too many matchers.`);
        }
        if (rawManual.length > POLICY_IO_LIMITS.manualAssignmentsPerProfile) {
            reject('too-many-manual-assignments', `${path} contains too many assignments.`);
        }
        matcherTotal += rawMatchers.length;
        manualTotal += rawManual.length;
        groupTotal += groups.length;
        if (matcherTotal > POLICY_IO_LIMITS.matchersTotal) {
            reject('too-many-matchers', 'The policy contains too many matchers.');
        }
        if (manualTotal > POLICY_IO_LIMITS.manualAssignmentsTotal) {
            reject(
                'too-many-manual-assignments',
                'The policy contains too many manual assignments.',
            );
        }
        if (groupTotal > GROUPS_TOTAL_LIMIT) {
            reject('too-many-groups', 'The policy contains too many groups.');
        }
        assertUniqueIds(groups, `${path}.groupDefinitions`);
        const matchers = rawMatchers.map((matcher, index) => (
            validateMatcher(matcher, `${path}.matchers[${index}]`)
        ));
        const manualAssignments = rawManual.map((assignment, index) => (
            validateManualAssignment(
                assignment,
                `${path}.manualAssignments[${index}]`,
            )
        ));
        assertUniqueIds(matchers, `${path}.matchers`);
        assertUniqueIds(manualAssignments, `${path}.manualAssignments`);
        unresolvedReferences.push(...matchers.map(({ groupDefinitionId }) => ({
            path,
            profileId: id,
            groupId: groupDefinitionId,
        })), ...manualAssignments.map(({ groupDefinitionId }) => ({
            path,
            profileId: id,
            groupId: groupDefinitionId,
        })));
        if (hasOwn(rawProfile, 'enabled') && typeof rawProfile.enabled !== 'boolean') {
            reject('invalid-profile', `${path}.enabled must be boolean.`);
        }
        const priority = rawProfile.priority ?? 0;
        if (!Number.isSafeInteger(priority)) {
            reject('invalid-profile', `${path}.priority must be an integer.`);
        }
        normalizedProfiles.push({
            id,
            label: optionalNullableText(
                rawProfile.label,
                STRING_LABEL_MAX_LENGTH,
                `${path}.label`,
            ) ?? id,
            enabled: rawProfile.enabled !== false,
            priority,
            scope: validateScope(rawProfile, path),
            groupDefinitions: groups,
            matchers,
            manualAssignments,
        });
    }

    const groupsByProfile = new Map(normalizedProfiles.map(({ id, groupDefinitions }) => [
        id,
        new Set(groupDefinitions.map((group) => group.id)),
    ]));
    for (const reference of unresolvedReferences) {
        if (!groupsByProfile.get(reference.profileId)?.has(reference.groupId)) {
            reject(
                'dangling-group-reference',
                `${reference.path} references missing group ${reference.groupId}.`,
            );
        }
    }

    const canonical = {
        version: COMPARISON_POLICY_SCHEMA_VERSION,
        profiles: normalizedProfiles,
    };

    // Prefer the policy module's canonical V2 representation once available.
    // The explicit canonical fallback keeps this I/O boundary compatible while
    // older installations still expose the V1 normalizer.
    const moduleNormalized = normalizeComparisonPolicySettings(canonical);
    if (
        moduleNormalized?.version !== COMPARISON_POLICY_SCHEMA_VERSION
        || !Array.isArray(moduleNormalized.profiles)
        || moduleNormalized.profiles.length !== canonical.profiles.length
        || !structurallyEqual(moduleNormalized, canonical)
    ) {
        reject(
            'normalization-mismatch',
            'The comparison policy could not be normalized without data loss.',
        );
    }
    return moduleNormalized;
}

function validateIsoTimestamp(value, path) {
    if (value == null) return null;
    if (typeof value !== 'string' || !value || !Number.isFinite(Date.parse(value))) {
        reject('invalid-review', `${path} must be an ISO timestamp or null.`);
    }
    const canonical = new Date(value).toISOString();
    if (canonical !== value) {
        reject('invalid-review', `${path} must be a canonical ISO timestamp.`);
    }
    return canonical;
}

function validateReviews(value) {
    const reviews = plainObject(value, 'components.reviews.data');
    knownKeys(
        reviews,
        new Set(['version', 'decisions', 'ignores']),
        'components.reviews.data',
    );
    if (reviews.version !== FINDING_REVIEW_DOCUMENT_VERSION) {
        reject('unsupported-schema-version', 'The review document version is not supported.');
    }
    if (!Array.isArray(reviews.decisions) || !Array.isArray(reviews.ignores)) {
        reject('invalid-reviews', 'Review decisions and ignores must be arrays.');
    }
    if (reviews.decisions.length + reviews.ignores.length > POLICY_IO_LIMITS.reviews) {
        reject('too-many-reviews', 'The document contains too many review entries.');
    }
    const decisionKeys = new Set();
    for (let index = 0; index < reviews.decisions.length; index += 1) {
        const path = `components.reviews.data.decisions[${index}]`;
        const decision = plainObject(reviews.decisions[index], path);
        knownKeys(decision, new Set(['findingKey', 'decision', 'updatedAt']), path);
        const key = normalizedText(
            decision.findingKey,
            STRING_ID_MAX_LENGTH,
            `${path}.findingKey`,
            { required: true },
        );
        if (!/^finding:v1:[0-9a-f]{16}$/u.test(key)) {
            reject('invalid-review', `${path}.findingKey is invalid.`);
        }
        if (decisionKeys.has(key)) {
            reject('duplicate-id', `${path}.findingKey is duplicated.`);
        }
        decisionKeys.add(key);
        if (!REVIEW_DECISIONS.has(decision.decision)) {
            reject('invalid-review', `${path}.decision is invalid.`);
        }
        validateIsoTimestamp(decision.updatedAt, `${path}.updatedAt`);
    }

    const ignoreKeys = new Set();
    for (let index = 0; index < reviews.ignores.length; index += 1) {
        const path = `components.reviews.data.ignores[${index}]`;
        const ignore = plainObject(reviews.ignores[index], path);
        knownKeys(
            ignore,
            new Set([
                'suppressionKey',
                'scope',
                'scopeKey',
                'label',
                'updatedAt',
            ]),
            path,
        );
        const suppressionKey = normalizedText(
            ignore.suppressionKey,
            STRING_ID_MAX_LENGTH,
            `${path}.suppressionKey`,
            { required: true },
        );
        if (!/^suppression:v1:[0-9a-f]{16}$/u.test(suppressionKey)) {
            reject('invalid-review', `${path}.suppressionKey is invalid.`);
        }
        if (!PROFILE_SCOPES.has(ignore.scope)) {
            reject('invalid-scope', `${path}.scope is invalid.`);
        }
        const scopeKey = ignore.scope === 'global'
            ? null
            : normalizedText(
                ignore.scopeKey,
                STRING_ID_MAX_LENGTH,
                `${path}.scopeKey`,
                { required: true },
            );
        if (
            ignore.scope === 'global'
            && ignore.scopeKey != null
            && ignore.scopeKey !== ''
        ) {
            reject('invalid-scope', `${path}.scopeKey must be null for global scope.`);
        }
        if (
            scopeKey
            && !new RegExp(`^scope:${ignore.scope}:[0-9a-f]{16}$`, 'u').test(scopeKey)
        ) {
            reject('invalid-scope', `${path}.scopeKey is invalid.`);
        }
        const identity = `${suppressionKey}|${ignore.scope}|${scopeKey ?? ''}`;
        if (ignoreKeys.has(identity)) {
            reject('duplicate-id', `${path} duplicates another ignore.`);
        }
        ignoreKeys.add(identity);
        optionalNullableText(
            ignore.label,
            STRING_LABEL_MAX_LENGTH,
            `${path}.label`,
        );
        validateIsoTimestamp(ignore.updatedAt, `${path}.updatedAt`);
    }

    const normalized = normalizeFindingReviewDocument({
        ...reviews,
        audit: [],
    });
    return {
        version: REVIEWS_SCHEMA_VERSION,
        decisions: normalized.decisions,
        ignores: normalized.ignores,
    };
}

function normalizedEnvelope(envelope) {
    knownKeys(
        envelope,
        new Set([
            'kind',
            'formatVersion',
            'exportedAt',
            'extensionVersion',
            'components',
        ]),
        'document',
    );
    if (envelope.kind !== POLICY_CONFIG_KIND) {
        reject('invalid-kind', 'This is not an ST DevTools Rule Inspector configuration.');
    }
    if (envelope.formatVersion !== POLICY_CONFIG_FORMAT_VERSION) {
        reject('unsupported-format-version', 'The configuration format version is not supported.');
    }
    const components = plainObject(envelope.components, 'components');
    knownKeys(
        components,
        new Set(['ruleSettings', 'comparisonPolicy', 'reviews']),
        'components',
    );
    if (!hasOwn(components, 'ruleSettings') || !hasOwn(components, 'comparisonPolicy')) {
        reject('missing-component', 'Rule settings and comparison policy are required.');
    }
    const result = {
        kind: POLICY_CONFIG_KIND,
        formatVersion: POLICY_CONFIG_FORMAT_VERSION,
        exportedAt: validateTimestamp(envelope.exportedAt, 'exportedAt'),
        extensionVersion: optionalNullableText(
            envelope.extensionVersion,
            64,
            'extensionVersion',
        ),
        components: {
            ruleSettings: {
                schemaVersion: RULE_SETTINGS_SCHEMA_VERSION,
                data: validateRuleSettings(validateComponent(
                    components.ruleSettings,
                    RULE_SETTINGS_SCHEMA_VERSION,
                    'components.ruleSettings',
                )),
            },
            comparisonPolicy: {
                schemaVersion: COMPARISON_POLICY_SCHEMA_VERSION,
                data: validateComparisonPolicy(validateComponent(
                    components.comparisonPolicy,
                    COMPARISON_POLICY_SCHEMA_VERSION,
                    'components.comparisonPolicy',
                )),
            },
        },
    };
    if (hasOwn(components, 'reviews')) {
        result.components.reviews = {
            schemaVersion: REVIEWS_SCHEMA_VERSION,
            data: validateReviews(validateComponent(
                components.reviews,
                REVIEWS_SCHEMA_VERSION,
                'components.reviews',
            )),
        };
    }
    const serialized = JSON.stringify(result);
    if (encodedBytes(serialized) > POLICY_IO_LIMITS.normalizedBytes) {
        reject('normalized-too-large', 'The normalized policy document exceeds 768 KiB.');
    }
    return result;
}

export function parsePolicyDocument(input) {
    return normalizedEnvelope(parseBoundedInput(input));
}

export function createPolicyDocument({
    ruleSettings,
    comparisonPolicy,
    reviews = null,
    exportedAt = Date.now(),
    extensionVersion = null,
} = {}) {
    const envelope = {
        kind: POLICY_CONFIG_KIND,
        formatVersion: POLICY_CONFIG_FORMAT_VERSION,
        exportedAt,
        extensionVersion,
        components: {
            ruleSettings: {
                schemaVersion: RULE_SETTINGS_SCHEMA_VERSION,
                data: normalizeRuleSettings(ruleSettings),
            },
            comparisonPolicy: {
                schemaVersion: COMPARISON_POLICY_SCHEMA_VERSION,
                data: comparisonPolicy,
            },
            ...(reviews
                ? {
                    reviews: {
                        schemaVersion: REVIEWS_SCHEMA_VERSION,
                        data: (() => {
                            const normalized = normalizeFindingReviewDocument(reviews);
                            return {
                                version: REVIEWS_SCHEMA_VERSION,
                                decisions: normalized.decisions,
                                ignores: normalized.ignores,
                            };
                        })(),
                    },
                }
                : {}),
        },
    };
    return normalizedEnvelope(envelope);
}

export function serializePolicyDocument(options, { space = 2 } = {}) {
    return JSON.stringify(createPolicyDocument(options), null, space);
}

/**
 * Produces a replacement state without mutating the caller's current state.
 * Validation finishes before the first object in nextState is created, so a
 * thrown import cannot partially apply any component.
 */
export function preparePolicyImport(input, currentState = {}) {
    const document = parsePolicyDocument(input);
    const importedReviews = document.components.reviews?.data;
    const currentReviews = normalizeFindingReviewDocument(currentState.reviews ?? {});
    const nextState = {
        ...currentState,
        ruleSettings: document.components.ruleSettings.data,
        comparisonPolicy: document.components.comparisonPolicy.data,
        ...(importedReviews
            ? {
                reviews: {
                    ...importedReviews,
                    audit: currentReviews.audit,
                },
            }
            : {}),
    };
    return { document, nextState };
}
