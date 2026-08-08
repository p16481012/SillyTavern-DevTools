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

const SUPPRESSED_COMPARISON_RECORD_LIMIT = 100;
const CHARACTER_PROFILE_FIELDS = new Set(['description', 'personality']);
const DUPLICATE_EVIDENCE_SOURCE_LIMIT = 20;
const DUPLICATE_EVIDENCE_RANGE_LIMIT = 100;

export const RULE_DEFINITIONS = Object.freeze([
    { id: 'context', labelKey: 'rules.setting.context' },
    { id: 'duplicates', labelKey: 'rules.setting.duplicates' },
    { id: 'language', labelKey: 'rules.setting.language' },
    { id: 'format', labelKey: 'rules.setting.format' },
    { id: 'tone', labelKey: 'rules.setting.tone' },
    { id: 'role', labelKey: 'rules.setting.role' },
    { id: 'identity', labelKey: 'rules.setting.identity' },
    { id: 'safety', labelKey: 'rules.setting.safety' },
    { id: 'memory', labelKey: 'rules.setting.memory' },
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
        evidenceSummary: details.evidenceSummary ?? null,
        relationKind: details.relationKind ?? null,
        applicabilityKind: details.applicabilityKind ?? null,
        relationDisposition: details.relationDisposition ?? null,
        semanticRecords: details.semanticRecords ?? [],
        suppressionSignature: details.suppressionSignature ?? null,
    };
}

function normalizeSentence(sentence) {
    return sentence
        .toLowerCase()
        .replace(/[`*_>#()[\]{}]/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
}

function getSentences(source, minimumLength) {
    const content = String(source?.content ?? '');
    const separators = /(?<=[.!?。！？])\s+|\n+/gu;
    const sentences = [];
    let cursor = 0;
    const appendSentence = (start, end) => {
        while (start < end && /\s/u.test(content[start])) start += 1;
        while (end > start && /\s/u.test(content[end - 1])) end -= 1;
        if (end <= start) return;
        const original = content.slice(start, end);
        const normalized = normalizeSentence(original);
        if (normalized.length < minimumLength) return;
        sentences.push({
            original,
            normalized,
            localRange: { start, end },
        });
    };
    for (const separator of content.matchAll(separators)) {
        appendSentence(cursor, separator.index);
        cursor = separator.index + separator[0].length;
    }
    appendSentence(cursor, content.length);
    return sentences;
}

function stableSentenceHash(value) {
    let hash = 2166136261;
    for (const character of value) {
        hash ^= character.codePointAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
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

function uniqueRanges(ranges) {
    const seen = new Set();
    return ranges
        .map(({ start, end }) => ({ start: Number(start), end: Number(end) }))
        .filter(({ start, end }) => Number.isFinite(start) && Number.isFinite(end) && end > start)
        .filter(({ start, end }) => {
            const key = `${start}:${end}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

function projectSentenceRange(source, localRange) {
    const contentLength = String(source?.content ?? '').length;
    return uniqueRanges(validRanges(source).flatMap((range) => {
        if (
            source?.attribution === 'exact'
            && contentLength > 0
            && range.end - range.start === contentLength
        ) {
            return [{
                start: Math.min(range.end, range.start + localRange.start),
                end: Math.min(range.end, range.start + localRange.end),
            }];
        }
        return [];
    }));
}

function duplicateEvidenceDetails(items, sourceIds) {
    const selected = new Set(sourceIds);
    const bySource = new Map();
    for (const item of items) {
        if (!selected.has(item.source.id)) continue;
        const list = bySource.get(item.source.id) ?? [];
        list.push(item);
        bySource.set(item.source.id, list);
    }
    const records = [];
    const finalRangeOwners = new Map();
    let mappedSourceCount = 0;
    let sharedFinalLocation = false;
    for (const [sourceIndex, sourceId] of sourceIds.entries()) {
        const occurrences = bySource.get(sourceId) ?? [];
        const first = occurrences[0];
        if (!first) continue;
        const localRanges = [];
        const localKeys = new Set();
        const finalRanges = [];
        const sourceFinalKeys = new Set();
        for (const { source, localRange } of occurrences) {
            const localKey = `${localRange.start}:${localRange.end}`;
            if (
                sourceIndex < DUPLICATE_EVIDENCE_SOURCE_LIMIT
                && localRanges.length < DUPLICATE_EVIDENCE_RANGE_LIMIT
                && !localKeys.has(localKey)
            ) {
                localKeys.add(localKey);
                localRanges.push(localRange);
            }
            for (const range of projectSentenceRange(source, localRange)) {
                const finalKey = `${range.start}:${range.end}`;
                sourceFinalKeys.add(finalKey);
                const owner = finalRangeOwners.get(finalKey);
                if (owner && owner !== sourceId) sharedFinalLocation = true;
                else if (!owner) finalRangeOwners.set(finalKey, sourceId);
                if (
                    sourceIndex < DUPLICATE_EVIDENCE_SOURCE_LIMIT
                    && finalRanges.length < DUPLICATE_EVIDENCE_RANGE_LIMIT
                    && !finalRanges.some(({ start, end }) => (
                        start === range.start && end === range.end
                    ))
                ) {
                    finalRanges.push(range);
                }
            }
        }
        if (sourceFinalKeys.size > 0) mappedSourceCount += 1;
        if (sourceIndex >= DUPLICATE_EVIDENCE_SOURCE_LIMIT) continue;
        const uniqueLocalCount = new Set(occurrences.map(
            ({ localRange }) => `${localRange.start}:${localRange.end}`,
        )).size;
        records.push({
            sourceId,
            sourceLabel: sourceDisplayLabel(first.source),
            text: first.original,
            localRange: localRanges[0] ?? null,
            localRanges,
            finalRanges,
            occurrenceCount: occurrences.length,
            locationsTruncated: uniqueLocalCount > localRanges.length
                || sourceFinalKeys.size > finalRanges.length,
            omittedLocationCount: Math.max(0, uniqueLocalCount - localRanges.length),
            omittedFinalLocationCount: Math.max(0, sourceFinalKeys.size - finalRanges.length),
        });
    }
    return {
        records,
        summary: {
            sourceCount: sourceIds.length,
            displayedSourceCount: records.length,
            omittedSourceCount: Math.max(0, sourceIds.length - records.length),
            mappedSourceCount,
            unmappedSourceCount: Math.max(0, sourceIds.length - mappedSourceCount),
            finalLocationCount: finalRangeOwners.size,
            sharedFinalLocation,
            locationsTruncated: records.some(({ locationsTruncated }) => locationsTruncated)
                || sourceIds.length > records.length,
        },
    };
}

function isCharacterProfileReference(source) {
    return source?.type === 'character'
        && CHARACTER_PROFILE_FIELDS.has(source?.metadata?.field);
}

function isPersonaProfileReference(source) {
    return source?.type === 'persona';
}

function builtInSourcePairDecision(left, right, category) {
    if (
        category === 'duplicates'
        && (
            (isCharacterProfileReference(left) && isPersonaProfileReference(right))
            || (isPersonaProfileReference(left) && isCharacterProfileReference(right))
        )
    ) {
        return {
            compare: false,
            reason: 'character-persona-reference-pair',
            category,
            group: null,
            groupKey: null,
            groupInstanceKey: null,
            profileId: null,
            mode: 'built-in',
        };
    }
    return null;
}

function suppressionCollector() {
    const records = [];
    const keys = new Set();
    return {
        records,
        get totalCount() {
            return keys.size;
        },
        get truncated() {
            return keys.size > records.length;
        },
        get omittedCount() {
            return Math.max(0, keys.size - records.length);
        },
        compare(left, right, category) {
            if (left.id === right.id) return true;
            const decision = builtInSourcePairDecision(left, right, category)
                ?? compareSourcePair(left, right, category);
            if (decision.compare) return true;
            const sourceIds = [left.id, right.id].sort();
            const key = JSON.stringify([
                category,
                decision.groupInstanceKey ?? decision.groupKey,
                ...sourceIds,
            ]);
            if (!keys.has(key)) {
                keys.add(key);
                if (records.length < SUPPRESSED_COMPARISON_RECORD_LIMIT) {
                    records.push({
                        leftId: left.id,
                        rightId: right.id,
                        sourceIds: [left.id, right.id],
                        category,
                        group: decision.group,
                        groupKey: decision.groupKey,
                        groupInstanceKey: decision.groupInstanceKey ?? null,
                        profileId: decision.profileId ?? null,
                        mode: decision.mode,
                        reason: decision.reason,
                    });
                }
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
            list.push({
                source,
                original: sentence.original,
                localRange: sentence.localRange,
            });
            occurrences.set(sentence.normalized, list);
        }
    }
    const findingIdBaseCounts = new Map();
    const findingIdBase = (normalized, items) => {
        const uniqueSourceIds = new Set(items.map(({ source }) => source.id));
        if (uniqueSourceIds.size > 1) return `duplicate:${normalized.slice(0, 40)}`;
        if (uniqueSourceIds.size === 1 && items.length > 1) {
            return `repeated:${items[0].source.id}:${normalized.slice(0, 40)}`;
        }
        return null;
    };
    for (const [normalized, items] of occurrences) {
        const base = findingIdBase(normalized, items);
        if (base) findingIdBaseCounts.set(base, (findingIdBaseCounts.get(base) ?? 0) + 1);
    }
    const stableFindingId = (base, normalized) => (
        (findingIdBaseCounts.get(base) ?? 0) > 1
            ? `${base}:${stableSentenceHash(normalized)}`
            : base
    );

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
            const evidenceDetails = duplicateEvidenceDetails(items, sourceIds);
            const evidenceRecords = evidenceDetails.records;
            const idBase = `duplicate:${normalized.slice(0, 40)}`;
            results.push(finding(
                'duplicates',
                stableFindingId(idBase, normalized),
                'warning',
                'rules.duplicate.title',
                'rules.duplicate.message',
                { count: sourceIds.length },
                {
                    evidence: items[0].original,
                    suppressionSignature: normalized,
                    sourceIds,
                    finalRanges: uniqueRanges(
                        evidenceRecords.flatMap(({ finalRanges }) => finalRanges),
                    ),
                    evidenceRecords,
                    evidenceSummary: evidenceDetails.summary,
                    confidence: 'high',
                },
            ));
            continue;
        }

        if (uniqueSources.length === 1 && items.length > 1) {
            const source = uniqueSources[0];
            const evidenceDetails = duplicateEvidenceDetails(items, [source.id]);
            const evidenceRecords = evidenceDetails.records;
            const idBase = `repeated:${source.id}:${normalized.slice(0, 40)}`;
            results.push(finding(
                'duplicates',
                stableFindingId(idBase, normalized),
                'info',
                'rules.repeated.title',
                'rules.repeated.message',
                {
                    source: sourceDisplayLabel(source),
                    count: items.length,
                },
                {
                    evidence: items[0].original,
                    suppressionSignature: normalized,
                    sourceIds: source.synthetic ? [] : [source.id],
                    finalRanges: source.synthetic
                        ? []
                        : evidenceRecords[0]?.finalRanges ?? [],
                    evidenceRecords: source.synthetic ? [] : evidenceRecords,
                    evidenceSummary: source.synthetic ? null : evidenceDetails.summary,
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

function isExplicitlyEnabledSource(source) {
    return source?.enabled === true
        || source?.configuredEnabled === true
        || source?.metadata?.enabled === true
        || source?.metadata?.configuredEnabled === true;
}

function explicitSafetyDisclosureDemand(atom) {
    return atom?.category === 'safety'
        && atom?.property === 'response.safety.secret-disclosure'
        && atom?.action === 'disclose'
        && atom?.value === 'disclosed'
        && atom?.polarity === 'require';
}

function instructionFindingSeverity(relation, atoms) {
    if (relation.status === 'insufficient-evidence') return 'info';
    if (relation.category === 'language' && relation.status === 'confirmed') {
        return 'critical';
    }
    if (
        relation.category === 'safety'
        && relation.kind === 'opposite-polarity'
        && relation.status === 'confirmed'
        && atoms.some(explicitSafetyDisclosureDemand)
    ) {
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
    const semanticDefinitions = {
        tone: {
            ruleId: 'tone',
            idPrefix: 'tone-conflict',
            titleKey: 'rules.tone.title',
            messageKey: 'rules.v3.tone.message',
        },
        role: {
            ruleId: 'role',
            idPrefix: 'role-conflict',
            titleKey: 'rules.role.title',
            messageKey: 'rules.v3.role.message',
        },
        identity: {
            ruleId: 'identity',
            idPrefix: 'identity-conflict',
            titleKey: 'rules.identity.title',
            messageKey: 'rules.v3.identity.message',
        },
        safety: {
            ruleId: 'safety',
            idPrefix: 'safety-conflict',
            titleKey: 'rules.safety.title',
            messageKey: 'rules.v3.safety.message',
        },
        memory: {
            ruleId: 'memory',
            idPrefix: 'memory-conflict',
            titleKey: 'rules.memory.title',
            messageKey: 'rules.v3.memory.message',
        },
    };
    const definition = semanticDefinitions[relation.category] ?? semanticDefinitions.role;
    return {
        ...definition,
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
            instructionFindingSeverity(relation, atoms),
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
                relationKind: relation.kind,
                applicabilityKind: relation.applicabilityKind,
                relationDisposition: relation.disposition,
                semanticRecords: atoms.map((atom) => ({
                    category: atom.category,
                    target: atom.target,
                    action: atom.action,
                    property: atom.property,
                    value: atom.value,
                    polarity: atom.polarity,
                    scope: atom.scope,
                    participantScope: atom.participantScope,
                    condition: atom.condition,
                    exception: atom.exception,
                    priority: atom.priority,
                    status: atom.status,
                })),
            },
        );
    });
    for (const alert of model.alerts) {
        const atoms = alert.atomIds
            .map((atomId) => atomById.get(atomId))
            .filter(Boolean);
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
                relationKind: 'priority-override',
                semanticRecords: atoms.map((atom) => ({
                    category: atom.category,
                    target: atom.target,
                    action: atom.action,
                    property: atom.property,
                    value: atom.value,
                    polarity: atom.polarity,
                    scope: atom.scope,
                    participantScope: atom.participantScope,
                    condition: atom.condition,
                    exception: atom.exception,
                    priority: atom.priority,
                    status: atom.status,
                })),
                suppressionSignature: alert.localEvidence
                    .map(({ text }) => text)
                    .join('\n'),
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
        snapshot,
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
            && isExplicitlyEnabledSource(source)
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
            suppressionSignature: warning.groupInstanceKey,
        });
    }

    return {
        findings: sortFindings(findings),
        instructions: instructionModel,
        comparison: {
            suppressedComparisons: collector.records,
            suppressedComparisonCount: collector.totalCount,
            suppressedComparisonsTruncated: collector.truncated,
            suppressedComparisonsOmitted: collector.omittedCount,
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
