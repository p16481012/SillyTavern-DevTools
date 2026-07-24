import { sourceDisplayLabel, t } from './i18n.js';

const MIN_SENTENCE_LENGTH = 20;

function finding(id, severity, titleKey, messageKey, variables = {}, details = {}) {
    return {
        id,
        severity,
        title: t(titleKey, variables),
        message: t(messageKey, variables),
        evidence: details.evidence ?? null,
        sourceIds: details.sourceIds ?? [],
    };
}

function normalizeSentence(sentence) {
    return sentence
        .toLocaleLowerCase()
        .replace(/[`*_>#()[\]{}]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function getSentences(source) {
    return source.content
        .split(/(?<=[.!?。！？])\s+|\n+/u)
        .map((sentence) => ({
            original: sentence.trim(),
            normalized: normalizeSentence(sentence),
        }))
        .filter((sentence) => sentence.normalized.length >= MIN_SENTENCE_LENGTH);
}

function analyzeDuplicates(sources) {
    const occurrences = new Map();
    for (const source of sources) {
        for (const sentence of getSentences(source)) {
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
                `duplicate:${normalized.slice(0, 40)}`,
                'warning',
                'rules.duplicate.title',
                'rules.duplicate.message',
                { count: sourceIds.length },
                { evidence: items[0].original, sourceIds },
            ));
            continue;
        }

        if (items.length > 1) {
            results.push(finding(
                `repeated:${sourceIds[0]}:${normalized.slice(0, 40)}`,
                'info',
                'rules.repeated.title',
                'rules.repeated.message',
                {
                    source: sourceDisplayLabel(items[0].source),
                    count: items.length,
                },
                { evidence: items[0].original, sourceIds },
            ));
        }
    }
    return results.slice(0, 30);
}

function detectLanguages(text) {
    const languages = new Set();
    const patterns = [
        ['한국어', /(?:한국어|korean)(?:로|으로| in)?[\s\S]{0,24}(?:답변|응답|작성|출력|respond|reply|answer|write)|(?:respond|reply|answer|write)[\s\S]{0,24}(?:한국어|korean)/giu],
        ['영어', /(?:영어|english)(?:로|으로| in)?[\s\S]{0,24}(?:답변|응답|작성|출력|respond|reply|answer|write)|(?:respond|reply|answer|write)[\s\S]{0,24}(?:영어|english)/giu],
        ['일본어', /(?:일본어|japanese)(?:로|으로| in)?[\s\S]{0,24}(?:답변|응답|작성|출력|respond|reply|answer|write)|(?:respond|reply|answer|write)[\s\S]{0,24}(?:일본어|japanese)/giu],
        ['중국어', /(?:중국어|chinese)(?:로|으로| in)?[\s\S]{0,24}(?:답변|응답|작성|출력|respond|reply|answer|write)|(?:respond|reply|answer|write)[\s\S]{0,24}(?:중국어|chinese)/giu],
    ];
    for (const [label, pattern] of patterns) {
        if (pattern.test(text)) languages.add(label);
    }
    return [...languages];
}

function detectFormats(text) {
    const formats = [];
    if (/\bjson\b|JSON\s*형식/iu.test(text)) formats.push('JSON');
    if (/\bxml\b|XML\s*형식/iu.test(text)) formats.push('XML');
    if (/\bmarkdown\b|마크다운(?:으로| 형식)/iu.test(text)) formats.push('Markdown');
    if (/\bplain\s*text\b|일반\s*텍스트|마크다운(?:을|을 절대)?\s*사용하지/iu.test(text)) formats.push('일반 텍스트');
    return formats;
}

function formatsConflict(formats) {
    const set = new Set(formats);
    return (set.has('JSON') && set.has('XML'))
        || (set.has('Markdown') && set.has('일반 텍스트'))
        || set.size >= 3;
}

function detectRoles(text) {
    const roles = [];
    const patterns = [
        /\b(?:you are|act as|role is)\s+([^.\n]{3,80})/giu,
        /(?:너는|당신은)\s+([^.\n]{3,80})(?:이다|입니다|로 행동)/gu,
        /(?:역할은|역할:)\s*([^.\n]{3,80})/gu,
    ];
    for (const pattern of patterns) {
        for (const match of text.matchAll(pattern)) {
            roles.push(match[1].replace(/\s+/g, ' ').trim());
        }
    }
    return [...new Set(roles.map((role) => role.toLocaleLowerCase()))].slice(0, 10);
}

export function analyzeSnapshot(snapshot) {
    const findings = [];
    const sources = (snapshot?.sources ?? []).filter((source) => (
        source.type !== 'final'
        && source.type !== 'chat_history'
        && source.content?.trim()
    ));
    const finalText = snapshot?.finalText ?? '';
    const usage = snapshot?.stats?.contextUsage;

    if (usage >= 0.9) {
        findings.push(finding(
            'context-critical',
            'critical',
            'rules.contextCritical.title',
            'rules.contextCritical.message',
            { usage: (usage * 100).toFixed(1) },
        ));
    } else if (usage >= 0.75) {
        findings.push(finding(
            'context-warning',
            'warning',
            'rules.contextWarning.title',
            'rules.contextWarning.message',
            { usage: (usage * 100).toFixed(1) },
        ));
    }

    findings.push(...analyzeDuplicates(sources));

    const languages = detectLanguages(finalText);
    if (languages.length > 1) {
        findings.push(finding(
            'language-conflict',
            'critical',
            'rules.language.title',
            'rules.language.message',
            { languages: languages.join(', ') },
            { evidence: languages.join(' ↔ ') },
        ));
    }

    const formats = detectFormats(finalText);
    if (formatsConflict(formats)) {
        findings.push(finding(
            'format-conflict',
            'warning',
            'rules.format.title',
            'rules.format.message',
            { formats: formats.join(', ') },
            { evidence: formats.join(' ↔ ') },
        ));
    }

    const roles = detectRoles(finalText);
    if (roles.length > 1) {
        findings.push(finding(
            'role-conflict',
            'info',
            'rules.role.title',
            'rules.role.message',
            { count: roles.length },
            { evidence: roles.join('\n'), sourceIds: sources.map((source) => source.id) },
        ));
    }

    const totalTokens = snapshot?.stats?.totalTokens || 0;
    for (const source of sources) {
        const share = totalTokens ? source.tokenCount / totalTokens : 0;
        if (source.tokenCount >= 1000 && share >= 0.4) {
            findings.push(finding(
                `large-source:${source.id}`,
                'warning',
                'rules.largeSource.title',
                'rules.largeSource.message',
                {
                    source: sourceDisplayLabel(source),
                    tokens: source.tokenCount,
                    share: (share * 100).toFixed(1),
                },
                { sourceIds: [source.id] },
            ));
        }
    }

    const unmatched = sources.filter((source) => source.attribution === 'unmatched');
    if (unmatched.length > 0) {
        findings.push(finding(
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

    const order = { critical: 0, warning: 1, info: 2 };
    return findings.sort((left, right) => order[left.severity] - order[right.severity]);
}
