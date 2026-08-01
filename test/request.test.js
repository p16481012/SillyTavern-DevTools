import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createCaptureBoundary,
    createRequestRecord,
    extractRequestCorrelationId,
    extractPromptPayload,
    sanitizeRequestBody,
    sanitizePromptPayload,
    stripRequestCorrelationIds,
} from '../src/request.js';
import { assertBoundedJsonValue } from '../src/snapshot-privacy.js';

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

test('request correlation scrubber removes only root and known-container public ids', () => {
    const original = {
        request_id: 'root-secret',
        id: 'ordinary-root-id',
        metadata: {
            generationId: 'metadata-secret',
            id: 'ordinary-metadata-id',
            nested: {
                response_id: 'ordinary-nested-content',
                _meta: { responseId: 'nested-container-secret' },
            },
        },
        messages: [{
            role: 'user',
            content: { request_id: 'user-authored-content' },
        }],
    };
    const scrubbed = stripRequestCorrelationIds(original);

    assert.equal(scrubbed.request_id, undefined);
    assert.equal(scrubbed.id, 'ordinary-root-id');
    assert.equal(scrubbed.metadata.generationId, undefined);
    assert.equal(scrubbed.metadata.id, 'ordinary-metadata-id');
    assert.equal(scrubbed.metadata.nested.response_id, 'ordinary-nested-content');
    assert.equal(scrubbed.metadata.nested._meta.responseId, undefined);
    assert.equal(
        scrubbed.messages[0].content.request_id,
        'user-authored-content',
    );
    assert.equal(original.request_id, 'root-secret');
    assert.equal(original.metadata.generationId, 'metadata-secret');
});

test('new request records persist only correlation presence, never the raw public id', () => {
    const request = createRequestRecord({
        request_id: 'raw-public-id',
        messages: [{ role: 'user', content: 'hello' }],
        metadata: { responseId: 'raw-response-id', safe: true },
    });

    assert.equal(request.correlationId, null);
    assert.equal(request.hadCorrelationId, true);
    assert.equal(JSON.stringify(request).includes('raw-public-id'), false);
    assert.equal(JSON.stringify(request).includes('raw-response-id'), false);
    assert.equal(request.body.metadata.safe, true);
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

test('sanitizer produces persistable JSON from browser-only and unsupported values', () => {
    const dateWithOverriddenMethods = new Date('2026-07-30T00:00:00.000Z');
    dateWithOverriddenMethods.getTime = () => Number.NaN;
    dateWithOverriddenMethods.toISOString = () => undefined;
    const input = {
        count: 12n,
        invalidNumber: Number.NaN,
        callback: () => 'not serializable',
        marker: Symbol('not serializable'),
        bytes: new Uint8Array([1, 2, 3]),
        createdAt: new Date('2026-07-31T00:00:00.000Z'),
        dateWithOverriddenMethods,
    };
    Object.defineProperty(input, 'throwingGetter', {
        enumerable: true,
        get() {
            throw new Error('must not escape sanitizer');
        },
    });

    const sanitized = sanitizeRequestBody(input);
    assert.equal(sanitized.body.count, '12');
    assert.equal(sanitized.body.invalidNumber, null);
    assert.equal(sanitized.body.callback, null);
    assert.equal(sanitized.body.marker, null);
    assert.equal(sanitized.body.bytes, '[미디어 데이터 생략됨]');
    assert.equal(sanitized.body.createdAt, '2026-07-31T00:00:00.000Z');
    assert.equal(
        sanitized.body.dateWithOverriddenMethods,
        '2026-07-30T00:00:00.000Z',
    );
    assert.equal(
        sanitized.body.throwingGetter,
        '[ST DevTools: unsupported value omitted]',
    );
    assert.doesNotThrow(() => structuredClone(sanitized.body));
    assert.doesNotThrow(() => JSON.stringify(sanitized.body));
    assert.doesNotThrow(() => assertBoundedJsonValue(sanitized.body));
});

test('request records normalize SillyTavern optional generation fields before privacy validation', () => {
    const optionalFields = [
        'logit_bias',
        'n',
        'reasoning_effort',
        'verbosity',
        'n_probs',
        'guided_grammar',
        'guided_json',
        'sampler_priority',
        'grammar_retain_state',
    ];
    const requestBody = {
        messages: [{ role: 'user', content: 'hello', name: undefined }],
    };
    for (const key of optionalFields) requestBody[key] = undefined;

    const request = createRequestRecord(requestBody);

    assert.equal(request.body.messages[0].name, null);
    for (const key of optionalFields) {
        assert.equal(Object.hasOwn(request.body, key), true);
        assert.equal(request.body[key], null);
        assert.equal(request.settings[key], null);
    }
    assert.doesNotThrow(() => assertBoundedJsonValue(request));
});

test('sanitizer converts explicit undefined values and sparse array holes to null', () => {
    const input = {
        optional: undefined,
        messages: [
            { role: 'user', content: 'hello', name: undefined },
            ,
            undefined,
        ],
    };

    const sanitized = sanitizeRequestBody(input);

    assert.equal(Object.hasOwn(sanitized.body, 'optional'), true);
    assert.equal(sanitized.body.optional, null);
    assert.equal(sanitized.body.messages[0].name, null);
    assert.equal(Object.hasOwn(sanitized.body.messages, 1), true);
    assert.deepEqual(sanitized.body.messages, [
        { role: 'user', content: 'hello', name: null },
        null,
        null,
    ]);
    assert.equal(JSON.stringify(sanitized.body).includes('undefined'), false);
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
