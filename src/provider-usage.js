import {
    assertExactKeys,
    assertSafeDataContainer,
    assertSafeStructuredData,
    BoundedDataError,
    isPlainDataRecord,
    ownData,
} from './bounded-data.js';
import { providerFamily } from './provider-capabilities.js';

export const USAGE_STATUSES = Object.freeze([
    'provider-reported',
    'local-estimate',
    'unlinked',
    'unavailable',
]);

export const MAX_USAGE_TOKENS = 1_000_000_000;
export const MAX_NORMALIZED_COST = 1_000_000_000;
const MAX_TIMESTAMP = 8_640_000_000_000_000;
const USAGE_RECORD_KEYS = Object.freeze([
    'status',
    'inputTokens',
    'outputTokens',
    'cachedInputTokens',
    'totalTokens',
    'sourceEvent',
    'correlatedAt',
    'cost',
]);
const COST_RECORD_KEYS = Object.freeze([
    'status',
    'amount',
    'currency',
    'priceSource',
    'priceAsOf',
]);
const COST_STATUSES = Object.freeze([
    'provider-reported',
    'catalog-estimate',
    'lower-bound',
    'unavailable',
]);

const USAGE_PATHS = Object.freeze([
    ['usage'],
    ['usageMetadata'],
    ['usage_metadata'],
    ['token_usage'],
    ['response', 'usage'],
    ['response', 'usageMetadata'],
    ['response', 'usage_metadata'],
    ['response', 'token_usage'],
    ['data', 'usage'],
    ['data', 'usageMetadata'],
    ['data', 'usage_metadata'],
    ['data', 'token_usage'],
    ['result', 'usage'],
    ['result', 'usageMetadata'],
]);

const RECOGNIZED_KEYS = new Set([
    'prompt_tokens',
    'completion_tokens',
    'total_tokens',
    'input_tokens',
    'output_tokens',
    'promptTokens',
    'completionTokens',
    'totalTokens',
    'inputTokens',
    'outputTokens',
    'promptTokenCount',
    'candidatesTokenCount',
    'totalTokenCount',
    'prompt_token_count',
    'candidates_token_count',
    'total_token_count',
    'prompt_eval_count',
    'eval_count',
    'tokens_prompt',
    'tokens_generated',
]);

export class UsageNormalizationError extends TypeError {
    constructor(code, message) {
        super(message);
        this.name = 'UsageNormalizationError';
        this.code = code;
    }
}

function fail(code, message) {
    throw new UsageNormalizationError(code, message);
}

function unavailableCost() {
    return Object.freeze({
        status: 'unavailable',
        amount: null,
        currency: null,
        priceSource: null,
        priceAsOf: null,
    });
}

function requireFields(record, keys, label) {
    for (const key of keys) {
        if (!ownData(record, key).present) {
            fail('MISSING_FIELD', `${label} is missing a required field.`);
        }
    }
}

function validCalendarDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year
        && parsed.getUTCMonth() === month - 1
        && parsed.getUTCDate() === day;
}

function normalizeCostRecord(cost) {
    if (!isPlainDataRecord(cost)) fail('INVALID_COST', 'cost must be a plain data object.');
    assertExactKeys(cost, COST_RECORD_KEYS, 'normalized cost');
    requireFields(cost, COST_RECORD_KEYS, 'normalized cost');
    const status = ownData(cost, 'status').value;
    const amount = ownData(cost, 'amount').value;
    const currency = ownData(cost, 'currency').value;
    const priceSource = ownData(cost, 'priceSource').value;
    const priceAsOf = ownData(cost, 'priceAsOf').value;
    if (!COST_STATUSES.includes(status)) {
        fail('INVALID_COST_STATUS', 'cost.status is not supported.');
    }
    if (status === 'unavailable') {
        if ([amount, currency, priceSource, priceAsOf].some((value) => value !== null)) {
            fail('INVALID_COST', 'Unavailable cost must not contain values.');
        }
    } else {
        if (
            typeof amount !== 'number'
            || !Number.isFinite(amount)
            || amount < 0
            || amount > MAX_NORMALIZED_COST
        ) {
            fail('INVALID_COST', 'cost.amount must be a bounded non-negative number.');
        }
        if (typeof currency !== 'string' || !/^[A-Z]{3}$/u.test(currency)) {
            fail('INVALID_COST', 'cost.currency must be an uppercase three-letter code.');
        }
        if (status === 'provider-reported') {
            if (priceSource !== 'provider-response' || priceAsOf !== null) {
                fail('INVALID_COST', 'Provider-reported cost requires provider-response provenance.');
            }
        } else if (
            priceSource !== 'user-override'
            || !validCalendarDate(priceAsOf)
        ) {
            fail('INVALID_COST', 'Estimated cost requires a dated user override.');
        }
    }
    return Object.freeze({ status, amount, currency, priceSource, priceAsOf });
}

function normalizeSourceEvent(value = 'unknown') {
    if (typeof value !== 'string') fail('INVALID_SOURCE_EVENT', 'sourceEvent must be a string.');
    const normalized = value.trim().toLowerCase();
    if (!normalized || normalized.length > 64 || !/^[a-z][a-z0-9_.:-]*$/u.test(normalized)) {
        fail('INVALID_SOURCE_EVENT', 'sourceEvent is not a bounded event label.');
    }
    return normalized;
}

function normalizeCorrelatedAt(value = null) {
    if (value === null || value === undefined) return null;
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TIMESTAMP) {
        fail('INVALID_CORRELATED_AT', 'correlatedAt must be a valid epoch-millisecond timestamp.');
    }
    return value;
}

function tokenInteger(value, label) {
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_USAGE_TOKENS) {
        fail('INVALID_TOKEN_COUNT', `${label} must be a bounded non-negative integer.`);
    }
    return value;
}

function checkedAdd(...values) {
    const sum = values.reduce((total, value) => total + value, 0);
    if (!Number.isSafeInteger(sum) || sum > MAX_USAGE_TOKENS) {
        fail('TOKEN_COUNT_OVERFLOW', 'Combined token count exceeds the supported limit.');
    }
    return sum;
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

function hasRecognizedTokenKey(record) {
    if (!isPlainDataRecord(record)) return false;
    return Object.keys(record).some((key) => RECOGNIZED_KEYS.has(key));
}

function locateUsage(payload) {
    if (!isPlainDataRecord(payload)) {
        fail('INVALID_ENVELOPE', 'Provider usage must be supplied as a plain data object.');
    }
    assertSafeDataContainer(payload);
    for (const path of USAGE_PATHS) {
        const located = readPath(payload, path);
        if (!located.present) continue;
        if (!isPlainDataRecord(located.value)) {
            fail('INVALID_USAGE_OBJECT', 'A recognized usage field must be a plain data object.');
        }
        if (hasRecognizedTokenKey(located.value)) return located.value;
    }
    return hasRecognizedTokenKey(payload) ? payload : null;
}

function readAliases(record, paths, label) {
    const values = [];
    for (const path of paths) {
        const field = readPath(record, path);
        if (!field.present) continue;
        values.push(tokenInteger(field.value, label));
    }
    if (values.length === 0) return null;
    if (values.some((value) => value !== values[0])) {
        fail('CONFLICTING_TOKEN_COUNTS', `${label} aliases contain conflicting values.`);
    }
    return values[0];
}

function genericCounts(usage) {
    return {
        input: readAliases(usage, [
            ['prompt_tokens'],
            ['input_tokens'],
            ['promptTokens'],
            ['inputTokens'],
            ['prompt_eval_count'],
            ['tokens_prompt'],
        ], 'input token count'),
        output: readAliases(usage, [
            ['completion_tokens'],
            ['output_tokens'],
            ['completionTokens'],
            ['outputTokens'],
            ['eval_count'],
            ['tokens_generated'],
        ], 'output token count'),
        total: readAliases(usage, [
            ['total_tokens'],
            ['totalTokens'],
            ['tokens_total'],
        ], 'total token count'),
        cached: readAliases(usage, [
            ['cached_tokens'],
            ['cachedTokens'],
            ['prompt_tokens_details', 'cached_tokens'],
            ['input_tokens_details', 'cached_tokens'],
            ['promptTokensDetails', 'cachedTokens'],
            ['inputTokensDetails', 'cachedTokens'],
        ], 'cached input token count'),
    };
}

function anthropicCounts(usage) {
    const baseInput = readAliases(usage, [
        ['input_tokens'],
        ['inputTokens'],
    ], 'input token count');
    const cacheCreation = readAliases(usage, [
        ['cache_creation_input_tokens'],
        ['cacheCreationInputTokens'],
    ], 'cache creation token count') ?? 0;
    const cacheRead = readAliases(usage, [
        ['cache_read_input_tokens'],
        ['cacheReadInputTokens'],
    ], 'cached input token count') ?? 0;
    const input = baseInput === null
        ? (cacheCreation || cacheRead ? checkedAdd(cacheCreation, cacheRead) : null)
        : checkedAdd(baseInput, cacheCreation, cacheRead);
    return {
        input,
        output: readAliases(usage, [
            ['output_tokens'],
            ['outputTokens'],
        ], 'output token count'),
        total: readAliases(usage, [
            ['total_tokens'],
            ['totalTokens'],
        ], 'total token count'),
        cached: cacheRead,
    };
}

function googleCounts(usage) {
    const input = readAliases(usage, [
        ['promptTokenCount'],
        ['prompt_token_count'],
    ], 'input token count');
    const candidates = readAliases(usage, [
        ['candidatesTokenCount'],
        ['candidates_token_count'],
    ], 'candidate token count');
    const thoughts = readAliases(usage, [
        ['thoughtsTokenCount'],
        ['thoughts_token_count'],
    ], 'thought token count') ?? 0;
    const reportedTotal = readAliases(usage, [
        ['totalTokenCount'],
        ['total_token_count'],
    ], 'total token count');
    const cached = readAliases(usage, [
        ['cachedContentTokenCount'],
        ['cached_content_token_count'],
    ], 'cached input token count');
    let output = candidates === null
        ? (thoughts > 0 ? thoughts : null)
        : checkedAdd(candidates, thoughts);

    if (reportedTotal !== null && input !== null) {
        if (reportedTotal < input) {
            fail('INCONSISTENT_TOTAL', 'Total tokens are lower than input tokens.');
        }
        const derivedOutput = reportedTotal - input;
        if (output !== null && output > derivedOutput) {
            fail('INCONSISTENT_TOTAL', 'Total tokens are lower than reported output components.');
        }
        output = derivedOutput;
    }
    return { input, output, total: reportedTotal, cached };
}

function looksAnthropic(usage, provider) {
    const hasAnthropicCache = readPath(usage, ['cache_creation_input_tokens']).present
        || readPath(usage, ['cache_read_input_tokens']).present
        || readPath(usage, ['cacheCreationInputTokens']).present
        || readPath(usage, ['cacheReadInputTokens']).present;
    const nativeInputShape = readPath(usage, ['input_tokens']).present
        || readPath(usage, ['inputTokens']).present;
    return hasAnthropicCache
        || (providerFamily(provider) === 'anthropic' && nativeInputShape);
}

function looksGoogle(usage, provider) {
    const googleShape = readPath(usage, ['promptTokenCount']).present
        || readPath(usage, ['candidatesTokenCount']).present
        || readPath(usage, ['totalTokenCount']).present
        || readPath(usage, ['prompt_token_count']).present
        || readPath(usage, ['candidates_token_count']).present
        || readPath(usage, ['total_token_count']).present;
    return googleShape
        || (
            providerFamily(provider) === 'google'
            && readPath(usage, ['cachedContentTokenCount']).present
        );
}

function reconcileCounts(counts) {
    let {
        input,
        output,
        total,
        cached,
    } = counts;

    if (cached !== null) {
        if (input === null || cached > input) {
            fail('INCONSISTENT_CACHED_INPUT', 'Cached input tokens must be a subset of input tokens.');
        }
    }
    if (total !== null && input !== null && output !== null) {
        if (checkedAdd(input, output) !== total) {
            fail('INCONSISTENT_TOTAL', 'Total tokens do not equal input plus output tokens.');
        }
    } else if (total === null && input !== null && output !== null) {
        total = checkedAdd(input, output);
    } else if (total !== null && input !== null && output === null) {
        if (input > total) fail('INCONSISTENT_TOTAL', 'Input tokens exceed total tokens.');
        output = total - input;
    } else if (total !== null && output !== null && input === null) {
        if (output > total) fail('INCONSISTENT_TOTAL', 'Output tokens exceed total tokens.');
        input = total - output;
    }
    return { input, output, cached, total };
}

function result(status, counts, options) {
    return normalizeUsageRecord({
        status,
        inputTokens: counts.input,
        outputTokens: counts.output,
        cachedInputTokens: counts.cached,
        totalTokens: counts.total,
        sourceEvent: normalizeSourceEvent(options.sourceEvent),
        correlatedAt: normalizeCorrelatedAt(options.correlatedAt),
        cost: unavailableCost(),
    });
}

export function normalizeUsageRecord(value) {
    try {
        assertSafeStructuredData(value, {
            maxArrayLength: 0,
            maxDepth: 2,
            maxKeysPerObject: USAGE_RECORD_KEYS.length,
            maxNodes: 24,
            maxStringLength: 64,
        });
        assertExactKeys(value, USAGE_RECORD_KEYS, 'normalized usage');
        requireFields(value, USAGE_RECORD_KEYS, 'normalized usage');
        const status = ownData(value, 'status').value;
        if (!USAGE_STATUSES.includes(status)) {
            fail('INVALID_USAGE_STATUS', 'usage.status is not supported.');
        }
        const counts = reconcileCounts({
            input: value.inputTokens === null
                ? null
                : tokenInteger(value.inputTokens, 'input token count'),
            output: value.outputTokens === null
                ? null
                : tokenInteger(value.outputTokens, 'output token count'),
            cached: value.cachedInputTokens === null
                ? null
                : tokenInteger(value.cachedInputTokens, 'cached input token count'),
            total: value.totalTokens === null
                ? null
                : tokenInteger(value.totalTokens, 'total token count'),
        });
        const allCountsMissing = Object.values(counts).every((count) => count === null);
        if (status === 'unavailable' ? !allCountsMissing : allCountsMissing) {
            fail('INVALID_USAGE_STATUS', 'usage status and token counts are inconsistent.');
        }
        return Object.freeze({
            status,
            inputTokens: counts.input,
            outputTokens: counts.output,
            cachedInputTokens: counts.cached,
            totalTokens: counts.total,
            sourceEvent: normalizeSourceEvent(value.sourceEvent),
            correlatedAt: normalizeCorrelatedAt(value.correlatedAt),
            cost: normalizeCostRecord(value.cost),
        });
    } catch (error) {
        if (error instanceof UsageNormalizationError) throw error;
        if (error instanceof BoundedDataError) {
            throw new UsageNormalizationError(error.code, error.message);
        }
        throw error;
    }
}

export function createUnavailableUsage(options = {}) {
    return result('unavailable', {
        input: null,
        output: null,
        cached: null,
        total: null,
    }, options);
}

export function createLocalEstimatedUsage(counts = {}, options = {}) {
    try {
        assertSafeStructuredData(counts, {
            maxArrayLength: 0,
            maxDepth: 1,
            maxKeysPerObject: 4,
            maxNodes: 8,
            maxStringLength: 0,
        });
        assertExactKeys(
            counts,
            ['inputTokens', 'outputTokens', 'cachedInputTokens', 'totalTokens'],
            'local token estimate',
        );
        const normalized = reconcileCounts({
            input: counts.inputTokens == null ? null : tokenInteger(counts.inputTokens, 'input token count'),
            output: counts.outputTokens == null ? null : tokenInteger(counts.outputTokens, 'output token count'),
            cached: counts.cachedInputTokens == null ? null : tokenInteger(counts.cachedInputTokens, 'cached input token count'),
            total: counts.totalTokens == null ? null : tokenInteger(counts.totalTokens, 'total token count'),
        });
        if (Object.values(normalized).every((value) => value === null)) {
            return createUnavailableUsage(options);
        }
        return result('local-estimate', normalized, options);
    } catch (error) {
        if (error instanceof UsageNormalizationError) throw error;
        if (error instanceof BoundedDataError) {
            throw new UsageNormalizationError(error.code, error.message);
        }
        throw error;
    }
}

export function normalizeProviderUsage(payload, options = {}) {
    try {
        const usage = locateUsage(payload);
        if (!usage) return createUnavailableUsage(options);
        assertSafeStructuredData(usage, {
            maxArrayLength: 64,
            maxDepth: 5,
            maxKeysPerObject: 64,
            maxNodes: 256,
            maxStringLength: 256,
        });
        const counts = looksGoogle(usage, options.provider)
            ? googleCounts(usage)
            : looksAnthropic(usage, options.provider)
                ? anthropicCounts(usage)
                : genericCounts(usage);
        const normalized = reconcileCounts(counts);
        if (Object.values(normalized).every((value) => value === null)) {
            return createUnavailableUsage(options);
        }
        return result(options.linked === false ? 'unlinked' : 'provider-reported', normalized, options);
    } catch (error) {
        if (error instanceof UsageNormalizationError) throw error;
        if (error instanceof BoundedDataError) {
            throw new UsageNormalizationError(error.code, error.message);
        }
        throw error;
    }
}
