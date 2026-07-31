const MAX_PROFILE_ID_LENGTH = 256;
const MAX_IDENTITY_LENGTH = 256;
const MAX_SUPPORTED_PROFILES = 1_000;

export const SEMANTIC_CONNECTION_PROFILE_LIST_STATUS = Object.freeze({
    AVAILABLE: 'available',
    UNAVAILABLE: 'unavailable',
});

export function normalizeSemanticConnectionProfileId(value) {
    if (
        typeof value !== 'string'
        || value.length === 0
        || value.length > MAX_PROFILE_ID_LENGTH
        || /[\u0000-\u001f\u007f]/u.test(value)
    ) {
        return null;
    }
    return value;
}

function safeIdentityString(value) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    if (
        normalized.length === 0
        || normalized.length > MAX_IDENTITY_LENGTH
        || /[\u0000-\u001f\u007f]/u.test(normalized)
    ) {
        return null;
    }
    return normalized;
}

function ownDataValue(value, key) {
    if (!value || typeof value !== 'object') return undefined;
    try {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return descriptor && 'value' in descriptor
            ? descriptor.value
            : undefined;
    } catch {
        return undefined;
    }
}

function readConnectionManagerService(context) {
    let service;
    try {
        service = context?.ConnectionManagerRequestService;
        if (
            (typeof service !== 'function' && (!service || typeof service !== 'object'))
            || typeof service.getSupportedProfiles !== 'function'
            || typeof service.sendRequest !== 'function'
        ) {
            return null;
        }
    } catch {
        return null;
    }
    return service;
}

function readSupportedProfileRecords(context) {
    const service = readConnectionManagerService(context);
    if (!service) return null;
    try {
        const profiles = service.getSupportedProfiles();
        if (!Array.isArray(profiles)) return null;
        return {
            service,
            profiles: profiles.slice(0, MAX_SUPPORTED_PROFILES),
        };
    } catch {
        return null;
    }
}

function connectionDescriptorForProfile(profile, service) {
    const profileApi = safeIdentityString(ownDataValue(profile, 'api'));
    let validateProfile;
    try {
        validateProfile = service?.validateProfile;
    } catch {
        return null;
    }
    if (typeof validateProfile === 'function') {
        try {
            const map = validateProfile.call(service, profile);
            const selected = safeIdentityString(ownDataValue(map, 'selected'));
            if (selected === 'openai') {
                return {
                    completionType: 'chat-completion',
                    provider: safeIdentityString(ownDataValue(map, 'source'))
                        ?? profileApi,
                };
            }
            if (selected === 'textgenerationwebui') {
                return {
                    completionType: 'text-completion',
                    provider: safeIdentityString(ownDataValue(map, 'type'))
                        ?? profileApi,
                };
            }
        } catch {
            return null;
        }
    }
    const mode = safeIdentityString(ownDataValue(profile, 'mode'));
    if (mode === 'cc') {
        return { completionType: 'chat-completion', provider: profileApi };
    }
    if (mode === 'tc') {
        return { completionType: 'text-completion', provider: profileApi };
    }
    return null;
}

function sanitizeProfile(profile, service) {
    const id = normalizeSemanticConnectionProfileId(ownDataValue(profile, 'id'));
    const connection = connectionDescriptorForProfile(profile, service);
    if (!id || !connection?.provider || !connection.completionType) return null;
    return Object.freeze({
        id,
        name: safeIdentityString(ownDataValue(profile, 'name')),
        provider: connection.provider,
        model: safeIdentityString(ownDataValue(profile, 'model')),
        completionType: connection.completionType,
    });
}

function unavailableProfileList() {
    return Object.freeze({
        status: SEMANTIC_CONNECTION_PROFILE_LIST_STATUS.UNAVAILABLE,
        profiles: Object.freeze([]),
    });
}

export function listSemanticConnectionProfiles(context) {
    const records = readSupportedProfileRecords(context);
    if (!records) return unavailableProfileList();
    const ids = new Set();
    const profiles = [];
    for (const record of records.profiles) {
        const profile = sanitizeProfile(record, records.service);
        if (!profile || ids.has(profile.id)) continue;
        ids.add(profile.id);
        profiles.push(profile);
    }
    return Object.freeze({
        status: SEMANTIC_CONNECTION_PROFILE_LIST_STATUS.AVAILABLE,
        profiles: Object.freeze(profiles),
    });
}

export function resolveSemanticConnectionProfile(context, profileId) {
    const id = normalizeSemanticConnectionProfileId(profileId);
    if (!id) return null;
    const records = readSupportedProfileRecords(context);
    if (!records) return null;
    for (const record of records.profiles) {
        const profile = sanitizeProfile(record, records.service);
        if (profile?.id !== id) continue;
        return Object.freeze({
            service: records.service,
            profile,
        });
    }
    return null;
}
