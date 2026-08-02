import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { SemanticCaptureGate } from '../src/semantic-capture-gate.js';
import {
    SEMANTIC_PROVIDER_ERROR_CODES,
    SemanticProviderAdapter,
    SemanticProviderError,
    readSemanticProviderIdentity,
} from '../src/semantic-provider-adapter.js';

function deterministicCrypto() {
    let sequence = 0;
    return {
        getRandomValues(bytes) {
            sequence += 1;
            bytes.fill(sequence);
            return bytes;
        },
    };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function chatContext(generateRaw, provider = 'openrouter') {
    return {
        mainApi: 'openai',
        chatCompletionSettings: {
            chat_completion_source: provider,
        },
        getChatCompletionModel: () => 'semantic-model',
        generateRaw,
    };
}

function adapterFor(context, options = {}) {
    const captureGate = options.captureGate ?? new SemanticCaptureGate({
        crypto: deterministicCrypto(),
        ttlMs: 1_000,
    });
    return {
        captureGate,
        adapter: new SemanticProviderAdapter({
            getContext: () => context,
            captureGate,
            getConnectionProfileId: options.getConnectionProfileId ?? (() => null),
            defaultTimeoutMs: options.defaultTimeoutMs ?? 100,
        }),
    };
}

test('provider identity uses public context values and fails closed or partial', () => {
    const available = readSemanticProviderIdentity(chatContext(async () => '{}'));
    assert.deepEqual(available, {
        status: 'available',
        provider: 'openrouter',
        model: 'semantic-model',
        routeKind: 'current',
        connectionProfileId: null,
    });
    assert.equal(Object.isFrozen(available), true);

    assert.deepEqual(readSemanticProviderIdentity({
        mainApi: 'textgenerationwebui',
        textCompletionSettings: {
            type: 'aphrodite',
            server_model: 'text-model',
        },
    }), {
        status: 'available',
        provider: 'aphrodite',
        model: 'text-model',
        routeKind: 'current',
        connectionProfileId: null,
    });
    assert.deepEqual(readSemanticProviderIdentity({
        mainApi: 'kobold',
        textCompletionSettings: {},
    }), {
        status: 'partial',
        provider: 'kobold',
        model: null,
        routeKind: 'current',
        connectionProfileId: null,
    });
    assert.deepEqual(readSemanticProviderIdentity({
        mainApi: 'openai',
        chatCompletionSettings: {
            chat_completion_source: 'anthropic',
            model: 'settings-fallback-model',
        },
        getChatCompletionModel() {
            throw new Error('temporary public helper failure');
        },
    }), {
        status: 'available',
        provider: 'anthropic',
        model: 'settings-fallback-model',
        routeKind: 'current',
        connectionProfileId: null,
    });
    assert.deepEqual(readSemanticProviderIdentity({}), {
        status: 'unavailable',
        provider: null,
        model: null,
        routeKind: 'current',
        connectionProfileId: null,
    });
});

test('generate calls only public generateRaw with the bounded v1.13.5 contract', async () => {
    const calls = [];
    const schema = {
        type: 'object',
        properties: { ok: { type: 'boolean' } },
        required: ['ok'],
    };
    const context = chatContext(async (options) => {
        calls.push(options);
        return '{"ok":true}';
    });
    const { adapter, captureGate } = adapterFor(context);

    const resultPromise = adapter.generate({
        prompt: 'inspect these rules',
        responseTokenCap: 512,
        jsonSchema: schema,
    });
    assert.equal(captureGate.activeCount, 1);
    assert.deepEqual(adapter.identity(), {
        status: 'available',
        provider: 'openrouter',
        model: 'semantic-model',
        routeKind: 'current',
        connectionProfileId: null,
    });
    assert.equal(await resultPromise, '{"ok":true}');
    assert.equal(captureGate.activeCount, 0);
    assert.deepEqual(Object.keys(calls[0]).sort(), [
        'jsonSchema',
        'prefill',
        'prompt',
        'responseLength',
        'systemPrompt',
        'trimNames',
    ]);
    assert.equal(calls[0].responseLength, 512);
    assert.equal(calls[0].trimNames, true);
    assert.equal(calls[0].jsonSchema, schema);
    assert.match(calls[0].prompt, /^inspect these rules/u);
    assert.match(calls[0].prompt, /ST_DEVTOOLS_SEMANTIC:[0-9a-f]{32}/u);
});

test('prefill is combined only with a continuation, not a complete JSON response', async () => {
    const completeContext = chatContext(async () => '{"version":1,"suggestions":[]}');
    const { adapter: completeAdapter } = adapterFor(completeContext);
    assert.equal(await completeAdapter.generate({
        prompt: 'inspect',
        prefill: '{"version":1,"suggestions":',
        responseTokenCap: 512,
    }), '{"version":1,"suggestions":[]}');

    const continuationContext = chatContext(async () => '[]}');
    const { adapter: continuationAdapter } = adapterFor(continuationContext);
    assert.equal(await continuationAdapter.generate({
        prompt: 'inspect',
        prefill: '{"version":1,"suggestions":',
        responseTokenCap: 512,
    }), '{"version":1,"suggestions":[]}');
});

test('known OpenAI, Anthropic, and Google response envelopes normalize to text', async () => {
    const expected = '{"version":1,"suggestions":[]}';
    const cases = [
        {
            provider: 'openai',
            response: {
                choices: [{ message: { content: expected } }],
            },
        },
        {
            provider: 'anthropic',
            response: {
                content: [
                    { type: 'thinking', thinking: 'not returned' },
                    { type: 'text', text: expected },
                ],
            },
        },
        {
            provider: 'makersuite',
            response: {
                candidates: [{
                    content: {
                        parts: [{ text: expected }],
                    },
                }],
            },
        },
    ];

    for (const { provider, response } of cases) {
        const { adapter } = adapterFor(chatContext(
            async () => response,
            provider,
        ));
        assert.equal(
            await adapter.generate({ prompt: `inspect through ${provider}` }),
            expected,
        );
    }
});

test('only bounded known response envelopes are accepted', async () => {
    const unknown = adapterFor(chatContext(async () => ({
        privatePayload: '{"version":1,"suggestions":[]}',
    }), 'openai')).adapter;
    await assert.rejects(
        unknown.generate({ prompt: 'unknown response envelope' }),
        (value) => (
            value.code === SEMANTIC_PROVIDER_ERROR_CODES.INVALID_RESPONSE
            && value.reason === 'provider-response-shape'
            && !value.message.includes('privatePayload')
        ),
    );

    const structured = adapterFor(chatContext(async () => ({
        version: 1,
        suggestions: [],
    }), 'openai')).adapter;
    assert.equal(
        await structured.generate({ prompt: 'structured semantic object' }),
        '{"version":1,"suggestions":[]}',
    );

    let toJsonCalls = 0;
    const inert = { version: 1, suggestions: [] };
    Object.defineProperty(inert, 'toJSON', {
        value() {
            toJsonCalls += 1;
            return { privatePayload: true };
        },
    });
    const inertAdapter = adapterFor(chatContext(async () => inert, 'openai')).adapter;
    assert.equal(
        await inertAdapter.generate({ prompt: 'inert structured object' }),
        '{"version":1,"suggestions":[]}',
    );
    assert.equal(toJsonCalls, 0);
});

test('response node limits count primitive entries and reject huge sparse arrays', async () => {
    // Root object + version + suggestions array consume three of 4,096 nodes.
    const boundaryResponse = {
        version: 1,
        suggestions: new Array(4_093).fill(null),
    };
    const boundary = adapterFor(chatContext(
        async () => boundaryResponse,
        'openai',
    )).adapter;
    const normalized = JSON.parse(await boundary.generate({ prompt: 'node boundary' }));
    assert.equal(normalized.suggestions.length, 4_093);

    const overLimit = adapterFor(chatContext(async () => ({
        version: 1,
        suggestions: new Array(4_094).fill(null),
    }), 'openai')).adapter;
    await assert.rejects(
        overLimit.generate({ prompt: 'primitive node overflow' }),
        (value) => (
            value.code === SEMANTIC_PROVIDER_ERROR_CODES.INVALID_RESPONSE
            && value.reason === 'provider-response-shape'
            && !value.message.includes('primitive node overflow')
        ),
    );

    const sparse = [];
    sparse.length = 4_294_967_295;
    const sparseAdapter = adapterFor(chatContext(async () => ({
        version: 1,
        suggestions: sparse,
    }), 'openai')).adapter;
    await assert.rejects(
        sparseAdapter.generate({ prompt: 'sparse response secret' }),
        (value) => (
            value.code === SEMANTIC_PROVIDER_ERROR_CODES.INVALID_RESPONSE
            && value.reason === 'provider-response-shape'
            && !value.message.includes('sparse response secret')
        ),
    );
});

test('response arrays never invoke custom iterators, accessors, or slice methods', async () => {
    const expected = '{"version":1,"suggestions":[]}';
    let iteratorCalls = 0;
    const iteratorParts = [{ type: 'text', text: expected }];
    Object.defineProperty(iteratorParts, Symbol.iterator, {
        value() {
            iteratorCalls += 1;
            return Array.prototype[Symbol.iterator].call(this);
        },
    });

    let indexGetterCalls = 0;
    const accessorParts = [];
    accessorParts.length = 1;
    Object.defineProperty(accessorParts, '0', {
        enumerable: true,
        get() {
            indexGetterCalls += 1;
            return { type: 'text', text: expected };
        },
    });

    let sliceCalls = 0;
    const output = [{ content: [{ type: 'output_text', text: expected }] }];
    Object.defineProperty(output, 'slice', {
        value() {
            sliceCalls += 1;
            return [];
        },
    });

    const cases = [
        {
            provider: 'anthropic',
            response: { content: iteratorParts },
        },
        {
            provider: 'anthropic',
            response: { content: accessorParts },
        },
        {
            provider: 'openai',
            response: { output },
        },
    ];
    for (const { provider, response } of cases) {
        const { adapter } = adapterFor(chatContext(async () => response, provider));
        await assert.rejects(
            adapter.generate({ prompt: 'hostile response array' }),
            (value) => (
                value.code === SEMANTIC_PROVIDER_ERROR_CODES.INVALID_RESPONSE
                && value.reason === 'provider-response-shape'
                && !value.message.includes('hostile response array')
            ),
        );
    }
    assert.equal(iteratorCalls, 0);
    assert.equal(indexGetterCalls, 0);
    assert.equal(sliceCalls, 0);
});

test('hostile resolved proxies settle with a bounded invalid-response error', async () => {
    const throwing = new Proxy({}, {
        getPrototypeOf() {
            throw new Error('private response prototype trap');
        },
    });
    const revocable = Proxy.revocable({ choices: [] }, {});
    revocable.revoke();

    for (const response of [throwing, revocable.proxy]) {
        const { adapter } = adapterFor(chatContext(async () => response, 'openai'));
        let timeout;
        const outcome = await Promise.race([
            adapter.generate({ prompt: 'private proxy response' }).then(
                (value) => ({ value }),
                (failure) => ({ failure }),
            ),
            new Promise((resolve) => {
                timeout = setTimeout(() => resolve({ timedOut: true }), 100);
            }),
        ]);
        clearTimeout(timeout);
        assert.equal(outcome.timedOut, undefined);
        assert.equal(outcome.value, undefined);
        assert.equal([
            [
                SEMANTIC_PROVIDER_ERROR_CODES.INVALID_RESPONSE,
                'provider-response-shape',
            ],
            [
                SEMANTIC_PROVIDER_ERROR_CODES.PROVIDER_ERROR,
                'provider-rejected',
            ],
        ].some(([code, reason]) => (
            outcome.failure?.code === code
            && outcome.failure?.reason === reason
        )), true);
        assert.equal(outcome.failure?.message.includes('private'), false);
    }
});

test('structured safety refusals are provider rejections, not malformed responses', async () => {
    const validText = '{"version":1,"suggestions":[]}';
    const cases = [
        {
            provider: 'openai',
            response: {
                choices: [{
                    finish_reason: 'content_filter',
                    message: { content: validText },
                }],
            },
        },
        {
            provider: 'openai',
            response: {
                choices: [{
                    finish_reason: 'stop',
                    message: {
                        content: validText,
                        refusal: 'private refusal text',
                    },
                }],
            },
        },
        {
            provider: 'openai',
            response: {
                output: [{
                    type: 'message',
                    content: [
                        { type: 'refusal', refusal: 'private policy refusal' },
                        { type: 'output_text', text: validText },
                    ],
                }],
            },
        },
        {
            provider: 'makersuite',
            response: {
                promptFeedback: { blockReason: 'SAFETY' },
                candidates: [],
            },
        },
    ];

    for (const { provider, response } of cases) {
        const { adapter } = adapterFor(chatContext(async () => response, provider));
        await assert.rejects(
            adapter.generate({ prompt: 'provider refusal' }),
            (value) => (
                value.code === SEMANTIC_PROVIDER_ERROR_CODES.PROVIDER_ERROR
                && value.reason === 'provider-rejected'
                && !value.message.includes('private refusal')
            ),
        );
    }
});

test('selected Connection Manager profile is listed, identified, and called without changing the current connection', async () => {
    const calls = [];
    let currentCalls = 0;
    const schema = {
        type: 'object',
        properties: { ok: { type: 'boolean' } },
        required: ['ok'],
    };
    const profile = {
        id: 'semantic-profile',
        mode: 'cc',
        name: 'Semantic only',
        api: 'openai',
        model: 'profile-model',
        'secret-id': 'not-returned-or-stored',
        'api-url': 'https://not-returned.invalid',
    };
    const service = {
        getSupportedProfiles: () => [profile],
        validateProfile: () => ({
            selected: 'openai',
            source: 'openrouter',
        }),
        async sendRequest(...args) {
            calls.push(args);
            return { content: { ok: true }, reasoning: 'ignored' };
        },
    };
    const context = {
        ...chatContext(async () => {
            currentCalls += 1;
            return 'current connection must not run';
        }),
        ConnectionManagerRequestService: service,
    };
    const { adapter, captureGate } = adapterFor(context, {
        getConnectionProfileId: () => 'semantic-profile',
    });

    assert.deepEqual(adapter.connectionProfiles(), {
        status: 'available',
        profiles: [{
            id: 'semantic-profile',
            name: 'Semantic only',
            provider: 'openrouter',
            model: 'profile-model',
            completionType: 'chat-completion',
        }],
    });
    assert.deepEqual(adapter.identity(), {
        status: 'available',
        provider: 'openrouter',
        model: 'profile-model',
        routeKind: 'profile',
        connectionProfileId: 'semantic-profile',
    });
    assert.equal(await adapter.generate({
        prompt: 'inspect through selected profile',
        jsonSchema: schema,
        responseTokenCap: 640,
    }), '{"ok":true}');

    assert.equal(currentCalls, 0);
    assert.equal(captureGate.activeCount, 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'semantic-profile');
    assert.equal(calls[0][1][0].role, 'user');
    assert.match(calls[0][1][0].content, /^inspect through selected profile/u);
    assert.match(calls[0][1][0].content, /ST_DEVTOOLS_SEMANTIC:[0-9a-f]{32}/u);
    assert.equal(calls[0][2], 640);
    assert.deepEqual(calls[0][3], {
        stream: false,
        signal: null,
        extractData: true,
        includePreset: true,
        includeInstruct: true,
    });
    assert.deepEqual(calls[0][4], { json_schema: schema });
});

test('text profiles omit chat-only schema payloads and return extracted text', async () => {
    const calls = [];
    const service = {
        getSupportedProfiles: () => [{
            id: 'text-profile',
            mode: 'tc',
            name: 'Text profile',
            api: 'aphrodite',
            model: 'text-model',
        }],
        async sendRequest(...args) {
            calls.push(args);
            return { content: '{"ok":true}' };
        },
    };
    const context = {
        ...chatContext(async () => 'must not run'),
        ConnectionManagerRequestService: service,
    };
    const { adapter } = adapterFor(context, {
        getConnectionProfileId: () => 'text-profile',
    });

    assert.equal(await adapter.generate({
        prompt: 'text semantic request',
        jsonSchema: { type: 'object' },
    }), '{"ok":true}');
    assert.equal(typeof calls[0][1], 'string');
    assert.match(calls[0][1], /^text semantic request/u);
    assert.equal(
        [...calls[0][1].matchAll(/ST_DEVTOOLS_SEMANTIC:[0-9a-f]{32}/gu)].length,
        1,
    );
    assert.deepEqual(calls[0][3], {
        stream: false,
        signal: null,
        extractData: true,
        includePreset: true,
        includeInstruct: false,
    });
    assert.deepEqual(calls[0][4], {});
    assert.deepEqual(adapter.identity(), {
        status: 'available',
        provider: 'aphrodite',
        model: 'text-model',
        routeKind: 'profile',
        connectionProfileId: 'text-profile',
    });
});

test('unsupported or stale profile selection falls back to the current public connection', async () => {
    for (const service of [null, {
        getSupportedProfiles: () => [],
        sendRequest: async () => {
            throw new Error('must not run');
        },
    }]) {
        let currentCalls = 0;
        const context = chatContext(async () => {
            currentCalls += 1;
            return 'current fallback';
        });
        if (service) context.ConnectionManagerRequestService = service;
        const { adapter } = adapterFor(context, {
            getConnectionProfileId: () => 'missing-profile',
        });

        assert.deepEqual(adapter.identity(), {
            status: 'available',
            provider: 'openrouter',
            model: 'semantic-model',
            routeKind: 'current',
            connectionProfileId: null,
        });
        assert.equal(await adapter.generate({ prompt: 'fallback request' }), 'current fallback');
        assert.equal(currentCalls, 1);
    }
});

test('profile request failure is never retried through the current connection', async () => {
    let currentCalls = 0;
    let profileCalls = 0;
    const service = {
        getSupportedProfiles: () => [{
            id: 'failing-profile',
            mode: 'cc',
            name: 'Failing',
            api: 'openrouter',
            model: 'profile-model',
        }],
        async sendRequest() {
            profileCalls += 1;
            throw new Error('private provider failure');
        },
    };
    const context = {
        ...chatContext(async () => {
            currentCalls += 1;
            return 'must not retry';
        }),
        ConnectionManagerRequestService: service,
    };
    const { adapter } = adapterFor(context, {
        getConnectionProfileId: () => 'failing-profile',
    });

    await assert.rejects(
        adapter.generate({ prompt: 'single dispatch only' }),
        (value) => (
            value.code === SEMANTIC_PROVIDER_ERROR_CODES.PROVIDER_ERROR
            && !value.message.includes('private provider failure')
        ),
    );
    assert.equal(profileCalls, 1);
    assert.equal(currentCalls, 0);
});

test('structured provider failures map to stable retry-safe codes without message leakage', async () => {
    const cases = [
        {
            failure: Object.assign(new Error('private authentication response'), {
                status: 401,
            }),
            code: SEMANTIC_PROVIDER_ERROR_CODES.AUTHENTICATION_ERROR,
            reason: 'provider-authentication',
        },
        {
            failure: Object.assign(new Error('private quota response'), {
                response: { status: 429 },
            }),
            code: SEMANTIC_PROVIDER_ERROR_CODES.RATE_LIMITED,
            reason: 'provider-rate-limited',
        },
        {
            failure: Object.assign(new Error('private network response'), {
                code: 'ECONNRESET',
            }),
            code: SEMANTIC_PROVIDER_ERROR_CODES.NETWORK_ERROR,
            reason: 'provider-network',
        },
        {
            failure: Object.assign(new Error('private unavailable response'), {
                statusCode: 503,
            }),
            code: SEMANTIC_PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE,
            reason: 'provider-unavailable',
        },
        {
            failure: Object.assign(new Error('private timeout response'), {
                code: 'ETIMEDOUT',
            }),
            code: SEMANTIC_PROVIDER_ERROR_CODES.TIMEOUT,
            reason: 'provider-timeout',
        },
    ];

    for (const { failure, code, reason } of cases) {
        const { adapter } = adapterFor(chatContext(async () => {
            throw failure;
        }));
        await assert.rejects(
            adapter.generate({ prompt: 'bounded classification' }),
            (value) => (
                value.code === code
                && value.reason === reason
                && value.message === code
                && !value.message.includes('private')
            ),
        );
    }
});

test('provider-thrown semantic errors are rebuilt without arbitrary private fields', async () => {
    const providerFailure = new SemanticProviderError(
        SEMANTIC_PROVIDER_ERROR_CODES.NETWORK_ERROR,
        'provider-network',
    );
    providerFailure.privateBody = 'private raw provider response';
    providerFailure.request = { prompt: 'private original prompt' };
    const { adapter } = adapterFor(chatContext(async () => {
        throw providerFailure;
    }));

    await assert.rejects(
        adapter.generate({ prompt: 'private semantic request' }),
        (value) => (
            value instanceof SemanticProviderError
            && value !== providerFailure
            && value.code === SEMANTIC_PROVIDER_ERROR_CODES.NETWORK_ERROR
            && value.reason === 'provider-network'
            && value.message === SEMANTIC_PROVIDER_ERROR_CODES.NETWORK_ERROR
            && !('privateBody' in value)
            && !('request' in value)
            && !JSON.stringify(value).includes('private')
        ),
    );
});

test('a hostile proxy rejection still fails closed with a bounded generic error', async () => {
    const hostile = new Proxy({}, {
        getOwnPropertyDescriptor() {
            throw new Error('private descriptor trap');
        },
        getPrototypeOf() {
            throw new Error('private prototype trap');
        },
    });
    const { adapter } = adapterFor(chatContext(async () => {
        throw hostile;
    }));

    await assert.rejects(
        adapter.generate({ prompt: 'hostile rejection' }),
        (value) => (
            value instanceof Error
            && value.code === SEMANTIC_PROVIDER_ERROR_CODES.PROVIDER_ERROR
            && value.reason === 'provider-rejected'
            && value.message === SEMANTIC_PROVIDER_ERROR_CODES.PROVIDER_ERROR
            && !value.message.includes('private')
        ),
    );
});

test('missing generateRaw is explicitly unsupported without legacy fallback access', async () => {
    const context = {
        mainApi: 'openai',
        get generateQuietPrompt() {
            throw new Error('legacy API must not be read');
        },
        get generateRawData() {
            throw new Error('internal API must not be read');
        },
    };
    const { adapter, captureGate } = adapterFor(context);

    await assert.rejects(
        adapter.generate({ prompt: 'never dispatched' }),
        (value) => (
            value.code === SEMANTIC_PROVIDER_ERROR_CODES.UNSUPPORTED
            && value.message === SEMANTIC_PROVIDER_ERROR_CODES.UNSUPPORTED
        ),
    );
    assert.equal(captureGate.activeCount, 0);

    const throwing = adapterFor({
        mainApi: 'openai',
        get generateRaw() {
            throw new Error('private provider setup detail');
        },
    }).adapter;
    await assert.rejects(
        throwing.generate({ prompt: 'still never dispatched' }),
        (value) => (
            value.code === SEMANTIC_PROVIDER_ERROR_CODES.UNSUPPORTED
            && !value.message.includes('private provider setup detail')
        ),
    );
});

test('logical timeout discards a late result and never stops concurrent generation', async () => {
    const pending = deferred();
    let stopCalls = 0;
    const context = {
        ...chatContext(() => pending.promise),
        stopGeneration() {
            stopCalls += 1;
        },
    };
    const { adapter, captureGate } = adapterFor(context, {
        defaultTimeoutMs: 10,
    });
    const result = adapter.generate({
        prompt: 'timeout-sensitive raw prompt',
    });

    await assert.rejects(
        result,
        (value) => value.code === SEMANTIC_PROVIDER_ERROR_CODES.TIMEOUT,
    );
    assert.equal(captureGate.activeCount, 1);
    assert.equal(stopCalls, 0);
    pending.resolve('late raw response must be discarded');
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(captureGate.activeCount, 0);
    assert.equal(stopCalls, 0);
});

test('AbortSignal is logical-only and cleanup waits for underlying settlement', async () => {
    const pending = deferred();
    const abortController = new AbortController();
    const context = chatContext(() => pending.promise);
    const { adapter, captureGate } = adapterFor(context);
    const result = adapter.generate({
        prompt: 'abort-sensitive raw prompt',
        signal: abortController.signal,
    });
    abortController.abort();

    await assert.rejects(
        result,
        (value) => (
            value.name === 'AbortError'
            && value.code === SEMANTIC_PROVIDER_ERROR_CODES.ABORTED
        ),
    );
    assert.equal(captureGate.activeCount, 1);
    pending.reject(new Error('late provider rejection with private payload'));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(captureGate.activeCount, 0);
});

test('a retry gets a fresh nonce while a timed-out call is still settling', async () => {
    const first = deferred();
    const second = deferred();
    const pending = [first, second];
    const prompts = [];
    const context = chatContext((options) => {
        prompts.push(options.prompt);
        return pending.shift().promise;
    });
    const { adapter, captureGate } = adapterFor(context, {
        defaultTimeoutMs: 8,
    });
    const firstResult = adapter.generate({ prompt: 'same logical request' });
    await assert.rejects(
        firstResult,
        (value) => value.code === SEMANTIC_PROVIDER_ERROR_CODES.TIMEOUT,
    );

    const secondResult = adapter.generate({
        prompt: 'same logical request',
        timeoutMs: 100,
    });
    second.resolve('fresh response');
    assert.equal(await secondResult, 'fresh response');
    assert.equal(prompts.length, 2);
    assert.notEqual(prompts[0], prompts[1]);
    assert.equal(captureGate.activeCount, 1);
    first.resolve('discarded old response');
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(captureGate.activeCount, 0);
});

test('capacity and provider failures expose only bounded stable errors', async () => {
    const pending = deferred();
    const gate = new SemanticCaptureGate({
        crypto: deterministicCrypto(),
        ttlMs: 1_000,
        maxActive: 1,
    });
    const context = chatContext(() => pending.promise);
    const { adapter } = adapterFor(context, { captureGate: gate });
    const first = adapter.generate({ prompt: 'private first prompt' });

    await assert.rejects(
        adapter.generate({ prompt: 'private second prompt' }),
        (value) => (
            value.code === SEMANTIC_PROVIDER_ERROR_CODES.BUSY
            && !value.message.includes('private second prompt')
        ),
    );
    pending.reject(new Error('provider leaked private response'));
    await assert.rejects(
        first,
        (value) => (
            value.code === SEMANTIC_PROVIDER_ERROR_CODES.PROVIDER_ERROR
            && value.message === SEMANTIC_PROVIDER_ERROR_CODES.PROVIDER_ERROR
            && !value.message.includes('provider leaked')
        ),
    );
    assert.equal(gate.activeCount, 0);
});

test('invalid schemas and responses fail without retaining raw values in errors', async () => {
    const context = chatContext(async () => ({ raw: 'not a string' }));
    const { adapter, captureGate } = adapterFor(context);
    const cyclicSchema = { type: 'object' };
    cyclicSchema.self = cyclicSchema;

    await assert.rejects(
        adapter.generate({
            prompt: 'schema secret',
            jsonSchema: cyclicSchema,
        }),
        (value) => (
            value.code === SEMANTIC_PROVIDER_ERROR_CODES.INVALID_INPUT
            && !value.message.includes('schema secret')
        ),
    );
    await assert.rejects(
        adapter.generate({ prompt: 'response secret' }),
        (value) => (
            value.code === SEMANTIC_PROVIDER_ERROR_CODES.INVALID_RESPONSE
            && !value.message.includes('response secret')
        ),
    );
    assert.equal(captureGate.activeCount, 0);
});

test('capture gate cleanup failures cannot strand a settled generation', async () => {
    const captureGate = {
        arm({ prompt }) {
            return {
                ticket: Object.freeze({}),
                prompt: `${prompt}\nnonce`,
            };
        },
        disarm() {
            throw new Error('cleanup implementation detail');
        },
    };
    const context = chatContext(async () => 'settled response');
    const adapter = new SemanticProviderAdapter({
        getContext: () => context,
        captureGate,
        defaultTimeoutMs: 100,
    });

    assert.equal(
        await adapter.generate({ prompt: 'cleanup-safe prompt' }),
        'settled response',
    );
});

test('adapter source excludes internal generation and credential transports', async () => {
    const source = await readFile(
        new URL('../src/semantic-provider-adapter.js', import.meta.url),
        'utf8',
    );
    assert.doesNotMatch(source, /generateQuietPrompt/u);
    assert.doesNotMatch(source, /generateRawData/u);
    assert.doesNotMatch(source, /\bfetch\s*\(/u);
    assert.doesNotMatch(source, /\bapi[_-]?key\b/iu);
});
