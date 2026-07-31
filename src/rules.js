import {
    DEFAULT_COMPARISON_POLICY_SETTINGS,
    annotateSourcesWithPolicies,
    compareSourcePair,
    normalizeComparisonPolicySettings,
    sourceEligibility,
    summarizeAlternativeGroups,
} from './comparison-policy.js';
import { sourceDisplayLabel, t } from './i18n.js';
import { buildInstructionModel } from './instruction-atoms.js';

export const RULE_DEFINITIONS = Object.freeze([
    { id: 'context', labelKey: 'rules.setting.context' },
    { id: 'duplicates', labelKey: 'rules.setting.duplicates' },
    { id: 'language', labelKey: 'rules.setting.language' },
    { id: 'format', labelKey: 'rules.setting.format' },
    { id: 'role', labelKey: 'rules.setting.role' },
    { id: 'directives', labelKey: 'rules.setting.directives' },
    { id: 'largeSource', labelKey: 'rules.setting.largeSource' },
    { id: 'unmatched', labelKey: 'rules.setting.unmatched' },
]);

export const DEFAULT_RULE_SETTINGS = Object.freeze({
    enabled: Object.freeze(Object.fromEntries(RULE_DEFINITIONS.map(({ id }) => [id, true]))),
    contextWarning: 0.75,
    contextCritical: 0.9,
    largeSourceTokens: 1000,
    largeSourceShare: 0.4,
    minimumSentenceLength: 20,
});

function finiteNumber(value, fallback) {
    if (value === null || value === undefined || value === '') {
        return fallback;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

export function normalizeRuleSettings(value = {}) {
    const rawEnabled = value?.enabled ?? {};
    const enabled = Object.fromEntries(RULE_DEFINITIONS.map(({ id }) => [
        id,
        rawEnabled[id] == null ? DEFAULT_RULE_SETTINGS.enabled[id] : Boolean(rawEnabled[id]),
    ]));
    const contextWarning = clamp(
        finiteNumber(value?.contextWarning, DEFAULT_RULE_SETTINGS.contextWarning),
        0.1,
        0.98,
    );
    const requestedCritical = clamp(
        finiteNumber(value?.contextCritical, DEFAULT_RULE_SETTINGS.contextCritical),
        0.11,
        1,
    );
    const contextCritical = requestedCritical > contextWarning
        ? requestedCritical
        : Math.min(1, contextWarning + 0.05);

    return {
        enabled,
        contextWarning,
        contextCritical,
        largeSourceTokens: Math.round(clamp(
            finiteNumber(value?.largeSourceTokens, DEFAULT_RULE_SETTINGS.largeSourceTokens),
            1,
            1_000_000,
        )),
        largeSourceShare: clamp(
            finiteNumber(value?.largeSourceShare, DEFAULT_RULE_SETTINGS.largeSourceShare),
            0.01,
            1,
        ),
        minimumSentenceLength: Math.round(clamp(
            finiteNumber(value?.minimumSentenceLength, DEFAULT_RULE_SETTINGS.minimumSentenceLength),
            5,
            500,
        )),
    };
}

function finding(ruleId, id, severity, titleKey, messageKey, variables = {}, details = {}) {
    return {
        ruleId,
        id,
        severity,
        title: t(titleKey, variables),
        message: t(messageKey, variables),
        evidence: details.evidence ?? null,
        sourceIds: details.sourceIds ?? [],
        finalRanges: details.finalRanges ?? [],
        method: details.method ?? 'source-static',
        confidence: details.confidence ?? 'medium',
        determination: details.determination ?? null,
        atomIds: details.atomIds ?? [],
        relationId: details.relationId ?? null,
        clusterId: details.clusterId ?? null,
        evidenceRecords: details.evidenceRecords ?? [],
    };
}

function normalizeSentence(sentence) {
    return sentence
        .toLocaleLowerCase()
        .replace(/[`*_>#()[\]{}]/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
}

function getSentences(source, minimumLength) {
    return source.content
        .split(/(?<=[.!?。！？])\s+|\n+/u)
        .map((sentence) => ({
            original: sentence.trim(),
            normalized: normalizeSentence(sentence),
        }))
        .filter((sentence) => sentence.normalized.length >= minimumLength);
}

function validRanges(source) {
    return (source?.ranges ?? [])
        .map(({ start, end }) => ({ start: Number(start), end: Number(end) }))
        .filter(({ start, end }) => Number.isFinite(start) && Number.isFinite(end) && end > start);
}

function sourceRanges(sources, sourceIds) {
    const selected = new Set(sourceIds);
    return sources
        .filter((source) => selected.has(source.id))
        .flatMap(validRanges);
}

function suppressionCollector() {
    const records = [];
    const keys = new Set();
    return {
        records,
        compare(left, right, category) {
            if (left.id === right.id) return true;
            const decision = compareSourcePair(left, right, category);
            if (decision.compare) return true;
            const sourceIds = [left.id, right.id].sort();
            const key = `${category}:${decision.groupKey}:${sourceIds.join(':')}`;
            if (!keys.has(key)) {
                keys.add(key);
                records.push({
                    leftId: left.id,
                    rightId: right.id,
                    sourceIds: [left.id, right.id],
                    category,
                    group: decision.group,
                    groupKey: decision.groupKey,
                    mode: decision.mode,
                    reason: decision.reason,
                });
            }
            return false;
        },
    };
}

function shadowedUnmatchedSources(sources) {
    const exactContents = new Set(sources
        .filter((source) => source.attribution !== 'unmatched')
        .map((source) => source.content?.trim())
        .filter(Boolean));
    return sources.filter((source) => (
        source.attribution === 'unmatched'
        && exactContents.has(source.content?.trim())
    ));
}

function analyzeDuplicates(sources, minimumLength, collector) {
    const occurrences = new Map();
    for (const source of sources) {
        for (const sentence of getSentences(source, minimumLength)) {
            const list = occurrences.get(sentence.normalized) ?? [];
            list.push({ source, original: sentence.original });
            occurrences.set(sentence.normalized, list);
        }
    }

    const results = [];
    for (const [normalized, items] of occurrences) {
        const uniqueSources = [...new Map(items.map((item) => [item.source.id, item.source])).values()];
        const selected = new Set();
        for (let leftIndex = 0; leftIndex < uniqueSources.length; leftIndex += 1) {
            for (
                let rightIndex = leftIndex + 1;
                rightIndex < uniqueSources.length;
                rightIndex += 1
            ) {
                const left = uniqueSources[leftIndex];
                const right = uniqueSources[rightIndex];
                if (!collector.compare(left, right, 'duplicates')) continue;
                selected.add(left);
                selected.add(right);
            }
        }

        if (selected.size > 1) {
            const sourceIds = [...selected].map(({ id }) => id);
            results.push(finding(
                'duplicates',
                `duplicate:${normalized.slice(0, 40)}`,
                'warning',
                'rules.duplicate.title',
                'rules.duplicate.message',
                { count: sourceIds.length },
                {
                    evidence: items[0].original,
                    sourceIds,
                    finalRanges: sourceRanges(sources, sourceIds),
                    confidence: 'high',
                },
            ));
            continue;
        }

        if (uniqueSources.length === 1 && items.length > 1) {
            const source = uniqueSources[0];
            results.push(finding(
                'duplicates',
                `repeated:${source.id}:${normalized.slice(0, 40)}`,
                'info',
                'rules.repeated.title',
                'rules.repeated.message',
                {
                    source: sourceDisplayLabel(source),
                    count: items.length,
                },
                {
                    evidence: items[0].original,
                    sourceIds: source.synthetic ? [] : [source.id],
                    finalRanges: validRanges(source),
                    confidence: 'high',
                },
            ));
        }
    }
    return results.slice(0, 30);
}

function sortFindings(findings) {
    const order = { critical: 0, warning: 1, info: 2 };
    const determinationOrder = {
        confirmed: 0,
        candidate: 1,
        'insufficient-evidence': 2,
    };
    return findings.sort((left, right) => (
        order[left.severity] - order[right.severity]
        || (determinationOrder[left.determination] ?? 3)
            - (determinationOrder[right.determination] ?? 3)
    ));
}

function instructionFindingSeverity(relation) {
    if (relation.status === 'insufficient-evidence') return 'info';
    if (relation.category === 'language' && relation.status === 'confirmed') {
        return 'critical';
    }
    if (relation.status === 'confirmed') return 'warning';
    return relation.category === 'language' ? 'warning' : 'info';
}

function instructionFindingDefinition(relation, atoms) {
    const values = atoms
        .map(({ valueLabel, value }) => valueLabel ?? value)
        .filter(Boolean);
    if (relation.category === 'language') {
        return {
            ruleId: 'language',
            idPrefix: 'language-conflict',
            titleKey: 'rules.language.title',
            messageKey: 'rules.v3.language.message',
            variables: {
                left: values[0] ?? t('common.unknown'),
                right: values[1] ?? t('common.unknown'),
            },
        };
    }
    if (relation.category === 'format') {
        return {
            ruleId: 'format',
            idPrefix: 'format-conflict',
            titleKey: 'rules.format.title',
            messageKey: 'rules.v3.format.message',
            variables: {
                left: values[0] ?? t('common.unknown'),
                right: values[1] ?? t('common.unknown'),
            },
        };
    }
    if (relation.category === 'directives') {
        return {
            ruleId: 'directives',
            idPrefix: 'directive-conflict',
            titleKey: 'rules.directive.title',
            messageKey: 'rules.v3.directive.message',
            variables: {
                target: values[0] ?? t('common.unknown'),
            },
        };
    }
    return {
        ruleId: 'role',
        idPrefix: 'role-conflict',
        titleKey: 'rules.role.title',
        messageKey: 'rules.v3.role.message',
        variables: {
            left: values[0] ?? t('common.unknown'),
            right: values[1] ?? t('common.unknown'),
        },
    };
}

function findingsFromInstructionModel(model) {
    const atomById = new Map(model.atoms.map((atom) => [atom.id, atom]));
    const categoryIndexes = new Map();
    const results = model.relations.map((relation) => {
        const atoms = relation.atomIds
            .map((atomId) => atomById.get(atomId))
            .filter(Boolean);
        const definition = instructionFindingDefinition(relation, atoms);
        const evidence = relation.localEvidence
            .map((record) => `${record.sourceLabel}: ${record.text}`)
            .join('\n');
        const categoryIndex = categoryIndexes.get(relation.category) ?? 0;
        categoryIndexes.set(relation.category, categoryIndex + 1);
        const id = categoryIndex === 0
            ? definition.idPrefix
            : `${definition.idPrefix}:${relation.id.split(':').at(-1)}`;
        return finding(
            definition.ruleId,
            id,
            instructionFindingSeverity(relation),
            definition.titleKey,
            definition.messageKey,
            definition.variables,
            {
                evidence,
                sourceIds: relation.sourceIds,
                finalRanges: relation.finalRanges,
                method: relation.method,
                confidence: relation.confidence,
                determination: relation.status,
                atomIds: relation.atomIds,
                relationId: relation.id,
                clusterId: relation.clusterId,
                evidenceRecords: relation.localEvidence,
            },
        );
    });
    for (const alert of model.alerts) {
        results.push(finding(
            'directives',
            model.alerts.length === 1
                ? 'override-attempt'
                : `override-attempt:${alert.id.split(':').at(-1)}`,
            alert.status === 'confirmed' ? 'warning' : 'info',
            'rules.override.title',
            'rules.override.message',
            {},
            {
                evidence: alert.localEvidence
                    .map((record) => `${record.sourceLabel}: ${record.text}`)
                    .join('\n'),
                sourceIds: alert.sourceIds,
                finalRanges: alert.finalRanges,
                method: alert.method,
                confidence: alert.confidence,
                determination: alert.status,
                atomIds: alert.atomIds,
                evidenceRecords: alert.localEvidence,
            },
        ));
    }
    return results;
}

export function analyzeSnapshotDetailed(
    snapshot,
    rawSettings = DEFAULT_RULE_SETTINGS,
    rawComparisonSettings = DEFAULT_COMPARISON_POLICY_SETTINGS,
) {
    const settings = normalizeRuleSettings(rawSettings);
    const comparisonSettings = normalizeComparisonPolicySettings(rawComparisonSettings);
    const findings = [];
    const annotatedSources = annotateSourcesWithPolicies(
        snapshot?.sources ?? [],
        comparisonSettings,
    );
    const skippedSources = [];
    let eligibleSources = [];

    for (const source of annotatedSources) {
        const eligibility = sourceEligibility(source);
        if (eligibility.eligible) {
            eligibleSources.push(source);
        } else {
            skippedSources.push({
                id: source.id,
                sourceId: source.id,
                reason: eligibility.reason,
            });
        }
    }

    const shadowed = new Set(shadowedUnmatchedSources(eligibleSources).map(({ id }) => id));
    if (shadowed.size > 0) {
        eligibleSources = eligibleSources.filter((source) => {
            if (!shadowed.has(source.id)) return true;
            skippedSources.push({
                id: source.id,
                sourceId: source.id,
                reason: 'shadowed-unmatched',
            });
            return false;
        });
    }

    const finalText = snapshot?.finalText ?? '';
    const analysisSources = eligibleSources.length > 0 || !finalText.trim()
        ? eligibleSources
        : [{
            id: '__final__',
            type: 'synthetic',
            label: '최종 프롬프트',
            content: finalText,
            tokenCount: snapshot?.stats?.totalTokens ?? 0,
            attribution: 'synthetic',
            ranges: [{ start: 0, end: finalText.length }],
            synthetic: true,
    }];
    const collector = suppressionCollector();
    const activeSourceIds = new Set(eligibleSources.map(({ id }) => id));
    if (analysisSources.some(({ synthetic }) => synthetic)) {
        analysisSources
            .filter(({ synthetic }) => synthetic)
            .forEach(({ id }) => activeSourceIds.add(id));
    }
    const instructionSources = analysisSources.some(({ synthetic }) => synthetic)
        ? [...annotatedSources, ...analysisSources.filter(({ synthetic }) => synthetic)]
        : annotatedSources;
    const instructionModel = buildInstructionModel(instructionSources, {
        activeSourceIds,
        categoryEnabled: (category) => (
            category === 'priority'
                ? settings.enabled.directives
                : settings.enabled[category] !== false
        ),
        compareSources: (left, right, category) => (
            collector.compare(left, right, category)
        ),
    });
    const usage = snapshot?.stats?.contextUsage;

    if (settings.enabled.context && usage >= settings.contextCritical) {
        findings.push(finding(
            'context',
            'context-critical',
            'critical',
            'rules.contextCritical.title',
            'rules.contextCritical.message',
            { usage: (usage * 100).toFixed(1) },
            { method: 'context-metric', confidence: 'high' },
        ));
    } else if (settings.enabled.context && usage >= settings.contextWarning) {
        findings.push(finding(
            'context',
            'context-warning',
            'warning',
            'rules.contextWarning.title',
            'rules.contextWarning.message',
            { usage: (usage * 100).toFixed(1) },
            { method: 'context-metric', confidence: 'high' },
        ));
    }

    if (settings.enabled.duplicates) {
        findings.push(...analyzeDuplicates(
            analysisSources,
            settings.minimumSentenceLength,
            collector,
        ));
    }

    findings.push(...findingsFromInstructionModel({
        ...instructionModel,
        alerts: settings.enabled.directives ? instructionModel.alerts : [],
    }));

    if (settings.enabled.largeSource) {
        const totalTokens = snapshot?.stats?.totalTokens || 0;
        for (const source of eligibleSources) {
            const share = totalTokens ? source.tokenCount / totalTokens : 0;
            if (
                source.tokenCount >= settings.largeSourceTokens
                && share >= settings.largeSourceShare
            ) {
                findings.push(finding(
                    'largeSource',
                    `large-source:${source.id}`,
                    'warning',
                    'rules.largeSource.title',
                    'rules.largeSource.message',
                    {
                        source: sourceDisplayLabel(source),
                        tokens: source.tokenCount,
                        share: (share * 100).toFixed(1),
                    },
                    {
                        sourceIds: [source.id],
                        finalRanges: validRanges(source),
                        method: 'source-metric',
                        confidence: 'high',
                    },
                ));
            }
        }
    }

    if (settings.enabled.unmatched) {
        const unmatched = annotatedSources.filter((source) => (
            source.attribution === 'unmatched'
            && source.type !== 'final'
            && source.type !== 'chat_history'
            && source.enabled !== false
            && source.configuredEnabled !== false
            && source.metadata?.configuredEnabled !== false
            && source.metadata?.enabled !== false
        ));
        if (unmatched.length > 0) {
            findings.push(finding(
                'unmatched',
                'unmatched-sources',
                'info',
                'rules.unmatched.title',
                'rules.unmatched.message',
                { count: unmatched.length },
                {
                    evidence: unmatched.map((source) => sourceDisplayLabel(source)).join(', '),
                    sourceIds: unmatched.map((source) => source.id),
                    method: 'attribution',
                    confidence: 'high',
                },
            ));
        }
    }

    const groupSummarySources = annotatedSources.map((source) => (
        shadowed.has(source.id) ? { ...source, included: false } : source
    ));
    const groupSummary = summarizeAlternativeGroups(groupSummarySources);
    for (const warning of groupSummary.warnings) {
        findings.push({
            ruleId: 'comparison-policy',
            id: warning.id,
            severity: 'warning',
            title: '대안 그룹에 여러 옵션이 포함됨',
            message: warning.message,
            evidence: warning.options.join(', ') || null,
            sourceIds: warning.sourceIds,
            finalRanges: sourceRanges(annotatedSources, warning.sourceIds),
            method: 'comparison-policy',
            confidence: 'high',
        });
    }

    return {
        findings: sortFindings(findings),
        instructions: instructionModel,
        comparison: {
            suppressedComparisons: collector.records,
            skippedSources,
            groups: groupSummary.groups,
            groupWarnings: groupSummary.warnings,
        },
    };
}

export function analyzeSnapshot(
    snapshot,
    rawSettings = DEFAULT_RULE_SETTINGS,
    rawComparisonSettings = DEFAULT_COMPARISON_POLICY_SETTINGS,
) {
    return analyzeSnapshotDetailed(snapshot, rawSettings, rawComparisonSettings).findings;
}
