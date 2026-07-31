import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createProviderCapabilityMatrix,
    DEFAULT_PROVIDER_CAPABILITY_MATRIX,
    getProviderCapabilities,
    normalizeProviderId,
    providerFamily,
} from '../src/provider-capabilities.js';

test('default matrix separates parser support from the documented public event contract', () => {
    const openai = getProviderCapabilities('openai');
    assert.equal(openai.usageShape, 'supported');
    assert.equal(openai.providerReportedCost, 'unsupported');
    assert.equal(openai.publicRequestEvent, 'conditional');
    assert.equal(openai.publicResponseEvent, 'unsupported');
    assert.equal(openai.publicStreamUsageEvent, 'unsupported');
    assert.equal(openai.publicRequestCorrelation, 'unsupported');
    assert.equal(Object.isFrozen(DEFAULT_PROVIDER_CAPABILITY_MATRIX), true);
    assert.equal(Object.isFrozen(openai), true);
});

test('normalizes provider ids and maps known provider families', () => {
    assert.equal(normalizeProviderId(' OpenRouter '), 'openrouter');
    assert.equal(normalizeProviderId('bad provider'), null);
    assert.equal(providerFamily('openai'), 'openai');
    assert.equal(providerFamily('azure-openai'), 'openai');
    assert.equal(providerFamily('claude-compatible'), 'anthropic');
    assert.equal(providerFamily('gemini'), 'google');
    assert.equal(providerFamily('openrouter'), 'compatible');
    assert.equal(providerFamily(null), 'unknown');
});

test('accepts bounded integration-injected public event capabilities', () => {
    const matrix = createProviderCapabilityMatrix({
        openai: {
            publicRequestEvent: 'supported',
            publicResponseEvent: 'supported',
            publicStreamUsageEvent: 'conditional',
            publicRequestCorrelation: 'supported',
        },
        'local-compatible': {
            usageShape: 'conditional',
            providerReportedCost: 'unsupported',
            publicResponseEvent: 'supported',
        },
    });
    assert.deepEqual(getProviderCapabilities('openai', matrix), {
        usageShape: 'supported',
        providerReportedCost: 'unsupported',
        publicRequestEvent: 'supported',
        publicResponseEvent: 'supported',
        publicStreamUsageEvent: 'conditional',
        publicRequestCorrelation: 'supported',
    });
    assert.equal(
        getProviderCapabilities('local-compatible', matrix).providerReportedCost,
        'unsupported',
    );
    assert.equal(Object.isFrozen(matrix), true);
    assert.equal(Object.isFrozen(matrix['local-compatible']), true);
    assert.throws(() => {
        matrix.openai.publicRequestEvent = 'unsupported';
    }, TypeError);
});

test('rejects unsupported capability keys, states, and unsafe objects', () => {
    assert.throws(() => createProviderCapabilityMatrix({
        openai: { publicResponseEvent: 'sometimes' },
    }));
    assert.throws(() => createProviderCapabilityMatrix({
        openai: { undocumentedCapability: 'supported' },
    }));
    assert.throws(() => createProviderCapabilityMatrix({
        'bad provider': { publicResponseEvent: 'supported' },
    }));

    const poisoned = JSON.parse(
        '{"openai":{"publicResponseEvent":"supported","__proto__":{}}}',
    );
    assert.throws(() => createProviderCapabilityMatrix(poisoned));

    const customPrototype = Object.create({ inherited: true });
    customPrototype.publicResponseEvent = 'supported';
    assert.throws(() => createProviderCapabilityMatrix({ openai: customPrototype }));
});
