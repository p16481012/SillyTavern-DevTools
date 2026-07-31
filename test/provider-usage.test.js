import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createLocalEstimatedUsage,
    createUnavailableUsage,
    MAX_USAGE_TOKENS,
    normalizeProviderUsage,
    normalizeUsageRecord,
    UsageNormalizationError,
} from '../src/provider-usage.js';

test('normalizes OpenAI chat-completion usage without retaining response data or ids', () => {
    const result = normalizeProviderUsage({
        id: 'response-secret-id',
        model: 'private-model-alias',
        usage: {
            prompt_tokens: 100,
            completion_tokens: 20,
            total_tokens: 120,
            prompt_tokens_details: { cached_tokens: 40 },
        },
    }, {
        provider: 'openai',
        sourceEvent: 'generation-response',
        correlatedAt: 1_722_000_000_000,
    });

    assert.deepEqual(result, {
        status: 'provider-reported',
        inputTokens: 100,
        outputTokens: 20,
        cachedInputTokens: 40,
        totalTokens: 120,
        sourceEvent: 'generation-response',
        correlatedAt: 1_722_000_000_000,
        cost: {
            status: 'unavailable',
            amount: null,
            currency: null,
            priceSource: null,
            priceAsOf: null,
        },
    });
    assert.equal(JSON.stringify(result).includes('secret'), false);
    assert.equal(JSON.stringify(result).includes('private-model'), false);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.cost), true);
});

test('normalizes OpenAI Responses API and camel-case compatible shapes', () => {
    assert.deepEqual(
        normalizeProviderUsage({ response: { usage: {
            input_tokens: 80,
            output_tokens: 12,
            total_tokens: 92,
            input_tokens_details: { cached_tokens: 10 },
        } } }),
        {
            status: 'provider-reported',
            inputTokens: 80,
            outputTokens: 12,
            cachedInputTokens: 10,
            totalTokens: 92,
            sourceEvent: 'unknown',
            correlatedAt: null,
            cost: {
                status: 'unavailable', amount: null, currency: null, priceSource: null, priceAsOf: null,
            },
        },
    );
    const compatible = normalizeProviderUsage({ usage: {
        promptTokens: 30,
        completionTokens: 4,
        totalTokens: 34,
        promptTokensDetails: { cachedTokens: 8 },
    } }, { provider: 'openrouter' });
    assert.deepEqual(
        [compatible.inputTokens, compatible.outputTokens, compatible.cachedInputTokens, compatible.totalTokens],
        [30, 4, 8, 34],
    );

    const tokenUsageEnvelope = normalizeProviderUsage({ token_usage: {
        tokens_prompt: 9,
        tokens_generated: 2,
        tokens_total: 11,
    } }, { provider: 'custom' });
    assert.deepEqual(
        [tokenUsageEnvelope.inputTokens, tokenUsageEnvelope.outputTokens, tokenUsageEnvelope.totalTokens],
        [9, 2, 11],
    );

    const ollamaCompatible = normalizeProviderUsage({
        prompt_eval_count: 15,
        eval_count: 6,
    }, { provider: 'ollama' });
    assert.deepEqual(
        [ollamaCompatible.inputTokens, ollamaCompatible.outputTokens, ollamaCompatible.totalTokens],
        [15, 6, 21],
    );
});

test('normalizes Anthropic cache creation and cache reads as total input', () => {
    const result = normalizeProviderUsage({ usage: {
        input_tokens: 50,
        output_tokens: 5,
        cache_creation_input_tokens: 10,
        cache_read_input_tokens: 20,
        total_tokens: 85,
    } }, { provider: 'anthropic' });
    assert.deepEqual(
        [result.inputTokens, result.outputTokens, result.cachedInputTokens, result.totalTokens],
        [80, 5, 20, 85],
    );
});

test('normalizes Google usage metadata including thought and hidden output tokens', () => {
    const exact = normalizeProviderUsage({ usageMetadata: {
        promptTokenCount: 100,
        candidatesTokenCount: 20,
        thoughtsTokenCount: 5,
        totalTokenCount: 125,
        cachedContentTokenCount: 40,
        promptTokensDetails: [{ modality: 'TEXT', tokenCount: 100 }],
    } }, { provider: 'google' });
    assert.deepEqual(
        [exact.inputTokens, exact.outputTokens, exact.cachedInputTokens, exact.totalTokens],
        [100, 25, 40, 125],
    );

    const withUnclassifiedOutput = normalizeProviderUsage({ usageMetadata: {
        promptTokenCount: 100,
        candidatesTokenCount: 20,
        totalTokenCount: 130,
    } });
    assert.equal(withUnclassifiedOutput.outputTokens, 30);

    const snakeCase = normalizeProviderUsage({ usage_metadata: {
        prompt_token_count: 12,
        candidates_token_count: 3,
        total_token_count: 15,
    } });
    assert.deepEqual(
        [snakeCase.inputTokens, snakeCase.outputTokens, snakeCase.totalTokens],
        [12, 3, 15],
    );
});

test('marks valid but uncorrelated provider usage separately', () => {
    const result = normalizeProviderUsage({ usage: {
        prompt_tokens: 7,
        completion_tokens: 3,
    } }, { linked: false, sourceEvent: 'stream-usage' });
    assert.equal(result.status, 'unlinked');
    assert.equal(result.totalTokens, 10);
});

test('creates bounded local estimates and unavailable records', () => {
    const estimate = createLocalEstimatedUsage({
        inputTokens: 12,
        outputTokens: 3,
        cachedInputTokens: 2,
    }, { sourceEvent: 'local-tokenizer', correlatedAt: 123 });
    assert.deepEqual(
        [estimate.status, estimate.totalTokens, estimate.sourceEvent, estimate.correlatedAt],
        ['local-estimate', 15, 'local-tokenizer', 123],
    );
    assert.equal(createLocalEstimatedUsage({}).status, 'unavailable');
    assert.equal(createUnavailableUsage().status, 'unavailable');
    assert.equal(normalizeProviderUsage({ id: 'no-usage' }).status, 'unavailable');
    assert.throws(
        () => createLocalEstimatedUsage({ inputTokens: 1, unexpected: 2 }),
        UsageNormalizationError,
    );

    assert.deepEqual(normalizeUsageRecord(estimate), estimate);
    assert.notStrictEqual(normalizeUsageRecord(estimate), estimate);
    const unavailable = createUnavailableUsage();
    assert.deepEqual(normalizeUsageRecord(unavailable), unavailable);
    assert.notStrictEqual(normalizeUsageRecord(unavailable), unavailable);
});

test('strict normalized usage validation rejects extra, missing, and invalid cost fields', () => {
    const valid = createLocalEstimatedUsage({ inputTokens: 2, outputTokens: 1 });
    assert.throws(
        () => normalizeUsageRecord({ ...valid, requestId: 'must-not-be-retained' }),
        UsageNormalizationError,
    );
    const { sourceEvent: _sourceEvent, ...missing } = valid;
    assert.throws(() => normalizeUsageRecord(missing), UsageNormalizationError);
    assert.throws(() => normalizeUsageRecord({
        ...valid,
        cost: { ...valid.cost, rawResponse: {} },
    }), UsageNormalizationError);
    assert.throws(() => normalizeUsageRecord({
        ...valid,
        cost: {
            status: 'catalog-estimate',
            amount: 1,
            currency: 'USD',
            priceSource: 'provider-response',
            priceAsOf: null,
        },
    }), UsageNormalizationError);

    const reportedCost = normalizeUsageRecord({
        ...valid,
        cost: {
            status: 'provider-reported',
            amount: 0.1,
            currency: 'USD',
            priceSource: 'provider-response',
            priceAsOf: null,
        },
    });
    assert.equal(reportedCost.cost.status, 'provider-reported');
    assert.equal(Object.isFrozen(reportedCost.cost), true);
});

test('rejects invalid, conflicting, and internally inconsistent token counts', () => {
    const invalidPayloads = [
        { usage: { prompt_tokens: -1, completion_tokens: 1 } },
        { usage: { prompt_tokens: Number.NaN, completion_tokens: 1 } },
        { usage: { prompt_tokens: Number.POSITIVE_INFINITY, completion_tokens: 1 } },
        { usage: { prompt_tokens: MAX_USAGE_TOKENS + 1, completion_tokens: 1 } },
        { usage: { prompt_tokens: 1.5, completion_tokens: 1 } },
        { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 14 } },
        { usage: { prompt_tokens: 10, completion_tokens: 5, cached_tokens: 11 } },
        { usage: { prompt_tokens: 10, input_tokens: 11, completion_tokens: 1 } },
        { usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, totalTokenCount: 12 } },
    ];
    for (const payload of invalidPayloads) {
        assert.throws(() => normalizeProviderUsage(payload), UsageNormalizationError);
    }
});

test('rejects prototype pollution, accessors, custom prototypes, and oversized usage trees', () => {
    const poisoned = JSON.parse(
        '{"usage":{"prompt_tokens":1,"completion_tokens":1,"__proto__":{"polluted":true}}}',
    );
    assert.throws(() => normalizeProviderUsage(poisoned), UsageNormalizationError);

    const rootPoisoned = JSON.parse(
        '{"usage":{"prompt_tokens":1,"completion_tokens":1},"constructor":{"prototype":{}}}',
    );
    assert.throws(() => normalizeProviderUsage(rootPoisoned), UsageNormalizationError);

    const accessor = { prompt_tokens: 1, completion_tokens: 1 };
    Object.defineProperty(accessor, 'total_tokens', { get: () => 2, enumerable: true });
    assert.throws(() => normalizeProviderUsage({ usage: accessor }), UsageNormalizationError);

    const customPrototype = Object.create({ inherited: true });
    customPrototype.prompt_tokens = 1;
    customPrototype.completion_tokens = 1;
    assert.throws(() => normalizeProviderUsage({ usage: customPrototype }), UsageNormalizationError);

    const tooManyKeys = { prompt_tokens: 1, completion_tokens: 1 };
    for (let index = 0; index < 65; index += 1) tooManyKeys[`extra${index}`] = index;
    assert.throws(() => normalizeProviderUsage({ usage: tooManyKeys }), UsageNormalizationError);

    const tooLongArray = Array.from({ length: 65 }, () => ({ modality: 'TEXT', tokenCount: 1 }));
    assert.throws(() => normalizeProviderUsage({ usageMetadata: {
        promptTokenCount: 1,
        candidatesTokenCount: 1,
        promptTokensDetails: tooLongArray,
    } }), UsageNormalizationError);
});

test('rejects unbounded event labels and invalid correlation timestamps', () => {
    const payload = { usage: { prompt_tokens: 1, completion_tokens: 1 } };
    assert.throws(
        () => normalizeProviderUsage(payload, { sourceEvent: 'request id with spaces' }),
        UsageNormalizationError,
    );
    assert.throws(
        () => normalizeProviderUsage(payload, { correlatedAt: -1 }),
        UsageNormalizationError,
    );
    assert.throws(
        () => normalizeProviderUsage(payload, { correlatedAt: 1.25 }),
        UsageNormalizationError,
    );
});
