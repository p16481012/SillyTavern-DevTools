export const SEMANTIC_PROMPT_SETTINGS_KEY = 'st-devtools:semantic-prompt:v1';
export const MAX_SEMANTIC_USER_PROMPT_LENGTH = 8_192;
export const MAX_SEMANTIC_PREFILL_LENGTH = 1_024;

export const DEFAULT_SEMANTIC_PROMPT_SETTINGS = Object.freeze({
    version: 1,
    userPrompt: '',
    assistantPrefill: '',
});

function boundedText(value, maximum, field) {
    const text = value == null ? '' : String(value);
    if (text.length > maximum || /[\u0000\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(text)) {
        const error = new Error(`invalid-${field}`);
        error.code = `invalid-${field}`;
        throw error;
    }
    return text.replace(/\r\n?/gu, '\n');
}

export function normalizeSemanticPromptSettings(value = {}) {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
        return { ...DEFAULT_SEMANTIC_PROMPT_SETTINGS };
    }
    return {
        version: 1,
        userPrompt: boundedText(
            value.userPrompt,
            MAX_SEMANTIC_USER_PROMPT_LENGTH,
            'semantic-user-prompt',
        ),
        assistantPrefill: boundedText(
            value.assistantPrefill,
            MAX_SEMANTIC_PREFILL_LENGTH,
            'semantic-prefill',
        ),
    };
}

export function readSemanticPromptSettings(storage = globalThis.localStorage) {
    try {
        const raw = storage?.getItem?.(SEMANTIC_PROMPT_SETTINGS_KEY);
        if (raw == null) return { ...DEFAULT_SEMANTIC_PROMPT_SETTINGS };
        return normalizeSemanticPromptSettings(JSON.parse(raw));
    } catch {
        return { ...DEFAULT_SEMANTIC_PROMPT_SETTINGS };
    }
}

export function saveSemanticPromptSettings(
    value,
    storage = globalThis.localStorage,
) {
    const normalized = normalizeSemanticPromptSettings(value);
    const serialized = JSON.stringify(normalized);
    storage?.setItem?.(SEMANTIC_PROMPT_SETTINGS_KEY, serialized);
    if (storage?.getItem?.(SEMANTIC_PROMPT_SETTINGS_KEY) !== serialized) {
        const error = new Error('semantic-prompt-storage-write-failed');
        error.code = 'semantic-prompt-storage-write-failed';
        throw error;
    }
    return normalized;
}
