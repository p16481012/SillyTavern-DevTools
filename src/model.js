import {
    attributionDisplayLabel,
    sourceDisplayLabel,
    t,
} from './i18n.js';

export const SNAPSHOT_SCHEMA_VERSION = 1;

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
            .map((part) => {
                if (typeof part === 'string') {
                    return part;
                }
                if (part?.type === 'text' && typeof part.text === 'string') {
                    return part.text;
                }
                return JSON.stringify(part);
            })
            .join('\n');
    }

    if (content == null) {
        return '';
    }

    return typeof content === 'object' ? JSON.stringify(content, null, 2) : String(content);
}

export function flattenPrompt(payload) {
    if (typeof payload === 'string') {
        return payload;
    }

    if (!Array.isArray(payload)) {
        return JSON.stringify(payload ?? null, null, 2);
    }

    return payload
        .map((message, index) => {
            const role = String(message?.role ?? 'unknown').toUpperCase();
            const name = message?.name ? ` (${message.name})` : '';
            return `# ${index + 1} ${role}${name}\n${contentToText(message?.content)}`;
        })
        .join('\n\n');
}

function getCharacterData(contextState) {
    const character = contextState.character;
    return character?.data ?? character ?? {};
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
}) {
    const text = contentToText(content).trim();
    if (!text) {
        return;
    }

    const exactMatch = finalText.includes(text);
    sources.push({
        id: `${type}:${sources.length}`,
        type,
        label,
        labelKey,
        content: text,
        color: SOURCE_COLORS[type] ?? SOURCE_COLORS.utility,
        attribution: attribution ?? (exactMatch ? 'exact' : 'unmatched'),
        included: included ?? exactMatch,
        tokenCount: null,
        metadata,
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

export function buildSources(contextState, payload, activatedLore = []) {
    const finalText = flattenPrompt(payload);
    const sources = [];
    const character = getCharacterData(contextState);

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

    for (const prompt of contextState.configuredPrompts ?? []) {
        const type = classifyConfiguredPrompt(prompt);
        addSource(sources, {
            type,
            label: prompt?.name || prompt?.identifier || 'Configured prompt',
            labelKey: prompt?.name || prompt?.identifier ? null : 'source.configuredPrompt',
            content: prompt?.content,
            finalText,
            metadata: {
                identifier: prompt?.identifier ?? null,
                role: prompt?.role ?? null,
                enabled: prompt?.enabled ?? null,
            },
        });
    }

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
}) {
    const timestamp = Date.now();
    const finalText = flattenPrompt(payload);
    const sources = buildSources(contextState, payload, activatedLore);
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
    const maxOutput = Number(contextState.maxOutput) || null;
    const usableContext = maxContext && maxOutput ? Math.max(0, maxContext - maxOutput) : maxContext;

    return {
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        id: createSnapshotId(timestamp, payload),
        timestamp,
        extensionVersion,
        chatId: contextState.chatId || '__global__',
        messageCount: contextState.messageCount,
        api: contextState.mainApi || 'unknown',
        model: contextState.model || null,
        preset: contextState.preset || null,
        promptType,
        generationType: generationType || 'unknown',
        payload,
        finalText,
        sources,
        lorebookEntries: activatedLore,
        stats: {
            totalTokens,
            maxContext,
            maxOutput,
            usableContext,
            contextUsage: usableContext ? totalTokens / usableContext : null,
            remainingContext: usableContext ? Math.max(0, usableContext - totalTokens) : null,
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
        `API: ${snapshot.api}`,
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
