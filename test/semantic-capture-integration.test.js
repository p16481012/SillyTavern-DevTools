import assert from 'node:assert/strict';
import test from 'node:test';
import { CaptureController } from '../src/capture.js';
import { SemanticCaptureGate } from '../src/semantic-capture-gate.js';
import { SemanticProviderAdapter } from '../src/semantic-provider-adapter.js';

const EVENTS = {
    GENERATION_STARTED: 'generation_started',
    GENERATION_STOPPED: 'generation_stopped',
    GENERATION_ENDED: 'generation_ended',
    MESSAGE_RECEIVED: 'message_received',
    WORLD_INFO_ACTIVATED: 'world_info_activated',
    CHAT_COMPLETION_PROMPT_READY: 'chat_completion_prompt_ready',
    GENERATE_AFTER_COMBINE_PROMPTS: 'generate_after_combine_prompts',
    CHAT_COMPLETION_SETTINGS_READY: 'chat_completion_settings_ready',
    TEXT_COMPLETION_SETTINGS_READY: 'text_completion_settings_ready',
    GENERATE_AFTER_DATA: 'generate_after_data',
};

class FakeEventSource {
    constructor() {
        this.handlers = new Map();
    }

    on(name, handler) {
        const handlers = this.handlers.get(name) ?? [];
        handlers.push(handler);
        this.handlers.set(name, handlers);
    }

    emit(name, ...args) {
        for (const handler of this.handlers.get(name) ?? []) {
            handler(...args);
        }
    }
}

function deterministicCrypto() {
    let sequence = 0;
    return {
        getRandomValues(bytes) {
            sequence += 1;
            for (let index = 0; index < bytes.length; index += 1) {
                bytes[index] = sequence + index;
            }
            return bytes;
        },
    };
}

function contextFor(eventSource, mainApi = 'openai') {
    return {
        eventSource,
        eventTypes: EVENTS,
        mainApi,
        chat: [{ mes: 'hello' }],
        chatId: 'semantic-test-chat',
        characters: [],
        characterId: undefined,
        extensionPrompts: {},
        chatCompletionSettings: {
            openai_max_tokens: 128,
            chat_completion_source: 'openrouter',
            prompts: [],
        },
        textCompletionSettings: {
            type: 'textgenerationwebui',
            model: 'text-model',
            amount_gen: 128,
        },
        powerUserSettings: {},
        chatMetadata: {},
        maxContext: 4_096,
        getCurrentChatId: () => 'semantic-test-chat',
        getChatCompletionModel: () => 'chat-model',
        getTokenCountAsync: async (text) => Math.ceil(text.length / 4),
    };
}

async function waitFor(predicate, timeoutMs = 500) {
    const started = Date.now();
    while (!predicate()) {
        if (Date.now() - started >= timeoutMs) {
            throw new Error('semantic capture integration timed out');
        }
        await new Promise((resolve) => setTimeout(resolve, 2));
    }
}

function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function controllerFor(context, gate, saved, settingsWaitMs = 8) {
    const controller = new CaptureController({
        getContext: () => context,
        store: {
            async addSnapshot(snapshot) {
                saved.push(snapshot);
            },
        },
        version: 'semantic-test',
        settingsWaitMs,
        semanticCaptureGate: gate,
    });
    controller.start();
    return controller;
}

test('chat generateRaw prompt and request stay outside capture while user capture continues', async () => {
    const eventSource = new FakeEventSource();
    const saved = [];
    const gate = new SemanticCaptureGate({
        crypto: deterministicCrypto(),
        ttlMs: 1_000,
    });
    const context = contextFor(eventSource);
    const semanticRaw = 'raw semantic chat request must never persist';
    const semanticResponse = 'raw semantic chat response must never persist';
    context.generateRaw = async (options) => {
        eventSource.emit('chat_completion_prompt_ready', {
            chat: [{ role: 'user', content: options.prompt }],
            dryRun: false,
        });
        const request = {
            messages: [{ role: 'user', content: options.prompt }],
        };
        eventSource.emit('chat_completion_settings_ready', request);
        eventSource.emit('chat_completion_settings_ready', request);
        return semanticResponse;
    };
    controllerFor(context, gate, saved);
    const adapter = new SemanticProviderAdapter({
        getContext: () => context,
        captureGate: gate,
        defaultTimeoutMs: 100,
    });

    assert.equal(await adapter.generate({ prompt: semanticRaw }), semanticResponse);
    await delay(15);
    assert.equal(saved.length, 0);
    eventSource.emit('chat_completion_prompt_ready', {
        chat: [{ role: 'user', content: 'ordinary user prompt' }],
        dryRun: false,
    });
    eventSource.emit('chat_completion_settings_ready', {
        messages: [{ role: 'user', content: 'ordinary user request' }],
    });
    await waitFor(() => saved.length === 1);

    assert.equal(saved[0].payload[0].content, 'ordinary user request');
    const persisted = JSON.stringify(saved);
    assert.equal(persisted.includes(semanticRaw), false);
    assert.equal(persisted.includes(semanticResponse), false);
    assert.equal(persisted.includes('ST_DEVTOOLS_SEMANTIC'), false);
});

test('a semantic prompt after the scan bound cannot fall back into a snapshot', async () => {
    const eventSource = new FakeEventSource();
    const saved = [];
    const gate = new SemanticCaptureGate({
        crypto: deterministicCrypto(),
        ttlMs: 1_000,
    });
    const context = contextFor(eventSource);
    controllerFor(context, gate, saved, 5);
    const armed = gate.arm({
        prompt: 'semantic prompt hidden after 130 chat messages',
        promptType: 'chat-completion',
    });
    const messages = Array.from({ length: 130 }, (_, index) => ({
        role: 'user',
        content: `ordinary prefix ${index}`,
    }));
    messages.push({ role: 'user', content: armed.prompt });

    eventSource.emit('chat_completion_prompt_ready', {
        chat: messages,
        dryRun: false,
    });
    eventSource.emit('chat_completion_settings_ready', { messages });
    await delay(15);
    assert.equal(saved.length, 0);

    eventSource.emit('chat_completion_prompt_ready', {
        request_id: 'bounded-normal-request',
        chat: [{ role: 'user', content: 'ordinary identified prompt' }],
        dryRun: false,
    });
    eventSource.emit('chat_completion_settings_ready', {
        request_id: 'bounded-normal-request',
        messages: [{ role: 'user', content: 'ordinary identified request' }],
    });
    await waitFor(() => saved.length === 1);

    assert.equal(saved[0].payload[0].content, 'ordinary identified request');
    const persisted = JSON.stringify(saved);
    assert.equal(persisted.includes('semantic prompt hidden'), false);
    assert.equal(persisted.includes('ST_DEVTOOLS_SEMANTIC'), false);
    gate.disarm(armed.ticket);
});

test('text generateRaw suppresses settings and duplicate data events only on exact match', async () => {
    const eventSource = new FakeEventSource();
    const saved = [];
    const gate = new SemanticCaptureGate({
        crypto: deterministicCrypto(),
        ttlMs: 1_000,
    });
    const context = contextFor(eventSource, 'textgenerationwebui');
    context.generateRaw = async (options) => {
        eventSource.emit('generate_after_combine_prompts', {
            prompt: options.prompt,
            dryRun: false,
        });
        const request = { prompt: options.prompt, max_new_tokens: 64 };
        eventSource.emit('text_completion_settings_ready', request);
        eventSource.emit('generate_after_data', request, false);
        return '{"semantic":true}';
    };
    controllerFor(context, gate, saved);
    const adapter = new SemanticProviderAdapter({
        getContext: () => context,
        captureGate: gate,
        defaultTimeoutMs: 100,
    });

    await adapter.generate({ prompt: 'raw semantic text request' });
    await delay(15);
    assert.equal(saved.length, 0);
    eventSource.emit('generate_after_combine_prompts', {
        prompt: 'ordinary concurrent text prompt',
        dryRun: false,
    });
    eventSource.emit('text_completion_settings_ready', {
        prompt: 'ordinary concurrent text request',
    });
    await waitFor(() => saved.length === 1);

    assert.equal(saved[0].payload, 'ordinary concurrent text request');
    assert.equal(JSON.stringify(saved).includes('raw semantic text request'), false);
});

test('exact semantic request never claims an older id-less user pending capture', async () => {
    const eventSource = new FakeEventSource();
    const saved = [];
    const gate = new SemanticCaptureGate({
        crypto: deterministicCrypto(),
        ttlMs: 1_000,
    });
    const context = contextFor(eventSource);
    controllerFor(context, gate, saved, 5);
    const armed = gate.arm({
        prompt: 'semantic request behind user pending',
        promptType: 'chat-completion',
    });

    eventSource.emit('chat_completion_prompt_ready', {
        chat: [{ role: 'user', content: 'older id-less user prompt' }],
        dryRun: false,
    });
    eventSource.emit('chat_completion_prompt_ready', {
        chat: [{ role: 'user', content: armed.prompt }],
        dryRun: false,
    });
    const semanticRequest = {
        messages: [{ role: 'user', content: armed.prompt }],
    };
    eventSource.emit('chat_completion_settings_ready', semanticRequest);
    eventSource.emit('chat_completion_settings_ready', semanticRequest);
    await waitFor(() => saved.length === 1);

    assert.equal(saved[0].payload[0].content, 'older id-less user prompt');
    assert.equal(saved[0].capture.stage, 'prompt-ready');
    const persisted = JSON.stringify(saved);
    assert.equal(persisted.includes('semantic request behind user pending'), false);
    assert.equal(persisted.includes('ST_DEVTOOLS_SEMANTIC'), false);
    gate.disarm(armed.ticket);
});

test('id-less ambiguous request cannot contaminate a concurrent user prompt', async () => {
    const eventSource = new FakeEventSource();
    const saved = [];
    const gate = new SemanticCaptureGate({
        crypto: deterministicCrypto(),
        ttlMs: 1_000,
    });
    const context = contextFor(eventSource);
    controllerFor(context, gate, saved, 5);
    const armed = gate.arm({
        prompt: 'semantic call whose request has not arrived',
        promptType: 'chat-completion',
    });

    eventSource.emit('chat_completion_prompt_ready', {
        chat: [{ role: 'user', content: 'concurrent user prompt' }],
        dryRun: false,
    });
    eventSource.emit('chat_completion_settings_ready', {
        messages: [{ role: 'user', content: 'ambiguous id-less request body' }],
    });
    await waitFor(() => saved.length === 1);

    assert.equal(saved[0].payload[0].content, 'concurrent user prompt');
    assert.equal(saved[0].capture.stage, 'prompt-ready');
    assert.equal(
        JSON.stringify(saved).includes('ambiguous id-less request body'),
        false,
    );
    gate.disarm(armed.ticket);
});

test('explicitly correlated normal request remains eligible during semantic ambiguity', async () => {
    const eventSource = new FakeEventSource();
    const saved = [];
    const gate = new SemanticCaptureGate({
        crypto: deterministicCrypto(),
        ttlMs: 1_000,
    });
    const context = contextFor(eventSource);
    controllerFor(context, gate, saved, 100);
    const armed = gate.arm({
        prompt: 'semantic call still awaiting request',
        promptType: 'chat-completion',
    });

    eventSource.emit('chat_completion_prompt_ready', {
        request_id: 'normal-request-id',
        chat: [{ role: 'user', content: 'identified user prompt' }],
        dryRun: false,
    });
    eventSource.emit('chat_completion_settings_ready', {
        request_id: 'normal-request-id',
        messages: [{ role: 'user', content: 'identified user request' }],
    });
    await waitFor(() => saved.length === 1);

    assert.equal(saved[0].payload[0].content, 'identified user request');
    assert.equal(saved[0].capture.correlationMethod, 'explicit-id');
    assert.equal(JSON.stringify(saved).includes('normal-request-id'), false);
    gate.disarm(armed.ticket);
});
