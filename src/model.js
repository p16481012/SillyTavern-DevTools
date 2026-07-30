import {
    attributionDisplayLabel,
    providerDisplayLabel,
    sourceDisplayLabel,
    t,
} from './i18n.js';
import {
    detectMultimodalProvider,
    estimateMultimodalTokens,
} from './multimodal.js';
import { createCaptureBoundary, createRequestRecord } from './request.js';

export const SNAPSHOT_SCHEMA_VERSION = 4;

function nonEmptyString(value) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized || null;
}

function firstKnownString(...values) {
    const normalized = values.map(nonEmptyString).filter(Boolean);
    return normalized.find((value) => value.toLocaleLowerCase() !== 'unknown')
        ?? normalized[0]
        ?? null;
}

function textCompletionProvider(api, source) {
    const normalizedApi = nonEmptyString(api);
    const normalizedSource = nonEmptyString(source);
    const apiKey = normalizedApi?.toLocaleLowerCase();
    const sourceKey = normalizedSource?.toLocaleLowerCase();
    const knownApi = normalizedApi && apiKey !== 'unknown';
    const knownSource = normalizedSource && sourceKey !== 'unknown';

    if (knownApi && apiKey !== 'textgenerationwebui') return normalizedApi;
    if (knownSource && !['ooba', 'textgenerationwebui'].includes(sourceKey)) {
        return normalizedSource;
    }
    if (apiKey === 'textgenerationwebui' || ['ooba', 'textgenerationwebui'].includes(sourceKey)) {
        return 'textgenerationwebui';
    }
    return 'unknown';
}

export function snapshotProvider(snapshot = {}) {
    const api = nonEmptyString(snapshot.api);
    if (snapshot.promptType && snapshot.promptType !== 'chat-completion') {
        return textCompletionProvider(
            api,
            firstKnownString(snapshot.provider, snapshot.generatingApi),
        );
    }

    return firstKnownString(
        snapshot.request?.settings?.chat_completion_source,
        snapshot.request?.body?.chat_completion_source,
        snapshot.provider,
        snapshot.generatingApi,
        api,
        'unknown',
    );
}

const SOURCE_COLORS = {
    system: '#8b5cf6',
    character: '#22c55e',
    persona: '#06b6d4',
    authors_note: '#f59e0b',
    lorebook: '#ec4899',
    extension: '#14b8a6',
    jailbreak: '#ef4444',
    utility: '#64748b',
    chat_history: '#3b82f6',
    assistant_prefill: '#a855f7',
    tool_schema: '#0f766e',
    tool_call: '#c2410c',
    tool_result: '#7c3aed',
    multimodal: '#0369a1',
    final: '#eab308',
};

export function deepClone(value) {
    if (typeof structuredClone === 'function') {
        try {
            return structuredClone(value);
        } catch {
            // Fall through to JSON for serializable prompt payloads.
        }
    }

    return JSON.parse(JSON.stringify(value));
}

export function contentToText(content) {
    if (typeof content === 'string') {
        return content;
    }

    if (Array.isArray(content)) {
        return content
            .map((part, index) => contentPartToText(part, index))
            .join('\n');
    }

    if (content == null) {
        return '';
    }

    return typeof content === 'object' ? JSON.stringify(content, null, 2) : String(content);
}

function mediaType(part) {
    const type = String(part?.type ?? '').toLocaleLowerCase();
    if (type.includes('image') || part?.image_url || part?.image) return 'image';
    if (type.includes('audio') || part?.audio_url || part?.input_audio || part?.audio) return 'audio';
    if (type.includes('video') || part?.video_url || part?.video) return 'video';
    if (type.includes('file') || part?.file || part?.file_url) return 'file';
    return null;
}

export function contentPartToText(part, index = 0) {
    if (typeof part === 'string') return part;
    if (
        ['text', 'input_text', 'output_text'].includes(part?.type)
        && typeof part.text === 'string'
    ) {
        return part.text;
    }

    const type = mediaType(part);
    const number = Number(index) + 1;
    if (type === 'image') return `[ì´ë¯¸ì§€ ìž…ë ¥ ${number}]`;
    if (type === 'audio') return `[ì˜¤ë””ì˜¤ ìž…ë ¥ ${number}]`;
    if (type === 'video') return `[ë¹„ë””ì˜¤ ìž…ë ¥ ${number}]`;
    if (type === 'file') return `[íŒŒì¼ ìž…ë ¥ ${number}]`;
    return JSON.stringify(part);
}

function flattenMessage(message, index) {
    const role = String(message?.role ?? 'unknown').toUpperCase();
    const name = message?.name ? ` (${message.name})` : '';
    const sections = [contentToText(message?.content)];
    if (Array.isArray(message?.tool_calls) && message.tool_calls.length > 0) {
        sections.push(`TOOL CALLS\n${JSON.stringify(message.tool_calls, null, 2)}`);
    }
    if (message?.function_call) {
        sections.push(`FUNCTION CALL\n${JSON.stringify(message.function_call, null, 2)}`);
    }
    return `# ${index + 1} ${role}${name}\n${sections.filter(Boolean).join('\n')}`;
}

export function flattenPrompt(payload) {
    if (typeof payload === 'string') {
        return payload;
    }

    if (!Array.isArray(payload)) {
        return JSON.stringify(payload ?? null, null, 2);
    }

    return payload.map(flattenMessage).join('\n\n');
}

function payloadMessageEntries(payload) {
    if (!Array.isArray(payload)) return [];

    const entries = [];
    let blockOffset = 0;
    payload.forEach((message, messageIndex) => {
        const block = flattenMessage(message, messageIndex);
        const rawContent = contentToText(message?.content);
        const content = rawContent.trim();
        if (content) {
            const role = String(message?.role ?? 'unknown').toLocaleLowerCase();
            const header = `# ${messageIndex + 1} ${role.toUpperCase()}${
                message?.name ? ` (${message.name})` : ''
            }\n`;
            const leadingWhitespace = rawContent.length - rawContent.trimStart().length;
            const start = blockOffset + header.length + leadingWhitespace;
            entries.push({
                content,
                end: start + content.length,
                message,
                messageIndex,
                role,
                start,
            });
        }
        blockOffset += block.length + (messageIndex < payload.length - 1 ? 2 : 0);
    });
    return entries;
}

export function findExactRanges(finalText, content, limit = 50) {
    const haystack = String(finalText ?? '');
    const needle = contentToText(content).trim();
    if (!needle) return [];

    const ranges = [];
    let offset = 0;
    while (ranges.length < limit) {
        const start = haystack.indexOf(needle, offset);
        if (start < 0) break;
        ranges.push({ start, end: start + needle.length });
        offset = start + Math.max(1, needle.length);
    }
    return ranges;
}

function normalizeWithMap(value) {
    const normalized = [];
    const starts = [];
    const ends = [];
    let previousWhitespace = false;
    let offset = 0;

    for (const character of String(value ?? '')) {
        const start = offset;
        offset += character.length;
        if (/[\u200B-\u200D\uFEFF]/u.test(character)) continue;

        const transformed = character.normalize('NFKC').toLocaleLowerCase();
        for (const transformedCharacter of transformed) {
            const whitespace = /\s/u.test(transformedCharacter);
            if (whitespace) {
                if (previousWhitespace || normalized.length === 0) continue;
                normalized.push(' ');
                starts.push(start);
                ends.push(offset);
                previousWhitespace = true;
                continue;
            }
            normalized.push(transformedCharacter);
            starts.push(start);
            ends.push(offset);
            previousWhitespace = false;
        }
    }

    if (normalized.at(-1) === ' ') {
        normalized.pop();
        starts.pop();
        ends.pop();
    }
    return { text: normalized.join(''), starts, ends };
}

export function findNormalizedRanges(finalText, content, limit = 50) {
    const haystack = normalizeWithMap(finalText);
    const needle = normalizeWithMap(content).text;
    if (needle.length < 8 || !haystack.text) return [];

    const ranges = [];
    let offset = 0;
    while (ranges.length < limit) {
        const normalizedStart = haystack.text.indexOf(needle, offset);
        if (normalizedStart < 0) break;
        const normalizedEnd = normalizedStart + needle.length;
        ranges.push({
            start: haystack.starts[normalizedStart],
            end: haystack.ends[normalizedEnd - 1],
        });
        offset = normalizedStart + Math.max(1, needle.length);
    }
    return ranges;
}

function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function literalTemplatePattern(value) {
    return escapeRegex(value.normalize('NFKC')).replace(/\s+/g, '\\s+');
}

export function findTemplateRanges(finalText, content, limit = 20) {
    const template = contentToText(content).trim();
    if (template.length > 50_000) {
        return { ranges: [], confidence: null, method: null };
    }
    const macroPattern = /\{\{[^{}\r\n]{1,100}\}\}|\$\{[^{}\r\n]{1,100}\}|<%[^%\r\n]{1,100}%>|<<[^<>\r\n]{1,100}>>/gu;
    const macros = [...template.matchAll(macroPattern)];
    if (macros.length === 0 || macros.length > 20) {
        return { ranges: [], confidence: null, method: null };
    }

    const literals = [];
    let cursor = 0;
    for (const macro of macros) {
        literals.push(template.slice(cursor, macro.index));
        cursor = macro.index + macro[0].length;
    }
    literals.push(template.slice(cursor));
    const literalLength = literals.join('').replace(/\s+/g, '').length;
    const meaningfulLiterals = literals.filter((value) => value.trim());
    if (literalLength < 12 || meaningfulLiterals.length < 2) {
        return { ranges: [], confidence: null, method: null };
    }

    const pattern = meaningfulLiterals
        .map((literal) => literalTemplatePattern(literal))
        .join('[\\s\\S]{0,500}?');
    let expression;
    try {
        expression = new RegExp(pattern, 'giu');
    } catch {
        return { ranges: [], confidence: null, method: null };
    }

    const ranges = [];
    for (const match of String(finalText ?? '').matchAll(expression)) {
        if (!match[0] || match.index == null) continue;
        ranges.push({ start: match.index, end: match.index + match[0].length });
        if (ranges.length >= limit) break;
    }
    if (ranges.length === 0) {
        return { ranges: [], confidence: null, method: null };
    }

    const literalShare = literalLength / Math.max(1, template.replace(/\s+/g, '').length);
    const confidence = Math.max(
        0.55,
        Math.min(0.92, 0.62 + (literalShare * 0.3) - ((macros.length - 1) * 0.03)),
    );
    return {
        ranges,
        confidence: Number(confidence.toFixed(2)),
        method: 'macro-template',
    };
}

function getCharacterData(contextState) {
    const character = contextState.character;
    return character?.data ?? character ?? {};
}

function getCharacterFields(contextState) {
    const character = getCharacterData(contextState);
    return {
        description: contextState.characterFields?.description ?? character.description,
        personality: contextState.characterFields?.personality ?? character.personality,
        scenario: contextState.characterFields?.scenario ?? character.scenario,
        exampleDialogue: contextState.characterFields?.exampleDialogue
            ?? contextState.characterFields?.mesExamples
            ?? character.mes_example,
        firstMessage: contextState.characterFields?.firstMessage
            ?? character.first_mes,
        systemPrompt: contextState.characterFields?.systemPrompt
            ?? contextState.characterFields?.system
            ?? character.system_prompt,
        postHistoryInstructions: contextState.characterFields?.postHistoryInstructions
            ?? contextState.characterFields?.jailbreak
            ?? character.post_history_instructions,
        depthPrompt: contextState.characterFields?.depthPrompt
            ?? contextState.characterFields?.charDepthPrompt
            ?? character.extensions?.depth_prompt?.prompt,
    };
}

function addSource(sources, {
    type,
    label,
    labelKey = null,
    content,
    finalText,
    metadata = {},
    attribution = null,
    included = null,
    configuredEnabled = undefined,
    ranges: providedRanges = null,
    provenance: providedProvenance = null,
}) {
    const text = contentToText(content).trim();
    if (!text) {
        return;
    }

    const hasProvidedRanges = Array.isArray(providedRanges);
    const exactRanges = hasProvidedRanges ? [] : findExactRanges(finalText, text);
    const normalizedRanges = hasProvidedRanges || exactRanges.length
        ? []
        : findNormalizedRanges(finalText, text);
    const templateMatch = hasProvidedRanges || exactRanges.length || normalizedRanges.length
        ? { ranges: [], confidence: null, method: null }
        : findTemplateRanges(finalText, text);
    const ranges = hasProvidedRanges
        ? providedRanges
        : exactRanges.length
            ? exactRanges
            : normalizedRanges.length
                ? normalizedRanges
                : templateMatch.ranges;
    const exactMatch = ranges.length > 0;
    const inferredAttribution = exactRanges.length
        ? 'exact'
        : normalizedRanges.length
            ? 'normalized'
            : templateMatch.ranges.length
                ? 'template'
                : 'unmatched';
    const inferredProvenance = exactRanges.length
        ? { method: 'exact', confidence: 1 }
        : normalizedRanges.length
            ? { method: 'normalized', confidence: 0.95 }
            : templateMatch.ranges.length
                ? { method: templateMatch.method, confidence: templateMatch.confidence }
                : { method: 'unmatched', confidence: 0 };
    sources.push({
        id: `${type}:${sources.length}`,
        type,
        label,
        labelKey,
        content: text,
        color: SOURCE_COLORS[type] ?? SOURCE_COLORS.utility,
        attribution: attribution ?? inferredAttribution,
        included: included ?? exactMatch,
        tokenCount: null,
        metadata,
        ranges,
        provenance: providedProvenance ?? (attribution
            ? { method: attribution, confidence: attribution === 'exact' ? 1 : null }
            : inferredProvenance),
        ...(configuredEnabled !== undefined ? { configuredEnabled } : {}),
    });
}

function classifyConfiguredPrompt(prompt) {
    const identity = `${prompt?.identifier ?? ''} ${prompt?.name ?? ''}`.toLowerCase();
    if (identity.includes('jailbreak')) {
        return 'jailbreak';
    }
    if (identity.includes('main') || identity.includes('system')) {
        return 'system';
    }
    return 'utility';
}

function normalizedConfiguredRole(role) {
    if (role === 0 || role === '0') return 'system';
    if (role === 1ßnº¶‰žËkºwµç|ü¹Õ±°°(€€€€€€€€€€€€€€€€€€€µ•ÍÍ…•%¹‘•à°(€€€€€€€€€€€€€€€ô°(€€€€€€€€€€€ô¤ì(€€€€€€€ô((€€€€€€€¥˜€ …ÉÉ…ä¹¥ÍÉÉ…ä¡µ•ÍÍ…”ü¹½¹Ñ•¹Ð¤¤É•ÑÕÉ¸ì(€€€€€€€µ•ÍÍ…”¹½¹Ñ•¹Ð¹™½É…  ¡Á…ÉÐ°Á…ÉÑ%¹‘•à¤€ôøì(€€€€€€€€€€€½¹ÍÐÑåÁ”€ôµ•‘¥…QåÁ”¡Á…ÉÐ¤ì(€€€€€€€€€€€¥˜€ …ÑåÁ”¤É•ÑÕÉ¸ì(€€€€€€€€€€€…‘‘M½ÕÉ”¡Í½ÕÉ•Ì°ì(€€€€€€€€€€€€€€€ÑåÁ”è€µÕ±Ñ¥µ½‘…°œ°(€€€€€€€€€€€€€€€±…‰•°è5Õ±Ñ¥µ½‘…°€‘íÑåÁ•ô€‘íÁ…ÉÑ%¹‘•à€¬€Åõ€°(€€€€€€€€€€€€€€€±…‰•±-•äèÍ½ÕÉ”¹µÕ±Ñ¥µ½‘…°¸‘íÑåÁ•õ€°(€€€€€€€€€€€€€€€½¹Ñ•¹Ðè½¹Ñ•¹ÑA…ÉÑQ½Q•áÐ¡Á…ÉÐ°Á…ÉÑ%¹‘•à¤°(€€€€€€€€€€€€€€€™¥¹…±Q•áÐ°(€€€€€€€€€€€€€€€µ•Ñ…‘…Ñ„èì(€€€€€€€€€€€€€€€€€€€ÑåÁ”°(€€€€€€€€€€€€€€€€€€€µ•ÍÍ…•%¹‘•à°(€€€€€€€€€€€€€€€€€€€Á…ÉÑ%¹‘•à°(€€€€€€€€€€€€€€€€€€€Ñ½­•¹ÍÑ¥µ…Ñ”è•ÍÑ¥µ…Ñ•5Õ±Ñ¥µ½‘…±Q½­•¹Ì¡ì(€€€€€€€€€€€€€€€€€€€€€€€Á…ÉÐ°(€€€€€€€€€€€€€€€€€€€€€€€ÑåÁ”°(€€€€€€€€€€€€€€€€€€€€€€€ÁÉ½Ù¥‘•È°(€€€€€€€€€€€€€€€€€€€€€€€µ½‘•°°(€€€€€€€€€€€€€€€€€€€ô¤°(€€€€€€€€€€€€€€€ô°(€€€€€€€€€€€ô¤ì(€€€€€€€ô¤ì(€€€ô¤ì)ô()•áÁ½ÉÐ™Õ¹Ñ¥½¸‰Õ¥±‘M½ÕÉ•Ì¡½¹Ñ•áÑMÑ…Ñ”°Á…å±½…°…Ñ¥Ù…Ñ•‘1½É”€ômt°É•ÅÕ•ÍÐ€ô¹Õ±°¤ì(€€€½¹ÍÐ™¥¹…±Q•áÐ€ô™±…ÑÑ•¹AÉ½µÁÐ¡Á…å±½…¤ì(€€€½¹ÍÐÍ½ÕÉ•Ì€ômtì(€€€½¹ÍÐ¡…É…Ñ•È€ô•Ñ¡…É…Ñ•É¥•±‘Ì¡½¹Ñ•áÑMÑ…Ñ”¤ì(€€€½¹ÍÐµ•ÍÍ…•¹ÑÉ¥•Ì€ôÁ…å±½…‘5•ÍÍ…•¹ÑÉ¥•Ì¡Á…å±½…¤ì((€€€…‘‘M½ÕÉ”¡Í½ÕÉ•Ì°ì(€€€€€€€ÑåÁ”è€¡…É…Ñ•Èœ°(€€€€€€€±…‰•°è€¡…É…Ñ•È•ÍÉ¥ÁÑ¥½¸œ°(€€€€€€€±…‰•±-•äè€Í½ÕÉ”¹¡…É…Ñ•É•ÍÉ¥ÁÑ¥½¸œ°(€€€€€€€½¹Ñ•¹Ðè¡…É…Ñ•È¹‘•ÍÉ¥ÁÑ¥½¸°(€€€€€€€™¥¹…±Q•áÐ°(€€€€€€€µ•Ñ…‘…Ñ„èì™¥•±è€‘•ÍÉ¥ÁÑ¥½¸œô°(€€€ô¤ì(€€€…‘‘M½ÕÉ”¡Í½ÕÉ•Ì°ì(€€€€€€€ÑåÁ”è€¡…É…Ñ•Èœ°(€€€€€€€±…‰•°è€¡…É…Ñ•ÈA•ÉÍ½¹…±¥Ñäœ°(€€€€€€€±…‰•±-•äè€Í½ÕÉ”¹¡…É…Ñ•ÉA•ÉÍ½¹…±¥Ñäœ°(€€€€€€€½¹Ñ•¹Ðè¡…É…Ñ•È¹Á•ÉÍ½¹…±¥Ñä°(€€€€€€€™¥¹…±Q•áÐ°(€€€€€€€µ•Ñ…‘…Ñ„èì™¥•±è€Á•ÉÍ½¹…±¥Ñäœô°(€€€ô¤ì(€€€…‘‘M½ÕÉ”¡Í½ÕÉ•Ì°ì(€€€€€€€ÑåÁ”è€¡…É…Ñ•Èœ°(€€€€€€€±…‰•°è€M•¹…É¥¼œ°(€€€€€€€±…‰•±-•äè€Í½ÕÉ”¹Í•¹…É¥¼œ°(€€€€€€€½¹Ñ•¹Ðè¡…É…Ñ•È¹Í•¹…É¥¼°(€€€€€€€™¥¹…±Q•áÐ°(€€€€€€€µ•Ñ…‘…Ñ„èì™¥•±è€Í•¹…É¥¼œô°(€€€ô¤ì(€€€…‘‘M½ÕÉ”¡Í½ÕÉ•Ì°ì(€€€€€€€ÑåÁ”è€¡…É…Ñ•Èœ°(€€€€€€€±…‰•°è€¡…É…Ñ•Èá…µÁ±”¥…±½Õ”œ°(€€€€€€€±…‰•±-•äè€Í½ÕÉ”¹¡…É…Ñ•Éá…µÁ±•Ìœ°(€€€€€€€½¹Ñ•¹Ðè¡…É…Ñ•È¹•á…µÁ±•¥…±½Õ”°(€€€€€€€™¥¹…±Q•áÐ°(€€€€€€€µ•Ñ…‘…Ñ„èì™¥•±è€µ•Í}•á…µÁ±”œô°(€€€ô¤ì(€€€…‘‘M½ÕÉ”¡Í½ÕÉ•Ì°ì(€€€€€€€ÑåÁ”è€¡…É…Ñ•Èœ°(€€€€€€€±…‰•°è€¡…É…Ñ•È¥ÉÍÐ5•ÍÍ…”œ°(€€€€€€€±…‰•±-•äè€Í½ÕÉ”¹¡…É…Ñ•É¥ÉÍÑ5•ÍÍ…”œ°(€€€€€€€½¹Ñ•¹Ðè¡…É…Ñ•È¹™¥ÉÍÑ5•ÍÍ…”°(€€€€€€€™¥¹…±Q•áÐ°(€€€€€€€µ•Ñ…‘…Ñ„èì™¥•±è€™¥ÉÍÑ}µ•Ìœô°(€€€ô¤ì(€€€…‘‘M½ÕÉ”¡Í½ÕÉ•Ì°ì(€€€€€€€ÑåÁ”è€ÍåÍÑ•´œ°(€€€€€€€±…‰•°è€¡…É…Ñ•ÈMåÍÑ•´AÉ½µÁÐœ°(€€€€€€€±…‰•±-•äè€Í½ÕÉ”¹¡…É…Ñ•ÉMåÍÑ•µAÉ½µÁÐœ°(€€€€€€€½¹Ñ•¹Ðè¡…É…Ñ•È¹ÍåÍÑ•µAÉ½µÁÐ°(€€€€€€€™¥¹…±Q•áÐ°(€€€€€€€µ•Ñ…‘…Ñ„èì™¥•±è€ÍåÍÑ•µ}ÁÉ½µÁÐœô°(€€€ô¤ì(€€€…‘‘M½ÕÉ”¡Í½ÕÉ•Ì°ì(€€€€€€€ÑåÁ”è€©…¥±‰É•…¬œ°(€€€€€€€±…‰•°è€¡…É…Ñ•ÈA½ÍÐµ!¥ÍÑ½Éä%¹ÍÑÉÕÑ¥½¹Ìœ°(€€€€€€€±…‰•±-•äè€Í½ÕÉ”¹¡…É…Ñ•ÉA½ÍÑ!¥ÍÑ½Éäœ°(€€€€€€€½¹Ñ•¹Ðè¡…É…Ñ•È¹Á½ÍÑ!¥ÍÑ½Éå%¹ÍÑÉÕÑ¥½¹Ì°(€€€€€€€™¥¹…±Q•áÐ°(€€€€€€€µ•Ñ…‘…Ñ„èì™¥•±è€Á½ÍÑ}¡¥ÍÑ½Éå}¥¹ÍÑÉÕÑ¥½¹Ìœô°(€€€ô¤ì(€€€…‘‘M½ÕÉ”¡Í½ÕÉ•Ì°ì(€€€€€€€ÑåÁ”è€•áÑ•¹Í¥½¸œ°(€€€€€€€±…‰•°è€¡…É…Ñ•È•ÁÑ AÉ½µÁÐœ°(€€€€€€€±…‰•±-•äè€Í½ÕÉ”¹¡…É…Ñ•É•ÁÑ¡AÉ½µÁÐœ°(€€€€€€€½¹Ñ•¹Ðè¡…É…Ñ•È¹‘•ÁÑ¡AÉ½µÁÐ°(€€€€€€€™¥¹…±Q•áÐ°(€€€€€€€µ•Ñ…‘…Ñ„èì™¥•±è€•áÑ•¹Í¥½¹Ì¹‘•ÁÑ¡}ÁÉ½µÁÐ¹ÁÉ½µÁÐœô°(€€€ô¤ì(€€€…‘‘M½ÕÉ”¡Í½ÕÉ•Ì°ì(€€€€€€€ÑåÁ”è€Á•ÉÍ½¹„œ°(€€€€€€€±…‰•°è€A•ÉÍ½¹„œ°(€€€€€€€±…‰•±-•äè€Í½ÕÉ”¹Á•ÉÍ½¹„œ°(€€€€€€€½¹Ñ•¹Ðè½¹Ñ•áÑMÑ…Ñ”¹Á•ÉÍ½¹…•ÍÉ¥ÁÑ¥½¸°(€€€€€€€™¥¹…±Q•áÐ°(€€€ô¤ì(€€€…‘‘M½ÕÉ”¡Í½ÕÉ•Ì°ì(€€€€€€€ÑåÁ”è€…ÕÑ¡½ÉÍ}¹½Ñ”œ°(€€€€€€€±…‰•°è€‰ÕÑ¡½ÈÌ9½Ñ”ˆ°(€€€€€€€±…‰•±-•äè€Í½ÕÉ”¹…ÕÑ¡½ÉÍ9½Ñ”œ°(€€€€€€€½¹Ñ•¹Ðè½¹Ñ•áÑMÑ…Ñ”¹…ÕÑ¡½ÉÍ9½Ñ”°(€€€€€€€™¥¹…±Q•áÐ°(€€€ô¤ì((€€€™½È€¡½¹ÍÐ•¹ÑÉä½˜…Ñ¥Ù…Ñ•‘1½É”¤ì(€€€€€€€…‘‘M½ÕÉ”¡Í½ÕÉ•Ì°ì(€€€€€€€€€€€ÑåÁ”è€±½É•‰½½¬œ°(€€€€€€€€€€€±…‰•°è•¹ÑÉäü¹½µµ•¹Ðñð•¹ÑÉäü¹­•äü¹©½¥¸ œ°€œ¤ñð1½É•‰½½¬•¹ÑÉä€‘í•¹ÑÉäü¹Õ¥€üü€œüõ€°(€€€€€€€€€€€±…‰•±-•äè•¹ÑÉäü¹½µµ•¹Ðñð•¹ÑÉäü¹­•äü¹±•¹Ñ €ü¹Õ±°€è€Í½ÕÉ”¹±½É•‰½½­¹ÑÉäœ°(€€€€€€€€€€€½¹Ñ•¹Ðè•¹ÑÉäü¹½¹Ñ•¹Ð°(€€€€€€€€€€€™¥¹…±Q•áÐ°(€€€€€€€€€€€µ•Ñ…‘…Ñ„èì(€€€€€€€€€€€€€€€Ý½É±è•¹ÑÉäü¹Ý½É±€üü¹Õ±°°(€€€€€€€€€€€€€€€Õ¥è•¹ÑÉäü¹Õ¥€üü¹Õ±°°(€€€€€€€€€€€€€€€Á½Í¥Ñ¥½¸è•¹ÑÉäü¹Á½Í¥Ñ¥½¸€üü¹Õ±°°(€€€€€€€€€€€ô°(€€€€€€€ô¤ì(€€€ô((€€€™½È€¡½¹ÍÐm­•ä°ÁÉ½µÁÑt½˜=‰©•Ð¹•¹ÑÉ¥•Ì¡½¹Ñ•áÑMÑ…Ñ”¹•áÑ•¹Í¥½¹AÉ½µÁÑÌ€üüíô¤¤ì(€€€€€€€…‘‘M½ÕÉ”¡Í½ÕÉ•Ì°ì(€€€€€€€€€€€ÑåÁ”è€•áÑ•¹Í¥½¸œ°(€€€€€€€€€€€±…‰•°èÁÉ½µÁÐü¹¹…µ”ñð­•ä°(€€€€€€€€€€€½¹Ñ•¹ÐèÁÉ½µÁÐü¹Ù…±Õ”€üüÁÉ½µÁÐü¹½¹Ñ•¹Ð°(€€€€€€€€€€€™¥¹…±Q•áÐ°(€€€€€€€€€€€µ•Ñ…‘…Ñ„èì(€€€€€€€€€€€€€€€­•ä°(€€€€€€€€€€€€€€€Á½Í¥Ñ¥½¸èÁÉ½µÁÐü¹Á½Í¥Ñ¥½¸€üü¹Õ±°°(€€€€€€€€€€€€€€€‘•ÁÑ èÁÉ½µÁÐü¹‘•ÁÑ €üü¹Õ±°°(€€€€€€€€€€€€€€€É½±”èÁÉ½µÁÐü¹É½±”€üü¹Õ±°°(€€€€€€€€€€€ô°(€€€€€€€ô¤ì(€€€ô((€€€™½È€¡½¹ÍÐmÁÉ½µÁÑ%¹‘•à°ÁÉ½µÁÑt½˜€¡½¹Ñ•áÑMÑ…Ñ”¹½¹™¥ÕÉ•‘AÉ½µÁÑÌ€üümt¤¹•¹ÑÉ¥•Ì ¤¤ì(€€€€€€€½¹ÍÐÑåÁ”€ô±…ÍÍ¥™å½¹™¥ÕÉ•‘AÉ½µÁÐ¡ÁÉ½µÁÐ¤ì(€€€€€€€½¹ÍÐ½¹™¥ÕÉ•‘¹…‰±•€ôÁÉ½µÁÐü¹•¹…‰±•€üü¹Õ±°ì(€€€€€€€½¹ÍÐµ…Ñ €ô™¥¹‘½¹™¥ÕÉ•‘AÉ½µÁÑ5…Ñ ¡ÁÉ½µÁÐ°µ•ÍÍ…•¹ÑÉ¥•Ì¤ì(€€€€€€€…‘‘M½ÕÉ”¡Í½ÕÉ•Ì°ì(€€€€€€€€€€€ÑåÁ”°(€€€€€€€€€€€±…‰•°èÁÉ½µÁÐü¹¹…µ”ñðÁÉ½µÁÐü¹¥‘•¹Ñ¥™¥•Èñð€½¹™¥ÕÉ•ÁÉ½µÁÐœ°(€€€€€€€€€€€±…‰•±-•äèÁÉ½µÁÐü¹¹…µ”ñðÁÉ½µÁÐü¹¥‘•¹Ñ¥™¥•È€ü¹Õ±°€è€Í½ÕÉ”¹½¹™¥ÕÉ•‘AÉ½µÁÐœ°(€€€€€€€€€€€½¹Ñ•¹ÐèÁÉ½µÁÐü¹½¹Ñ•¹Ð°(€€€€€€€€€€€™¥¹…±Q•áÐ°(€€€€€€€€€€€µ•Ñ…‘…Ñ„èì(€€€€€€€€€€€€€€€Í½ÕÉ•-¥¹è€½¹™¥ÕÉ•‘AÉ½µÁÐœ°(€€€€€€€€€€€€€€€¥‘•¹Ñ¥™¥•ÈèÁÉ½µÁÐü¹¥‘•¹Ñ¥™¥•È€üü¹Õ±°°(€€€€€€€€€€€€€€€¹…µ”èÁÉ½µÁÐü¹¹…µ”€üü¹Õ±°°(€€€€€€€€€€€€€€€É½±”èÁÉ½µÁÐü¹É½±”€üü¹Õ±°°(€€€€€€€€€€€€€€€•¹…‰±•è½¹™¥ÕÉ•‘¹…‰±•°(€€€€€€€€€€€€€€€½¹™¥ÕÉ•‘¹…‰±•°(€€€€€€€€€€€€€€€ÁÉ½µÁÑ=É‘•Èè9Õµ‰•È¹¥Í¥¹¥Ñ”¡ÁÉ½µÁÐü¹ÁÉ½µÁÑ=É‘•È¤(€€€€€€€€€€€€€€€€€€€€üÁÉ½µÁÐ¹ÁÉ½µÁÑ=É‘•È(€€€€€€€€€€€€€€€€€€€€èÁÉ½µÁÑ%¹‘•à°(€€€€€€€€€€€€€€€ÁÉ½µÁÑ=É‘•ÉM½ÕÉ”èÁÉ½µÁÐü¹ÁÉ½µÁÑ=É‘•ÉM½ÕÉ”€üü€…ÁÑÕÉ•µ…ÉÉ…äœ°(€€€€€€€€€€€€€€€Á½Í¥Ñ¥½¸èÁÉ½µÁÐü¹Á½Í¥Ñ¥½¸(€€€€€€€€€€€€€€€€€€€€üüÁÉ½µÁÐü¹¥¹©•Ñ¥½¹}Á½Í¥Ñ¥½¸(€€€€€€€€€€€€€€€€€€€€üüÁÉ½µÁÐü¹¥¹©•Ñ¥½¹A½Í¥Ñ¥½¸(€€€€€€€€€€€€€€€€€€€€üü¹Õ±°°(€€€€€€€€€€€€€€€‘•ÁÑ èÁÉ½µÁÐü¹‘•ÁÑ (€€€€€€€€€€€€€€€€€€€€üüÁÉ½µÁÐü¹¥¹©•Ñ¥½¹}‘•ÁÑ (€€€€€€€€€€€€€€€€€€€€üüÁÉ½µÁÐü¹¥¹©•Ñ¥½¹•ÁÑ (€€€€€€€€€€€€€€€€€€€€üü¹Õ±°°(€€€€€€€€€€€ô°(€€€€€€€€€€€…ÑÑÉ¥‰ÕÑ¥½¸èµ…Ñ ¹…ÑÑÉ¥‰ÕÑ¥½¸°(€€€€€€€€€€€½¹™¥ÕÉ•‘¹…‰±•°(€€€€€€€€€€€¥¹±Õ‘•èµ…Ñ ¹¥¹±Õ‘•°(€€€€€€€€€€€ÁÉ½Ù•¹…¹”èµ…Ñ ¹ÁÉ½Ù•¹…¹”°(€€€€€€€€€€€É…¹•Ìèµ…Ñ ¹É…¹•Ì°(€€€€€€€ô¤ì(€€€ô((€€€…‘‘MÑÉÕÑÕÉ•‘M½ÕÉ•Ì¡Í½ÕÉ•Ì°Á…å±½…°É•ÅÕ•ÍÐ°™¥¹…±Q•áÐ°½¹Ñ•áÑMÑ…Ñ”¤ì(€€€…‘‘U¹…ÑÑÉ¥‰ÕÑ•‘I•ÅÕ•ÍÑMåÍÑ•µM½ÕÉ•Ì¡Í½ÕÉ•Ì°µ•ÍÍ…•¹ÑÉ¥•Ì°™¥¹…±Q•áÐ¤ì((€€€¥˜€¡ÉÉ…ä¹¥ÍÉÉ…ä¡Á…å±½…¤¤ì(€€€€€€€½¹ÍÐ¡¥ÍÑ½Éå5•ÍÍ…•Ì€ôÁ…å±½…¹™¥±Ñ•È ¡µ•ÍÍ…”¤€ôølÕÍ•Èœ°€…ÍÍ¥ÍÑ…¹Ðœ°€Ñ½½°t¹¥¹±Õ‘•Ì¡µ•ÍÍ…”ü¹É½±”¤¤ì(€€€€€€€…‘‘M½ÕÉ”¡Í½ÕÉ•Ì°ì(€€€€€€€€€€€ÑåÁ”è€¡…Ñ}¡¥ÍÑ½Éäœ°(€€€€€€€€€€€±…‰•°è€¡…Ð!¥ÍÑ½Éäœ°(€€€€€€€€€€€±…‰•±-•äè€Í½ÕÉ”¹¡…Ñ!¥ÍÑ½Éäœ°(€€€€€€€€€€€½¹Ñ•¹Ðè™±…ÑÑ•¹AÉ½µÁÐ¡¡¥ÍÑ½Éå5•ÍÍ…•Ì¤°(€€€€€€€€€€€™¥¹…±Q•áÐ°(€€€€€€€€€€€µ•Ñ…‘…Ñ„èìµ•ÍÍ…•½Õ¹Ðè¡¥ÍÑ½Éå5•ÍÍ…•Ì¹±•¹Ñ ô°(€€€€€€€€€€€…ÑÑÉ¥‰ÕÑ¥½¸è€‘•É¥Ù•œ°(€€€€€€€€€€€¥¹±Õ‘•è¡¥ÍÑ½Éå5•ÍÍ…•Ì¹±•¹Ñ €ø€À°(€€€€€€€ô¤ì((€€€€€€€½¹ÍÐ±…ÍÑ5•ÍÍ…”€ôÁ…å±½…¹…Ð ´Ä¤ì(€€€€€€€¥˜€¡±…ÍÑ5•ÍÍ…”ü¹É½±”€ôôô€…ÍÍ¥ÍÑ…¹Ðœ¤ì(€€€€€€€€€€€…‘‘M½ÕÉ”¡Í½ÕÉ•Ì°ì(€€€€€€€€€€€€€€€ÑåÁ”è€…ÍÍ¥ÍÑ…¹Ñ}ÁÉ•™¥±°œ°(€€€€€€€€€€€€€€€±…‰•°è€ÍÍ¥ÍÑ…¹ÐAÉ•™¥±°€¼1…ÍÐÍÍ¥ÍÑ…¹Ð5•ÍÍ…”œ°(€€€€€€€€€€€€€€€±…‰•±-•äè€Í½ÕÉ”¹…ÍÍ¥ÍÑ…¹ÑAÉ•™¥±°œ°(€€€€€€€€€€€€€€€½¹Ñ•¹Ðè±…ÍÑ5•ÍÍ…”¹½¹Ñ•¹Ð°(€€€€€€€€€€€€€€€™¥¹…±Q•áÐ°(€€€€€€€€€€€€€€€µ•Ñ…‘…Ñ„èì¥¹™•ÉÉ•èÑÉÕ”ô°(€€€€€€€€€€€€€€€…ÑÑÉ¥‰ÕÑ¥½¸è€‘•É¥Ù•œ°(€€€€€€€€€€€€€€€¥¹±Õ‘•èÑÉÕ”°(€€€€€€€€€€€ô¤ì(€€€€€€€ô(€€€ô((€€€Í½ÕÉ•Ì¹ÁÕÍ ¡ì(€€€€€€€¥è™¥¹…°è‘íÍ½ÕÉ•Ì¹±•¹Ñ¡õ€°(€€€€€€€ÑåÁ”è€™¥¹…°œ°(€€€€€€€±…‰•°è€¥¹…°AÉ½µÁÐœ°(€€€€€€€±…‰•±-•äè€Í½ÕÉ”¹™¥¹…±AÉ½µÁÐœ°(€€€€€€€½¹Ñ•¹Ðè™¥¹…±Q•áÐ°(€€€€€€€½±½ÈèM=UI}=1=IL¹™¥¹…°°(€€€€€€€…ÑÑÉ¥‰ÕÑ¥½¸è€•á…Ðœ°(€€€€€€€¥¹±Õ‘•èÑÉÕ”°(€€€€€€€Ñ½­•¹½Õ¹Ðè¹Õ±°°(€€€€€€€µ•Ñ…‘…Ñ„èíô°(€€€€€€€É…¹•Ìè™¥¹…±Q•áÐ€ümìÍÑ…ÉÐè€À°•¹è™¥¹…±Q•áÐ¹±•¹Ñ õt€èmt°(€€€€€€€ÁÉ½Ù•¹…¹”èìµ•Ñ¡½è€•á…Ðœ°½¹™¥‘•¹”è€Äô°(€€€ô¤ì((€€€É•ÑÕÉ¸Í½ÕÉ•Ìì)ô()•áÁ½ÉÐ™Õ¹Ñ¥½¸É•…Ñ•M¹…ÁÍ¡½Ñ%¡Ñ¥µ•ÍÑ…µÀ°Á…å±½…¤ì(€€€½¹ÍÐ¥¹ÁÕÐ€ô€‘íÑ¥µ•ÍÑ…µÁôè‘í™±…ÑÑ•¹AÉ½µÁÐ¡Á…å±½…¥õ€ì(€€€±•Ð¡…Í €ô€ÈÄØØÄÌØÈØÄì(€€€™½È€¡±•Ð¥¹‘•à€ô€Àì¥¹‘•à€ð¥¹ÁÕÐ¹±•¹Ñ ì¥¹‘•à€¬ô€Ä¤ì(€€€€€€€¡…Í xô¥¹ÁÕÐ¹¡…É½‘•Ð¡¥¹‘•à¤ì(€€€€€€€¡…Í €ô5…Ñ ¹¥µÕ°¡¡…Í °€ÄØÜÜÜØÄä¤ì(€€€ô(€€€É•ÑÕÉ¸€‘íÑ¥µ•ÍÑ…µÀ¹Ñ½MÑÉ¥¹œ ÌØ¥ô´‘ì¡¡…Í €øøø€À¤¹Ñ½MÑÉ¥¹œ ÌØ¥õ€ì)ô()•áÁ½ÉÐ…Íå¹Œ™Õ¹Ñ¥½¸™¥¹…±¥é•M¹…ÁÍ¡½Ð¡ì(€€€½¹Ñ•áÑMÑ…Ñ”°(€€€Á…å±½…°(€€€ÁÉ½µÁÑQåÁ”°(€€€•¹•É…Ñ¥½¹QåÁ”°(€€€…Ñ¥Ù…Ñ•‘1½É”°(€€€•áÑ•¹Í¥½¹Y•ÉÍ¥½¸°(€€€Ñ½­•¹½Õ¹Ñ•È°(€€€…ÁÑÕÉ”°(€€€É•ÅÕ•ÍÐ°)ô¤ì(€€€½¹ÍÐÑ¥µ•ÍÑ…µÀ€ô…Ñ”¹¹½Ü ¤ì(€€€½¹ÍÐ™¥¹…±Q•áÐ€ô™±…ÑÑ•¹AÉ½µÁÐ¡Á…å±½…¤ì(€€€½¹ÍÐ¹½Éµ…±¥é•‘I•ÅÕ•ÍÐ€ôÉ•ÅÕ•ÍÐ€üüÉ•…Ñ•I•ÅÕ•ÍÑI•½É¡¹Õ±°¤ì(€€€½¹ÍÐÍ½ÕÉ•Ì€ô‰Õ¥±‘M½ÕÉ•Ì¡½¹Ñ•áÑMÑ…Ñ”°Á…å±½…°…Ñ¥Ù…Ñ•‘1½É”°¹½Éµ…±¥é•‘I•ÅÕ•ÍÐ¤ì(€€€½¹ÍÐ¹½Éµ…±¥é•‘…ÁÑÕÉ”€ô…ÁÑÕÉ”€üüÉ•…Ñ•…ÁÑÕÉ•	½Õ¹‘…Éä¡ì(€€€€€€€•Ù•¹Ñ9…µ”èÁÉ½µÁÑQåÁ”€ôôô€¡…Ðµ½µÁ±•Ñ¥½¸œ(€€€€€€€€€€€€ü€!Q}=5A1Q%=9}AI=5AQ}Idœ(€€€€€€€€€€€€è€9IQ}QI}=5	%9}AI=5AQLœ°(€€€€€€€ÍÑ…”è€ÁÉ½µÁÐµÉ•…‘äœ°(€€€€€€€É•ÅÕ•ÍÑ	½‘åÙ…¥±…‰±”è™…±Í”°(€€€€€€€™…±±‰…¬èÑÉÕ”°(€€€ô¤ì(€€€½¹ÍÐ½Õ¹Ð€ô…Íå¹Œ€¡Ñ•áÐ¤€ôøì(€€€€€€€ÑÉäì(€€€€€€€€€€€É•ÑÕÉ¸9Õµ‰•È¡…Ý…¥ÐÑ½­•¹½Õ¹Ñ•È¡Ñ•áÐ¤¤ñð€Àì(€€€€€€€ô…Ñ ì(€€€€€€€€€€€É•ÑÕÉ¸5…Ñ ¹•¥°¡¹•ÜQ•áÑ¹½‘•È ¤¹•¹½‘”¡Ñ•áÐ¤¹±•¹Ñ €¼€Ì¸ÌÔ¤ì(€€€€€€€ô(€€€ôì((€€€½¹ÍÐÑ½­•¹½Õ¹ÑÌ€ô…Ý…¥ÐAÉ½µ¥Í”¹…±°¡Í½ÕÉ•Ì¹µ…À ¡Í½ÕÉ”¤€ôø½Õ¹Ð¡Í½ÕÉ”¹½¹Ñ•¹Ð¤¤¤ì(€€€Í½ÕÉ•Ì¹™½É…  ¡Í½ÕÉ”°¥¹‘•à¤€ôøì(€€€€€€€Í½ÕÉ”¹Ñ½­•¹½Õ¹Ð€ôÑ½­•¹½Õ¹ÑÍm¥¹‘•átì(€€€ô¤ì(€€€½¹ÍÐÑ½Ñ…±Q½­•¹Ì€ô…Ý…¥Ð½Õ¹Ð¡™¥¹…±Q•áÐ¤ì(€€€½¹ÍÐµ…á½¹Ñ•áÐ€ô9Õµ‰•È¡½¹Ñ•áÑMÑ…Ñ”¹µ…á½¹Ñ•áÐ¤ñð¹Õ±°ì(€€€½¹ÍÐÉ•ÅÕ•ÍÑ5…á=ÕÑÁÕÐ€ô¹½Éµ…±¥é•‘I•ÅÕ•ÍÐ¹Í•ÑÑ¥¹Ìü¹µ…á}Ñ½­•¹Ì(€€€€€€€€üü¹½Éµ…±¥é•‘I•ÅÕ•ÍÐ¹Í•ÑÑ¥¹Ìü¹µ…á}½µÁ±•Ñ¥½¹}Ñ½­•¹Ì(€€€€€€€€üü¹½Éµ…±¥é•‘I•ÅÕ•ÍÐ¹Í•ÑÑ¥¹Ìü¹µ…á}¹•Ý}Ñ½­•¹Ì(€€€€€€€€üü¹½Éµ…±¥é•‘I•ÅÕ•ÍÐ¹Í•ÑÑ¥¹Ìü¹µ…á}±•¹Ñ ì(€€€½¹ÍÐµ…á=ÕÑÁÕÐ€ô9Õµ‰•È¡É•ÅÕ•ÍÑ5…á=ÕÑÁÕÐ€üü½¹Ñ•áÑMÑ…Ñ”¹µ…á=ÕÑÁÕÐ¤ñð¹Õ±°ì(€€€½¹ÍÐÕÍ…‰±•½¹Ñ•áÐ€ôµ…á½¹Ñ•áÐ€˜˜µ…á=ÕÑÁÕÐ€ü5…Ñ ¹µ…à À°µ…á½¹Ñ•áÐ€´µ…á=ÕÑÁÕÐ¤€èµ…á½¹Ñ•áÐì(€€€½¹ÍÐµÕ±Ñ¥µ½‘…±ÍÑ¥µ…Ñ•Ì€ôÍ½ÕÉ•Ì(€€€€€€€€¹™¥±Ñ•È ¡Í½ÕÉ”¤€ôøÍ½ÕÉ”¹ÑåÁ”€ôôô€µÕ±Ñ¥µ½‘…°œ¤(€€€€€€€€¹µ…À ¡Í½ÕÉ”¤€ôøÍ½ÕÉ”¹µ•Ñ…‘…Ñ„ü¹Ñ½­•¹ÍÑ¥µ…Ñ”¤(€€€€€€€€¹™¥±Ñ•È¡	½½±•…¸¤ì(€€€½¹ÍÐ•ÍÑ¥µ…Ñ•‘5Õ±Ñ¥µ½‘…°€ôµÕ±Ñ¥µ½‘…±ÍÑ¥µ…Ñ•Ì¹™¥±Ñ•È ¡•ÍÑ¥µ…Ñ”¤€ôø9Õµ‰•È¹¥Í¥¹¥Ñ”¡•ÍÑ¥µ…Ñ”¹Ñ½­•¹Ì¤¤ì(€€€½¹ÍÐ…Á¤€ô½¹Ñ•áÑMÑ…Ñ”¹µ…¥¹Á¤ñð€Õ¹­¹½Ý¸œì(€€€½¹ÍÐÁÉ½Ù¥‘•È€ôÁÉ½µÁÑQåÁ”€ôôô€¡…Ðµ½µÁ±•Ñ¥½¸œ(€€€€€€€€ü™¥ÉÍÑ-¹½Ý¹MÑÉ¥¹œ (€€€€€€€€€€€¹½Éµ…±¥é•‘I•ÅÕ•ÍÐ¹Í•ÑÑ¥¹Ìü¹¡…Ñ}½µÁ±•Ñ¥½¹}Í½ÕÉ”°(€€€€€€€€€€€¹½Éµ…±¥é•‘I•ÅÕ•ÍÐ¹‰½‘äü¹¡…Ñ}½µÁ±•Ñ¥½¹}Í½ÕÉ”°(€€€€€€€€€€€½¹Ñ•áÑMÑ…Ñ”¹¡…Ñ½µÁ±•Ñ¥½¹M½ÕÉ”°(€€€€€€€€€€€…Á¤°(€€€€€€€€€€€€Õ¹­¹½Ý¸œ°(€€€€€€€€¤(€€€€€€€€èÑ•áÑ½µÁ±•Ñ¥½¹AÉ½Ù¥‘•È¡…Á¤°½¹Ñ•áÑMÑ…Ñ”¹Ñ•áÑ½µÁ±•Ñ¥½¹M½ÕÉ”¤ì((€€€É•ÑÕÉ¸ì(€€€€€€€Í¡•µ…Y•ÉÍ¥½¸èM9AM!=Q}M!5}YIM%=8°(€€€€€€€¥èÉ•…Ñ•M¹…ÁÍ¡½Ñ%¡Ñ¥µ•ÍÑ…µÀ°Á…å±½…¤°(€€€€€€€Ñ¥µ•ÍÑ…µÀ°(€€€€€€€•áÑ•¹Í¥½¹Y•ÉÍ¥½¸°(€€€€€€€¡…Ñ%è½¹Ñ•áÑMÑ…Ñ”¹¡…Ñ%ñð€}}±½‰…±}|œ°(€€€€€€€µ•ÍÍ…•½Õ¹Ðè½¹Ñ•áÑMÑ…Ñ”¹µ•ÍÍ…•½Õ¹Ð°(€€€€€€€…Á¤°(€€€€€€€ÁÉ½Ù¥‘•È°(€€€€€€€µ½‘•°è¹½Éµ…±¥é•‘I•ÅÕ•ÍÐ¹Í•ÑÑ¥¹Ìü¹µ½‘•°€üü½¹Ñ•áÑMÑ…Ñ”¹µ½‘•°€üü¹Õ±°°(€€€€€€€ÁÉ•Í•Ðè½¹Ñ•áÑMÑ…Ñ”¹ÁÉ•Í•Ðñð¹Õ±°°(€€€€€€€ÁÉ½µÁÑQåÁ”°(€€€€€€€•¹•É…Ñ¥½¹QåÁ”è•¹•É…Ñ¥½¹QåÁ”ñð€Õ¹­¹½Ý¸œ°(€€€€€€€Á…å±½…°(€€€€€€€™¥¹…±Q•áÐ°(€€€€€€€…ÁÑÕÉ”è¹½Éµ…±¥é•‘…ÁÑÕÉ”°(€€€€€€€É•ÅÕ•ÍÐè¹½Éµ…±¥é•‘I•ÅÕ•ÍÐ°(€€€€€€€Í½ÕÉ•Ì°(€€€€€€€±½É•‰½½­¹ÑÉ¥•Ìè…Ñ¥Ù…Ñ•‘1½É”°(€€€€€€€ÍÑ…ÑÌèì(€€€€€€€€€€€Ñ½Ñ…±Q½­•¹Ì°(€€€€€€€€€€€µ…á½¹Ñ•áÐ°(€€€€€€€€€€€µ…á=ÕÑÁÕÐ°(€€€€€€€€€€€ÕÍ…‰±•½¹Ñ•áÐ°(€€€€€€€€€€€½¹Ñ•áÑUÍ…”èÕÍ…‰±•½¹Ñ•áÐ€üÑ½Ñ…±Q½­•¹Ì€¼ÕÍ…‰±•½¹Ñ•áÐ€è¹Õ±°°(€€€€€€€€€€€É•µ…¥¹¥¹½¹Ñ•áÐèÕÍ…‰±•½¹Ñ•áÐ€ü5…Ñ ¹µ…à À°ÕÍ…‰±•½¹Ñ•áÐ€´Ñ½Ñ…±Q½­•¹Ì¤€è¹Õ±°°(€€€€€€€€€€€ÍÑÉÕÑÕÉ•èì(€€€€€€€€€€€€€€€Ñ½½±M¡•µ…ÌèÍ½ÕÉ•Ì¹™¥±Ñ•È ¡Í½ÕÉ”¤€ôøÍ½ÕÉ”¹ÑåÁ”€ôôô€Ñ½½±}Í¡•µ„œ¤¹±•¹Ñ °(€€€€€€€€€€€€€€€Ñ½½±…±±ÌèÍ½ÕÉ•Ì¹™¥±Ñ•È ¡Í½ÕÉ”¤€ôøÍ½ÕÉ”¹ÑåÁ”€ôôô€Ñ½½±}…±°œ¤¹±•¹Ñ °(€€€€€€€€€€€€€€€Ñ½½±I•ÍÕ±ÑÌèÍ½ÕÉ•Ì¹™¥±Ñ•È ¡Í½ÕÉ”¤€ôøÍ½ÕÉ”¹ÑåÁ”€ôôô€Ñ½½±}É•ÍÕ±Ðœ¤¹±•¹Ñ °(€€€€€€€€€€€€€€€µÕ±Ñ¥µ½‘…±A…ÉÑÌèÍ½ÕÉ•Ì¹™¥±Ñ•È ¡Í½ÕÉ”¤€ôøÍ½ÕÉ”¹ÑåÁ”€ôôô€µÕ±Ñ¥µ½‘…°œ¤¹±•¹Ñ °(€€€€€€€€€€€€€€€µÕ±Ñ¥µ½‘…±ÍÑ¥µ…Ñ•‘Q½­•¹Ìè•ÍÑ¥µ…Ñ•‘5Õ±Ñ¥µ½‘…°(€€€€€€€€€€€€€€€€€€€€¹É•‘Õ” ¡ÍÕ´°•ÍÑ¥µ…Ñ”¤€ôøÍÕ´€¬•ÍÑ¥µ…Ñ”¹Ñ½­•¹Ì°€À¤°(€€€€€€€€€€€€€€€µÕ±Ñ¥µ½‘…±ÍÑ¥µ…Ñ•½Ù•É…”èµÕ±Ñ¥µ½‘…±ÍÑ¥µ…Ñ•Ì¹±•¹Ñ (€€€€€€€€€€€€€€€€€€€€ü•ÍÑ¥µ…Ñ•‘5Õ±Ñ¥µ½‘…°¹±•¹Ñ €¼µÕ±Ñ¥µ½‘…±ÍÑ¥µ…Ñ•Ì¹±•¹Ñ (€€€€€€€€€€€€€€€€€€€€è¹Õ±°°(€€€€€€€€€€€ô°(€€€€€€€ô°(€€€ôì)ô()•áÁ½ÉÐ™Õ¹Ñ¥½¸Í•…É¡M¹…ÁÍ¡½Ð¡Í¹…ÁÍ¡½Ð°ÅÕ•Éä°½ÁÑ¥½¹Ì€ôíô¤ì(€€€½¹ÍÐ¹••‘±”€ôMÑÉ¥¹œ¡ÅÕ•Éä€üü€œœ¤ì(€€€¥˜€ …¹••‘±”¤ì(€€€€€€€É•ÑÕÉ¸mtì(€€€ô((€€€½¹ÍÐ™±…Ì€ô½ÁÑ¥½¹Ì¹…Í•M•¹Í¥Ñ¥Ù”€ü€œœ€è€¤œì(€€€½¹ÍÐ•áÁÉ•ÍÍ¥½¸€ô½ÁÑ¥½¹Ì¹É••à(€€€€€€€€ü¹•ÜI•áÀ¡¹••‘±”°™±…Ì¤(€€€€€€€€è¹•ÜI•áÀ¡¹••‘±”¹É•Á±…” ½l¸¨¬ýx‘íô ¥ñmquqqt½œ°€qp˜œ¤°™±…Ì¤ì(€€€½¹ÍÐÉ•ÍÕ±ÑÌ€ômtì((€€€™½È€¡½¹ÍÐÍ½ÕÉ”½˜Í¹…ÁÍ¡½Ðü¹Í½ÕÉ•Ì€üümt¤ì(€€€€€€€•áÁÉ•ÍÍ¥½¸¹±…ÍÑ%¹‘•à€ô€Àì(€€€€€€€±•Ðµ…Ñ ì(€€€€€€€Ý¡¥±”€ ¡µ…Ñ €ô•áÁÉ•ÍÍ¥½¸¹•á•Œ¡Í½ÕÉ”¹½¹Ñ•¹Ð¤¤€„ôô¹Õ±°€˜˜É•ÍÕ±ÑÌ¹±•¹Ñ €ð€ÈÀÀ¤ì(€€€€€€€€€€€½¹ÍÐÍÑ…ÉÐ€ô5…Ñ ¹µ…à À°µ…Ñ ¹¥¹‘•à€´€ØÀ¤ì(€€€€€€€€€€€½¹ÍÐ•¹€ô5…Ñ ¹µ¥¸¡Í½ÕÉ”¹½¹Ñ•¹Ð¹±•¹Ñ °µ…Ñ ¹¥¹‘•à€¬5…Ñ ¹µ…à¡µ…Ñ¡lÁt¹±•¹Ñ °€Ä¤€¬€ØÀ¤ì(€€€€€€€€€€€É•ÍÕ±ÑÌ¹ÁÕÍ ¡ì(€€€€€€€€€€€€€€€Í½ÕÉ•%èÍ½ÕÉ”¹¥°(€€€€€€€€€€€€€€€Í½ÕÉ•1…‰•°èÍ½ÕÉ•¥ÍÁ±…å1…‰•°¡Í½ÕÉ”¤°(€€€€€€€€€€€€€€€¥¹‘•àèµ…Ñ ¹¥¹‘•à°(€€€€€€€€€€€€€€€±•¹Ñ èµ…Ñ¡lÁt¹±•¹Ñ °(€€€€€€€€€€€€€€€Í¹¥ÁÁ•ÐèÍ½ÕÉ”¹½¹Ñ•¹Ð¹Í±¥”¡ÍÑ…ÉÐ°•¹¤°(€€€€€€€€€€€ô¤ì(€€€€€€€€€€€¥˜€¡µ…Ñ¡lÁt¹±•¹Ñ €ôôô€À¤ì(€€€€€€€€€€€€€€€•áÁÉ•ÍÍ¥½¸¹±…ÍÑ%¹‘•à€¬ô€Äì(€€€€€€€€€€€ô(€€€€€€€ô(€€€€€€€¥˜€¡É•ÍÕ±ÑÌ¹±•¹Ñ €øô€ÈÀÀ¤ì(€€€€€€€€€€€‰É•…¬ì(€€€€€€€ô(€€€ô((€€€É•ÑÕÉ¸É•ÍÕ±ÑÌì)ô()•áÁ½ÉÐ™Õ¹Ñ¥½¸Í•É¥…±¥é•M¹…ÁÍ¡½Ð¡Í¹…ÁÍ¡½Ð°™½Éµ…Ð¤ì(€€€¥˜€¡™½Éµ…Ð€ôôô€©Í½¸œ¤ì(€€€€€€€É•ÑÕÉ¸)M=8¹ÍÑÉ¥¹¥™ä¡Í¹…ÁÍ¡½Ð°¹Õ±°°€È¤ì(€€€ô((€€€½¹ÍÐ¡•…‘•È€ôl(€€€€€€€MP•ÙQ½½±Ìƒ²*“®²Ü€‘íÍ¹…ÁÍ¡½Ð¹¥‘õ€°(€€€€€€€ƒ²ê‡²Ê`ƒ².sªÂè€‘í¹•Ü…Ñ”¡Í¹…ÁÍ¡½Ð¹Ñ¥µ•ÍÑ…µÀ¤¹Ñ½%M=MÑÉ¥¹œ ¥õ€°(€€€€€€€A$ƒªÊ÷®†pè€‘íÍ¹…ÁÍ¡½Ð¹…Á¥õ€°(€€€€€€€ƒ²w²Äƒ²‚sªÎ×²z@è€‘íÁÉ½Ù¥‘•É¥ÍÁ±…å1…‰•°¡Í¹…ÁÍ¡½ÑAÉ½Ù¥‘•È¡Í¹…ÁÍ¡½Ð¤¥õ€°(€€€€€€€ƒ®ª£®6àè€‘íÍ¹…ÁÍ¡½Ð¹µ½‘•°€üüÐ ½µµ½¸¹Õ¹­¹½Ý¸œ¥õ€°(€€€€€€€ƒ¶ƒ¶Àè€‘íÍ¹…ÁÍ¡½Ð¹ÍÑ…ÑÌü¹Ñ½Ñ…±Q½­•¹Ì€üüÐ ½µµ½¸¹Õ¹­¹½Ý¸œ¥õ€°(€€€tì((€€€¥˜€¡™½Éµ…Ð€ôôô€µ…É­‘½Ý¸œ¤ì(€€€€€€€½¹ÍÐÍ•Ñ¥½¹Ì€ôÍ¹…ÁÍ¡½Ð¹Í½ÕÉ•Ì¹µ…À ¡Í½ÕÉ”¤€ôø€ (€€€€€€€€€€€€ŒŒ€‘íÍ½ÕÉ•¥ÍÁ±…å1…‰•°¡Í½ÕÉ”¥õq¹q¹€€¬(€€€€€€€€€€€€´ƒ²rƒ¶bTèq€‘íÍ½ÕÉ”¹ÑåÁ•õqq¹€€¬(€€€€€€€€€€€€´ƒ¶ƒ¶Àè€‘íÍ½ÕÉ”¹Ñ½­•¹½Õ¹Ð€üüÐ ½µµ½¸¹Õ¹­¹½Ý¸œ¥õq¹€€¬(€€€€€€€€€€€€´ƒ²3²*ƒ²^ÃªÊÀè€‘í…ÑÑÉ¥‰ÕÑ¥½¹¥ÍÁ±…å1…‰•°¡Í½ÕÉ”¹…ÑÑÉ¥‰ÕÑ¥½¸¥õq¹q¹€€¬(€€€€€€€€€€€qqqÑ•áÑq¸‘íÍ½ÕÉ”¹½¹Ñ•¹Ð¹É•Á±…•±° €œ°€qq€œ¥õq¹qqq€(€€€€€€€€¤¤ì(€€€€€€€É•ÑÕÉ¸€ŒMP•ÙQ½½±Ìƒ²*“®²Ýq¹q¸‘í¡•…‘•È¹µ…À ¡±¥¹”¤€ôø€´€‘í±¥¹•õ€¤¹©½¥¸ q¸œ¥õq¹q¸‘íÍ•Ñ¥½¹Ì¹©½¥¸ q¹q¸œ¥õ€ì(€€€ô((€€€½¹ÍÐÍ•Ñ¥½¹Ì€ôÍ¹…ÁÍ¡½Ð¹Í½ÕÉ•Ì¹µ…À ¡Í½ÕÉ”¤€ôø€ (€€€€€€€q¹q¸ôôôôô€‘íÍ½ÕÉ•¥ÍÁ±…å1…‰•°¡Í½ÕÉ”¥ôl‘íÍ½ÕÉ”¹ÑåÁ•õt€ôôôôõq¸‘íÍ½ÕÉ”¹½¹Ñ•¹Ñõ€(€€€€¤¤ì(€€€É•ÑÕÉ¸€‘í¡•…‘•È¹©½¥¸ q¸œ¥ô‘íÍ•Ñ¥½¹Ì¹©½¥¸ œœ¥õ€ì)ô(