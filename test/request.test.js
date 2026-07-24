import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createCaptureBoundary,
    createRequestRecord,
    extractPromptPayload,
    sanitizeRequestBody,
} from '../src/request.js';

test('request records redact credential-like fields without mutating input', () => {
    const input = {
        model: 'model',
        max_tokens: 256,
        messages: [{ role: 'user', content: 'hello' }],
        apiKey: 'secret',
        nested: { proxy_password: 'secret-2' },
    };
    const before = structuredClone(input);
    const request = createRequestRecord(input);

    assert.deepEqual(input, before);
    assert.equal(request.body.apiKey, '[민감 정보 제거됨]');
    assert.equal(request.body.nested.proxy_password, '[민감 정보 제거됨]');
    assert.deepEqual(request.redactedPaths, ['apiKey', 'nested.proxy_password']);
    assert.equal(request.settings.model, 'model');
    assert.equal(request.settings.max_tokens, 256);
    assert.equal('messages' in request.settings, false);
});

test('prompt payload prefers request-ready messages and prompt fields', () => {
    const fallback = [{ role: 'user', content: 'fallback' }];
    assert.deepEqual(
        extractPromptPayload({ messages: [{ role: 'user', content: 'ready' }] }, 'chat-completion', fallback),
        [{ role: 'user', content: 'ready' }],
    );
    assert.equal(extractPromptPayload({ prompt: 'ready text' }, 'text-completion', 'fallback'), 'ready text');
});

test('capture boundary never claims provider server transformations', () => {
    const capture = createCaptureBoundary({
        eventName: 'CHAT_COMPLETION_SETTINGS_READY',
        stage: 'backend-request-ready',
        requestBodyAvailable: true,
    });
    assert.equal(capture.clientBackendRequestCaptured, true);
    assert.equal(capture.serverTransformationsIncluded, false);
});

test('sanitizer handles circular request metadata safely', () => {
    const value = {};
    value.self = value;
    assert.equal(sanitizeRequestBody(value).body.self, '[순환 참조]');
});
