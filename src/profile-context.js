const PROFILE_CONTEXT_VERSION = 1;
const LABEL_MAX_LENGTH = 120;

function normalizedText(value) {
    return typeof value === 'string'
        ? value.normalize('NFKC').replace(/\s+/gu, ' ').trim()
        : '';
}

function firstText(...values) {
    return values.map(normalizedText).find(Boolean) ?? '';
}

function hash32(value, seed) {
    let hash = seed >>> 0;
    for (const character of value) {
        hash ^= character.codePointAt(0);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

export function scopeFingerprint(kind, value) {
    const normalizedKind = normalizedText(kind).toLowerCase();
    const normalizedValue = normalizedText(value).toLowerCase();
    if (!normalizedKind || !normalizedValue) return null;
    const input = `st-devtools:scope:v1:${normalizedKind}:${normalizedValue}`;
    return `scope-v1:${input.length}:${hash32(input, 0x811c9dc5)}${
        hash32(input, 0x9e3779b9)
    }`;
}

function contextEntry(kind, identity, label = identity) {
    const normalizedIdentity = normalizedText(identity);
    if (!normalizedIdentity) return null;
    return {
        key: scopeFingerprint(kind, normalizedIdentity),
        label: firstText(label, normalizedIdentity).slice(0, LABEL_MAX_LENGTH),
    };
}

function presetIdentity(preset) {
    if (typeof preset === 'string') return preset;
    return firstText(
        preset?.identifier,
        preset?.id,
        preset?.name,
        preset?.preset_name,
        preset?.label,
    );
}

function namespacedPresetIdentity(preset, presetNamespace) {
    const value = presetIdentity(preset);
    const namespace = firstText(presetNamespace);
    if (!value || !namespace) return value;
    return JSON.stringify(['preset-owner-v1', namespace, value]);
}

function presetLabel(preset, fallback) {
    if (typeof preset === 'string') return preset;
    return firstText(
        preset?.name,
        preset?.preset_name,
        preset?.label,
        fallback,
    );
}

function characterIdentity(character, characterId) {
    const data = character?.data ?? {};
    return firstText(
        character?.avatar,
        data?.avatar,
        character?.id,
        data?.id,
        characterId == null ? '' : String(characterId),
        character?.name,
        data?.name,
    );
}

function characterLabel(character, fallback) {
    return firstText(character?.name, character?.data?.name, fallback);
}

function groupIdentity(group, groupId) {
    const data = group?.data ?? {};
    return firstText(
        group?.id == null ? '' : String(group.id),
        data?.id == null ? '' : String(data.id),
        group?.group_id == null ? '' : String(group.group_id),
        groupId == null ? '' : String(groupId),
        group?.avatar,
        data?.avatar,
        group?.name,
        data?.name,
    );
}

function chatIdentity({
    chatId,
    character,
    characterId,
    group,
    groupId,
}) {
    const chatValue = firstText(chatId == null ? '' : String(chatId));
    if (!chatValue) return '';

    const groupValue = groupIdentity(group, groupId);
    if (groupValue) {
        return JSON.stringify(['chat-owner-v1', 'group', groupValue, chatValue]);
    }

    const characterValue = characterIdentity(character, characterId);
    if (characterValue) {
        return JSON.stringify([
            'chat-owner-v1',
            'character',
            characterValue,
            chatValue,
        ]);
    }

    // Preserve the deterministic legacy fallback when SillyTavern does not
    // expose either a character or group owner for the current chat.
    return chatValue;
}

export function createProfileContext({
    chatId = null,
    preset = null,
    presetNamespace = null,
    character = null,
    characterId = null,
    group = null,
    groupId = null,
} = {}) {
    const presetValue = namespacedPresetIdentity(preset, presetNamespace);
    const presetLabelValue = presetIdentity(preset);
    const characterValue = characterIdentity(character, characterId);
    return {
        version: PROFILE_CONTEXT_VERSION,
        global: { key: '*', label: '전체' },
        preset: contextEntry(
            'preset',
            presetValue,
            presetLabel(preset, presetLabelValue),
        ),
        character: contextEntry(
            'character',
            characterValue,
            characterLabel(character, characterValue),
        ),
        chat: contextEntry(
            'chat',
            chatIdentity({
                chatId,
                character,
                characterId,
                group,
                groupId,
            }),
            chatId == null ? '' : String(chatId),
        ),
    };
}

export function normalizeProfileContext(value = {}) {
    const entry = (kind) => {
        const raw = value?.[kind];
        const key = normalizedText(raw?.key);
        if (!key) return null;
        return {
            key: key.slice(0, 160),
            label: normalizedText(raw?.label).slice(0, LABEL_MAX_LENGTH),
        };
    };
    return {
        version: PROFILE_CONTEXT_VERSION,
        global: { key: '*', label: '전체' },
        preset: entry('preset'),
        character: entry('character'),
        chat: entry('chat'),
    };
}

export const PROFILE_SCOPE_KINDS = Object.freeze([
    'global',
    'preset',
    'character',
    'chat',
]);
