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
    if (type === 'image') return `[이미지 입력 ${number}]`;
    if (type === 'audio') return `[오디오 입력 ${number}]`;
    if (type === 'video') return `[비디오 입력 ${number}]`;
    if (type === 'file') return `[파일 입력 ${number}]`;
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
    if (role === 1 || role === '1') return 'user';
    if (role === 2 || role === '2') return 'assistant';

    const normalized = String(role ?? '').trim().toLocaleLowerCase();
    return ['system', 'developer', 'user', 'assistant'].includes(normalized)
        ? normalized
        : null;
}

function configuredPromptCandidates(messageEntries, prompt) {
    const role = normalizedConfiguredRole(prompt?.role);
    if (role) {
        return messageEntries.filter((entry) => entry.role === role);
    }
    return messageEntries.filter((entry) => ['system', 'developer'].includes(entry.role));
}

function offsetRanges(ranges, offset) {
    return ranges.map((range) => ({
        start: offset + range.start,
        end: offset + range.end,
    }));
}

function findConfiguredPromptMatch(prompt, messageEntries) {
    const configuredEnabled = prompt?.enabled ?? null;
    if (configuredEnabled === false) {
        return {
            attribution: 'unmatched',
            included: false,
            provenance: {
                method: 'configured-disabled',
                confidence: 1,
                messageIndexes: [],
            },
            ranges: [],
        };
    }

    const content = contentToText(prompt?.content).trim();
    const candidates = configuredPromptCandidates(messageEntries, prompt);
    const exactRanges = [];
    const exactMessageIndexes = new Set();
    candidates.forEach((entry) => {
        const localRanges = findExactRanges(entry.content, content);
        if (!localRanges.length) return;
        exactRanges.push(...offsetRanges(localRanges, entry.start));
        exactMessageIndexes.add(entry.messageIndex);
    });
    if (exactRanges.length) {
        return {
            attribution: 'exact',
            included: true,
            provenance: {
                method: 'configured-payload-exact',
                confidence: 1,
                messageIndexes: [...exactMessageIndexes],
            },
            ranges: exactRanges,
        };
    }

    const normalizedRanges = [];
    const normalizedMessageIndexes = new Set();
    candidates.forEach((entry) => {
        const localRanges = findNormalizedRanges(entry.content, content);
        if (!localRanges.length) return;
        normalizedRanges.push(...offsetRanges(localRanges, entry.start));
        normalizedMessageIndexes.add(entry.messageIndex);
    });
    if (normalizedRanges.length) {
        return {
            attribution: 'normalized',
            included: true,
            provenance: {
                method: 'configured-payload-normalized',
                confidence: 0.95,
                messageIndexes: [...normalizedMessageIndexes],
            },
            ranges: normalizedRanges,
        };
    }

    const templateRanges = [];
    const templateMessageIndexes = new Set();
    const templateConfidences = [];
    candidates.forEach((entry) => {
        const match = findTemplateRanges(entry.content, content);
        if (!match.ranges.length) return;
        templateRanges.push(...offsetRanges(match.ranges, entry.start));
        templateMessageIndexes.add(entry.messageIndex);
        if (Number.isFinite(match.confidence)) templateConfidences.push(match.confidence);
    });
    if (templateRanges.length) {
        return {
            attribution: 'template',
            included: true,
            provenance: {
                method: 'configured-payload-template',
                matcher: 'macro-template',
                confidence: templateConfidences.length
                    ? Math.min(...templateConfidences)
                    : 0.55,
                messageIndexes: [...templateMessageIndexes],
            },
            ranges: templateRanges,
        };
    }

    return {
        attribution: 'unmatched',
        included: false,
        provenance: {
            method: 'configured-payload-unmatched',
            confidence: 0,
            messageIndexes: [],
        },
        ranges: [],
    };
}

function mergeRanges(ranges) {
    const sorted = ranges
        .filter((range) => Number.isFinite(range?.start) && Number.isFinite(range?.end))
        .filter((range) => range.end > range.start)
        .sort((left, right) => left.start - right.start || left.end - right.end);
    const merged = [];
    for (const range of sorted) {
        const previous = merged.at(-1);
        if (!previous || range.start > previous.end) {
            merged.push({ ...range });
            continue;
        }
        previous.end = Math.max(previous.end, range.end);
    }
    return merged;
}

function trimRange(finalText, range) {
    let start = range.start;
    let end = range.end;
    while (start < end && /\s/u.test(finalText[start])) start += 1;
    while (end > start && /\s/u.test(finalText[end - 1])) end -= 1;
    return { start, end };
}

function meaningfulRequestFragment(value) {
    return String(value ?? '').replace(/[\s\p{P}\p{S}]/gu, '').length > 0;
}

function addUnattributedRequestSystemSources(sources, messageEntries, finalText) {
    const requestEntries = messageEntries.filter(
        (entry) => ['system', 'developer'].includes(entry.role),
    );
    for (const entry of requestEntries) {
        const roleLabel = entry.role === 'developer' ? '개발자' : '시스템';
        const covered = mergeRanges(sources
            .filter((source) => source.included !== false)
            .flatMap((source) => source.ranges ?? [])
            .map((range) => ({
                start: Math.max(entry.start, range.start),
                end: Math.min(entry.end, range.end),
            }))
            .filter((range) => range.end > range.start));

        const gaps = [];
        let cursor = entry.start;
        for (const range of covered) {
            if (range.start > cursor) gaps.push({ start: cursor, end: range.start });
            cursor = Math.max(cursor, range.end);
        }
        if (cursor < entry.end) gaps.push({ start: cursor, end: entry.end });

        const unattributedRanges = gaps
            .map((range) => trimRange(finalText, range))
            .filter((range) => range.end > range.start)
            .filter((range) => meaningfulRequestFragment(
                finalText.slice(range.start, range.end),
            ));
        if (!unattributedRanges.length) continue;

        addSource(sources, {
            type: 'system',
            label: entry.message?.name
                ? `요청 ${roleLabel} 메시지 (${entry.message.name})`
                : `요청 ${roleLabel} 메시지 ${entry.messageIndex + 1}`,
            content: unattributedRanges
                .map((range) => finalText.slice(range.start, range.end))
                .join('\n'),
            finalText,
            metadata: {
                sourceKind: 'requestMessage',
                messageIndex: entry.messageIndex,
                name: entry.message?.name ?? null,
                role: entry.role,
                segmentCount: unattributedRanges.length,
            },
            attribution: 'exact',
            included: true,
            ranges: unattributedRanges,
            provenance: {
                method: 'request-payload',
                confidence: 1,
                messageIndexes: [entry.messageIndex],
            },
        });
    }
}

function addStructuredSources(sources, payload, request, finalText, contextState) {
    const requestBody = request?.body ?? request ?? {};
    const provider = detectMultimodalProvider(contextState, request);
    const model = request?.settings?.model ?? requestBody?.model ?? contextState?.model ?? '';
    const toolSchemas = [
        ...(Array.isArray(requestBody?.tools)
            ? requestBody.tools.map((schema) => ({ schema, legacy: false }))
            : []),
        ...(Array.isArray(requestBody?.functions)
            ? requestBody.functions.map((definition) => ({
                schema: { type: 'function', function: definition },
                legacy: true,
            }))
            : []),
    ];
    toolSchemas.forEach(({ schema, legacy }, index) => {
        const name = schema?.function?.name ?? schema?.name ?? String(index + 1);
        addSource(sources, {
            type: 'tool_schema',
            label: `Tool schema ${name}`,
            labelKey: 'source.toolSchema',
            content: JSON.stringify(schema, null, 2),
            finalText,
            metadata: { name, index, legacy },
            attribution: 'derived',
            included: true,
        });
    });

    if (!Array.isArray(payload)) return;
    payload.forEach((message, messageIndex) => {
        const calls = Array.isArray(message?.tool_calls)
            ? message.tool_calls
            : message?.function_call
                ? [message.function_call]
                : [];
        calls.forEach((call, callIndex) => {
            const name = call?.function?.name ?? call?.name ?? String(callIndex + 1);
            addSource(sources, {
                type: 'tool_call',
                label: `Tool call ${name}`,
                labelKey: 'source.toolCall',
                content: JSON.stringify(call, null, 2),
                finalText,
                metadata: { name, messageIndex, callIndex },
                attribution: 'derived',
                included: true,
            });
        });

        if (message?.role === 'tool') {
            const name = message?.name ?? message?.tool_call_id ?? String(messageIndex + 1);
            addSource(sources, {
                type: 'tool_result',
                label: `Tool result ${name}`,
                labelKey: 'source.toolResult',
                content: message.content,
                finalText,
                metadata: {
                    name,
                    toolCallId: message?.tool_call_id ?? null,
                    messageIndex,
                },
            });
        }

        if (!Array.isArray(message?.content)) return;
        message.content.forEach((part, partIndex) => {
            const type = mediaType(part);
            if (!type) return;
            addSource(sources, {
                type: 'multimodal',
                label: `Multimodal ${type} ${partIndex + 1}`,
                labelKey: `source.multimodal.${type}`,
                content: contentPartToText(part, partIndex),
                finalText,
                metadata: {
                    type,
                    messageIndex,
                    partIndex,
                    tokenEstimate: estimateMultimodalTokens({
                        part,
                        type,
                        provider,
                        model,
                    }),
                },
            });
        });
    });
}

export function buildSources(contextState, payload, activatedLore = [], request = null) {
    const finalText = flattenPrompt(payload);
    const sources = [];
    const character = getCharacterFields(contextState);
    const messageEntries = payloadMessageEntries(payload);

    addSource(sources, {
        type: 'character',
        label: 'Character Description',
        labelKey: 'source.characterDescription',
        content: character.description,
        finalText,
        metadata: { field: 'description' },
    });
    addSource(sources, {
        type: 'character',
        label: 'Character Personality',
        labelKey: 'source.characterPersonality',
        content: character.personality,
        finalText,
        metadata: { field: 'personality' },
    });
    addSource(sources, {
        type: 'character',
        label: 'Scenario',
        labelKey: 'source.scenario',
        content: character.scenario,
        finalText,
        metadata: { field: 'scenario' },
    });
    addSource(sources, {
        type: 'character',
        label: 'Character Example Dialogue',
        labelKey: 'source.characterExamples',
        content: character.exampleDialogue,
        finalText,
        metadata: { field: 'mes_example' },
    });
    addSource(sources, {
        type: 'character',
        label: 'Character First Message',
        labelKey: 'source.characterFirstMessage',
        content: character.firstMessage,
        finalText,
        metadata: { field: 'first_mes' },
    });
    addSource(sources, {
        type: 'system',
        label: 'Character System Prompt',
        labelKey: 'source.characterSystemPrompt',
        content: character.systemPrompt,
        finalText,
        metadata: { field: 'system_prompt' },
    });
    addSource(sources, {
        type: 'jailbreak',
        label: 'Character Post-History Instructions',
        labelKey: 'source.characterPostHistory',
        content: character.postHistoryInstructions,
        finalText,
        metadata: { field: 'post_history_instructions' },
    });
    addSource(sources, {
        type: 'extension',
        label: 'Character Depth Prompt',
        labelKey: 'source.characterDepthPrompt',
        content: character.depthPrompt,
        finalText,
        metadata: { field: 'extensions.depth_prompt.prompt' },
    });
    addSource(sources, {
        type: 'persona',
        label: 'Persona',
        labelKey: 'source.persona',
        content: contextState.personaDescription,
        finalText,
    });
    addSource(sources, {
        type: 'authors_note',
        label: "Author's Note",
        labelKey: 'source.authorsNote',
        content: contextState.authorsNote,
        finalText,
    });

    for (const entry of activatedLore) {
        addSource(sources, {
            type: 'lorebook',
            label: entry?.comment || entry?.key?.join(', ') || `Lorebook entry ${entry?.uid ?? '?'}`,
            labelKey: entry?.comment || entry?.key?.length ? null : 'source.lorebookEntry',
            content: entry?.content,
            finalText,
            metadata: {
                world: entry?.world ?? null,
                uid: entry?.uid ?? null,
                position: entry?.position ?? null,
            },
        });
    }

    for (const [key, prompt] of Object.entries(contextState.extensionPrompts ?? {})) {
        addSource(sources, {
            type: 'extension',
            label: prompt?.name || key,
            content: prompt?.value ?? prompt?.content,
            finalText,
            metadata: {
                key,
                position: prompt?.position ?? null,
                depth: prompt?.depth ?? null,
                role: prompt?.role ?? null,
            },
        });
    }

    for (const [promptIndex, prompt] of (contextState.configuredPrompts ?? []).entries()) {
        const type = classifyConfiguredPrompt(prompt);
        const configuredEnabled = prompt?.enabled ?? null;
        const match = findConfiguredPromptMatch(prompt, messageEntries);
        addSource(sources, {
            type,
            label: prompt?.name || prompt?.identifier || 'Configured prompt',
            labelKey: prompt?.name || prompt?.identifier ? null : 'source.configuredPrompt',
            content: prompt?.content,
            finalText,
            metadata: {
                sourceKind: 'configuredPrompt',
                identifier: prompt?.identifier ?? null,
                name: prompt?.name ?? null,
                role: prompt?.role ?? null,
                enabled: configuredEnabled,
                configuredEnabled,
                promptOrder: Number.isFinite(prompt?.promptOrder)
                    ? prompt.promptOrder
                    : promptIndex,
                promptOrderSource: prompt?.promptOrderSource ?? 'captured-array',
                position: prompt?.position
                    ?? prompt?.injection_position
                    ?? prompt?.injectionPosition
                    ?? null,
                depth: prompt?.depth
                    ?? prompt?.injection_depth
                    ?? prompt?.injectionDepth
                    ?? null,
            },
            attribution: match.attribution,
            configuredEnabled,
            included: match.included,
            provenance: match.provenance,
            ranges: match.ranges,
        });
    }

    addStructuredSources(sources, payload, request, finalText, contextState);
    addUnattributedRequestSystemSources(sources, messageEntries, finalText);

    if (Array.isArray(payload)) {
        const historyMessages = payload.filter((message) => ['user', 'assistant', 'tool'].includes(message?.role));
        addSource(sources, {
            type: 'chat_history',
            label: 'Chat History',
            labelKey: 'source.chatHistory',
            content: flattenPrompt(historyMessages),
            finalText,
            metadata: { messageCount: historyMessages.length },
            attribution: 'derived',
            included: historyMessages.length > 0,
        });

        const lastMessage = payload.at(-1);
        if (lastMessage?.role === 'assistant') {
            addSource(sources, {
                type: 'assistant_prefill',
                label: 'Assistant Prefill / Last Assistant Message',
                labelKey: 'source.assistantPrefill',
                content: lastMessage.content,
                finalText,
                metadata: { inferred: true },
                attribution: 'derived',
                included: true,
            });
        }
    }

    sources.push({
        id: `final:${sources.length}`,
        type: 'final',
        label: 'Final Prompt',
        labelKey: 'source.finalPrompt',
        content: finalText,
        color: SOURCE_COLORS.final,
        attribution: 'exact',
        included: true,
        tokenCount: null,
        metadata: {},
        ranges: finalText ? [{ start: 0, end: finalText.length }] : [],
        provenance: { method: 'exact', confidence: 1 },
    });

    return sources;
}

export function createSnapshotId(timestamp, payload) {
    const input = `${timestamp}:${flattenPrompt(payload)}`;
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `${timestamp.toString(36)}-${(hash >>> 0).toString(36)}`;
}

export async function finalizeSnapshot({
    contextState,
    payload,
    promptType,
    generationType,
    activatedLore,
    extensionVersion,
    tokenCounter,
    capture,
    request,
}) {
    const timestamp = Date.now();
    const finalText = flattenPrompt(payload);
    const normalizedRequest = request ?? createRequestRecord(null);
    const sources = buildSources(contextState, payload, activatedLore, normalizedRequest);
    const normalizedCapture = capture ?? createCaptureBoundary({
        eventName: promptType === 'chat-completion'
            ? 'CHAT_COMPLETION_PROMPT_READY'
            : 'GENERATE_AFTER_COMBINE_PROMPTS',
        stage: 'prompt-ready',
        requestBodyAvailable: false,
        fallback: true,
    });
    const count = async (text) => {
        try {
            return Number(await tokenCounter(text)) || 0;
        } catch {
            return Math.ceil(new TextEncoder().encode(text).length / 3.35);
        }
    };

    const tokenCounts = await Promise.all(sources.map((source) => count(source.content)));
    sources.forEach((source, index) => {
        source.tokenCount = tokenCounts[index];
    });
    const totalTokens = await count(finalText);
    const maxContext = Number(contextState.maxContext) || null;
    const requestMaxOutput = normalizedRequest.settings?.max_tokens
        ?? normalizedRequest.settings?.max_completion_tokens
        ?? normalizedRequest.settings?.max_new_tokens
        ?? normalizedRequest.settings?.max_length;
    const maxOutput = Number(requestMaxOutput ?? contextState.maxOutput) || null;
    const usableContext = maxContext && maxOutput ? Math.max(0, maxContext - maxOutput) : maxContext;
    const multimodalEstimates = sources
        .filter((source) => source.type === 'multimodal')
        .map((source) => source.metadata?.tokenEstimate)
        .filter(Boolean);
    const estimatedMultimodal = multimodalEstimates.filter((estimate) => Number.isFinite(estimate.tokens));
    const api = contextState.mainApi || 'unknown';
    const provider = promptType === 'chat-completion'
        ? firstKnownString(
            normalizedRequest.settings?.chat_completion_source,
            normalizedRequest.body?.chat_completion_source,
            contextState.chatCompletionSource,
            api,
            'unknown',
        )
        : textCompletionProvider(api, contextState.textCompletionSource);

    return {
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        id: createSnapshotId(timestamp, payload),
        timestamp,
        extensionVersion,
        chatId: contextState.chatId || '__global__',
        messageCount: contextState.messageCount,
        api,
        provider,
        model: normalizedRequest.settings?.model ?? contextState.model ?? null,
        preset: contextState.preset || null,
        promptType,
        generationType: generationType || 'unknown',
        payload,
        finalText,
        capture: normalizedCapture,
        request: normalizedRequest,
        sources,
        lorebookEntries: activatedLore,
        stats: {
            totalTokens,
            maxContext,
            maxOutput,
            usableContext,
            contextUsage: usableContext ? totalTokens / usableContext : null,
            remainingContext: usableContext ? Math.max(0, usableContext - totalTokens) : null,
            structured: {
                toolSchemas: sources.filter((source) => source.type === 'tool_schema').length,
                toolCalls: sources.filter((source) => source.type === 'tool_call').length,
                toolResults: sources.filter((source) => source.type === 'tool_result').length,
                multimodalParts: sources.filter((source) => source.type === 'multimodal').length,
                multimodalEstimatedTokens: estimatedMultimodal
                    .reduce((sum, estimate) => sum + estimate.tokens, 0),
                multimodalEstimateCoverage: multimodalEstimates.length
                    ? estimatedMultimodal.length / multimodalEstimates.length
                    : null,
            },
        },
    };
}

export function searchSnapshot(snapshot, query, options = {}) {
    const needle = String(query ?? '');
    if (!needle) {
        return [];
    }

    const flags = options.caseSensitive ? 'g' : 'gi';
    const expression = options.regex
        ? new RegExp(needle, flags)
        : new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    const results = [];

    for (const source of snapshot?.sources ?? []) {
        expression.lastIndex = 0;
        let match;
        while ((match = expression.exec(source.content)) !== null && results.length < 200) {
            const start = Math.max(0, match.index - 60);
            const end = Math.min(source.content.length, match.index + Math.max(match[0].length, 1) + 60);
            results.push({
                sourceId: source.id,
                sourceLabel: sourceDisplayLabel(source),
                index: match.index,
                length: match[0].length,
                snippet: source.content.slice(start, end),
            });
            if (match[0].length === 0) {
                expression.lastIndex += 1;
            }
        }
        if (results.length >= 200) {
            break;
        }
    }

    return results;
}

export function serializeSnapshot(snapshot, format) {
    if (format === 'json') {
        return JSON.stringify(snapshot, null, 2);
    }

    const header = [
        `ST DevTools 스냅샷 ${snapshot.id}`,
        `캡처 시각: ${new Date(snapshot.timestamp).toISOString()}`,
        `API 경로: ${snapshot.api}`,
        `생성 제공자: ${providerDisplayLabel(snapshotProvider(snapshot))}`,
        `모델: ${snapshot.model ?? t('common.unknown')}`,
        `토큰: ${snapshot.stats?.totalTokens ?? t('common.unknown')}`,
    ];

    if (format === 'markdown') {
        const sections = snapshot.sources.map((source) => (
            `## ${sourceDisplayLabel(source)}\n\n` +
            `- 유형: \`${source.type}\`\n` +
            `- 토큰: ${source.tokenCount ?? t('common.unknown')}\n` +
            `- 소스 연결: ${attributionDisplayLabel(source.attribution)}\n\n` +
            `\`\`\`text\n${source.content.replaceAll('```', '``\\`')}\n\`\`\``
        ));
        return `# ST DevTools 스냅샷\n\n${header.map((line) => `- ${line}`).join('\n')}\n\n${sections.join('\n\n')}`;
    }

    const sections = snapshot.sources.map((source) => (
        `\n\n===== ${sourceDisplayLabel(source)} [${source.type}] =====\n${source.content}`
    ));
    return `${header.join('\n')}${sections.join('')}`;
}
