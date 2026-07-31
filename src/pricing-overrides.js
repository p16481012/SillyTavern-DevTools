import {
    assertExactKeys,
    assertSafeDataContainer,
    assertSafeStructuredData,
    BoundedDataError,
    isPlainDataRecord,
    ownData,
} from './bounded-data.js';
import { normalizeProviderId } from './provider-capabilities.js';
import {
    MAX_USAGE_TOKENS,
    USAGE_STATUSES,
} from './provider-usage.js';

export const COST_STATUSES = Object.freeze([
    'provider-reported',
    'catalog-estimate',
    'lower-bound',
    'unavailable',
]);

export const PRICING_OVERRIDE_SCHEMA_VERSION = 1;
export const MAX_PRICING_OVERRIDES = 256;
export const MAX_PRICE_PER_MILLION = 1_000_000;
export const MAX_REPORTED_COST = 1_000_000_000;

const ROOT_KEYS = Object.freeze(['version', 'entries']);
const ENTRY_KEYS = Object.freeze([
    'provider',
    'model',
    'currency',
    'inputPerMillion',
    'outputPerMillion',
    'cachedInputPerMillion',
    'priceAsOf',
]);
const COST_PATHS = Object.freeze([
    ['usage'],
    ['usageMetadata'],
    ['usage_metadata'],
    ['response', 'usage'],
    ['response', 'usageMetadata'],
    ['response', 'usage_metadata'],
    ['data', 'usage'],
    ['data', 'usageMetadata'],
    ['data', 'usage_metadata'],
    ['result', 'usage'],
]);
const COST_KEYS = new Set(['cost', 'total_cost', 'totalCost', 'cost_details', 'costDetails']);

export class PricingOverrideError extends TypeError {
    constructor(code, message) {
        super(message);
        this.name = 'PricingOverrideError';
        this.code = code;
    }
}

function fail(code, message) {
    throw new PricingOverrideError(code, message);
}

function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const child of Object.values(value)) deepFreeze(child);
    }
    return value;
}

export function unavailableCost() {
    return Object.freeze({
        status: 'unavailable',
        amount: null,
        currency: null,
        priceSource: null,
        priceAsOf: null,
    });
}

export function normalizeCurrency(value) {
    if (typeof value !== 'string') return null;
    const currency = value.trim().toUpperCase();
    return /^[A-Z]{3}$/u.test(currency) ? currency : null;
}

export function normalizeModelId(value) {
    if (typeof value !== 'string') return null;
    const model = value.trim().toLowerCase();
    if (!model || model.length > 128) return null;
    if (!/^[a-z0-9][a-z0-9._:/@+\-]*$/u.test(model)) return null;
    return model;
}

function finiteAmount(value, maximum, label) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum) {
        fail('INVALID_AMOUNT', `${label} must be a bounded non-negative number.`);
    }
    return value;
}

function optionalRate(record, key) {
    const field = ownData(record, key);
    return field.present && field.value !== null
        ? finiteAmount(field.value, MAX_PRICE_PER_MILLION, key)
        : null;
}

function normalizePriceAsOf(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
        fail('INVALID_PRICE_DATE', 'priceAsOf must use YYYY-MM-DD.');
    }
    const [year, month, day] = value.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
        parsed.getUTCFullYear() !== year
        || parsed.getUTCMonth() !== month - 1
        || parsed.getUTCDate() !== day
    ) {
        fail('INVALID_PRICE_DATE', 'priceAsOf is not a valid calendar date.');
    }
    return value;
}

function normalizeEntry(entry) {
    assertExactKeys(entry, ENTRY_KEYS, 'pricing override');
    const provider = normalizeProviderId(ownData(entry, 'provider').value);
    const model = normalizeModelId(ownData(entry, 'model').value);
    const currency = normalizeCurrency(ownData(entry, 'currency').value);
    if (!provider) fail('INVALID_PROVIDER', 'A pricing override requires a valid provider.');
    if (!model) fail('INVALID_MODEL', 'A pricing override requires a valid model.');
    if (!currency) fail('INVALID_CURRENCY', 'A pricing override requires a three-letter currency.');
    const inputPerMillion = optionalRate(entry, 'inputPerMillion');
    const outputPerMillion = optionalRate(entry, 'outputPerMillion');
    const cachedInputPerMillion = optionalRate(entry, 'cachedInputPerMillion');
    if (inputPerMillion === null && outputPerMillion === null && cachedInputPerMillion === null) {
        fail('MISSING_RATES', 'A pricing override requires at least one token rate.');
    }
    return {
        provider,
        model,
        currency,
        inputPerMillion,
        outputPerMillion,
        cachedInputPerMillion,
        priceAsOf: normalizePriceAsOf(ownData(entry, 'priceAsOf').value),
    };
}

export function normalizePricingOverrides(value) {
    try {
        assertSafeStructuredData(value, {
            maxArrayLength: MAX_PRICING_OVERRIDES,
            maxDepth: 3,
            maxKeysPerObject: MAX_PRICING_OVERRIDES + 1,
            maxNodes: (MAX_PRICING_OVERRIDES * (ENTRY_KEYS.length + 2)) + 4,
            maxStringLength: 128,
        });
        assertExactKeys(value, ROOT_KEYS, 'pricing override catalog');
        const version = ownData(value, 'version');
        const entries = ownData(value, 'entries');
        if (!version.present || version.value !== PRICING_OVERRIDE_SCHEMA_VERSION) {
            fail('UNSUPPORTED_VERSION', 'Unsupported pricing override schema version.');
        }
        if (!entries.present || !Array.isArray(entries.value)) {
            fail('INVALID_ENTRIES', 'Pricing override entries must be an array.');
        }
        if (entries.value.length > MAX_PRICING_OVERRIDES) {
            fail('TOO_MANY_ENTRIES', 'Too many pricing override entries.');
        }
        const normalizedEntries = entries.value.map(normalizeEntry);
        const seen = new Set();
        for (const entry of normalizedEntries) {
            const key = `${entry.provider}\u0000${entry.model}\u0000${entry.currency}`;
            if (seen.has(key)) {
                fail('DUPLICATE_ENTRY', 'Duplicate provider, model, and currency pricing override.');
            }
            seen.add(key);
        }
        return deepFreeze({
            version: PRICING_OVERRIDE_SCHEMA_VERSION,
            entries: normalizedEntries,
        });
    } catch (error) {
        if (error instanceof PricingOverrideError) throw error;
        if (error instanceof BoundedDataError) {
            throw new PricingOverrideError(error.code, error.message);
        }
        throw error;
    }
}

function catalogEntry(catalog, provider, model, currency) {
    const normalizedProvider = normalizeProviderId(provider);
    const normalizedModel = normalizeModelId(model);
    const normalizedCurrency = normalizeCurrency(currency);
    if (!normalizedProvider || !normalizedModel || !normalizedCurrency) return null;
    const normalizedCatalog = normalizePricingOverrides(catalog);
    return normalizedCatalog.entries.find((entry) => (
        entry.provider === normalizedProvider
        && entry.model === normalizedModel
        && entry.currency === normalizedCurrency
    )) ?? null;
}

function validUsageCount(value, label) {
    if (value === null) return null;
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_USAGE_TOKENS) {
        fail('INVALID_USAGE', `${label} is not a bounded token count.`);
    }
    return value;
}

function validateUsage(usage) {
    if (!isPlainDataRecord(usage)) fail('INVALID_USAGE', 'Usage must be a plain data object.');
    assertSafeDataContainer(usage, { maxKeys: 16 });
    if (!USAGE_STATUSES.includes(usage.status)) fail('INVALID_USAGE', 'Usage status is not supported.');
    const input = validUsageCount(usage.inputTokens, 'inputTokens');
    const output = validUsageCount(usage.outputTokens, 'outputTokens');
    const cached = validUsageCount(usage.cachedInputTokens, 'cachedInputTokens');
    if (cached !== null && (input === null || cached > input)) {
        fail('INVALID_USAGE', 'cachedInputTokens must be a subset of inputTokens.');
    }
    const total = validUsageCount(usage.totalTokens, 'totalTokens');
    if (input !== null && output !== null && total !== null && input + output !== total) {
        fail('INVALID_USAGE', 'totalTokens must equal inputTokens plus outputTokens.');
    }
    return { input, output, cached, total };
}

function roundedMoney(value) {
    return Number(value.toFixed(12));
}

export function calculateUsageCost(usage, {
    overrides,
    provider,
    model,
    currency,
} = {}) {
    try {
        const counts = validateUsage(usage);
        if (!overrides) return unavailableCost();
        const price = catalogEntry(overrides, provider, model, currency);
        if (!price) return unavailableCost();

        let amount = 0;
        let pricedComponents = 0;
        let missingComponent = false;
        const add = (tokens, rate) => {
            if (tokens === null) {
                missingComponent = true;
                return;
            }
            if (tokens === 0) return;
            if (rate === null) {
                missingComponent = true;
                return;
            }
            amount += (tokens * rate) / 1_000_000;
            pricedComponents += 1;
        };

        if (counts.input === null) {
            missingComponent = true;
        } else {
            const cached = counts.cached ?? 0;
            add(counts.input - cached, price.inputPerMillion);
            add(cached, price.cachedInputPerMillion ?? price.inputPerMillion);
        }
        add(counts.output, price.outputPerMillion);

        const allKnownZero = counts.input === 0 && counts.output === 0;
        if (pricedComponents === 0 && !allKnownZero) return unavailableCost();
        return Object.freeze({
            status: missingComponent ? 'lower-bound' : 'catalog-estimate',
            amount: roundedMoney(amount),
            currency: price.currency,
            priceSource: 'user-override',
            priceAsOf: price.priceAsOf,
        });
    } catch (error) {
        if (error instanceof PricingOverrideError) throw error;
        if (error instanceof BoundedDataError) {
            throw new PricingOverrideError(error.code, error.message);
        }
        throw error;
    }
}

function readPath(record, path) {
    let current = record;
    for (const key of path) {
        if (!isPlainDataRecord(current)) return { present: false, value: undefined };
        assertSafeDataContainer(current);
        const field = ownData(current, key);
        if (!field.present) return field;
        current = field.value;
    }
    return { present: true, value: current };
}

function locateCostRecord(payload) {
    if (!isPlainDataRecord(payload)) fail('INVALID_COST_ENVELOPE', 'Cost payload must be a plain object.');
    assertSafeDataContainer(payload);
    for (const path of COST_PATHS) {
        const located = readPath(payload, path);
        if (!located.present) continue;
        if (!isPlainDataRecord(located.value)) {
            fail('INVALID_COST_OBJECT', 'A recognized usage field must be a plain object.');
        }
        if (Object.keys(located.value).some((key) => COST_KEYS.has(key))) return located.value;
    }
    return Object.keys(payload).some((key) => COST_KEYS.has(key)) ? payload : null;
}

function readNumericAliases(record, paths, label) {
    const values = [];
    for (const path of paths) {
        const field = readPath(record, path);
        if (!field.present) continue;
        values.push(finiteAmount(field.value, MAX_REPORTED_COST, label));
    }
    if (values.length === 0) return null;
    if (values.some((value) => value !== values[0])) {
        fail('CONFLICTING_COST', 'Provider-reported cost aliases conflict.');
    }
    return values[0];
}

function readCurrencyAliases(record, paths) {
    const currencies = [];
    for (const path of paths) {
        const field = readPath(record, path);
        if (!field.present) continue;
        const currency = normalizeCurrency(field.value);
        if (!currency) fail('INVALID_CURRENCY', 'Provider-reported cost currency is invalid.');
        currencies.push(currency);
    }
    if (currencies.length === 0) return null;
    if (currencies.some((currency) => currency !== currencies[0])) {
        fail('CONFLICTING_CURRENCY', 'Provider-reported cost currencies conflict.');
    }
    return currencies[0];
}

export function normalizeProviderReportedCost(payload, {
    currency: suppliedCurrency = null,
} = {}) {
    try {
        const record = locateCostRecord(payload);
        if (!record) return unavailableCost();
        assertSafeStructuredData(record, {
            maxArrayLength: 32,
            maxDepth: 5,
            maxKeysPerObject: 64,
            maxNodes: 256,
            maxStringLength: 128,
        });
        const directCost = ownData(record, 'cost');
        let objectAmount = null;
        let objectCurrency = null;
        const numericCost = directCost.present && typeof directCost.value === 'number'
            ? finiteAmount(directCost.value, MAX_REPORTED_COST, 'provider-reported cost')
            : null;
        if (directCost.present && typeof directCost.value !== 'number') {
            if (!isPlainDataRecord(directCost.value)) {
                fail('INVALID_COST', 'Provider-reported cost must be a number or amount object.');
            }
            objectAmount = readNumericAliases(directCost.value, [['amount']], 'provider-reported cost');
            objectCurrency = readCurrencyAliases(directCost.value, [['currency']]);
        }
        const aliasAmount = readNumericAliases(record, [
            ['total_cost'],
            ['totalCost'],
            ['cost_details', 'total_cost'],
            ['costDetails', 'totalCost'],
        ], 'provider-reported cost');
        const amounts = [numericCost, objectAmount, aliasAmount].filter((value) => value !== null);
        if (amounts.length === 0) return unavailableCost();
        if (amounts.some((amount) => amount !== amounts[0])) {
            fail('CONFLICTING_COST', 'Provider-reported cost aliases conflict.');
        }

        const recordCurrency = readCurrencyAliases(record, [
            ['currency'],
            ['cost_currency'],
            ['costCurrency'],
            ['cost_details', 'currency'],
            ['costDetails', 'currency'],
        ]);
        const optionCurrency = suppliedCurrency === null
            ? null
            : normalizeCurrency(suppliedCurrency);
        if (suppliedCurrency !== null && !optionCurrency) {
            fail('INVALID_CURRENCY', 'Supplied cost currency is invalid.');
        }
        const currencies = [objectCurrency, recordCurrency, optionCurrency]
            .filter((value) => value !== null);
        if (currencies.length === 0) return unavailableCost();
        if (currencies.some((currency) => currency !== currencies[0])) {
            fail('CONFLICTING_CURRENCY', 'Provider-reported cost currencies conflict.');
        }
        return Object.freeze({
            status: 'provider-reported',
            amount: amounts[0],
            currency: currencies[0],
            priceSource: 'provider-response',
            priceAsOf: null,
        });
    } catch (error) {
        if (error instanceof PricingOverrideError) throw error;
        if (error instanceof BoundedDataError) {
            throw new PricingOverrideError(error.code, error.message);
        }
        throw error;
    }
}

export function attachUsageCost(usage, cost) {
    validateUsage(usage);
    if (!isPlainDataRecord(cost)) {
        fail('INVALID_COST', 'Cost must be a normalized cost object.');
    }
    assertExactKeys(cost, ['status', 'amount', 'currency', 'priceSource', 'priceAsOf'], 'normalized cost');
    if (!COST_STATUSES.includes(cost.status)) {
        fail('INVALID_COST', 'Cost must be a normalized cost object.');
    }
    if (cost.status === 'unavailable') {
        if ([cost.amount, cost.currency, cost.priceSource, cost.priceAsOf].some((value) => value !== null)) {
            fail('INVALID_COST', 'Unavailable cost must not contain values.');
        }
    } else {
        finiteAmount(cost.amount, MAX_REPORTED_COST, 'normalized cost');
        if (!normalizeCurrency(cost.currency)) fail('INVALID_CURRENCY', 'Normalized cost currency is invalid.');
        if (!['provider-response', 'user-override'].includes(cost.priceSource)) {
            fail('INVALID_PRICE_SOURCE', 'Normalized cost source is invalid.');
        }
        if (cost.priceSource === 'user-override') normalizePriceAsOf(cost.priceAsOf);
        if (cost.priceSource === 'provider-response' && cost.priceAsOf !== null) {
            fail('INVALID_PRICE_DATE', 'Provider-reported cost must not invent a price date.');
        }
    }
    return Object.freeze({ ...usage, cost: Object.freeze({ ...cost }) });
}

export function resolveUsageCost(usage, {
    providerCostPayload = null,
    providerCostCurrency = null,
    overrides = null,
    provider = null,
    model = null,
    currency = null,
} = {}) {
    const reported = providerCostPayload === null
        ? unavailableCost()
        : normalizeProviderReportedCost(providerCostPayload, {
            currency: providerCostCurrency,
        });
    if (reported.status === 'provider-reported') {
        return attachUsageCost(usage, reported);
    }
    const estimated = calculateUsageCost(usage, {
        overrides,
        provider,
        model,
        currency,
    });
    return attachUsageCost(usage, estimated);
}
