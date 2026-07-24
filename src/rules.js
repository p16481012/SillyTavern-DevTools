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
    };
}

function normalizeSentence(sentence) {
    return sentence
        .toLocaleLowerCase()
        .replace(/[`*_>#()[\]{}]/g, ' ')
        .replace(/\s+/g, ' ')
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

function sourceRanges(sources, sourceIds) {
    const selected = new Set(sourceIds);
    return sources
        .filter((source) => selected.has(source.id))
        .flatMap((source) => source.ranges ?? [])
        .map(({ start, end }) => ({ start, end }));
}

function analyzeDuplicates(sources, minimumLength) {
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
        const sourceIds = [...new Set(items.map((item) => item.source.id))];
        if (sourceIds.length > 1) {
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
                },
            ));
            continue;
        }

        if (items.length > 1) {
            results.push(finding(
                'duplicates',
                `repeated:${sourceIds[0]}:${normalized.slice(0, 40)}`,
                'info',
                'rules.repeated.title',
                'rules.repeated.message',
                {
                    source: sourceDisplayLabel(items[0].source),
                    count: items.length,
                },
                {
                    evidence: items[0].original,
                    sourceIds,
                    finalRanges: sourceRanges(sources, sourceIds),
                },
            ));
        }
    }
    return results.slice(0, 30);
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

function sourceIdsForFinalMatches(sources, matches) {
    const finalRanges = matches
        .map(({ start, end }) => ({ start: Number(start), end: Number(end) }))
        .filter(({ start, end }) => (
            Number.isFinite(start)
            && Number.isFinite(end)
            && end > start
        ));
    return sources
        .filter((source) => (source.ranges ?? []).some((range) => {
            const start = Number(range.start);
            const end = Number(range.end);
            return Number.isFinite(start)
                && Number.isFinite(end)
                && end > start
                && finalRanges.some((finalRange) => (
                    start < finalRange.end && finalRange.start < end
                ));
        }))
        .map((source) => source.id);
}

function formatsConflict(formats) {
    const set = new Set(formats);
    return (set.has('JSON') && set.has('XML'))
        || (set.has('Markdown') && set.has('일반 텍스트'))
        || set.size >= 3;
}

function detectRoles(text) {
    const matches = [];
    const patterns = [
        /\b(?:you are|act as|role is)\s+([^.\n]{3,80})/giu,
        /(?:너는|당신은)\s+([^.\n]{3,80})(?:이다|입니다|로 행동)/gu,
        /(?:역할은|역할:)\s*([^.\n]{3,80})/gu,
    ];
    for (const pattern of patterns) {
        for (const match of text.matchAll(pattern)) {
            matches.push({
                label: match[1].replace(/\s+/g, ' ').trim().toLocaleLowerCase(),
                text: match[0],
                start: match.index,
                end: match.index + match[0].length,
            });
        }
    }
    return matches;
}

function detectDirectiveConflicts(text) {
    const conflicts = [];
    for (const pair of DIRECTIVE_PAIRS) {
        const positive = pair.positive.exec(text);
        const negative = pair.negative.exec(text);
        if (!positive || !negative) continue;
        conflicts.push({
            label: pair.label,
            matches: [
                { text: positive[0], start: positive.index, end: positive.index + positive[0].length },
                { text: negative[0], start: negative.index, end: negative.index + negative[0].length },
            ],
        });
    }
    return conflicts;
}

function matchRanges(text, pattern) {
    pattern.lastIndex = 0;
    return [...text.matchAll(pattern)].map((match) => ({
        text: match[0],
        start: match.index,
        end: match.index + match[0].length,
    }));
}

export function analyzeSnapshot(snapshot, rawSettings = DEFAULT_RULE_SETTINGS) {
    const settings = normalizeRuleSettings(rawSettings);
    const findings = [];
    const sources = (snapshot?.sources ?? []).filter((source) => (
        source.type !== 'final'
        && source.type !== 'chat_history'
        && source.content?.trim()
    ));
    const finalText = snapshot?.finalText ?? '';
    const usage = snapshot?.stats?.contextUsage;

    if (settings.enabled.context && usage >= settings.contextCritical) {
        findings.push(finding(
            'context',
            'context-critical',
            'critical',
            'rules.contextCritical.title',
            'rules.contextCritical.message',
            { usage: (usage * 100).toFixed(1) },
        ));
    } else if (settings.enabled.context && usage >= settings.contextWarning) {
        findings.push(finding(
            'context',
            'context-warning',
            'warning',
            'rules.contextWarning.title',
            'rules.contextWarning.message',
            { usage: (usage * 100).toFixed(1) },
        ));
    }

    if (settings.enabled.duplicates) {
        findings.push(...analyzeDuplicates(sources, settings.minimumSentenceLength));
    }

    if (settings.enabled.language) {
        const matches = detectPatternMatches(finalText, LANGUAGE_PATTERNS);
        const languages = [...new Set(matches.map(({ label }) => label))];
        if (languages.length > 1) {
            const sourceIds = sourceIdsForFinalMatches(sources, matches);
            findings.push(finding(
                'language',
                'language-conflict',
                'critical',
                'rules.language.title',
                'rules.language.message',
                { languages: languages.join(', ') },
                {
                    evidence: matches.map(({ text }) => text).join('\n'),
                    sourceIds,
                    finalRanges: matches.map(({ start, end }) => ({ start, end })),
                },
            ));
        }
    }

    if (settings.enabled.format) {
        const matches = detectPatternMatches(finalText, FORMAT_PATTERNS);
        const formats = [...new Set(matches.map(({ label }) => label))];
        if (formatsConflict(formats)) {
            const sourceIds = sourceIdsForFinalMatches(sources, matches);
            findings.push(finding(
                'format',
                'format-conflict',
                'warning',
                'rules.format.title',
                'rules.format.message',
                { formats: formats.join(', ') },
                {
                    evidence: matches.map(({ text }) => text).join('\n'),
                    sourceIds,
                    finalRanges: matches.map(({ start, end }) => ({ start, end })),
                },
            ));
        }
    }

    if (settings.enabled.role) {
        const matches = detectRoles(finalText);
        const uniqueMatches = [];
        const seenRoles = new Set();
        for (const match of matches) {
            if (seenRoles.has(match.label)) continue;
            seenRoles.add(match.label);
            uniqueMatches.push(match);
            if (uniqueMatches.length === 10) break;
        }
        if (uniqueMatches.length > 1) {
            const sourceIds = sourceIdsForFinalMatches(sources, uniqueMatches);
            findings.push(finding(
                'role',
                'role-conflict',
                'info',
                'rules.role.title',
                'rules.role.message',
                { count: uniqueMatches.length },
                {
                    evidence: uniqueMatches.map(({ text }) => text).join('\n'),
                    sourceIds,
                    finalRanges: uniqueMatches.map(({ start, end }) => ({ start, end })),
                },
            ));
        }
    }

    if (settings.enabled.directives) {
        const conflicts = detectDirectiveConflicts(finalText);
        if (conflicts.length > 0) {
            const matches = conflicts.flatMap(({ matches: items }) => items);
            const sourceIds = sourceIdsForFinalMatches(sources, matches);
            findings.push(finding(
                'directives',
                'directive-conflict',
                'warning',
                'rules.directive.title',
                'rules.directive.message',
                { directives: conflicts.map(({ label }) => label).join(', ') },
                {
                    evidence: matches.map(({ text }) => text).join('\n'),
                    sourceIds,
                    finalRanges: matches.map(({ start, end }) => ({ start, end })),
                },
            ));
        }

        const overrideMatches = matchRanges(finalText, OVERRIDE_PATTERN);
        if (overrideMatches.length > 0) {
            const sourceIds = sourceIdsForFinalMatches(sources, overrideMatches);
            findings.push(finding(
                'directives',
                'override-attempt',
                'warning',
                'rules.override.title',
                'rules.override.message',
                {},
                {
                    evidence: overrideMatches.map(({ text }) => text).join('\n'),
                    sourceIds,
                    finalRanges: overrideMatches.map(({ start, end }) => ({ start, end })),
                },
            ));
        }
    }

    if (settings.enabled.largeSource) {
        const totalTokens = snapshot?.stats?.totalTokens || 0;
        for (const source of sources) {
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
                        finalRanges: sourceRanges(sources, [source.id]),
                    },
                ));
            }
        }
    }

    if (settings.enabled.unmatched) {
        const unmatched = sources.filter((source) => source.attribution === 'unmatched');
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
                },
            ));
        }
    }

    const order = { critical: 0, warning: 1, info: 2 };
    return findings.sort((left, right) => order[left.severity] - order[right.severity]);
}
