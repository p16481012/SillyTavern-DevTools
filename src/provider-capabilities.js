import {
    assertExactKeys,
    assertSafeStructuredData,
    ownData,
} from './bounded-data.js';

export const PROVIDER_CAPABILITY_STATES = Object.freeze([
    'supported',
    'conditional',
    'unsupported',
    'unknown',
]);

const CAPABILITY_KEYS = Object.freeze([
    'usageShape',
    'providerReportedCost',
    'publicRequestEvent',
    'publicResponseEvent',
    'publicStreamUsageEvent',
    'publicRequestCorrelation',
]);

const BASE_CAPABILITIES = Object.freeze({
    usageShape: 'conditional',
    providerReportedCost: 'unsupported',
    publicRequestEvent: 'conditional',
    publicResponseEvent: 'unsupported',
    publicStreamUsageEvent: 'unsupported',
    publicRequestCorrelation: 'unsupported',
});

const PARSED_PROVIDER = Object.freeze({
    ...BASE_CAPABILITIES,
    usageShape: 'supported',
});

export const DEFAULT_PROVIDER_CAPABILITY_MATRIX = deepFreeze({
    openai: { ...PARSED_PROVIDER },
    anthropic: { ...PARSED_PROVIDER },
    google: { ...PARSED_PROVIDER },
    compatible: { ...PARSED_PROVIDER },
    unknown: { ...BASE_CAPABILITIES },
});

function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const child of Object.values(value)) deepFreeze(child);
    }
    return value;
}

export function normalizeProviderId(value) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (!normalized || normalized.length > 64) return null;
    if (!/^[a-z0-9][a-z0-9._:/+-]*$/u.test(normalized)) return null;
    return normalized;
}

export function providerFamily(value) {
    const provider = normalizeProviderId(value);
    if (!provider || provider === 'unknown') return 'unknown';
    if (
        provider === 'openai'
        || provider.includes('azure-openai')
        || provider.includes('azure_openai')
    ) {
        return 'openai';
    }
    if (provider === 'anthropic' || provider.includes('claude')) return 'anthropic';
    if (
        provider === 'google'
        || provider.includes('gemini')
        || provider.includes('makersuite')
        || provider.includes('vertex')
    ) {
        return 'google';
    }
    return 'compatible';
}

function normalizeCapabilityRecord(value, fallback) {
    assertExactKeys(value, CAPABILITY_KEYS, 'provider capability');
    const result = { ...fallback };
    for (const key of CAPABILITY_KEYS) {
        const field = ownData(value, key);
        if (!field.present) continue;
        if (!PROVIDER_CAPABILITY_STATES.includes(field.value)) {
            throw new TypeError(`Invalid provider capability state for ${key}.`);
        }
        result[key] = field.value;
    }
    return result;
}

export function createProviderCapabilityMatrix(overrides = {}) {
    assertSafeStructuredData(overrides, {
        maxArrayLength: 0,
        maxDepth: 2,
        maxKeysPerObject: 64,
        maxNodes: 512,
        maxStringLength: 64,
    });
    const matrix = Object.fromEntries(
        Object.entries(DEFAULT_PROVIDER_CAPABILITY_MATRIX)
            .map(([provider, capabilities]) => [provider, { ...capabilities }]),
    );

    for (const rawProvider of Object.keys(overrides)) {
        const provider = normalizeProviderId(rawProvider);
        if (!provider) throw new TypeError('Invalid provider capability key.');
        const family = providerFamily(provider);
        const fallback = matrix[provider] ?? matrix[family] ?? matrix.unknown;
        matrix[provider] = normalizeCapabilityRecord(overrides[rawProvider], fallback);
    }
    return deepFreeze(matrix);
}

export function getProviderCapabilities(provider, matrix = DEFAULT_PROVIDER_CAPABILITY_MATRIX) {
    const providerId = normalizeProviderId(provider);
    const family = providerFamily(providerId);
    return matrix?.[providerId] ?? matrix?.[family] ?? matrix?.unknown
        ?? DEFAULT_PROVIDER_CAPABILITY_MATRIX.unknown;
}
