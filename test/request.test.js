import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createCaptureBoundary,
    createRequestRecord,
    extractRequestCorrelationId,
    extractPromptPayload,
    sanitizeRequestBody,
    sanitizePromptPayload,
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
    assert.equal(capture.requestStatus, 'captured');
    assert.equal(capture.generationStatus, 'unknown');
});

test('sanitizer handles circular request metadata safely', () => {
    const value = {};
    value.self = value;
    assert.equal(sanitizeRequestBody(value).body.self, '[순환 참조]');
});

test('request correlation accepts only explicit public identifier fields', () => {
    assert.equal(extractRequestCorrelationId({ request_id: 'request-a' }), 'request-a');
    assert.equal(
        extractRequestCorrelationId({ metadata: { generationId: 42 } }),
        '42',
    );
    assert.equal(extractRequestCorrelationId({ id: 'generic-id' }), null);
    assert.equal(extractRequestCorrelationId({ request_id: '' }), null);
});

test('multimodal data URLs are omitted without removing their part type', () => {
    const payload = [{
        role: 'user',
        content: [{
            type: 'image_url',
            image_url: { url: 'data:image/png;base64,private-bytes' },
        }],
    }];
    const sanitized = sanitizeRequestBody({ messages: payload });
    assert.deepEqual(sanitized.omittedMediaPaths, ['messages[0].content[0].image_url.url']);
    assert.equal(
        sanitized.body.messages[0].content[0].image_url.url,
        '[미디어 데이터 생략됨]',
    );
    assert.equal(JSON.stringify(sanitizePromptPayload(payload)).includes('private-bytes'), false);
});

test('sanitizer redacts token-shaped values and sensitive URL query values', () => {
    const tokenExample = ['sk', 'proj', 'abcdefghijklmnopqrstuvwxyz123456'].join('-');
    const input = {
        endpoint: 'https://example.test/v1?model=safe&api_key=visible-secret&mode=chat',
        note: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456',
        tokenExample,
        ordinary: 'Basic instructions and Bearer vocabulary are ordinary words',
    };
    const sanitized = sanitizeRequestBody(input);

    assert.equal(sanitized.body.endpoint.includes('visible-secret'), false);
    assert.equal(sanitized.body.endpoint.includes('model=safe'), true);
    assert.equal(sanitized.body.note.includes('abcdefghijklmnopqrstuvwxyz'), false);
    assert.equal(sanitized.body.tokenExample, '[민감 정보 제거됨]');
    assert.equal(sanitized.body.ordinary, input.ordinary);
    assert.deepEqual(
        sanitized.redactedPaths.sort(),
        ['endpoint', 'note', 'tokenExample'],
    );
});

test('sanitizer redacts service-account private keys by key and embedded PEM block', () => {
    const pem = [
        '-----BEGIN PRIVATE KEY-----',
        'very-private-material',
        '-----END PRIVATE KEY-----',
    ].join('\n');
    const sanitized = sanitizeRequestBody({
        private_key: pem,
        document: `before\n${pem}\nafter`,
    });

    assert.equal(sanitized.body.private_key, '[민감 정보 제거됨]');
    assert.equal(sanitized.body.document.includes('very-private-material'), false);
    assert.equal(sanitized.body.document, 'before\n[민감 정보 제거됨]\nafter');
    assert.deepEqual(sanitized.redactedPaths, ['private_key', 'document']);
});

test('sanitizer handles large non-secret text without changing it', () => {
    const content = `${'일반 프롬프트 문장. '.repeat(10000)}끝`;
    const sanitized = sanitizeRequestBody({ content });
    assert.equal(sanitized.body.content, content);
    assert.deepEqual(sanitized.redactedPaths, []);
});

test('sanitizer fuzz preserves shape and never leaks seeded secret values', () => {
    const secrets = [
        ['sk', 'proj', 'abcdefghijklmnopqrstuvwxyz123456'].join('-'),
        ['ghp', 'abcdefghijklmnopqrstuvwxyz123456'].join('_'),
        ['xoxb', '1234567890', 'abcdefghijklmnop'].join('-'),
        ['AKIA', 'ABCDEFGHIJKLMNOP'].join(''),
    ];
    const input = Array.from({ length: 200 }, (_, index) => ({
        label: `ordinary-${index}`,
        text: `prefix ${secrets[index % secrets.length]} suffix`,
        nested: {
            endpoint: `https://example.test/path?token=${secrets[(index + 1) % secrets.length]}`,
        },
    }));
    const sanitized = sanitizeRequestBody(input);
    const serialized = JSON.stringify(sanitized.body);

    assert.equal(Array.isArray(sanitized.body), true);
    assert.equal(sanitized.body.length, input.length);
    for (const secret of secrets) assert.equal(serialized.includes(secret), false);
    assert.equal(sanitized.redactedPaths.length, input.length * 2);
});
