import assert from 'node:assert/strict';
import test from 'node:test';
import {
    attachUsageCost,
    calculateUsageCost,
    MAX_PRICE_PER_MILLION,
    MAX_PRICING_OVERRIDES,
    normalizePricingOverrides,
    normalizeProviderReportedCost,
    PricingOverrideError,
    resolveUsageCost,
} from '../src/pricing-overrides.js';
import { normalizeProviderUsage } from '../src/provider-usage.js';

function catalog(entry = {}) {
    return {
        version: 1,
        entries: [{
            provider: 'openrouter',
            model: 'Example/Model-V1',
            currency: 'usd',
            inputPerMillion: 2,
            outputPerMillion: 10,
            cachedInputPerMillion: 1,
            priceAsOf: '2026-07-31',
            ...entry,
        }],
    };
}

function usage(overrides = {}) {
    return normalizeProviderUsage({ usage: {
        prompt_tokens: 1_000_000,
        completion_tokens: 100_000,
        total_tokens: 1_100_000,
        cached_tokens: 200_000,
        ...overrides,
    } });
}

test('normalizes and freezes exact user pricing overrides', () => {
    const result = normalizePricingOverrides(catalog());
    assert.deepEqual(result.entries[0], {
        provider: 'openrouter',
        model: 'example/model-v1',
        currency: 'USD',
        inputPerMillion: 2,
        outputPerMillion: 10,
        cachedInputPerMillion: 1,
        priceAsOf: '2026-07-31',
    });
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.entries), true);
    assert.equal(Object.isFrozen(result.entries[0]), true);
    assert.deepEqual(
        normalizePricingOverrides(JSON.parse(JSON.stringify(result))),
        result,
    );
});

test('calculates complete user-override cost with a cached-input discount', () => {
    const result = calculateUsageCost(usage(), {
        overrides: catalog(),
        provider: 'OPENROUTER',
        model: 'example/model-v1',
        currency: 'USD',
    });
    assert.deepEqual(result, {
        status: 'catalog-estimate',
        amount: 2.8,
        currency: 'USD',
        priceSource: 'user-override',
        priceAsOf: '2026-07-31',
    });
});

test('uses the base input rate when no separate cached rate is configured', () => {
    const value = catalog();
    delete value.entries[0].cachedInputPerMillion;
    const result = calculateUsageCost(usage(), {
        overrides: value,
        provider: 'openrouter',
        model: 'example/model-v1',
        currency: 'USD',
    });
    assert.equal(result.amount, 3);
    assert.equal(result.status, 'catalog-estimate');
});

test('marks partially priced usage as a lower bound', () => {
    const value = catalog();
    delete value.entries[0].outputPerMillion;
    const result = calculateUsageCost(usage(), {
        overrides: value,
        provider: 'openrouter',
        model: 'example/model-v1',
        currency: 'USD',
    });
    assert.deepEqual(result, {
        status: 'lower-bound',
        amount: 1.8,
        currency: 'USD',
        priceSource: 'user-override',
        priceAsOf: '2026-07-31',
    });
});

test('never invents built-in prices or applies a near-match override', () => {
    assert.equal(calculateUsageCost(usage(), {
        provider: 'openrouter',
        model: 'example/model-v1',
        currency: 'USD',
    }).status, 'unavailable');
    assert.equal(calculateUsageCost(usage(), {
        overrides: catalog(),
        provider: 'openrouter',
        model: 'example/model-v2',
        currency: 'USD',
    }).status, 'unavailable');
    assert.equal(calculateUsageCost(usage(), {
        overrides: catalog(),
        provider: 'openrouter',
        model: 'example/model-v1',
        currency: 'KRW',
    }).status, 'unavailable');
});

test('accepts provider-reported costs only with an explicit currency', () => {
    assert.deepEqual(normalizeProviderReportedCost({ usage: {
        cost: { amount: 0.0125, currency: 'usd' },
    } }), {
        status: 'provider-reported',
        amount: 0.0125,
        currency: 'USD',
        priceSource: 'provider-response',
        priceAsOf: null,
    });
    assert.deepEqual(normalizeProviderReportedCost({ usage: {
        total_cost: 0.25,
        cost_currency: 'EUR',
    } }), {
        status: 'provider-reported',
        amount: 0.25,
        currency: 'EUR',
        priceSource: 'provider-response',
        priceAsOf: null,
    });
    assert.equal(normalizeProviderReportedCost({ usage: { cost: 0.5 } }).status, 'unavailable');
    assert.equal(normalizeProviderReportedCost(
        { usage: { cost: 0.5 } },
        { currency: 'KRW' },
    ).currency, 'KRW');
});

test('rejects conflicting or malformed provider-reported costs', () => {
    const invalid = [
        { usage: { cost: -1, currency: 'USD' } },
        { usage: { cost: Number.NaN, currency: 'USD' } },
        { usage: { cost: 1, total_cost: 2, currency: 'USD' } },
        { usage: { cost: { amount: 1, currency: 'USD' }, currency: 'EUR' } },
        { usage: { cost: '1.00', currency: 'USD' } },
    ];
    for (const payload of invalid) {
        assert.throws(() => normalizeProviderReportedCost(payload), PricingOverrideError);
    }

    const poisoned = JSON.parse(
        '{"usage":{"cost":{"amount":1,"currency":"USD","__proto__":{} }}}',
    );
    assert.throws(() => normalizeProviderReportedCost(poisoned), PricingOverrideError);
});

test('attaches normalized costs without mutating usage', () => {
    const original = usage();
    const cost = normalizeProviderReportedCost({ cost: 1, currency: 'USD' });
    const combined = attachUsageCost(original, cost);
    assert.equal(original.cost.status, 'unavailable');
    assert.equal(combined.cost.status, 'provider-reported');
    assert.equal(Object.isFrozen(combined), true);
    assert.equal(Object.isFrozen(combined.cost), true);
});

test('prefers an explicit provider-reported amount over a user override', () => {
    const resolved = resolveUsageCost(usage(), {
        providerCostPayload: { usage: { cost: 0.75, currency: 'USD' } },
        overrides: catalog(),
        provider: 'openrouter',
        model: 'example/model-v1',
        currency: 'USD',
    });
    assert.equal(resolved.cost.status, 'provider-reported');
    assert.equal(resolved.cost.amount, 0.75);

    const fallback = resolveUsageCost(usage(), {
        providerCostPayload: { usage: { cost: 0.75 } },
        overrides: catalog(),
        provider: 'openrouter',
        model: 'example/model-v1',
        currency: 'USD',
    });
    assert.equal(fallback.cost.status, 'catalog-estimate');
    assert.equal(fallback.cost.amount, 2.8);
});

test('rejects malformed pricing catalogs, unsafe data, and duplicate normalized keys', () => {
    const invalidCatalogs = [
        { version: 2, entries: [] },
        { version: 1, entries: 'not-an-array' },
        { version: 1, entries: [{ provider: 'x', model: 'm', currency: 'USD', priceAsOf: '2026-01-01' }] },
        catalog({ currency: 'US' }),
        catalog({ model: 'bad model' }),
        catalog({ provider: 'bad provider' }),
        catalog({ inputPerMillion: -1 }),
        catalog({ inputPerMillion: Number.NaN }),
        catalog({ inputPerMillion: MAX_PRICE_PER_MILLION + 1 }),
        catalog({ priceAsOf: '2026-02-30' }),
        { ...catalog(), unexpected: true },
        { version: 1, entries: [{ ...catalog().entries[0], unexpected: true }] },
        { version: 1, entries: [catalog().entries[0], {
            ...catalog().entries[0],
            provider: 'OPENROUTER',
            model: 'example/model-v1',
            currency: 'USD',
        }] },
    ];
    for (const value of invalidCatalogs) {
        assert.throws(() => normalizePricingOverrides(value), PricingOverrideError);
    }

    const poisoned = JSON.parse(
        '{"version":1,"entries":[{"provider":"x","model":"m","currency":"USD","inputPerMillion":1,"priceAsOf":"2026-01-01","__proto__":{}}]}',
    );
    assert.throws(() => normalizePricingOverrides(poisoned), PricingOverrideError);
});

test('enforces the pricing override entry limit', () => {
    const entries = Array.from({ length: MAX_PRICING_OVERRIDES + 1 }, (_, index) => ({
        provider: 'custom',
        model: `model-${index}`,
        currency: 'USD',
        inputPerMillion: 1,
        priceAsOf: '2026-07-31',
    }));
    assert.throws(
        () => normalizePricingOverrides({ version: 1, entries }),
        PricingOverrideError,
    );
});
