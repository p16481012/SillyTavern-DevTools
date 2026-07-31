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
import {
    attachProvenanceLocations,
    createProviderTrace,
    jsonPointer,
} from './provenance.js';
import { createLocalEstimatedUsage } from './provider-usage.js';
import { createCaptureBoundary, createRequestRecord } from './request.js';
import { compileUserRegex, UserRegexError } from './regex-safety.js';

export const SNAPSHOT_SCHEMA_VERSION = 7;
export const SEARCH_QUERY_MAX_LENGTH = 512;
const TEMPLATE_REGEX_MAX_LENGTH = 12_000;

function nonEmptyString(value) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized || null;
}

function firstKnownString(...values) {
    const normalized = values.map(nonEmptyString).filter(Boolean);
    return normalized.find((value) => value.toLowerCase() !== 'unknown')
        ?? normalized[0]
        ?? null;
}

function textCompletionProvider(api, source) {
    const normalizedApi = nonEmptyString(api);
    const normalizedSource = nonEmptyString(source);
    const apiKey = normalizedApi?.toLowerCase();
    const sourceKey = normalizedSource?.toLowerCase();
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
    const tracedSource = nonEmptyString(snapshot.providerTrace?.selectedSource?.value);
    if (tracedSource && tracedSource.toLowerCase() !== 'unknown') {
        return tracedSource;
    }
    if (snapshot.promptType && snapshot.promptType !== 'chat-completion') {
        return textCompletionProvider(
            api,
            firstKnownString(tracedSource, snapshot.provider, snapshot.generatingApi),
        );
    }

    return firstKnownString(
        tracedSource,
        snapshot.request?.settings?.chat_completion_source,
        snapshot.request?.body?.chat_completion_source,
        snapshot.provider,
        snapshot.generatingApi,
        api,
        'unknown',
    );
}

function selectedProviderTrace({
    api,
    promptType,
    generationType,
    request,
    contextState,
}) {
    if (promptType === 'chat-completion') {
        const bodySource = firstKnownString(
            request?.body?.chat_completion_source,
        );
        const settingsSource = firstKnownString(
            request?.settings?.chat_completion_source,
        );
        const requestSource = firstKnownString(bodySource, settingsSource);
        if (requestSource && requestSource.toLowerCase() !== 'unknown') {
            return createProviderTrace({
                api,
                promptType,
                generationType,
                selectedSource: requestSource,
                selectedSourceStatus: 'captured',
                selectedSourcePointer: bodySource
                    && bodySource.toLowerCase() !== 'unknown'
                    ? '/request/body/chat_completion_source'
                    : '/request/settings/chat_completion_source',
            });
        }
        const contextSource = firstKnownString(contextState.chatCompletionSource);
        if (contextSource && contextSource.toLowerCase() !== 'unknown') {
            return createProviderTrace({
                api,
                promptType,
                generationType,
                selectedSource: contextSource,
                selectedSourceStatus: 'context-fallback',
                selectedSourcePointer: '/provider',
            });
        }
        const fallbackApi = firstKnownString(api, 'unknown');
        return createProviderTrace({
            api,
            promptType,
            generationType,
            selectedSource: fallbackApi,
            selectedSourceStatus: fallbackApi === 'unknown'
                ? 'unknown'
                : 'context-fallback',
            selectedSourcePointer: fallbackApi === 'unknown' ? null : '/api',
        });
    }

    const selectedSource = textCompletionProvider(
        api,
        contextState.textCompletionSource,
    );
    const sourceFromContext = firstKnownString(contextState.textCompletionSource);
    return createProviderTrace({
        api,
        promptType,
        generationType,
        selectedSource,
        selectedSourceStatus: selectedSource === 'unknown'
            ? 'unknown'
            : 'context-fallback',
        selectedSourcePointer: selectedSource === 'unknown'
            ? null
            : sourceFromContext
                ? '/provider'
                : '/api',
    });
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
    const type = String(part?.type ?? '').toLowerCase();
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

function contentWithLocations(content, messageIndex, role) {
    if (!Array.isArray(content)) {
        const text = contentToText(content);
        const directText = typeof content === 'string';
        return {
            text,
            locations: text
                ? [{
                    jsonPointer: jsonPointer('payload', messageIndex, 'content'),
                    messageIndex,
                    role,
                    valueRange: directText ? { start: 0, end: text.length } : null,
                    finalRange: { start: 0, end: text.length },
                }]
                : [],
        };
    }

    const sections = content.map((part, partIndex) => {
        const text = String(contentPartToText(part, partIndex) ?? '');
        const directText = typeof part === 'string'
            || (
                ['text', 'input_text', 'output_text'].includes(part?.type)
                && typeof part.text === 'string'
            );
        return {
            text,
            jsonPointer: typeof part === 'string'
                ? jsonPointer('payload', messageIndex, 'content', partIndex)
                : directText
                    ? jsonPointer('payload', messageIndex, 'content', partIndex, 'text')
                    : jsonPointer('payload', messageIndex, 'content', partIndex),
            directText,
        };
    });
    const locations = [];
    let offset = 0;
    sections.forEach((section, index) => {
        if (section.text) {
            locations.push({
                jsonPointer: section.jsonPointer,
                messageIndex,
                role,
                valueRange: section.directText
                    ? { start: 0, end: section.text.length }
                    : null,
                finalRange: {
                    start: offset,
                    end: offset + section.text.length,
                },
            });
        }
        offset += section.text.length + (index < sections.length - 1 ? 1 : 0);
    });
    return {
        text: sections.map(({ text }) => text).join('\n'),
        locations,
    };
}

function flattenMessageWithLocations(message, index, blockOffset = 0) {
    const role = String(message?.role ?? 'unknown').toUpperCase();
    const normalizedRole = role.toLowerCase();
    const name = message?.name ? ` (${message.name})` : '';
    const header = `# ${index + 1} ${role}${name}\n`;
    const content = contentWithLocations(message?.content, index, normalizedRole);
    const sections = [{
        text: content.text,
        locations: content.locations,
    }];
    if (Array.isArray(message?.tool_calls) && message.tool_calls.length > 0) {
        const serialized = JSON.stringify(message.tool_calls, null, 2);
        sections.push({
            text: `TOOL CALLS\n${serialized}`,
            locations: [{
                jsonPointer: jsonPointer('payload', index, 'tool_calls'),
                messageIndex: index,
                role: normalizedRole,
                valueRange: null,
                finalRange: {
                    start: 'TOOL CALLS\n'.length,
                    end: 'TOOL CALLS\n'.length + serialized.length,
                },
            }],
        });
    }
    if (message?.function_call) {
        const serialized = JSON.stringify(message.function_call, null, 2);
        sections.push({
            text: `FUNCTION CALL\n${serialized}`,
            locations: [{
                jsonPointer: jsonPointer('payload', index, 'function_call'),
                messageIndex: index,
                role: normalizedRole,
                valueRange: null,
                finalRange: {
                    start: 'FUNCTION CALL\n'.length,
                    end: 'FUNCTION CALL\n'.length + serialized.length,
                },
            }],
        });
    }
    const presentSections = sections.filter(({ text }) => Boolean(text));
    const locations = [];
    let sectionOffset = header.length;
    presentSections.forEach((section, sectionIndex) => {
        for (const location of section.locations) {
            locations.push({
                ...location,
                finalRange: location.finalRange
                    ? {
                        start: blockOffset + sectionOffset + location.finalRange.start,
                        end: blockOffset + sectionOffset + location.finalRange.end,
                    }
                    : null,
            });
        }
        sectionOffset += section.text.length
            + (sectionIndex < presentSections.length - 1 ? 1 : 0);
    });
    const text = `${header}${presentSections.map(({ text }) => text).join('\n')}`;
    const rawContent = content.text;
    const trimmedContent = rawContent.trim();
    const leadingWhitespace = rawContent.length - rawContent.trimStart().length;
    const messageEntry = trimmedContent
        ? {
            content: trimmedContent,
            end: blockOffset + header.length + leadingWhitespace + trimmedContent.length,
            jsonPointer: jsonPointer('payload', index, 'content'),
            message,
            messageIndex: index,
            role: normalizedRole,
            start: blockOffset + header.length + leadingWhitespace,
        }
        : null;
    return { text, locations, messageEntry };
}

export function flattenPromptWithLocations(payload) {
    if (typeof payload === 'string') {
        return {
            text: payload,
            locations: payload
                ? [{
                    jsonPointer: jsonPointer('payload'),
                    messageIndex: null,
                    role: null,
                    valueRange: { start: 0, end: payload.length },
                    finalRange: { start: 0, end: payload.length },
                }]
                : [],
            messageEntries: [],
        };
    }

    if (!Array.isArray(payload)) {
        const text = JSON.stringify(payload ?? null, null, 2);
        return {
            text,
            locations: text
                ? [{
                    jsonPointer: jsonPointer('payload'),
                    messageIndex: null,
                    role: null,
                    valueRange: null,
                    finalRange: { start: 0, end: text.length },
                }]
                : [],
            messageEntries: [],
        };
    }

    const blocks = [];
    const locations = [];
    const messageEntries = [];
    let blockOffset = 0;
    payload.forEach((message, index) => {
        const block = flattenMessageWithLocations(message, index, blockOffset);
        blocks.push(block.text);
        locations.push(...block.locations);
        if (block.messageEntry) messageEntries.push(block.messageEntry);
        blockOffset += block.text.length + (index < payload.length - 1 ? 2 : 0);
    });
    return {
        text: blocks.join('\n\n'),
        locations,
        messageEntries,
    };
}

export function flattenPrompt(payload) {
    return flattenPromptWithLocations(payload).text;
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

        const transformed = character.normalize('NFKC').toLowerCase();
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
    const noMatch = () => ({ ranges: [], confidence: null, method: null });
    const template = contentToText(content).trim();
    if (template.length > 50_000) {
        return noMatch();
    }
    const macroPattern = /\{\{[^{}\r\n]{1,100}\}\}|\$\{[^{}\r\n]{1,100}\}|<%[^%\r\n]{1,100}%>|<<[^<>\r\n]{1,100}>>/gu;
    const macros = [...template.matchAll(macroPattern)];
    if (macros.length === 0 || macros.length > 20) {
        return noMatch();
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
        return noMatch();
    }

    const pattern = meaningfulLiterals
        .map((literal) => literalTemplatePattern(literal))
        .join('[\\s\\S]{0,500}?');
    if (pattern.length > TEMPLATE_REGEX_MAX_LENGTH) return noMatch();

    const ranges = [];
    try {
        const expression = new RegExp(pattern, 'giu');
        for (const match of String(finalText ?? '').matchAll(expression)) {
            if (!match[0] || match.index == null) continue;
            ranges.push({ start: match.index, end: match.index + match[0].length });
            if (ranges.length >= limit) break;
        }
    } catch {
        // Some browser engines defer compiling large expressions until the first match.
        return noMatch();
    }

    if (ranges.length === 0) {
        return noMatch();
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

function provenanceLocationsForRanges(ranges, payloadLocations) {
    const locations = [];
    for (const range of ranges ?? []) {
        if (!Number.isFinite(range?.start) || !Number.isFinite(range?.end)) continue;
        for (const payloadLocation of payloadLocations ?? []) {
            const payloadRange = payloadLocation?.finalRange;
            if (!payloadRange) continue;
            const start = Math.max(range.start, payloadRange.start);
            const end = Math.min(range.end, payloadRange.end);
            if (end <= start) continue;

            let valueRange = null;
            if (
                payloadLocation.valueRange
                && payloadRange.end - payloadRange.start
                    === payloadLocation.valueRange.end - payloadLocation.valueRange.start
            ) {
                valueRange = {
                    start: payloadLocation.valueRange.start + start - payloadRange.start,
                    end: payloadLocation.valueRange.start + end - payloadRange.start,
                };
            }
            locations.push({
                jsonPointer: payloadLocation.jsonPointer,
                messageIndex: payloadLocation.messageIndex,
                role: payloadLocation.role,
                valueRange,
                finalRange: { start, end },
            });
        }
    }
    return locations;
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
    provenanceLocations = [],
    payloadLocations = [],
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
    const provenance = providedProvenance ?? (attribution
        ? { method: attribution, confidence: attribution === 'exact' ? 1 : null }
        : inferredProvenance);
    const locations = [
        ...(providedProvenance?.locations ?? []),
        ...provenanceLocations,
        ...provenanceLocationsForRanges(ranges, payloadLocations),
    ];
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
        provenance: attachProvenanceLocations(provenance, locations),
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

    const normalized = String(role ?? '').trim().toLowerCase();
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

function createConfiguredPromptMatcher(messageEntries) {
    const candidateGroups = new Map();
    const matchCaches = {
        exact: new Map(),
        normalized: new Map(),
        template: new Map(),
    };
    const claimedRanges = [];

    const groupKeyForPrompt = (prompt) => normalizedConfiguredRole(prompt?.role)
        ?? '__system-or-developer__';
    const candidatesForPrompt = (prompt) => {
        const groupKey = groupKeyForPrompt(prompt);
        if (!candidateGroups.has(groupKey)) {
            candidateGroups.set(
                groupKey,
                configuredPromptCandidates(messageEntries, prompt),
            );
        }
        return { groupKey, candidates: candidateGroups.get(groupKey) };
    };
    const claimedRangeIndex = (range) => {
        let low = 0;
        let high = claimedRanges.length;
        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (claimedRanges[middle].start < range.start) low = middle + 1;
            else high = middle;
        }
        return low;
    };
    const overlapsClaimedRange = ({ range }) => {
        const index = claimedRangeIndex(range);
        const previous = claimedRanges[index - 1];
        const next = claimedRanges[index];
        return Boolean(
            (previous && range.start < previous.end && range.end > previous.start)
            || (next && range.start < next.end && range.end > next.start)
        );
    };
    const claimRange = (range) => {
        claimedRanges.splice(claimedRangeIndex(range), 0, range);
    };
    const cacheFor = (kind, groupKey, content, candidates) => {
        const cacheKey = `${groupKey}\u0000${content}`;
        const cache = matchCaches[kind];
        if (cache.has(cacheKey)) return cache.get(cacheKey);

        const occurrences = [];
        for (const entry of candidates) {
            if (kind === 'template') {
                const match = findTemplateRanges(entry.content, content);
                for (const range of offsetRanges(match.ranges, entry.start)) {
                    occurrences.push({
                        range,
                        messageIndex: entry.messageIndex,
                        confidence: Number.isFinite(match.confidence)
                            ? match.confidence
                            : 0.55,
                    });
                }
                continue;
            }
            const localRanges = kind === 'exact'
                ? findExactRanges(entry.content, content)
                : findNormalizedRanges(entry.content, content);
            for (const range of offsetRanges(localRanges, entry.start)) {
                occurrences.push({
                    range,
                    messageIndex: entry.messageIndex,
                    confidence: kind === 'exact' ? 1 : 0.95,
                });
            }
        }
        const result = { occurrences, cursor: 0 };
        cache.set(cacheKey, result);
        return result;
    };
    const claimFrom = (cached) => {
        while (
            cached.cursor < cached.occurrences.length
            && overlapsClaimedRange(cached.occurrences[cached.cursor])
        ) {
            cached.cursor += 1;
        }
        if (cached.cursor >= cached.occurrences.length) return null;
        const occurrence = cached.occurrences[cached.cursor];
        cached.cursor += 1;
        claimRange(occurrence.range);
        return occurrence;
    };

    return (prompt) => {
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
        if (!content) {
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

        const { groupKey, candidates } = candidatesForPrompt(prompt);
        const exact = cacheFor('exact', groupKey, content, candidates);
        const exactOccurrence = claimFrom(exact);
        if (exactOccurrence) {
            return {
                attribution: 'exact',
                included: true,
                provenance: {
                    method: 'configured-payload-exact',
                    confidence: 1,
                    messageIndexes: [exactOccurrence.messageIndex],
                    candidateCount: exact.occurrences.length,
                    ambiguous: exact.occurrences.length > 1,
                },
                ranges: [exactOccurrence.range],
            };
        }

        const normalized = cacheFor('normalized', groupKey, content, candidates);
        const normalizedOccurrence = claimFrom(normalized);
        if (normalizedOccurrence) {
            return {
                attribution: 'normalized',
                included: true,
                provenance: {
                    method: 'configured-payload-normalized',
                    confidence: 0.95,
                    messageIndexes: [normalizedOccurrence.messageIndex],
                    candidateCount: normalized.occurrences.length,
                    ambiguous: normalized.occurrences.length > 1,
                },
                ranges: [normalizedOccurrence.range],
            };
        }

        const template = cacheFor('template', groupKey, content, candidates);
        const templateOccurrence = claimFrom(template);
        if (templateOccurrence) {
            return {
                attribution: 'template',
                included: true,
                provenance: {
                    method: 'configured-payload-template',
                    matcher: 'macro-template',
                    confidence: templateOccurrence.confidence,
                    messageIndexes: [templateOccurrence.messageIndex],
                    candidateCount: template.occurrences.length,
                    ambiguous: template.occurrences.length > 1,
                },
                ranges: [templateOccurrence.range],
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
    };
}

function findConfiguredPromptMatch(prompt, matchConfiguredPrompt) {
    if (typeof matchConfiguredPrompt === 'function') {
        return matchConfiguredPrompt(prompt);
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

function addUnattributedRequestSystemSources(
    sources,
    messageEntries,
    finalText,
    payloadLocations,
) {
    const requestEntries = messageEntries.filter(
        (entry) => ['system', 'developer'].includes(entry.role),
    );
    const includedRanges = mergeRanges(sources
        .filter((source) => source.included !== false)
        .flatMap((source) => source.ranges ?? []));
    let coveredIndex = 0;
    for (const entry of requestEntries) {
        const roleLabel = entry.role === 'developer' ? '개발자' : '시스템';
        while (
            coveredIndex < includedRanges.length
            && includedRanges[coveredIndex].end <= entry.start
        ) {
            coveredIndex += 1;
        }
        const covered = [];
        for (
            let index = coveredIndex;
            index < includedRanges.length && includedRanges[index].start < entry.end;
            index += 1
        ) {
            const range = includedRanges[index];
            const intersection = {
                start: Math.max(entry.start, range.start),
                end: Math.min(entry.end, range.end),
            };
            if (intersection.end > intersection.start) covered.push(intersection);
        }

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
            payloadLocations,
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

function addStructuredSources(
    sources,
    payload,
    request,
    finalText,
    contextState,
    payloadLocations,
) {
    const requestBody = request?.body ?? request ?? {};
    const provider = detectMultimodalProvider(contextState, request);
    const model = request?.settings?.model ?? requestBody?.model ?? contextState?.model ?? '';
    const toolSchemas = [
        ...(Array.isArray(requestBody?.tools)
            ? requestBody.tools.map((schema, index) => ({
                schema,
                legacy: false,
                pointer: jsonPointer('request', 'body', 'tools', index),
            }))
            : []),
        ...(Array.isArray(requestBody?.functions)
            ? requestBody.functions.map((definition, index) => ({
                schema: { type: 'function', function: definition },
                legacy: true,
                pointer: jsonPointer('request', 'body', 'functions', index),
            }))
            : []),
    ];
    toolSchemas.forEach(({ schema, legacy, pointer }, index) => {
        const name = schema?.function?.name ?? schema?.name ?? String(index + 1);
        addSource(sources, {
            type: 'tool_schema',
            label: `Tool schema ${name}`,
            labelKey: 'source.toolSchema',
            content: JSON.stringify(schema, null, 2),
            finalText,
            payloadLocations,
            metadata: { name, index, legacy },
            attribution: 'derived',
            included: true,
            provenanceLocations: [{
                jsonPointer: pointer,
                messageIndex: null,
                role: null,
                valueRange: null,
                finalRange: null,
            }],
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
                payloadLocations,
                metadata: { name, messageIndex, callIndex },
                attribution: 'derived',
                included: true,
                provenanceLocations: [{
                    jsonPointer: Array.isArray(message?.tool_calls)
                        ? jsonPointer('payload', messageIndex, 'tool_calls', callIndex)
                        : jsonPointer('payload', messageIndex, 'function_call'),
                    messageIndex,
                    role: String(message?.role ?? 'unknown').toLowerCase(),
                    valueRange: null,
                    finalRange: null,
                }],
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
                payloadLocations,
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
                payloadLocations,
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

function assistantPrefillEvidence(request) {
    const body = request?.body ?? request;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    const explicitFields = [
        'assistant_prefill',
        'continue_prefill',
        'prefill',
    ];
    for (const field of explicitFields) {
        const value = body[field];
        if (value === true || (typeof value === 'string' && value.trim())) {
            return jsonPointer('request', 'body', field);
        }
    }
    return null;
}

export function buildSources(contextState, payload, activatedLore = [], request = null) {
    const flattened = flattenPromptWithLocations(payload);
    const finalText = flattened.text;
    const payloadLocations = flattened.locations;
    const sources = [];
    const character = getCharacterFields(contextState);
    const messageEntries = flattened.messageEntries;
    const matchConfiguredPrompt = createConfiguredPromptMatcher(messageEntries);
    const add = (options) => addSource(sources, {
        ...options,
        finalText,
        payloadLocations,
    });

    add({
        type: 'character',
        label: 'Character Description',
        labelKey: 'source.characterDescription',
        content: character.description,
        finalText,
        metadata: { field: 'description' },
    });
    add({
        type: 'character',
        label: 'Character Personality',
        labelKey: 'source.characterPersonality',
        content: character.personality,
        finalText,
        metadata: { field: 'personality' },
    });
    add({
        type: 'character',
        label: 'Scenario',
        labelKey: 'source.scenario',
        content: character.scenario,
        finalText,
        metadata: { field: 'scenario' },
    });
    add({
        type: 'character',
        label: 'Character Example Dialogue',
        labelKey: 'source.characterExamples',
        content: character.exampleDialogue,
        finalText,
        metadata: { field: 'mes_example' },
    });
    add({
        type: 'character',
        label: 'Character First Message',
        labelKey: 'source.characterFirstMessage',
        content: character.firstMessage,
        finalText,
        metadata: { field: 'first_mes' },
    });
    add({
        type: 'system',
        label: 'Character System Prompt',
        labelKey: 'source.characterSystemPrompt',
        content: character.systemPrompt,
        finalText,
        metadata: { field: 'system_prompt' },
    });
    add({
        type: 'jailbreak',
        label: 'Character Post-History Instructions',
        labelKey: 'source.characterPostHistory',
        content: character.postHistoryInstructions,
        finalText,
        metadata: { field: 'post_history_instructions' },
    });
    add({
        type: 'extension',
        label: 'Character Depth Prompt',
        labelKey: 'source.characterDepthPrompt',
        content: character.depthPrompt,
        finalText,
        metadata: { field: 'extensions.depth_prompt.prompt' },
    });
    add({
        type: 'persona',
        label: 'Persona',
        labelKey: 'source.persona',
        content: contextState.personaDescription,
        finalText,
    });
    add({
        type: 'authors_note',
        label: "Author's Note",
        labelKey: 'source.authorsNote',
        content: contextState.authorsNote,
        finalText,
    });

    for (const entry of activatedLore) {
        add({
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
        add({
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
        const match = findConfiguredPromptMatch(prompt, matchConfiguredPrompt);
        add({
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

    addStructuredSources(
        sources,
        payload,
        request,
        finalText,
        contextState,
        payloadLocations,
    );
    addUnattributedRequestSystemSources(
        sources,
        messageEntries,
        finalText,
        payloadLocations,
    );

    if (Array.isArray(payload)) {
        const historyMessages = payload.filter((message) => ['user', 'assistant', 'tool'].includes(message?.role));
        add({
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
            const explicitPrefillPointer = assistantPrefillEvidence(request);
            const prefillStatus = explicitPrefillPointer ? 'confirmed' : 'inferred';
            const messageIndex = payload.length - 1;
            add({
                type: 'assistant_prefill',
                label: 'Assistant Prefill / Last Assistant Message',
                labelKey: 'source.assistantPrefill',
                content: lastMessage.content,
                finalText,
                metadata: {
                    inferred: prefillStatus === 'inferred',
                    prefillStatus,
                },
                attribution: 'derived',
                included: true,
                provenance: {
                    method: explicitPrefillPointer
                        ? 'assistant-prefill-explicit'
                        : 'assistant-prefill-inferred',
                    confidence: explicitPrefillPointer ? 1 : 0.5,
                    messageIndexes: [messageIndex],
                },
                provenanceLocations: explicitPrefillPointer
                    ? [{
                        jsonPointer: explicitPrefillPointer,
                        messageIndex: null,
                        role: null,
                        valueRange: null,
                        finalRange: null,
                    }]
                    : [],
            });
        }
    }

    add({
        type: 'final',
        label: 'Final Prompt',
        labelKey: 'source.finalPrompt',
        content: finalText,
        attribution: 'exact',
        included: true,
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
    const tokenCountsByText = new Map();
    const count = (text) => {
        const content = String(text ?? '');
        if (!tokenCountsByText.has(content)) {
            tokenCountsByText.set(content, (async () => {
                try {
                    return Number(await tokenCounter(content)) || 0;
                } catch {
                    return Math.ceil(new TextEncoder().encode(content).length / 3.35);
                }
            })());
        }
        return tokenCountsByText.get(content);
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
    const providerTrace = selectedProviderTrace({
        api,
        promptType,
        generationType,
        request: normalizedRequest,
        contextState,
    });
    const provider = providerTrace.selectedSource.value;

    return {
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        id: createSnapshotId(timestamp, payload),
        timestamp,
        extensionVersion,
        chatId: contextState.chatId || '__global__',
        messageCount: contextState.messageCount,
        api,
        provider,
        providerTrace,
        model: normalizedRequest.settings?.model ?? contextState.model ?? null,
        preset: contextState.preset || null,
        profileContext: contextState.profileContext ?? null,
        promptType,
        generationType: generationType || 'unknown',
        payload,
        finalText,
        capture: normalizedCapture,
        request: normalizedRequest,
        sources,
        lorebookEntries: activatedLore,
        usage: createLocalEstimatedUsage({
            inputTokens: totalTokens,
            outputTokens: null,
            cachedInputTokens: null,
            totalTokens: null,
        }, {
            sourceEvent: 'local-prompt-tokenizer',
            correlatedAt: timestamp,
        }),
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
    if (needle.length > SEARCH_QUERY_MAX_LENGTH) {
        throw new UserRegexError('query-too-long');
    }

    const flags = options.caseSensitive ? 'gu' : 'giu';
    const expression = options.regex
        ? compileUserRegex(needle, flags)
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
