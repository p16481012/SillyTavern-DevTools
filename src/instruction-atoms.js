const INSTRUCTION_SOURCE_TYPES = new Set([
    'system',
    'jailbreak',
    'extension',
    'authors_note',
    'utility',
    'requestMessage',
]);

const REFERENCE_SOURCE_TYPES = new Set([
    'character',
    'persona',
    'lorebook',
]);

const CONVERSATION_SOURCE_TYPES = new Set([
    'chat_history',
    'assistant_prefill',
]);

const TOOL_SOURCE_TYPES = new Set([
    'tool_schema',
    'tool_call',
    'tool_result',
]);

export const INSTRUCTION_MODEL_LIMITS = Object.freeze({
    atoms: 500,
    relations: 200,
    alerts: 100,
});

const LANGUAGE_DESCRIPTORS = [
    ['한국어', 'ko', /(?:한국어|한글)(?:로|으로)\s*(?:만\s*)?(?:답변|응답|작성|출력)(?:하(?:세요|라|십시오)?|해)|(?:답변|응답|출력)(?:은|을|를)?[^\n.!?。！？]{0,18}(?:한국어|한글)(?:로|으로)|(?:respond|reply|answer|write)(?:\s+only)?\s+in\s+korean/giu],
    ['영어', 'en', /영어(?:로|으로)\s*(?:만\s*)?(?:답변|응답|작성|출력)(?:하(?:세요|라|십시오)?|해)|(?:답변|응답|출력)(?:은|을|를)?[^\n.!?。！？]{0,18}영어(?:로|으로)|(?:respond|reply|answer|write)(?:\s+only)?\s+in\s+english/giu],
    ['일본어', 'ja', /일본어(?:로|으로)\s*(?:만\s*)?(?:답변|응답|작성|출력)(?:하(?:세요|라|십시오)?|해)|(?:답변|응답|출력)(?:은|을|를)?[^\n.!?。！？]{0,18}일본어(?:로|으로)|(?:respond|reply|answer|write)(?:\s+only)?\s+in\s+japanese/giu],
    ['중국어', 'zh', /중국어(?:로|으로)\s*(?:만\s*)?(?:답변|응답|작성|출력)(?:하(?:세요|라|십시오)?|해)|(?:답변|응답|출력)(?:은|을|를)?[^\n.!?。！？]{0,18}중국어(?:로|으로)|(?:respond|reply|answer|write)(?:\s+only)?\s+in\s+chinese/giu],
];

const LANGUAGE_NEGATIVE_DESCRIPTORS = [
    ['한국어', 'ko', /(?:한국어|한글)(?:를|은|로|으로)?[^\n.!?。！？]{0,12}(?:사용하지|쓰지|금지)|(?:do not|never)\s+(?:respond|reply|answer|write)\s+in\s+korean/giu],
    ['영어', 'en', /영어(?:를|은|로|으로)?[^\n.!?。！？]{0,12}(?:사용하지|쓰지|금지)|(?:do not|never)\s+(?:respond|reply|answer|write)\s+in\s+english/giu],
    ['일본어', 'ja', /일본어(?:를|은|로|으로)?[^\n.!?。！？]{0,12}(?:사용하지|쓰지|금지)|(?:do not|never)\s+(?:respond|reply|answer|write)\s+in\s+japanese/giu],
    ['중국어', 'zh', /중국어(?:를|은|로|으로)?[^\n.!?。！？]{0,12}(?:사용하지|쓰지|금지)|(?:do not|never)\s+(?:respond|reply|answer|write)\s+in\s+chinese/giu],
];

const FORMAT_DESCRIPTORS = [
    ['JSON', 'json', /(?:json)(?:\s*형식)?(?:으로|만)?[^\n.!?。！？]{0,16}(?:답변|응답|작성|출력|반환)|(?:return|respond|reply|output|write)[^\n.!?]{0,20}\bjson\b(?:\s+only)?/giu],
    ['XML', 'xml', /(?:xml)(?:\s*형식)?(?:으로|만)?[^\n.!?。！？]{0,16}(?:답변|응답|작성|출력|반환)|(?:return|respond|reply|output|write)[^\n.!?]{0,20}\bxml\b(?:\s+only)?/giu],
    ['Markdown', 'markdown', /(?:markdown|마크다운)(?:\s*형식)?(?:으로|만)?[^\n.!?。！？]{0,16}(?:답변|응답|작성|출력)|(?:return|respond|reply|output|write)[^\n.!?]{0,20}\bmarkdown\b/giu],
    ['일반 텍스트', 'plain-text', /(?:일반\s*텍스트|plain\s*text)(?:\s*형식)?(?:으로|만)?[^\n.!?。！？]{0,16}(?:답변|응답|작성|출력)|(?:return|respond|reply|output|write)[^\n.!?]{0,20}\bplain\s*text\b/giu],
];

const FORMAT_NEGATIVE_DESCRIPTORS = [
    ['JSON', 'json', /json[^\n.!?。！？]{0,14}(?:사용하지|쓰지|금지)|(?:do not|never)\s+(?:use|output|return)[^\n.!?]{0,12}\bjson\b/giu],
    ['XML', 'xml', /xml[^\n.!?。！？]{0,14}(?:사용하지|쓰지|금지)|(?:do not|never)\s+(?:use|output|return)[^\n.!?]{0,12}\bxml\b/giu],
    ['Markdown', 'markdown', /(?:markdown|마크다운)[^\n.!?。！？]{0,14}(?:사용하지|쓰지|금지)|(?:do not|never)\s+(?:use|output|return)[^\n.!?]{0,12}\bmarkdown\b/giu],
];

const FEATURE_DESCRIPTORS = [
    {
        label: '설명',
        key: 'explanation',
        positive: /(?:설명|해설|근거)[^\n.!?。！？]{0,16}(?:포함(?!\s*하지)|제공(?!\s*하지))|(?<!not )(?<!do not )(?<!without )(?:include|provide)[^\n.!?]{0,20}(?:explanation|rationale)/giu,
        negative: /(?:설명|해설|근거)[^\n.!?。！？]{0,16}(?:하지|제외|생략)|(?:no|without|do not (?:include|provide))[^\n.!?]{0,20}(?:explanation|rationale)/giu,
    },
    {
        label: '인용',
        key: 'citation',
        positive: /(?:인용|출처)[^\n.!?。！？]{0,16}(?:포함(?!\s*하지)|표시(?!\s*하지)|제공(?!\s*하지))|(?<!not )(?<!do not )(?<!without )(?:include|provide|add)[^\n.!?]{0,20}(?:citation|source)/giu,
        negative: /(?:인용|출처)[^\n.!?。！？]{0,16}(?:하지|제외|생략)|(?:no|without|do not (?:include|provide|add))[^\n.!?]{0,20}(?:citation|source)/giu,
    },
    {
        label: '이모지',
        key: 'emoji',
        positive: /(?:이모지|emoji)[^\n.!?。！？]{0,12}(?:사용(?!\s*하지)|포함(?!\s*하지))|(?<!not )(?<!do not )(?<!without )(?:use|include)[^\n.!?]{0,15}(?:emoji)/giu,
        negative: /(?:이모지|emoji)[^\n.!?。！？]{0,12}(?:사용\s*하지|포함\s*하지|금지|제외)|(?:no|without|do not use)[^\n.!?]{0,15}(?:emoji)/giu,
    },
    {
        label: '코드 블록',
        key: 'code-block',
        positive: /(?:코드\s*블록)[^\n.!?。！？]{0,12}(?:사용(?!\s*하지)|포함(?!\s*하지))|(?<!not )(?<!do not )(?<!without )(?:use|include)[^\n.!?]{0,18}(?:code block|fenced code)/giu,
        negative: /(?:코드\s*블록)[^\n.!?。！？]{0,12}(?:사용\s*하지|포함\s*하지|금지|제외)|(?:no|without|do not use)[^\n.!?]{0,18}(?:code block|fenced code)/giu,
    },
];

const ROLE_PATTERNS = [
    /\b(?:you are|act as|role is)\s+([^.\n]{3,80})/giu,
    /(?:너는|당신은)\s+([^.\n]{3,80}?)(?:이다|입니다|로 행동)/gu,
    /(?:역할은|역할:)\s*([^.\n]{3,80})/gu,
];

const OVERRIDE_PATTERN = /(?:이전|앞선|위의|기존)[^\n.!?。！？]{0,20}(?:지시|규칙|명령)[^\n.!?。！？]{0,16}(?:무시|취소|덮어)|(?:ignore|disregard|override)[^\n.!?]{0,24}(?:previous|earlier|above|all)[^\n.!?]{0,16}(?:instruction|rule)/giu;

const EXAMPLE_PREFIX = /^(?:>|예(?:시)?\s*:|ex(?:ample)?\.?\s*:|e\.g\.\s*)/iu;
const EXAMPLE_CUE = /(?:예(?:시)?|인용|문구|example|quote)\s*[:：]?/iu;
const CONDITION_PATTERN = /(?:만약|경우에는?|경우|때에는?|때|조건에서|if|when|only when|provided that)\s*[^,.;。！？]{0,80}/iu;
const EXCEPTION_PATTERN = /(?:예외|제외|아니면|unless|except(?: when| for)?)[^,.;。！？]{0,80}/iu;
const ABSOLUTE_PRIORITY_PATTERN = /(?:절대|무조건|never|under no circumstances)/iu;
const HIGH_PRIORITY_PATTERN = /(?:반드시|항상|최우선|우선|must|always|only)/iu;

function normalizedText(value) {
    return String(value ?? '').replace(/\s+/gu, ' ').trim();
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

function sourceRanges(source) {
    return uniqueRanges(source?.ranges ?? []);
}

function projectLocalRange(source, start, end) {
    if (source?.synthetic) return [{ start, end }];
    const contentLength = String(source?.content ?? '').length;
    return sourceRanges(source)
        .map((range) => {
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
        })
        .filter((range) => range.end > range.start);
}

function rangeOverlaps(left, right) {
    return left.start < right.end && right.start < left.end;
}

function sentenceSegments(text) {
    const segments = [];
    const pattern = /[^.!?。！？\n]+(?:[.!?。！？]+|$)/gu;
    for (const match of text.matchAll(pattern)) {
        const raw = match[0];
        const leading = raw.match(/^\s*/u)?.[0].length ?? 0;
        const trailing = raw.match(/\s*$/u)?.[0].length ?? 0;
        const start = match.index + leading;
        const end = match.index + raw.length - trailing;
        if (end <= start) continue;
        segments.push({ start, end, text: text.slice(start, end) });
    }
    return segments;
}

function excludedExampleRanges(text) {
    const ranges = [];
    const fenced = /```[\s\S]*?(?:```|$)/gu;
    for (const match of text.matchAll(fenced)) {
        ranges.push({
            start: match.index,
            end: match.index + match[0].length,
            reason: 'fenced-example',
        });
    }
    let cursor = 0;
    for (const line of text.split('\n')) {
        const trimmed = line.trimStart();
        if (EXAMPLE_PREFIX.test(trimmed)) {
            ranges.push({
                start: cursor,
                end: cursor + line.length,
                reason: 'example-line',
            });
        }
        cursor += line.length + 1;
    }
    return ranges;
}

function segmentAt(segments, offset) {
    return segments.find(({ start, end }) => offset >= start && offset < end) ?? null;
}

function isQuotedExample(text, start, end, segment) {
    if (!segment || !EXAMPLE_CUE.test(segment.text)) return false;
    const before = text.slice(segment.start, start);
    const after = text.slice(end, segment.end);
    const quotePairs = [
        ['"', '"'],
        ["'", "'"],
        ['“', '”'],
        ['‘', '’'],
        ['「', '」'],
    ];
    return quotePairs.some(([open, close]) => (
        before.lastIndexOf(open) > before.lastIndexOf(close)
        && after.indexOf(close) >= 0
    ));
}

function extractCondition(segment) {
    return normalizedText(segment?.text.match(CONDITION_PATTERN)?.[0]) || null;
}

function extractException(segment) {
    return normalizedText(segment?.text.match(EXCEPTION_PATTERN)?.[0]) || null;
}

function instructionPriority(text) {
    if (ABSOLUTE_PRIORITY_PATTERN.test(text)) return 'absolute';
    if (HIGH_PRIORITY_PATTERN.test(text)) return 'high';
    return 'normal';
}

function sourceContext(source) {
    return {
        role: source?.metadata?.role ?? (
            source?.type === 'system' || source?.type === 'jailbreak'
                ? 'system'
                : null
        ),
        position: source?.metadata?.position
            ?? source?.metadata?.promptOrder
            ?? null,
        depth: source?.metadata?.depth ?? null,
    };
}

export function classifyInstructionCapability(source) {
    const type = source?.type ?? 'unknown';
    if (source?.synthetic) {
        return {
            kind: 'aggregate-fallback',
            extractsAtoms: true,
            comparesAtoms: true,
            atomStatus: 'candidate',
            reason: 'final-text-fallback',
        };
    }
    if (type === 'final') {
        return {
            kind: 'aggregate',
            extractsAtoms: false,
            comparesAtoms: false,
            atomStatus: 'insufficient-evidence',
            reason: 'aggregate-output',
        };
    }
    if (CONVERSATION_SOURCE_TYPES.has(type)) {
        return {
            kind: 'conversation',
            extractsAtoms: false,
            comparesAtoms: false,
            atomStatus: 'insufficient-evidence',
            reason: 'conversation-output',
        };
    }
    if (TOOL_SOURCE_TYPES.has(type)) {
        return {
            kind: 'tool-data',
            extractsAtoms: false,
            comparesAtoms: false,
            atomStatus: 'insufficient-evidence',
            reason: 'tool-structure',
        };
    }
    if (type === 'multimodal') {
        return {
            kind: 'multimodal-placeholder',
            extractsAtoms: false,
            comparesAtoms: false,
            atomStatus: 'insufficient-evidence',
            reason: 'multimodal-placeholder',
        };
    }
    if (INSTRUCTION_SOURCE_TYPES.has(type)) {
        return {
            kind: 'instruction',
            extractsAtoms: true,
            comparesAtoms: true,
            atomStatus: 'confirmed',
            reason: null,
        };
    }
    if (REFERENCE_SOURCE_TYPES.has(type)) {
        return {
            kind: 'reference',
            extractsAtoms: true,
            comparesAtoms: false,
            atomStatus: 'insufficient-evidence',
            reason: 'reference-data',
        };
    }
    return {
        kind: 'mixed',
        extractsAtoms: true,
        comparesAtoms: false,
        atomStatus: 'insufficient-evidence',
        reason: 'unknown-source-capability',
    };
}

function atomId(source, category, property, value, start, end, polarity) {
    return [
        'atom',
        source.id,
        category,
        property,
        value,
        polarity,
        start,
        end,
    ].join(':');
}

function createAtom(source, capability, descriptor, match, segments) {
    const segment = segmentAt(segments, match.start);
    const condition = extractCondition(segment);
    const exception = extractException(segment);
    let status = capability.atomStatus;
    if (status === 'confirmed' && (condition || exception || descriptor.category === 'role')) {
        status = 'candidate';
    }
    const context = sourceContext(source);
    const confidencePenalty = condition || exception ? 0.08 : 0;
    const confidence = Math.max(
        0,
        Math.min(1, Number((descriptor.confidence - confidencePenalty).toFixed(2))),
    );
    const localRange = { start: match.start, end: match.end };
    return {
        id: atomId(
            source,
            descriptor.category,
            descriptor.property,
            descriptor.value,
            match.start,
            match.end,
            descriptor.polarity,
        ),
        category: descriptor.category,
        target: descriptor.target,
        action: descriptor.action,
        property: descriptor.property,
        value: descriptor.value,
        valueLabel: descriptor.valueLabel,
        polarity: descriptor.polarity,
        scope: descriptor.scope,
        condition,
        exception,
        priority: instructionPriority(segment?.text ?? match.text),
        status,
        sourceId: source.id,
        sourceLabel: source.label ?? source.id,
        sourceType: source.type ?? 'unknown',
        sourceRole: context.role,
        position: context.position,
        depth: context.depth,
        text: match.text,
        localRange,
        finalRanges: projectLocalRange(source, match.start, match.end),
        rangeMethod: source.attribution === 'exact'
            ? 'exact-offset'
            : sourceRanges(source).length > 0
                ? 'source-range'
                : 'local-only',
        method: descriptor.method,
        confidence,
        capability: capability.kind,
    };
}

function descriptorMatches(text, descriptor) {
    descriptor.pattern.lastIndex = 0;
    return [...text.matchAll(descriptor.pattern)].map((match) => ({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
    }));
}

function extractPatternAtoms(source, capability, descriptor, context) {
    const atoms = [];
    for (const match of descriptorMatches(context.text, descriptor)) {
        const range = { start: match.start, end: match.end };
        const excluded = context.excluded.find((item) => rangeOverlaps(range, item));
        if (excluded || isQuotedExample(
            context.text,
            match.start,
            match.end,
            segmentAt(context.segments, match.start),
        )) {
            context.exclusions.push({
                sourceId: source.id,
                localRange: range,
                reason: excluded?.reason ?? 'quoted-example',
                text: match.text,
            });
            continue;
        }
        atoms.push(createAtom(source, capability, descriptor, match, context.segments));
    }
    return atoms;
}

function extractRoleAtoms(source, capability, context) {
    const atoms = [];
    for (const pattern of ROLE_PATTERNS) {
        pattern.lastIndex = 0;
        for (const match of context.text.matchAll(pattern)) {
            const value = normalizedText(match[1]).toLowerCase();
            if (!value) continue;
            const range = { start: match.index, end: match.index + match[0].length };
            const excluded = context.excluded.find((item) => rangeOverlaps(range, item));
            if (excluded || isQuotedExample(
                context.text,
                range.start,
                range.end,
                segmentAt(context.segments, range.start),
            )) {
                context.exclusions.push({
                    sourceId: source.id,
                    localRange: range,
                    reason: excluded?.reason ?? 'quoted-example',
                    text: match[0],
                });
                continue;
            }
            atoms.push(createAtom(source, capability, {
                category: 'role',
                target: 'assistant',
                action: 'act-as',
                property: 'assistant.role',
                value,
                valueLabel: value,
                polarity: 'require',
                scope: 'identity',
                method: 'pattern:role-declaration',
                confidence: 0.74,
            }, {
                start: range.start,
                end: range.end,
                text: match[0],
            }, context.segments));
        }
    }
    return atoms;
}

function extractSourceAtoms(source, capability) {
    const text = String(source?.content ?? '');
    const exclusions = [];
    const context = {
        text,
        segments: sentenceSegments(text),
        excluded: excludedExampleRanges(text),
        exclusions,
    };
    const atoms = [];

    for (const [valueLabel, value, pattern] of LANGUAGE_DESCRIPTORS) {
        atoms.push(...extractPatternAtoms(source, capability, {
            category: 'language',
            target: 'response',
            action: 'set',
            property: 'response.language',
            value,
            valueLabel,
            polarity: 'require',
            scope: 'output',
            method: `pattern:language:${value}`,
            confidence: 0.98,
            pattern,
        }, context));
    }
    for (const [valueLabel, value, pattern] of LANGUAGE_NEGATIVE_DESCRIPTORS) {
        atoms.push(...extractPatternAtoms(source, capability, {
            category: 'language',
            target: 'response',
            action: 'avoid',
            property: 'response.language',
            value,
            valueLabel,
            polarity: 'prohibit',
            scope: 'output',
            method: `pattern:language-negative:${value}`,
            confidence: 0.94,
            pattern,
        }, context));
    }
    for (const [valueLabel, value, pattern] of FORMAT_DESCRIPTORS) {
        atoms.push(...extractPatternAtoms(source, capability, {
            category: 'format',
            target: 'response',
            action: 'set',
            property: 'response.format',
            value,
            valueLabel,
            polarity: 'require',
            scope: 'output',
            method: `pattern:format:${value}`,
            confidence: 0.96,
            pattern,
        }, context));
    }
    for (const [valueLabel, value, pattern] of FORMAT_NEGATIVE_DESCRIPTORS) {
        atoms.push(...extractPatternAtoms(source, capability, {
            category: 'format',
            target: 'response',
            action: 'avoid',
            property: 'response.format',
            value,
            valueLabel,
            polarity: 'prohibit',
            scope: 'output',
            method: `pattern:format-negative:${value}`,
            confidence: 0.92,
            pattern,
        }, context));
    }
    for (const feature of FEATURE_DESCRIPTORS) {
        atoms.push(...extractPatternAtoms(source, capability, {
            category: 'directives',
            target: 'response',
            action: 'include',
            property: `response.include.${feature.key}`,
            value: 'included',
            valueLabel: feature.label,
            polarity: 'require',
            scope: 'output',
            method: `pattern:directive:${feature.key}:positive`,
            confidence: 0.95,
            pattern: feature.positive,
        }, context));
        atoms.push(...extractPatternAtoms(source, capability, {
            category: 'directives',
            target: 'response',
            action: 'exclude',
            property: `response.include.${feature.key}`,
            value: 'included',
            valueLabel: feature.label,
            polarity: 'prohibit',
            scope: 'output',
            method: `pattern:directive:${feature.key}:negative`,
            confidence: 0.95,
            pattern: feature.negative,
        }, context));
    }
    atoms.push(...extractRoleAtoms(source, capability, context));
    atoms.push(...extractPatternAtoms(source, capability, {
        category: 'priority',
        target: 'instruction-set',
        action: 'override',
        property: 'instruction.priority',
        value: 'previous',
        valueLabel: '이전 지시',
        polarity: 'override',
        scope: 'all',
        method: 'pattern:priority-override',
        confidence: 0.99,
        pattern: OVERRIDE_PATTERN,
    }, context));

    const deduplicated = new Map();
    for (const atom of atoms) {
        const key = [
            atom.category,
            atom.property,
            atom.value,
            atom.polarity,
            atom.localRange.start,
            atom.localRange.end,
        ].join(':');
        const previous = deduplicated.get(key);
        if (!previous || atom.confidence > previous.confidence) deduplicated.set(key, atom);
    }
    return {
        atoms: [...deduplicated.values()].sort(
            (left, right) => left.localRange.start - right.localRange.start,
        ),
        exclusions,
    };
}

function formatsConflict(left, right) {
    const pair = new Set([left, right]);
    return (pair.has('json') && pair.has('xml'))
        || (pair.has('markdown') && pair.has('plain-text'));
}

function normalizedRoleTokens(value) {
    const ignored = new Set([
        'a',
        'an',
        'the',
        'helpful',
        'friendly',
        'assistant',
        'ai',
        '친절한',
        '유능한',
        '도우미',
    ]);
    return new Set(normalizedText(value)
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((token) => token && !ignored.has(token)));
}

function rolesCompatible(left, right) {
    if (left === right || left.includes(right) || right.includes(left)) return true;
    const leftTokens = normalizedRoleTokens(left);
    const rightTokens = normalizedRoleTokens(right);
    if (leftTokens.size === 0 || rightTokens.size === 0) return true;
    const leftOnly = [...leftTokens].filter((token) => !rightTokens.has(token));
    const rightOnly = [...rightTokens].filter((token) => !leftTokens.has(token));
    return leftOnly.length === 0 || rightOnly.length === 0;
}

function atomsConflict(left, right) {
    if (left.target !== right.target || left.property !== right.property) return null;
    if (left.category === 'priority' || right.category === 'priority') return null;
    if (left.value === right.value && left.polarity !== right.polarity) {
        return 'opposite-polarity';
    }
    if (left.polarity !== 'require' || right.polarity !== 'require') return null;
    if (left.category === 'language' && left.value !== right.value) {
        return 'alternative-values';
    }
    if (
        left.category === 'format'
        && left.value !== right.value
        && formatsConflict(left.value, right.value)
    ) {
        return 'alternative-values';
    }
    if (
        left.category === 'role'
        && left.value !== right.value
        && !rolesCompatible(left.value, right.value)
    ) {
        return 'role-overlap';
    }
    return null;
}

function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function relationStatus(left, right) {
    if (left.category === 'role' || right.category === 'role') {
        return 'insufficient-evidence';
    }
    if (
        left.status === 'insufficient-evidence'
        || right.status === 'insufficient-evidence'
    ) {
        return 'insufficient-evidence';
    }
    if (
        left.status === 'candidate'
        || right.status === 'candidate'
        || left.condition
        || right.condition
        || left.exception
        || right.exception
    ) {
        return 'candidate';
    }
    return 'confirmed';
}

function uniqueStrings(values) {
    return [...new Set(values.filter(Boolean))];
}

function createRelations(atoms, capabilities, compareSources, categoryEnabled) {
    const capabilityBySource = new Map(
        capabilities.map((capability) => [capability.sourceId, capability]),
    );
    const semanticAtoms = [...new Map(atoms.map((atom) => [[
        atom.sourceId,
        atom.category,
        atom.property,
        atom.value,
        atom.polarity,
        atom.condition ?? '',
        atom.exception ?? '',
    ].join('|'), atom])).values()];
    const relations = [];
    let truncated = false;
    relationPairs:
    for (let leftIndex = 0; leftIndex < semanticAtoms.length; leftIndex += 1) {
        for (
            let rightIndex = leftIndex + 1;
            rightIndex < semanticAtoms.length;
            rightIndex += 1
        ) {
            const left = semanticAtoms[leftIndex];
            const right = semanticAtoms[rightIndex];
            const kind = atomsConflict(left, right);
            if (!kind) continue;
            if (categoryEnabled && !categoryEnabled(left.category)) continue;
            const leftCapability = capabilityBySource.get(left.sourceId);
            const rightCapability = capabilityBySource.get(right.sourceId);
            if (!leftCapability?.comparesAtoms || !rightCapability?.comparesAtoms) continue;
            if (
                left.sourceId !== right.sourceId
                && compareSources
                && !compareSources(leftCapability.source, rightCapability.source, left.category)
            ) {
                continue;
            }
            const atomIds = [left.id, right.id].sort();
            const status = relationStatus(left, right);
            const relationKey = `${left.category}:${kind}:${atomIds.join('|')}`;
            relations.push({
                id: `relation:${left.category}:${hashString(relationKey)}`,
                category: left.category,
                kind,
                status,
                atomIds,
                sourceIds: uniqueStrings([left.sourceId, right.sourceId]),
                finalRanges: uniqueRanges([...left.finalRanges, ...right.finalRanges]),
                localEvidence: [
                    {
                        atomId: left.id,
                        sourceId: left.sourceId,
                        sourceLabel: left.sourceLabel,
                        text: left.text,
                        localRange: left.localRange,
                    },
                    {
                        atomId: right.id,
                        sourceId: right.sourceId,
                        sourceLabel: right.sourceLabel,
                        text: right.text,
                        localRange: right.localRange,
                    },
                ],
                conditions: uniqueStrings([left.condition, right.condition]),
                exceptions: uniqueStrings([left.exception, right.exception]),
                method: 'instruction-atom-pair',
                confidence: Number(Math.min(left.confidence, right.confidence).toFixed(2)),
                clusterId: null,
            });
            if (relations.length >= INSTRUCTION_MODEL_LIMITS.relations) {
                truncated = true;
                break relationPairs;
            }
        }
    }
    return { relations, truncated };
}

function buildClusters(relations) {
    const clusters = [];
    const remaining = new Set(relations.map(({ id }) => id));
    const relationById = new Map(relations.map((relation) => [relation.id, relation]));
    while (remaining.size > 0) {
        const seedId = remaining.values().next().value;
        const queue = [seedId];
        const selectedRelations = [];
        const atomIds = new Set();
        const category = relationById.get(seedId)?.category;
        while (queue.length > 0) {
            const relationId = queue.shift();
            if (!remaining.has(relationId)) continue;
            const relation = relationById.get(relationId);
            if (!relation || relation.category !== category) continue;
            remaining.delete(relationId);
            selectedRelations.push(relation);
            relation.atomIds.forEach((atomId) => atomIds.add(atomId));
            for (const candidateId of remaining) {
                const candidate = relationById.get(candidateId);
                if (
                    candidate?.category === category
                    && candidate.atomIds.some((atomId) => atomIds.has(atomId))
                ) {
                    queue.push(candidateId);
                }
            }
        }
        const relationIds = selectedRelations.map(({ id }) => id).sort();
        const clusterId = `cluster:${category}:${hashString(relationIds.join('|'))}`;
        const statuses = new Set(selectedRelations.map(({ status }) => status));
        const status = statuses.has('confirmed')
            ? 'confirmed'
            : statuses.has('candidate')
                ? 'candidate'
                : 'insufficient-evidence';
        const cluster = {
            id: clusterId,
            category,
            status,
            relationIds,
            atomIds: [...atomIds],
            sourceIds: uniqueStrings(selectedRelations.flatMap(({ sourceIds }) => sourceIds)),
            finalRanges: uniqueRanges(
                selectedRelations.flatMap(({ finalRanges }) => finalRanges),
            ),
            confidence: selectedRelations.length
                ? Number(Math.min(
                    ...selectedRelations.map(({ confidence }) => confidence),
                ).toFixed(2))
                : 0,
        };
        selectedRelations.forEach((relation) => {
            relation.clusterId = clusterId;
        });
        clusters.push(cluster);
    }
    return clusters;
}

export function buildInstructionModel(
    sources,
    {
        activeSourceIds = null,
        compareSources = null,
        categoryEnabled = null,
    } = {},
) {
    const active = activeSourceIds instanceof Set
        ? activeSourceIds
        : new Set((sources ?? []).map(({ id }) => id));
    const capabilities = [];
    const atoms = [];
    const exclusions = [];
    let atomsTruncated = false;

    for (const source of Array.isArray(sources) ? sources : []) {
        const classified = classifyInstructionCapability(source);
        const capability = {
            sourceId: source.id,
            sourceLabel: source.label ?? source.id,
            sourceType: source.type ?? 'unknown',
            active: active.has(source.id),
            ...classified,
            source,
        };
        capabilities.push(capability);
        if (!capability.active || !capability.extractsAtoms) continue;
        if (atoms.length >= INSTRUCTION_MODEL_LIMITS.atoms) {
            atomsTruncated = true;
            continue;
        }
        const extracted = extractSourceAtoms(source, capability);
        const enabledAtoms = categoryEnabled
            ? extracted.atoms.filter((atom) => categoryEnabled(atom.category))
            : extracted.atoms;
        const remaining = INSTRUCTION_MODEL_LIMITS.atoms - atoms.length;
        if (remaining > 0) {
            atoms.push(...enabledAtoms.slice(0, remaining));
        }
        if (enabledAtoms.length > remaining) atomsTruncated = true;
        exclusions.push(...extracted.exclusions);
    }

    const relationResult = createRelations(
        atoms,
        capabilities,
        compareSources,
        categoryEnabled,
    );
    const { relations } = relationResult;
    const clusters = buildClusters(relations);
    const allPriorityAlerts = atoms
        .filter((atom) => atom.category === 'priority' && atom.action === 'override')
        .filter(() => !categoryEnabled || categoryEnabled('priority'))
        .filter((atom) => {
            const capability = capabilities.find(
                ({ sourceId }) => sourceId === atom.sourceId,
            );
            return capability?.comparesAtoms;
        })
        .map((atom) => ({
            id: `alert:priority:${hashString(atom.id)}`,
            category: 'priority',
            status: atom.status,
            atomIds: [atom.id],
            sourceIds: [atom.sourceId],
            finalRanges: atom.finalRanges,
            localEvidence: [{
                atomId: atom.id,
                sourceId: atom.sourceId,
                sourceLabel: atom.sourceLabel,
                text: atom.text,
                localRange: atom.localRange,
            }],
            method: 'instruction-atom-single',
            confidence: atom.confidence,
            clusterId: null,
        }));
    const priorityAlerts = allPriorityAlerts.slice(0, INSTRUCTION_MODEL_LIMITS.alerts);

    return {
        version: 3,
        capabilities: capabilities.map(({ source, ...capability }) => capability),
        atoms,
        relations,
        clusters,
        alerts: priorityAlerts,
        exclusions,
        limits: INSTRUCTION_MODEL_LIMITS,
        stats: {
            activeSources: capabilities.filter(({ active }) => active).length,
            instructionSources: capabilities.filter(
                ({ active: isActive, comparesAtoms }) => isActive && comparesAtoms,
            ).length,
            referenceSources: capabilities.filter(
                ({ active: isActive, kind }) => isActive && kind === 'reference',
            ).length,
            excludedSources: capabilities.filter(
                ({ active: isActive, extractsAtoms }) => !isActive || !extractsAtoms,
            ).length,
            atoms: atoms.length,
            confirmedAtoms: atoms.filter(({ status }) => status === 'confirmed').length,
            candidateAtoms: atoms.filter(({ status }) => status === 'candidate').length,
            insufficientAtoms: atoms.filter(
                ({ status }) => status === 'insufficient-evidence',
            ).length,
            confirmedRelations: relations.filter(
                ({ status }) => status === 'confirmed',
            ).length,
            candidateRelations: relations.filter(
                ({ status }) => status === 'candidate',
            ).length,
            insufficientRelations: relations.filter(
                ({ status }) => status === 'insufficient-evidence',
            ).length,
            atomsTruncated,
            relationsTruncated: relationResult.truncated,
            alertsTruncated: allPriorityAlerts.length > priorityAlerts.length,
        },
    };
}
