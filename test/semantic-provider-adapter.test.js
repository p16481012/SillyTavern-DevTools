import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { SemanticCaptureGate } from '../src/semantic-capture-gate.js';
import {
    SEMANTIC_PROVIDER_ERROR_CODES,
    SemanticProviderAdapter,
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

function chatContext(generateRaw) {
    return {
        mainApi: 'openai',
        chatCompletionSettings: {
            chat_completion_source: 'openrouter',
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
    });
    assert.deepEqual(readSemanticProviderIdentity({
        mainApi: 'kobold',
        textCompletionSettings: {},
    }), {
        status: 'partial',
        provider: 'kobold',
        model: null,
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
    });
    assert.deepEqual(readSemanticProviderIdentity({}), {
        status: 'unavailable',
        provider: null,
        model: null,
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
    });
    assert.equal(await resultPromise, '{"ok":true}');
    assert.equal(captureGate.activeCount, 0);
    assert.deepEqual(Object.keys(calls[0]).sort(), [
        'jsonSchema',
        'prompt',
        'responseLength',
        'trimNames',
    ]);
    assert.equal(calls[0].responseLength, 512);
    assert.equal(calls[0].trimNames, true);
    assert.equal(calls[0].jsonSchema, schema);
    assert.match(calls[0].prompt, /^inspect these rules/u);
    assert.match(calls[0].prompt, /ST_DEVTOOLS_SEMANTIC:[0-9a-f]{32}/u);
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
