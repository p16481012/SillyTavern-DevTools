import assert from 'node:assert/strict';
import test from 'node:test';
import {
    detectMultimodalProvider,
    estimateMultimodalTokens,
} from '../src/multimodal.js';

function estimate(provider, model, type, part) {
    return estimateMultimodalTokens({ provider, model, type, part });
}

test('provider detection uses request settings and model identity', () => {
    assert.equal(detectMultimodalProvider({}, {
        settings: { provider: 'anthropic', model: 'claude-sonnet-4-7' },
    }), 'anthropic');
    assert.equal(detectMultimodalProvider({ model: 'gemini-3.6-flash' }), 'google');
    assert.equal(detectMultimodalProvider({ model: 'gpt-4o' }), 'openai');
    assert.equal(detectMultimodalProvider({ model: 'local-model' }), 'unknown');
});

test('OpenAI image estimates expose tile, patch, and lower-bound methods', () => {
    assert.deepEqual(estimate('openai', 'gpt-4o', 'image', {
        width: 1024,
        height: 1024,
        detail: 'high',
    }), {
        provider: 'openai',
        type: 'image',
        tokens: 765,
        kind: 'estimate',
        method: 'openai-tile-512',
    });
    assert.equal(estimate('openai', 'gpt-4o', 'image', {
        detail: 'low',
    }).tokens, 85);
    assert.equal(estimate('openai', 'gpt-4o', 'image', {
        detail: 'auto',
    }).kind, 'lower-bound');
    assert.equal(estimate('openai', 'gpt-5.6', 'image', {
        width: 1024,
        height: 1024,
        detail: 'auto',
    }).tokens, 1024);
});

test('Anthropic image estimates use 28px patches and explicit resize caps', () => {
    assert.equal(estimate('anthropic', 'claude-sonnet-4-6', 'image', {
        width: 1000,
        height: 1000,
    }).tokens, 1296);
    const standardCap = estimate('anthropic', 'claude-sonnet-4-6', 'image', {
        width: 3840,
        height: 2160,
    });
    assert.equal(standardCap.tokens, 1568);
    assert.equal(standardCap.kind, 'upper-bound');

    const highResolution = estimate('anthropic', 'claude-sonnet-4-7', 'image', {
        width: 1920,
        height: 1080,
    });
    assert.equal(highResolution.tokens, 2691);
    assert.equal(highResolution.kind, 'estimate');
});

test('Google estimates image tiles and time-based audio and video tokens', () => {
    assert.equal(estimate('google', 'gemini-3.6-flash', 'image', {
        width: 384,
        height: 384,
    }).tokens, 258);
    assert.equal(estimate('google', 'gemini-3.6-flash', 'image', {
        width: 769,
        height: 769,
    }).tokens, 1032);
    assert.equal(estimate('google', 'gemini-3.6-flash', 'audio', {
        duration_seconds: 60,
    }).tokens, 1920);
    assert.equal(estimate('google', 'gemini-3.6-flash', 'video', {
        duration_seconds: 60,
    }).tokens, 15780);
});

test('unsupported combinations remain unavailable instead of inventing a token value', () => {
    const result = estimate('unknown', 'local-model', 'image', {
        width: 1024,
        height: 1024,
    });
    assert.equal(result.tokens, null);
    assert.equal(result.kind, 'unavailable');
});
