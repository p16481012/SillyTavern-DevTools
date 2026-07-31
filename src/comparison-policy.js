import {
    USER_REGEX_MAX_LENGTH,
    compileUserRegex,
    validateUserRegex,
} from './regex-safety.js';
import { scopeFingerprint } from './profile-context.js';

const MODES = new Set(['alternative', 'ignore', 'normal']);
const RULE_KINDS = new Set(['template', 'regex']);
const TARGETS = new Set(['configured', 'all']);
const PROFILE_SCOPES = new Set(['global', 'preset', 'character', 'chat']);
const PROFILE_PRECEDENCE = Object.freeze({
    global: 0,
    preset: 100,
    character: 200,
    chat: 300,
});
const POLICY_EXCLUDED_SOURCE_TYPES = new Set([
    'final',
    'chat_history',
    'tool_schema',
    'tool_call',
    'tool_result',
    'multimodal',
]);
const LIMITS = Object.freeze({
    profiles: 64,
    groupDefinitions: 100,
    groupDefinitionsTotal: 500,
    matchers: 100,
    matchersTotal: 500,
    manualAssignments: 500,
    manualAssignmentsTotal: 2000,
    categories: 32,
    identifier: 256,
    label: 256,
    pattern: 2048,
    sourceName: 256,
    previewMatches: 50,
});

const DEFAULT_GLOBAL_PROFILE = Object.freeze({
    id: 'global',
    label: '전역',
    enabled: true,
    priority: 0,
    scope: Object.freeze({ kind: 'global', key: null }),
    groupDefinitions: Object.freeze([]),
    matchers: Object.freeze([]),
    manualAssignments: Object.freeze([]),
});

const defaultComparisonPolicySettings = {
    version: 2,
    profiles: Object.freeze([DEFAULT_GLOBAL_PROFILE]),
};
Object.defineProperties(defaultComparisonPolicySettings, {
    nameRules: {
        enumerable: false,
        value: Object.freeze([]),
    },
    manualAssignments: {
        enumerable: false,
        value: Object.freeze([]),
    },
});
export const DEFAULT_COMPARISON_POLICY_SETTINGS = Object.freeze(
    defaultComparisonPolicySettings,
);

function text(value, fallback = '') {
    return typeof value === 'string' ? value : fallback;
}

function boundedText(value, maximum = LIMITS.label) {
    return text(value).slice(0, maximum);
}

function normalizedText(value) {
    return text(value).normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function normalizedBoundedText(value, maximum = LIMITS.label) {
    return normalizedText(boundedText(value, maximum));
}

function canonicalValue(value) {
    return normalizedText(value).toLowerCase();
}

function canonicalScalar(value) {
    return value == null ? '' : canonicalValue(String(value));
}

export function comparisonScopeKeyEquals(left, right) {
    const leftKey = canonicalScalar(left);
    const rightKey = canonicalScalar(right);
    return Boolean(leftKey && rightKey && leftKey === rightKey);
}

function canonicalGroup(value) {
    return canonicalValue(value);
}

function normalizeMode(value) {
    return MODES.has(value) ? value : 'alternative';
}

function normalizeCategories(value) {
    const values = Array.isArray(value)
        ? value
        : typeof value === 'string'
            ? value.split(',')
            : [];
    const categories = [...new Set(values
        .slice(0, LIMITS.categories)
        .map((item) => canonicalValue(boundedText(item, 64)))
        .filter(Boolean))];
    return categories.length > 0 ? categories : ['*'];
}

function finiteInteger(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function hashString(value, seed = 2166136261) {
    let hash = seed >>> 0;
    const input = String(value ?? '');
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function stableHash(value) {
    const input = String(value ?? '');
    return `${hashString(input)}${hashString(input, 3339675911)}:${input.length.toString(36)}`;
}

function stableGeneratedId(prefix, value, index = 0) {
    return `${prefix}:${stableHash(`${value}|${index}`)}`;
}

function normalizedId(value, fallback) {
    return normalizedBoundedText(value, 128) || fallback;
}

function uniqueById(items, normalizeItem) {
    const seen = new Set();
    const results = [];
    items.forEach((item, index) => {
        const normalized = normalizeItem(item, index);
        if (!normalized || seen.has(normalized.id)) return;
        seen.add(normalized.id);
        results.push(normalized);
    });
    return results;
}

function normalizeLegacyNameRule(value, index) {
    const kind = RULE_KINDS.has(value?.kind) ? value.kind : 'template';
    const maximum = kind === 'regex' ? USER_REGEX_MAX_LENGTH : LIMITS.pattern;
    return {
        id: normalizedId(value?.id, `name-rule:${index}`),
        enabled: value?.enabled !== false,
        kind,
        pattern: boundedText(value?.pattern, maximum).trim(),
        fixedGroup: normalizedBoundedText(value?.fixedGroup) || null,
        fixedOption: normalizedBoundedText(value?.fixedOption) || null,
        mode: normalizeMode(value?.mode),
        categories: normalizeCategories(value?.categories),
        target: TARGETS.has(value?.target) ? value.target : 'configured',
        groupDefinitionId: normalizedBoundedText(value?.groupDefinitionId, 128) || null,
    };
}

function normalizeLegacyManualAssignment(value, index) {
    const identity = value?.sourceIdentity ?? {};
    return {
        id: normalizedId(value?.id, `manual:${index}`),
        sourceIdentifier: normalizedBoundedText(
            value?.sourceIdentifier ?? identity.identifier,
            LIMITS.identifier,
        ) || null,
        sourceFingerprint: normalizedBoundedText(
            value?.sourceFingerprint ?? identity.fingerprint,
            LIMITS.identifier,
        ) || null,
        sourceId: normalizedBoundedText(
            value?.sourceId ?? identity.sourceId,
            LIMITS.identifier,
        ) || null,
        sourceLabel: normalizedBoundedText(
            value?.sourceLabel ?? identity.label,
            LIMITS.label,
        ) || null,
        group: normalizedBoundedText(value?.group),
        option: normalizedBoundedText(value?.option) || null,
        mode: normalizeMode(value?.mode),
        categories: normalizeCategories(value?.categories),
        groupDefinitionId: normalizedBoundedText(value?.groupDefinitionId, 128) || null,
    };
}

function legacyGlobalProfile(rawNameRules, rawManualAssignments) {
    const nameRules = (Array.isArray(rawNameRules) ? rawNameRules : [])
        .slice(0, LIMITS.matchers)
        .map(normalizeLegacyNameRule);
    const manualAssignments = (Array.isArray(rawManualAssignments) ? rawManualAssignments : [])
        .slice(0, LIMITS.manualAssignments)
        .map(normalizeLegacyManualAssignment);
    const definitions = new Map();

    const ensureDefinition = (requestedId, mode, categories, label, seed) => {
        const baseId = normalizedId(
            requestedId,
            stableGeneratedId('group', seed),
        );
        const existing = definitions.get(baseId);
        if (existing) return existing;
        const definition = {
            id: baseId,
            label: normalizedBoundedText(label) || baseId,
            mode: normalizeMode(mode),
            categories: normalizeCategories(categories),
        };
        definitions.set(baseId, definition);
        return definition;
    };

    const behaviorSeed = (mode, categories) => (
        `legacy-behavior|${normalizeMode(mode)}|${normalizeCategories(categories).join(',')}`
    );

    const matchers = nameRules.map((rule, index) => {
        const definition = ensureDefinition(
            rule.groupDefinitionId,
            rule.mode,
            rule.categories,
            rule.fixedGroup || '레거시 이름 규칙',
            behaviorSeed(rule.mode, rule.categories),
        );
        return {
            id: rule.id,
            enabled: rule.enabled,
            groupDefinitionId: definition.id,
            kind: rule.kind,
            pattern: rule.pattern,
            fixedGroup: rule.fixedGroup,
            fixedOption: rule.fixedOption,
            target: rule.target,
            order: index,
        };
    });

    const assignments = manualAssignments
        .filter((assignment) => assignment.group && (
            assignment.sourceIdentifier
            || assignment.sourceFingerprint
            || assignment.sourceId
            || assignment.sourceLabel
        ))
        .map((assignment) => {
            const definition = ensureDefinition(
                assignment.groupDefinitionId,
                assignment.mode,
                assignment.categories,
                assignment.group,
                behaviorSeed(assignment.mode, assignment.categories),
            );
            return {
                id: assignment.id,
                groupDefinitionId: definition.id,
                group: assignment.group,
                option: assignment.option,
                sourceIdentity: {
                    identifier: assignment.sourceIdentifier,
                    fingerprint: assignment.sourceFingerprint,
                    sourceId: assignment.sourceId,
                    label: assignment.sourceLabel,
                },
            };
        });

    return {
        id: 'global',
        label: '전역',
        enabled: true,
        priority: 0,
        scope: { kind: 'global', key: null },
        groupDefinitions: [...definitions.values()],
        matchers,
        manualAssignments: assignments,
    };
}

function normalizeGroupDefinition(value, index) {
    return {
        id: normalizedId(value?.id, `group:${index}`),
        label: normalizedBoundedText(value?.label ?? value?.name)
            || `그룹 ${index + 1}`,
        mode: normalizeMode(value?.mode),
        categories: normalizeCategories(value?.categories),
    };
}

function normalizeMatcher(value, index, groupIds) {
    const kind = RULE_KINDS.has(value?.kind) ? value.kind : 'template';
    const maximum = kind === 'regex' ? USER_REGEX_MAX_LENGTH : LIMITS.pattern;
    const groupDefinitionId = normalizedBoundedText(
        value?.groupDefinitionId ?? value?.groupId,
        128,
    );
    if (!groupDefinitionId || !groupIds.has(groupDefinitionId)) return null;
    return {
        id: normalizedId(value?.id, `matcher:${index}`),
        enabled: value?.enabled !== false,
        groupDefinitionId,
        kind,
        pattern: boundedText(value?.pattern, maximum).trim(),
        fixedGroup: normalizedBoundedText(value?.fixedGroup) || null,
        fixedOption: normalizedBoundedText(value?.fixedOption) || null,
        target: TARGETS.has(value?.target) ? value.target : 'configured',
        order: finiteInteger(value?.order, index),
    };
}

function normalizeSourceIdentity(value = {}) {
    return {
        identifier: normalizedBoundedText(value?.identifier, LIMITS.identifier) || null,
        fingerprint: normalizedBoundedText(value?.fingerprint, LIMITS.identifier) || null,
        sourceId: normalizedBoundedText(value?.sourceId, LIMITS.identifier) || null,
        label: normalizedBoundedText(value?.label, LIMITS.label) || null,
    };
}

function normalizeManualAssignment(value, index, groupIds) {
    const groupDefinitionId = normalizedBoundedText(
        value?.groupDefinitionId ?? value?.groupId,
        128,
    );
    if (!groupDefinitionId || !groupIds.has(groupDefinitionId)) return null;
    const sourceIdentity = normalizeSourceIdentity({
        ...(value?.sourceIdentity ?? {}),
        identifier: value?.sourceIdentifier ?? value?.sourceIdentity?.identifier,
        fingerprint: value?.sourceFingerprint ?? value?.sourceIdentity?.fingerprint,
        sourceId: value?.sourceId ?? value?.sourceIdentity?.sourceId,
        label: value?.sourceLabel ?? value?.sourceIdentity?.label,
    });
    const group = normalizedBoundedText(value?.group);
    if (!group || !Object.values(sourceIdentity).some(Boolean)) return null;
    return {
        id: normalizedId(value?.id, `manual:${index}`),
        groupDefinitionId,
        group,
        option: normalizedBoundedText(value?.option) || null,
        sourceIdentity,
    };
}

function normalizeProfile(value, index) {
    const scopeKind = PROFILE_SCOPES.has(value?.scope?.kind)
        ? value.scope.kind
        : index === 0
            ? 'global'
            : null;
    if (!scopeKind) return null;
    const scopeKey = scopeKind === 'global'
        ? null
        : canonicalScalar(
            normalizedBoundedText(value?.scope?.key, LIMITS.identifier),
        ) || null;
    if (scopeKind !== 'global' && !scopeKey) return null;

    const groupDefinitions = uniqueById(
        (Array.isArray(value?.groupDefinitions)
            ? value.groupDefinitions
            : Array.isArray(value?.groups)
                ? value.groups
                : []).slice(0, LIMITS.groupDefinitions),
        normalizeGroupDefinition,
    );
    const groupIds = new Set(groupDefinitions.map(({ id }) => id));
    const matchers = uniqueById(
        (Array.isArray(value?.matchers)
            ? value.matchers
            : Array.isArray(value?.nameMatchers)
                ? value.nameMatchers
                : []).slice(0, LIMITS.matchers),
        (matcher, matcherIndex) => normalizeMatcher(matcher, matcherIndex, groupIds),
    );
    const manualAssignments = uniqueById(
        (Array.isArray(value?.manualAssignments)
            ? value.manualAssignments
            : Array.isArray(value?.assignments)
                ? value.assignments
                : []).slice(0, LIMITS.manualAssignments),
        (assignment, assignmentIndex) => normalizeManualAssignment(
            assignment,
            assignmentIndex,
            groupIds,
        ),
    );

    return {
        id: normalizedId(value?.id, `${scopeKind}:${index}`),
        label: normalizedBoundedText(value?.label ?? value?.name)
            || (scopeKind === 'global' ? '전역' : scopeKey),
        enabled: value?.enabled !== false,
        priority: finiteInteger(value?.priority, 0),
        scope: { kind: scopeKind, key: scopeKey },
        groupDefinitions,
        matchers,
        manualAssignments,
    };
}

function normalizeV2(value) {
    let profiles = uniqueById(
        (Array.isArray(value?.profiles) ? value.profiles : [])
            .slice(0, LIMITS.profiles),
        normalizeProfile,
    );
    if (!profiles.some(({ scope }) => scope.kind === 'global')) {
        profiles = [normalizeProfile(DEFAULT_GLOBAL_PROFILE, 0), ...profiles]
            .slice(0, LIMITS.profiles);
    }
    let groupBudget = LIMITS.groupDefinitionsTotal;
    let matcherBudget = LIMITS.matchersTotal;
    let assignmentBudget = LIMITS.manualAssignmentsTotal;
    profiles = profiles.map((profile) => {
        const groupDefinitions = profile.groupDefinitions.slice(0, groupBudget);
        groupBudget -= groupDefinitions.length;
        const groupIds = new Set(groupDefinitions.map(({ id }) => id));
        const matchers = profile.matchers
            .filter(({ groupDefinitionId }) => groupIds.has(groupDefinitionId))
            .slice(0, matcherBudget);
        matcherBudget -= matchers.length;
        const manualAssignments = profile.manualAssignments
            .filter(({ groupDefinitionId }) => groupIds.has(groupDefinitionId))
            .slice(0, assignmentBudget);
        assignmentBudget -= manualAssignments.length;
        return {
            ...profile,
            groupDefinitions,
            matchers,
            manualAssignments,
        };
    });
    return { version: 2, profiles };
}

function groupById(profile) {
    return new Map(profile.groupDefinitions.map((group) => [group.id, group]));
}

function projectLegacyNameRules(profile) {
    if (!profile) return [];
    const groups = groupById(profile);
    return profile.matchers.map((matcher) => {
        const group = groups.get(matcher.groupDefinitionId);
        return {
            id: matcher.id,
            enabled: matcher.enabled,
            kind: matcher.kind,
            pattern: matcher.pattern,
            fixedGroup: matcher.fixedGroup,
            fixedOption: matcher.fixedOption,
            mode: group?.mode ?? 'alternative',
            categories: group?.categories ?? ['*'],
            target: matcher.target,
            groupDefinitionId: matcher.groupDefinitionId,
        };
    });
}

function projectLegacyManualAssignments(profile) {
    if (!profile) return [];
    const groups = groupById(profile);
    return profile.manualAssignments.map((assignment) => {
        const group = groups.get(assignment.groupDefinitionId);
        return {
            id: assignment.id,
            sourceIdentifier: assignment.sourceIdentity.identifier,
            sourceFingerprint: assignment.sourceIdentity.fingerprint,
            sourceId: assignment.sourceIdentity.sourceId,
            sourceLabel: assignment.sourceIdentity.label,
            group: assignment.group,
            option: assignment.option,
            mode: group?.mode ?? 'alternative',
            categories: group?.categories ?? ['*'],
            groupDefinitionId: assignment.groupDefinitionId,
        };
    });
}

function attachLegacyAliases(settings) {
    const globalProfile = settings.profiles.find(({ scope }) => scope.kind === 'global');
    Object.defineProperties(settings, {
        nameRules: {
            configurable: true,
            enumerable: false,
            value: projectLegacyNameRules(globalProfile),
        },
        manualAssignments: {
            configurable: true,
            enumerable: false,
            value: projectLegacyManualAssignments(globalProfile),
        },
    });
    return settings;
}

function migrateV1(value = {}) {
    return {
        version: 2,
        profiles: [legacyGlobalProfile(value?.nameRules, value?.manualAssignments)],
    };
}

export function normalizeComparisonPolicySettings(value = {}) {
    if (value?.version !== 2 || !Array.isArray(value?.profiles)) {
        return attachLegacyAliases(normalizeV2(migrateV1(value)));
    }

    let normalized = normalizeV2(value);
    const hasLegacyRuleOverride = Object.prototype.propertyIsEnumerable.call(
        value,
        'nameRules',
    );
    const hasLegacyManualOverride = Object.prototype.propertyIsEnumerable.call(
        value,
        'manualAssignments',
    );
    if (hasLegacyRuleOverride || hasLegacyManualOverride) {
        const globalProfile = normalized.profiles.find(
            ({ scope }) => scope.kind === 'global',
        );
        const legacyProfile = legacyGlobalProfile(
            hasLegacyRuleOverride
                ? value.nameRules
                : projectLegacyNameRules(globalProfile),
            hasLegacyManualOverride
                ? value.manualAssignments
                : projectLegacyManualAssignments(globalProfile),
        );
        normalized = {
            ...normalized,
            profiles: normalized.profiles.map((profile) => (
                profile.scope.kind === 'global' ? legacyProfile : profile
            )),
        };
    }
    return attachLegacyAliases(normalized);
}

export function migrateComparisonPolicySettings(value = {}) {
    return normalizeComparisonPolicySettings(value);
}

function isConfiguredPromptSource(source) {
    const metadata = source?.metadata ?? {};
    return metadata.sourceKind === 'configuredPrompt'
        || Object.prototype.hasOwnProperty.call(metadata, 'configuredEnabled')
        || Object.prototype.hasOwnProperty.call(metadata, 'enabled')
        || Boolean(metadata.identifier);
}

function sourceName(source) {
    return normalizedText(boundedText(source?.metadata?.name, LIMITS.sourceName))
        || normalizedText(boundedText(source?.label, LIMITS.sourceName))
        || normalizedText(boundedText(source?.metadata?.identifier, LIMITS.sourceName))
        || normalizedText(boundedText(source?.id, LIMITS.sourceName));
}

function rawSourceIdentity(source) {
    return {
        identifier: normalizedBoundedText(
            source?.metadata?.identifier,
            LIMITS.identifier,
        ) || null,
        fingerprint: sourceFingerprint(source),
        sourceId: normalizedBoundedText(source?.id, LIMITS.identifier) || null,
        label: sourceName(source) || null,
    };
}

export function sourceFingerprint(source) {
    const metadata = source?.metadata ?? {};
    const identifier = canonicalValue(metadata.identifier);
    if (identifier) {
        return `source-v1:id:${stableHash(identifier)}`;
    }
    const canonical = [
        canonicalValue(source?.type || 'unknown'),
        canonicalValue(metadata.sourceKind),
        canonicalValue(source?.labelKey),
        canonicalValue(metadata.name || source?.label),
        canonicalValue(metadata.role),
        canonicalScalar(metadata.position ?? source?.position),
        canonicalScalar(metadata.depth ?? source?.depth),
    ].join('|');
    return `source-v1:${stableHash(canonical)}`;
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function templateToRegex(template, hasFixedGroup) {
    const groupCount = template.split('{group}').length - 1;
    const optionCount = template.split('{option}').length - 1;
    if (
        (!hasFixedGroup && groupCount !== 1)
        || groupCount > 1
        || optionCount !== 1
    ) {
        return null;
    }

    const tokenPattern = /(\{group\}|\{option\})/gu;
    let cursor = 0;
    let pattern = '^\\s*';
    for (const match of template.matchAll(tokenPattern)) {
        const literal = template.slice(cursor, match.index);
        pattern += escapeRegex(literal).replace(/\s+/gu, '\\s*');
        pattern += match[0] === '{group}'
            ? '(?<group>.+?)'
            : '(?<option>.+?)';
        cursor = match.index + match[0].length;
    }
    pattern += escapeRegex(template.slice(cursor)).replace(/\s+/gu, '\\s*');
    pattern += '\\s*$';
    return new RegExp(pattern, 'iu');
}

function compileMatcher(matcher) {
    if (!matcher.pattern) {
        return { error: 'empty-pattern', regex: null };
    }
    try {
        if (matcher.kind === 'regex') {
            const validation = validateUserRegex(matcher.pattern);
            if (!validation.ok) {
                return { error: validation.code, regex: null };
            }
            return { error: null, regex: compileUserRegex(matcher.pattern, 'iu') };
        }
        const regex = templateToRegex(matcher.pattern, Boolean(matcher.fixedGroup));
        return regex
            ? { error: null, regex }
            : { error: 'invalid-template', regex: null };
    } catch {
        return { error: 'invalid-regex', regex: null };
    }
}

function sourceCanBeNamed(source, target) {
    if (POLICY_EXCLUDED_SOURCE_TYPES.has(source?.type)) return false;
    return target !== 'configured' || isConfiguredPromptSource(source);
}

function matcherResult(matcher, source, compiled = compileMatcher(matcher)) {
    if (!matcher.enabled || !sourceCanBeNamed(source, matcher.target)) return null;
    if (!compiled.regex) return null;
    compiled.regex.lastIndex = 0;
    const match = compiled.regex.exec(
        sourceName(source).slice(0, LIMITS.sourceName),
    );
    if (!match) return null;

    const captures = match.groups ?? {};
    const group = normalizedBoundedText(
        matcher.fixedGroup || captures.group || match[1],
    );
    const option = normalizedBoundedText(
        matcher.fixedOption
        || captures.option
        || match[matcher.fixedGroup ? 1 : 2],
    );
    if (!group || !option) return null;
    return { group, option };
}

function scopeEntry(value, fallbackLabel = null) {
    if (value == null) return null;
    if (typeof value === 'object') {
        const key = normalizedBoundedText(
            value.key ?? value.id ?? value.identifier ?? value.name,
            LIMITS.identifier,
        );
        if (!key) return null;
        return {
            key,
            label: normalizedBoundedText(value.label ?? value.name) || fallbackLabel || key,
        };
    }
    const key = normalizedBoundedText(String(value), LIMITS.identifier);
    return key ? { key, label: fallbackLabel || key } : null;
}

function presetFallback(value) {
    if (value == null) return null;
    if (typeof value !== 'object') return scopeEntry(value);
    return scopeEntry(
        value.id
        ?? value.identifier
        ?? value.key
        ?? value.name
        ?? value.presetName,
        normalizedBoundedText(value.name ?? value.presetName) || null,
    );
}

function fingerprintedScopeEntry(kind, value, fallbackLabel = null) {
    const entry = scopeEntry(value, fallbackLabel);
    if (!entry) return null;
    return {
        ...entry,
        key: /^scope-v1:/u.test(entry.key)
            ? entry.key
            : scopeFingerprint(kind, entry.key),
    };
}

export function resolveComparisonPolicyContext(input = {}) {
    const wrapper = input ?? {};
    const snapshot = wrapper.snapshot ?? wrapper.context ?? wrapper;
    const provided = wrapper.profileContext
        ?? snapshot?.profileContext
        ?? {};
    const fromProfileContext = (kind) => scopeEntry(provided?.[kind]);
    return {
        global: fromProfileContext('global') ?? { key: '*', label: '전체' },
        preset: fromProfileContext('preset')
            ?? fingerprintedScopeEntry('preset', wrapper.presetKey)
            ?? (() => {
                const fallback = presetFallback(snapshot?.preset);
                return fingerprintedScopeEntry(
                    'preset',
                    fallback?.key,
                    fallback?.label,
                );
            })(),
        character: fromProfileContext('character')
            ?? fingerprintedScopeEntry('character', wrapper.characterKey)
            ?? fingerprintedScopeEntry(
                'character',
                snapshot?.characterKey ?? snapshot?.characterId,
            ),
        chat: fromProfileContext('chat')
            ?? fingerprintedScopeEntry('chat', wrapper.chatKey)
            ?? fingerprintedScopeEntry('chat', snapshot?.chatId),
    };
}

function applicableProfiles(settings, rawContext) {
    const context = resolveComparisonPolicyContext(rawContext);
    return settings.profiles
        .map((profile, index) => ({ profile, index }))
        .filter(({ profile }) => {
            if (!profile.enabled) return false;
            if (profile.scope.kind === 'global') return true;
            const active = context[profile.scope.kind];
            return Boolean(
                active?.key
                && comparisonScopeKeyEquals(active.key, profile.scope.key),
            );
        })
        .sort((left, right) => (
            PROFILE_PRECEDENCE[right.profile.scope.kind]
                - PROFILE_PRECEDENCE[left.profile.scope.kind]
            || right.profile.priority - left.profile.priority
            || left.index - right.index
        ))
        .map(({ profile }) => ({
            ...profile,
            precedence: PROFILE_PRECEDENCE[profile.scope.kind],
            context: context[profile.scope.kind],
        }));
}

function policyFromParts(profile, definition, values, origin) {
    const group = values.group;
    return {
        group,
        groupKey: canonicalGroup(group),
        groupInstanceKey: `${profile.id}:${definition.id}:${canonicalGroup(group)}`,
        option: values.option,
        mode: definition.mode,
        categories: definition.categories,
        origin: origin.kind,
        ruleId: origin.id,
        matcherId: origin.kind === 'rule' ? origin.id : null,
        assignmentId: origin.kind === 'manual' ? origin.id : null,
        groupDefinitionId: definition.id,
        profileId: profile.id,
        profileLabel: profile.label,
        profileScope: profile.scope.kind,
        precedence: profile.precedence,
        trace: {
            status: 'matched',
            profileId: profile.id,
            profileLabel: profile.label,
            profileScope: profile.scope.kind,
            profileKey: profile.scope.key,
            precedence: profile.precedence,
            priority: profile.priority,
            origin: origin.kind,
            originId: origin.id,
            groupDefinitionId: definition.id,
            sourceMatch: origin.sourceMatch ?? null,
        },
    };
}

function fingerprintCounts(sources) {
    const counts = new Map();
    for (const source of sources) {
        const fingerprint = sourceFingerprint(source);
        counts.set(fingerprint, (counts.get(fingerprint) ?? 0) + 1);
    }
    return counts;
}

function findManualAssignment(assignments, source, counts) {
    const identity = rawSourceIdentity(source);
    const identifierMatch = identity.identifier
        ? assignments.find(({ sourceIdentity: candidate }) => (
            candidate.identifier === identity.identifier
        ))
        : null;
    if (identifierMatch) {
        return {
            assignment: identifierMatch,
            sourceMatch: 'identifier',
            ambiguity: null,
        };
    }

    const fingerprintCandidates = assignments.filter(({ sourceIdentity: candidate }) => (
        !candidate.identifier
        && candidate.fingerprint
        && candidate.fingerprint === identity.fingerprint
    ));
    if (fingerprintCandidates.length > 0 && counts.get(identity.fingerprint) === 1) {
        return {
            assignment: fingerprintCandidates[0],
            sourceMatch: 'fingerprint',
            ambiguity: null,
        };
    }
    const ambiguity = fingerprintCandidates.length > 0
        ? {
            status: 'ambiguous-fingerprint',
            fingerprint: identity.fingerprint,
            count: counts.get(identity.fingerprint) ?? 0,
        }
        : null;

    const sourceIdMatch = identity.sourceId
        ? assignments.find(({ sourceIdentity: candidate }) => (
            !candidate.identifier
            && !candidate.fingerprint
            && candidate.sourceId === identity.sourceId
        ))
        : null;
    if (sourceIdMatch) {
        return { assignment: sourceIdMatch, sourceMatch: 'source-id', ambiguity };
    }
    const labelMatch = identity.label
        ? assignments.find(({ sourceIdentity: candidate }) => (
            !candidate.identifier
            && !candidate.fingerprint
            && !candidate.sourceId
            && candidate.label === identity.label
        ))
        : null;
    return {
        assignment: labelMatch ?? null,
        sourceMatch: labelMatch ? 'label' : null,
        ambiguity,
    };
}

function prepareProfile(profile) {
    const definitions = groupById(profile);
    return {
        ...profile,
        definitions,
        preparedMatchers: profile.matchers
            .map((matcher) => ({
                matcher,
                definition: definitions.get(matcher.groupDefinitionId),
                compiled: compileMatcher(matcher),
            }))
            .filter(({ definition }) => Boolean(definition)),
    };
}

function matchProfile(profile, source, counts) {
    const manual = findManualAssignment(profile.manualAssignments, source, counts);
    if (manual.assignment) {
        const definition = profile.definitions.get(
            manual.assignment.groupDefinitionId,
        );
        if (definition) {
            return {
                policy: policyFromParts(profile, definition, {
                    group: manual.assignment.group,
                    option: manual.assignment.option,
                }, {
                    kind: 'manual',
                    id: manual.assignment.id,
                    sourceMatch: manual.sourceMatch,
                }),
                ambiguity: manual.ambiguity,
            };
        }
    }

    for (const { matcher, definition, compiled } of profile.preparedMatchers) {
        const values = matcherResult(matcher, source, compiled);
        if (!values) continue;
        return {
            policy: policyFromParts(profile, definition, values, {
                kind: 'rule',
                id: matcher.id,
                sourceMatch: 'name',
            }),
            ambiguity: manual.ambiguity,
        };
    }
    return { policy: null, ambiguity: manual.ambiguity };
}

function annotateSources(sources, rawSettings, rawContext) {
    const settings = normalizeComparisonPolicySettings(rawSettings);
    const preparedProfiles = applicableProfiles(settings, rawContext).map(prepareProfile);
    const counts = fingerprintCounts(sources);
    return sources.map((source) => {
        let policy = null;
        let ambiguity = null;
        for (const profile of preparedProfiles) {
            const result = matchProfile(profile, source, counts);
            ambiguity ??= result.ambiguity;
            if (!result.policy) continue;
            policy = result.policy;
            break;
        }
        if (policy && ambiguity) {
            policy.trace.warnings = [ambiguity];
        }
        const metadata = { ...(source?.metadata ?? {}) };
        delete metadata.comparisonPolicy;
        delete metadata.comparisonPolicyTrace;
        if (policy) metadata.comparisonPolicy = policy;
        const trace = policy?.trace ?? ambiguity ?? {
            status: 'unmatched',
            profileIds: preparedProfiles.map(({ id }) => id),
        };
        metadata.comparisonPolicyTrace = trace;
        return {
            ...source,
            metadata,
            comparisonPolicy: policy,
            comparisonPolicyTrace: trace,
        };
    });
}

export function annotateSourceWithPolicy(source, rawSettings = {}, rawContext = {}) {
    return annotateSources([source], rawSettings, rawContext)[0];
}

export function annotateSourcesWithPolicies(
    sources,
    rawSettings = {},
    rawContext = {},
) {
    return annotateSources(
        Array.isArray(sources) ? sources : [],
        rawSettings,
        rawContext,
    );
}

export function sourceEligibility(source) {
    if (!source || !normalizedText(source.content)) {
        return { eligible: false, reason: 'empty' };
    }
    if (source.type === 'final' || source.type === 'chat_history') {
        return { eligible: false, reason: `source-type:${source.type}` };
    }
    if (
        source.enabled === false
        || source.metadata?.enabled === false
        || source.configuredEnabled === false
        || source.metadata?.configuredEnabled === false
    ) {
        return { eligible: false, reason: 'configured-disabled' };
    }
    if (source.included === false) {
        return { eligible: false, reason: 'not-in-request' };
    }
    return { eligible: true, reason: null };
}

export function sourceIsEligible(source) {
    return sourceEligibility(source).eligible;
}

function categoryApplies(policy, category) {
    if (!policy) return false;
    const categories = Array.isArray(policy.categories) ? policy.categories : ['*'];
    return categories.includes('*') || categories.includes(category);
}

function policyGroupIdentity(policy) {
    return policy?.groupInstanceKey ?? policy?.groupKey ?? null;
}

export function compareSourcePair(left, right, category = '*') {
    if (!left || !right || left.id === right.id) {
        return { compare: true, reason: null, category };
    }
    const leftPolicy = left.comparisonPolicy ?? left.metadata?.comparisonPolicy ?? null;
    const rightPolicy = right.comparisonPolicy ?? right.metadata?.comparisonPolicy ?? null;
    if (
        !policyGroupIdentity(leftPolicy)
        || policyGroupIdentity(leftPolicy) !== policyGroupIdentity(rightPolicy)
        || !categoryApplies(leftPolicy, category)
        || !categoryApplies(rightPolicy, category)
    ) {
        return { compare: true, reason: null, category };
    }

    const modes = new Set([leftPolicy.mode, rightPolicy.mode]);
    if (!modes.has('alternative') && !modes.has('ignore')) {
        return { compare: true, reason: null, category };
    }
    const mode = modes.has('ignore') ? 'ignore' : 'alternative';
    return {
        compare: false,
        reason: mode === 'ignore' ? 'same-ignore-group' : 'same-alternative-group',
        category,
        group: leftPolicy.group || rightPolicy.group,
        groupKey: leftPolicy.groupKey,
        groupInstanceKey: policyGroupIdentity(leftPolicy),
        mode,
        leftId: left.id,
        rightId: right.id,
        profileId: leftPolicy.profileId ?? rightPolicy.profileId ?? null,
    };
}

export function summarizeAlternativeGroups(sources) {
    const groups = new Map();
    for (const source of Array.isArray(sources) ? sources : []) {
        const policy = source.comparisonPolicy ?? source.metadata?.comparisonPolicy ?? null;
        const key = policyGroupIdentity(policy);
        if (!key) continue;
        const group = groups.get(key) ?? {
            group: policy.group,
            groupKey: policy.groupKey,
            groupInstanceKey: key,
            mode: policy.mode,
            profileId: policy.profileId ?? null,
            profileScope: policy.profileScope ?? null,
            precedence: policy.precedence ?? null,
            sourceIds: [],
            options: [],
            activeSourceIds: [],
            activeOptions: [],
        };
        if (policy.mode === 'ignore' || group.mode === 'ignore') {
            group.mode = 'ignore';
        } else if (policy.mode === 'alternative' || group.mode === 'alternative') {
            group.mode = 'alternative';
        }
        group.sourceIds.push(source.id);
        if (policy.option) group.options.push(policy.option);
        if (sourceIsEligible(source)) {
            group.activeSourceIds.push(source.id);
            if (policy.option) group.activeOptions.push(policy.option);
        }
        groups.set(key, group);
    }

    const summaries = [...groups.values()].map((group) => ({
        ...group,
        sourceIds: [...new Set(group.sourceIds)],
        options: [...new Set(group.options)],
        activeSourceIds: [...new Set(group.activeSourceIds)],
        activeOptions: [...new Set(group.activeOptions)],
    }));
    const warnings = summaries
        .filter((group) => (
            group.mode === 'alternative'
            && group.activeSourceIds.length > 1
            && (group.activeOptions.length > 1 || group.options.length === 0)
        ))
        .map((group) => ({
            id: `multiple-active:${stableHash(group.groupInstanceKey)}`,
            group: group.group,
            groupKey: group.groupKey,
            groupInstanceKey: group.groupInstanceKey,
            mode: group.mode,
            profileId: group.profileId,
            sourceIds: group.activeSourceIds,
            options: group.activeOptions,
            message: `대안 그룹 “${group.group}”에서 여러 옵션이 동시에 실제 요청에 포함되었습니다: ${
                group.activeOptions.join(', ') || `${group.activeSourceIds.length}개 소스`
            }`,
        }));
    return { groups: summaries, warnings };
}

export function previewNameMatcher(
    rawMatcher,
    sources,
    rawGroupDefinition = {},
    { limit = LIMITS.previewMatches } = {},
) {
    const groupDefinition = normalizeGroupDefinition({
        id: rawGroupDefinition?.id ?? rawMatcher?.groupDefinitionId ?? 'preview-group',
        label: rawGroupDefinition?.label ?? '미리보기 그룹',
        mode: rawGroupDefinition?.mode,
        categories: rawGroupDefinition?.categories,
    }, 0);
    const matcher = normalizeMatcher({
        ...rawMatcher,
        groupDefinitionId: groupDefinition.id,
    }, 0, new Set([groupDefinition.id]));
    if (!matcher) {
        return {
            error: 'missing-group-definition',
            matches: [],
            totalMatches: 0,
            truncated: false,
        };
    }
    const compiled = compileMatcher(matcher);
    if (compiled.error) {
        return {
            error: compiled.error,
            matches: [],
            totalMatches: 0,
            truncated: false,
        };
    }
    const maximum = Math.max(1, Math.min(100, finiteInteger(limit, LIMITS.previewMatches)));
    const matches = [];
    let totalMatches = 0;
    for (const source of Array.isArray(sources) ? sources : []) {
        const values = matcherResult(matcher, source, compiled);
        if (!values) continue;
        totalMatches += 1;
        if (matches.length >= maximum) continue;
        matches.push({
            sourceId: source?.id ?? null,
            sourceLabel: sourceName(source),
            group: values.group,
            option: values.option,
            mode: groupDefinition.mode,
            categories: groupDefinition.categories,
        });
    }
    return {
        error: null,
        matches,
        totalMatches,
        truncated: totalMatches > matches.length,
    };
}

export function buildBulkManualAssignments(sources, options = {}) {
    const groupDefinitionId = normalizedBoundedText(
        options.groupDefinitionId ?? options.groupId,
        128,
    );
    const group = normalizedBoundedText(options.group);
    if (!groupDefinitionId || !group) return [];
    const seen = new Set();
    const assignments = [];
    for (const source of (Array.isArray(sources) ? sources : [])
        .slice(0, LIMITS.manualAssignments)) {
        const identity = rawSourceIdentity(source);
        const identityKey = identity.identifier
            ? `identifier:${canonicalValue(identity.identifier)}`
            : `fingerprint:${identity.fingerprint}`;
        if (seen.has(identityKey)) continue;
        seen.add(identityKey);
        const requestedOption = typeof options.optionForSource === 'function'
            ? options.optionForSource(source)
            : options.option;
        const option = normalizedBoundedText(requestedOption)
            || sourceName(source)
            || null;
        assignments.push({
            id: stableGeneratedId(
                'manual',
                `${groupDefinitionId}|${identityKey}`,
                assignments.length,
            ),
            groupDefinitionId,
            group,
            option,
            sourceIdentity: identity,
            sourceIdentifier: identity.identifier,
            sourceFingerprint: identity.fingerprint,
            sourceId: identity.sourceId,
            sourceLabel: identity.label,
        });
    }
    return assignments;
}

export const createBulkManualAssignments = buildBulkManualAssignments;
export const COMPARISON_POLICY_MODES = Object.freeze([...MODES]);
export const COMPARISON_POLICY_PROFILE_SCOPES = Object.freeze([...PROFILE_SCOPES]);
export const COMPARISON_POLICY_LIMITS = LIMITS;
