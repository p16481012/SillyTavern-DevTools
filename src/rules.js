import {
    DEFAULT_COMPARISON_POLICY_SETTINGS,
    annotateSourcesWithPolicies,
    compareSourcePair,
    normalizeComparisonPolicySettings,
    sourceEligibility,
    summarizeAlternativeGroups,
} from './comparison-policy.js';
import { sourceDisplayLabel, t } from './i18n.js';

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

const LANGUAGE_PATTERNS = [
    ['한국어', /(?:한국어|korean)(?:로|으로| in)?[^\n.!?]{0,24}(?:답변|응답|작성|출력|respond|reply|answer|write)|(?:respond|reply|answer|write)[^\n.!?]{0,24}(?:한국어|korean)/giu],
    ['영어', /(?:영어|english)(?:로|으로| in)?[^\n.!?]{0,24}(?:답변|응답|작성|출력|respond|reply|answer|write)|(?:respond|reply|answer|write)[^\n.!?]{0,24}(?:영어|english)/giu],
    ['일본어', /(?:일본어|japanese)(?:로|으로| in)?[^\n.!?]{0,24}(?:답변|응답|작성|출력|respond|reply|answer|write)|(?:respond|reply|answer|write)[^\n.!?]{0,24}(?:일본어|japanese)/giu],
    ['중국어', /(?:중국어|chinese)(?:로|으로| in)?[^\n.!?]{0,24}(?:답변|응답|작성|출력|respond|reply|answer|write)|(?:respond|reply|answer|write)[^\n.!?]{0,24}(?:중국어|chinese)/giu],
];

const FORMAT_PATTERNS = [
    ['JSON', /\bjson\b|JSON\s*형식/giu],
    ['XML', /\bxml\b|XML\s*형식/giu],
    ['Markdown', /\bmarkdown\b|마크다운(?:으로| 형식)/giu],
    ['일반 텍스트', /\bplain\s*text\b|일반\s*텍스트|마크다운(?:을|을 절대)?\s*사용하지/giu],
];

const DIRECTIVE_PAIRS = [
    {
        label: '설명 포함 여부',
        positive: /(?:설명|해설|근거)[^\n.!?]{0,16}(?:포함(?!\s*하지)|제공(?!\s*하지))|(?<!not )(?<!do not )(?<!without )(?:include|provide)[^\n.!?]{0,20}(?:explanation|rationale)/iu,
        negative: /(?:설명|해설|근거)[^\n.!?]{0,16}(?:하지|제외|생략)|(?:no|without|do not (?:include|provide))[^\n.!?]{0,20}(?:explanation|rationale)/iu,
    },
    {
        label: '인용 포함 여부',
        positive: /(?:인용|출처)[^\n.!?]{0,16}(?:포함(?!\s*하지)|표시(?!\s*하지)|제공(?!\s*하지))|(?<!not )(?<!do not )(?<!without )(?:include|provide|add)[^\n.!?]{0,20}(?:citation|source)/iu,
        negative: /(?:인용|출처)[^\n.!?]{0,16}(?:하지|제외|생략)|(?:no|without|do not (?:include|provide|add))[^\n.!?]{0,20}(?:citation|source)/iu,
    },
    {
        label: '이모지 사용 여부',
        positive: /(?:이모지|emoji)[^\n.!?]{0,12}(?:사용(?!\s*하지)|포함(?!\s*하지))|(?<!not )(?<!do not )(?<!without )(?:use|include)[^\n.!?]{0,15}(?:emoji)/iu,
        negative: /(?:이모지|emoji)[^\n.!?]{0,12}(?:사용\s*하지|포함\s*하지|금지|제외)|(?:no|without|do not use)[^\n.!?]{0,15}(?:emoji)/iu,
    },
    {
        label: '코드 블록 사용 여부',
        positive: /(?:코드\s*블록)[^\n.!?]{0,12}(?:사용(?!\s*하지)|포함(?!\s*하지))|(?<!not )(?<!do not )(?<!without )(?:use|include)[^\n.!?]{0,18}(?:code block|fenced code)/iu,
        negative: /(?:코드\s*블록)[^\n.!?]{0,12}(?:사용\s*하지|포함\s*하지|금지|제외)|(?:no|without|do not use)[^\n.!?]{0,18}(?:code block|fenced code)/iu,
    },
];

const OVERRIDE_PATTERN = /(?:이전|앞선|위의|기존)[^\n.!?]{0,20}(?:지시|규칙|명령)[^\n.!?]{0,16}(?:무시|취소|덮어)|(?:ignore|disregard|override)[^\n.!?]{0,24}(?:previous|earlier|above|all)[^\n.!?]{0,16}(?:instruction|rule)/giu;

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

function projectLocalRange(source, start, end) {
    if (source.synthetic) {
        return [{ start, end }];
    }
    const contentLength = source.content?.length ?? 0;
    return validRanges(source).map((range) => {
        if (
            source.attribution === 'exact'
            && contentLength > 0
            && range.end - range.start === contentLength
        ) {
            return {
                start: Math.min(range.end, range.start + start),
                end: Math.min(range.end, range.start + end),
            };
        }
        return range;
    }).filter((range) => range.end > range.start);
}

function sourceIdsFromRecords(records) {
    return [...new Set(records
        .map(({ source }) => source)
        .filter((source) => !source.synthetic)
        .map(({ id }) => id))];
}

function finalRangesFromRecords(records) {
    const seen = new Set();
    return records
        .flatMap((record) => record.finalRanges ?? [])
        .filter(({ start, end }) => {
            const key = `${start}:${end}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

function detectPatternMatches(text, patterns) {
    const matches = [];
    for (const [label, pattern] of patterns) {
        pattern.lastIndex = 0;
        for (const match of text.matchAll(pattern)) {
            matches.push({
                label,
                text: match[0],
                start: match.index,
                end: match.index + match[0].length,
            });
        }
    }
    return matches;
}

function detectRoles(text) {
    const matches = [];
    const patterns = [
        /\b(?:you are|act as|role is)\s+([^.\n]{3,80})/giu,
        /(?:너는|당신은)\s+([^.\n]{3,80})(?:이다|입니다|로 행동)/gu,
        /(?:역할은|역할:)\s*([^.\n]{3,80})/gu,
    ];
    for (const pattern of patterns) {
        pattern.lastIndex = 0;
        for (const match of text.matchAll(pattern)) {
            matches.push({
                label: match[1].replace(/\s+/gu, ' ').trim().toLocaleLowerCase(),
                text: match[0],
                start: match.index,
                end: match.index + match[0].length,
            });
        }
    }
    return matches;
}

function matchRanges(text, pattern) {
    pattern.lastIndex = 0;
    return [...text.matchAll(pattern)].map((match) => ({
        text: match[0],
        start: match.index,
        end: match.index + match[0].length,
    }));
}

function matchFirst(text, pattern) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (!match) return null;
    return {
        text: match[0],
        start: match.index,
        end: match.index + match[0].length,
    };
}

function recordsForSources(sources, detector) {
    return sources.flatMap((source) => detector(source.content).map((match) => ({
        ...match,
        source,
        finalRanges: projectLocalRange(source, match.start, match.end),
    })));
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

function conflictingRecords(records, category, incompatible, collector) {
    const selected = new Set();
    for (let leftIndex = 0; leftIndex < records.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < records.length; rightIndex += 1) {
            const left = records[leftIndex];
            const right = records[rightIndex];
            if (!incompatible(left.label, right.label)) continue;
            if (!collector.compare(left.source, right.source, category)) continue;
            selected.add(left);
            selected.add(right);
        }
    }
    return [...selected];
}

function formatsConflict(left, right) {
    const pair = new Set([left, right]);
    return (pair.has('JSON') && pair.has('XML'))
        || (pair.has('Markdown') && pair.has('일반 텍스트'));
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
    return findings.sort((left, right) => order[left.severity] - order[right.severity]);
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

    if (settings.enabled.language) {
        const matches = recordsForSources(
            analysisSources,
            (text) => detectPatternMatches(text, LANGUAGE_PATTERNS),
        );
        const conflicts = conflictingRecords(
            matches,
            'language',
            (left, right) => left !== right,
            collector,
        );
        if (conflicts.length > 0) {
            const languages = [...new Set(conflicts.map(({ label }) => label))];
            findings.push(finding(
                'language',
                'language-conflict',
                'critical',
                'rules.language.title',
                'rules.language.message',
                { languages: languages.join(', ') },
                {
                    evidence: conflicts.map(({ text }) => text).join('\n'),
                    sourceIds: sourceIdsFromRecords(conflicts),
                    finalRanges: finalRangesFromRecords(conflicts),
                    confidence: 'high',
                },
            ));
        }
    }

    if (settings.enabled.format) {
        const matches = recordsForSources(
            analysisSources,
            (text) => detectPatternMatches(text, FORMAT_PATTERNS),
        );
        const conflicts = conflictingRecords(matches, 'format', formatsConflict, collector);
        if (conflicts.length > 0) {
            const formats = [...new Set(conflicts.map(({ label }) => label))];
            findings.push(finding(
                'format',
                'format-conflict',
                'warning',
                'rules.format.title',
                'rules.format.message',
                { formats: formats.join(', ') },
                {
                    evidence: conflicts.map(({ text }) => text).join('\n'),
                    sourceIds: sourceIdsFromRecords(conflicts),
                    finalRanges: finalRangesFromRecords(conflicts),
                    confidence: 'high',
                },
            ));
        }
    }

    if (settings.enabled.role) {
        const matches = recordsForSources(analysisSources, detectRoles);
        const conflicts = conflictingRecords(
            matches,
            'role',
            (left, right) => left !== right,
            collector,
        ).slice(0, 10);
        if (conflicts.length > 0) {
            findings.push(finding(
                'role',
                'role-conflict',
                'info',
                'rules.role.title',
                'rules.role.message',
                { count: new Set(conflicts.map(({ label }) => label)).size },
                {
                    evidence: conflicts.map(({ text }) => text).join('\n'),
                    sourceIds: sourceIdsFromRecords(conflicts),
                    finalRanges: finalRangesFromRecords(conflicts),
                    confidence: 'medium',
                },
            ));
        }
    }

    if (settings.enabled.directives) {
        const directiveLabels = [];
        const directiveMatches = new Set();
        for (const pair of DIRECTIVE_PAIRS) {
            const positives = recordsForSources(analysisSources, (text) => {
                const match = matchFirst(text, pair.positive);
                return match ? [{ ...match, label: 'positive' }] : [];
            });
            const negatives = recordsForSources(analysisSources, (text) => {
                const match = matchFirst(text, pair.negative);
                return match ? [{ ...match, label: 'negative' }] : [];
            });
            let pairConflict = false;
            for (const positive of positives) {
                for (const negative of negatives) {
                    if (!collector.compare(positive.source, negative.source, 'directives')) continue;
                    pairConflict = true;
                    directiveMatches.add(positive);
                    directiveMatches.add(negative);
                }
            }
            if (pairConflict) directiveLabels.push(pair.label);
        }

        const conflicts = [...directiveMatches];
        if (conflicts.length > 0) {
            findings.push(finding(
                'directives',
                'directive-conflict',
                'warning',
                'rules.directive.title',
                'rules.directive.message',
                { directives: directiveLabels.join(', ') },
                {
                    evidence: conflicts.map(({ text }) => text).join('\n'),
                    sourceIds: sourceIdsFromRecords(conflicts),
                    finalRanges: finalRangesFromRecords(conflicts),
                    confidence: 'high',
                },
            ));
        }

        const overrideMatches = recordsForSources(
            analysisSources,
            (text) => matchRanges(text, OVERRIDE_PATTERN).map((match) => ({
                ...match,
                label: 'override',
            })),
        );
        if (overrideMatches.length > 0) {
            findings.push(finding(
                'directives',
                'override-attempt',
                'warning',
                'rules.override.title',
                'rules.override.message',
                {},
                {
                    evidence: overrideMatches.map(({ text }) => text).join('\n'),
                    sourceIds: sourceIdsFromRecords(overrideMatches),
                    finalRanges: finalRangesFromRecords(overrideMatches),
                    confidence: 'high',
                },
            ));
        }
    }

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
