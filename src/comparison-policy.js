import { compileUserRegex, validateUserRegex } from './regex-safety.js';

const MODES = new Set(['alternative', 'ignore', 'normal']);
const RULE_KINDS = new Set(['template', 'regex']);
const TARGETS = new Set(['configured', 'all']);
const RULE_SOURCE_NAME_MAX_LENGTH = 2048;

export const DEFAULT_COMPARISON_POLICY_SETTINGS = Object.freeze({
    version: 1,
    nameRules: Object.freeze([]),
    manualAssignments: Object.freeze([]),
});

function text(value, fallback = '') {
    return typeof value === 'string' ? value : fallback;
}

function normalizedText(value) {
    return text(value).normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function canonicalGroup(value) {
    return normalizedText(value).toLocaleLowerCase();
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
        .map((item) => normalizedText(item).toLocaleLowerCase())
        .filter(Boolean))];
    return categories.length > 0 ? categories : ['*'];
}

function normalizeNameRule(value, index) {
    const kind = RULE_KINDS.has(value?.kind) ? value.kind : 'template';
    return {
        id: normalizedText(value?.id) || `name-rule:${index}`,
        enabled: value?.enabled !== false,
        kind,
        pattern: text(value?.pattern).trim(),
        fixedGroup: normalizedText(value?.fixedGroup) || null,
        fixedOption: normalizedText(value?.fixedOption) || null,
        mode: normalizeMode(value?.mode),
        categories: normalizeCategories(value?.categories),
        target: TARGETS.has(value?.target) ? value.target : 'configured',
    };
}

function normalizeManualAssignment(value, index) {
    return {
        id: normalizedText(value?.id) || `manual:${index}`,
        sourceIdentifier: normalizedText(value?.sourceIdentifier) || null,
        sourceId: normalizedText(value?.sourceId) || null,
        sourceLabel: normalizedText(value?.sourceLabel) || null,
        group: normalizedText(value?.group),
        option: normalizedText(value?.option) || null,
        mode: normalizeMode(value?.mode),
        categories: normalizeCategories(value?.categories),
    };
}

export function normalizeComparisonPolicySettings(value = {}) {
    return {
        version: 1,
        nameRules: (Array.isArray(value?.nameRules) ? value.nameRules : [])
            .slice(0, 100)
            .map(normalizeNameRule),
        manualAssignments: (
            Array.isArray(value?.manualAssignments) ? value.manualAssignments : []
        )
            .slice(0, 500)
            .map(normalizeManualAssignment)
            .filter((assignment) => assignment.group && (
                assignment.sourceIdentifier
                || assignment.sourceId
                || assignment.sourceLabel
            )),
    };
}

function isConfiguredPromptSource(source) {
    const metadata = source?.metadata ?? {};
    return metadata.sourceKind === 'configuredPrompt'
        || Object.prototype.hasOwnProperty.call(metadata, 'configuredEnabled')
        || Object.prototype.hasOwnProperty.call(metadata, 'enabled')
        || Boolean(metadata.identifier);
}

function sourceName(source) {
    return normalizedText(source?.metadata?.name)
        || normalizedText(source?.label)
        || normalizedText(source?.metadata?.identifier)
        || normalizedText(source?.id);
}

function sourceIdentity(source) {
    return {
        identifier: normalizedText(source?.metadata?.identifier),
        id: normalizedText(source?.id),
        label: sourceName(source),
    };
}

function assignmentMatchesSource(assignment, source) {
    const identity = sourceIdentity(source);
    if (assignment.sourceIdentifier) {
        return assignment.sourceIdentifier === identity.identifier;
    }
    if (assignment.sourceId && assignment.sourceId === identity.id) {
        return true;
    }
    return Boolean(assignment.sourceLabel && assignment.sourceLabel === identity.label);
}

function findManualAssignment(assignments, source) {
    const identity = sourceIdentity(source);
    if (identity.identifier) {
        const identifierMatch = assignments.find((assignment) => (
            assignment.sourceIdentifier === identity.identifier
        ));
        if (identifierMatch) return matchManualAssignment(identifierMatch, source);
    }
    const fallbackMatch = assignments.find((assignment) => (
        (!assignment.sourceIdentifier || !identity.identifier)
        && assignmentMatchesSource(assignment, source)
    ));
    return fallbackMatch ? matchManualAssignment(fallbackMatch, source) : null;
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function templateToRegex(template, hasFixedGroup) {
    const groupCount = template.split('{group}').length - 1;
    const optionCount = template.split('{option}').length - 1;
    if ((!hasFixedGroup && groupCount !== 1) || groupCount > 1 || optionCount !== 1) {
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

function compileRule(rule) {
    if (!rule.pattern) {
        return { error: 'empty-pattern', regex: null };
    }
    try {
        if (rule.kind === 'regex') {
            const validation = validateUserRegex(rule.pattern);
            if (!validation.ok) {
                return { error: validation.code, regex: null };
            }
            return { error: null, regex: compileUserRegex(rule.pattern, 'iu') };
        }
        const regex = templateToRegex(rule.pattern, Boolean(rule.fixedGroup));
        return regex
            ? { error: null, regex }
            : { error: 'invalid-template', regex: null };
    } catch {
        return { error: 'invalid-regex', regex: null };
    }
}

function matchNameRule(rule, source, compiled = compileRule(rule)) {
    if (!rule.enabled) return null;
    if (source?.type === 'final' || source?.type === 'chat_history') return null;
    if (rule.target === 'configured' && !isConfiguredPromptSource(source)) return null;

    if (!compiled.regex) return null;
    const match = compiled.regex.exec(
        sourceName(source).slice(0, RULE_SOURCE_NAME_MAX_LENGTH),
    );
    if (!match) return null;

    const captures = match.groups ?? {};
    const group = normalizedText(rule.fixedGroup || captures.group || match[1]);
    const optionCaptureIndex = rule.fixedGroup ? 1 : 2;
    const option = normalizedText(
        rule.fixedOption || captures.option || match[optionCaptureIndex],
    );
    if (!group || !option) return null;

    return {
        group,
        groupKey: canonicalGroup(group),
        option,
        mode: rule.mode,
        categories: rule.categories,
        origin: 'rule',
        ruleId: rule.id,
    };
}

function prepareNameRules(rules) {
    return rules.map((rule) => ({ rule, compiled: compileRule(rule) }));
}

function findNameRule(preparedRules, source) {
    for (const { rule, compiled } of preparedRules) {
        const match = matchNameRule(rule, source, compiled);
        if (match) return match;
    }
    return null;
}

function matchManualAssignment(assignment, source) {
    if (!assignmentMatchesSource(assignment, source)) return null;
    return {
        group: assignment.group,
        groupKey: canonicalGroup(assignment.group),
        option: assignment.option,
        mode: assignment.mode,
        categories: assignment.categories,
        origin: 'manual',
        ruleId: assignment.id,
    };
}

export function annotateSourceWithPolicy(source, rawSettings = {}) {
    const settings = normalizeComparisonPolicySettings(rawSettings);
    const manual = findManualAssignment(settings.manualAssignments, source);
    const policy = manual ?? findNameRule(prepareNameRules(settings.nameRules), source);
    return {
        ...source,
        metadata: {
            ...(source?.metadata ?? {}),
            ...(policy ? { comparisonPolicy: policy } : {}),
        },
        comparisonPolicy: policy,
    };
}

export function annotateSourcesWithPolicies(sources, rawSettings = {}) {
    const settings = normalizeComparisonPolicySettings(rawSettings);
    const preparedRules = prepareNameRules(settings.nameRules);
    return (Array.isArray(sources) ? sources : []).map((source) => {
        const manual = findManualAssignment(settings.manualAssignments, source);
        const policy = manual ?? findNameRule(preparedRules, source);
        return {
            ...source,
            metadata: {
                ...(source?.metadata ?? {}),
                ...(policy ? { comparisonPolicy: policy } : {}),
            },
            comparisonPolicy: policy,
        };
    });
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

export function compareSourcePair(left, right, category = '*') {
    if (!left || !right || left.id === right.id) {
        return { compare: true, reason: null, category };
    }
    const leftPolicy = left.comparisonPolicy ?? left.metadata?.comparisonPolicy ?? null;
    const rightPolicy = right.comparisonPolicy ?? right.metadata?.comparisonPolicy ?? null;
    if (
        !leftPolicy?.groupKey
        || leftPolicy.groupKey !== rightPolicy?.groupKey
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
        mode,
        leftId: left.id,
        rightId: right.id,
    };
}

export function summarizeAlternativeGroups(sources) {
    const groups = new Map();
    for (const source of Array.isArray(sources) ? sources : []) {
        const policy = source.comparisonPolicy ?? source.metadata?.comparisonPolicy ?? null;
        if (!policy?.groupKey) continue;
        const key = policy.groupKey;
        const group = groups.get(key) ?? {
            group: policy.group,
            groupKey: key,
            mode: policy.mode,
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
            id: `multiple-active:${group.groupKey}`,
            group: group.group,
            groupKey: group.groupKey,
            mode: group.mode,
            sourceIds: group.activeSourceIds,
            options: group.activeOptions,
            message: `대안 그룹 “${group.group}”에서 여러 옵션이 동시에 실제 요청에 포함되었습니다: ${
                group.activeOptions.join(', ') || `${group.activeSourceIds.length}개 소스`
            }`,
        }));
    return { groups: summaries, warnings };
}

export const COMPARISON_POLICY_MODES = Object.freeze([...MODES]);
