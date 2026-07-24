import assert from 'node:assert/strict';
import test from 'node:test';
import { CaptureController } from '../src/capture.js';

class FakeEventSource {
    constructor() {
        this.handlers = new Map();
    }

    on(name, handler) {
        const handlers = this.handlers.get(name) ?? [];
        handlers.push(handler);
        this.handlers.set(name, handlers);
    }

    emitSynchronously(name, ...data) {
        return (this.handlers.get(name) ?? []).map((handler) => handler(...data));
    }
}

function createContext(eventSource) {
    return {
        eventSource,
        eventTypes: {
            GENERATION_STARTED: 'generation_started',
            WORLD_INFO_ACTIVATED: 'world_info_activated',
            CHAT_COMPLETION_PROMPT_READY: 'chat_completion_prompt_ready',
            GENERATE_AFTER_COMBINE_PROMPTS: 'generate_after_combine_prompts',
            CHAT_COMPLETION_SETTINGS_READY: 'chat_completion_settings_ready',
            TEXT_COMPLETION_SETTINGS_READY: 'text_completion_settings_ready',
            GENERATE_AFTER_DATA: 'generate_after_data',
        },
        mainApi: 'openai',
        chat: [{ mes: 'Hello' }],
        chatId: 'chat',
        characters: [],
        characterId: undefined,
        extensionPrompts: {},
        chatCompletionSettings: { openai_max_tokens: 128, prompts: [] },
        textCompletionSettings: {},
        powerUserSettings: {},
        chatMetadata: {},
        maxContext: 4096,
        getCurrentChatId: () => 'chat',
        getChatCompletionModel: () => 'test-model',
        getTokenCountAsync: async (text) => Math.ceil(text.length / 4),
    };
}

test('request-ready capture pairs settings without mutating event payloads', async () => {
    const eventSource = new FakeEventSource();
    const saved = [];
    const context = createContext(eventSource);
    const controller = new CaptureController({
        getContext: () => context,
        store: { addSnapshot: async (snapshot) => saved.push(snapshot) },
        version: 'test',
        settingsWaitMs: 50,
    });
    controller.start();

    eventSource.emitSynchronously('generation_started', { type: 'normal' });
    eventSource.emitSynchronously('world_info_activated', [{ uid: 1, world: 'Book', content: 'Lore' }]);

    const payload = [{ role: 'user', content: 'Original' }];
    const returns = eventSource.emitSynchronously('chat_completion_prompt_ready', { chat: payload, dryRun: false });
    assert.deepEqual(returns, [undefined]);
    assert.deepEqual(payload, [{ role: 'user', content: 'Original' }]);

    const requestBody = {
        messages: [{ role: 'user', content: 'Before extension listener' }],
        model: 'request-model',
        temperature: 0.7,
        api_key: 'must-not-be-stored',
    };
    eventSource.on('chat_completion_settings_ready', (data) => {
        data.messages[0].content = 'Request-ready prompt';
    });
    const requestReturns = eventSource.emitSynchronously('chat_completion_settings_ready', requestBody);
    assert.deepEqual(requestReturns, [undefined, undefined]);
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(saved.length, 1);
    assert.equal(saved[0].payload[0].content, 'Request-ready prompt');
    assert.equal(saved[0].lorebookEntries[0].uid, 1);
    assert.equal(saved[0].generationType, 'normal');
    assert.equal(saved[0].capture.stage, 'backend-request-ready');
    assert.equal(saved[0].request.settings.temperature, 0.7);
    assert.equal(saved[0].request.body.api_key, '[민감 정보 제거됨]');
    assert.equal(saved[0].model, 'request-model');
});

test('prompt-ready fallback preserves captures on older SillyTavern versions', async () => {
    const eventSource = new FakeEventSource();
    const saved = [];
    const context = createContext(eventSource);
    delete context.eventTypes.CHAT_COMPLETION_SETTINGS_READY;
    const controller = new CaptureController({
        getContext: () => context,
        store: { addSnapshot: async (snapshot) => saved.push(snapshot) },
        version: 'test',
        settingsWaitMs: 5,
    });
    controller.start();

    eventSource.emitSynchronously('chat_completion_prompt_ready', {
        chat: [{ role: 'user', content: 'Legacy capture' }],
        dryRun: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(saved.length, 1);
    assert.equal(saved[0].capture.stage, 'prompt-ready');
    assert.equal(saved[0].capture.fallback, true);
    assert.equal(saved[0].request.body, null);
});

test('text completion prefers settings-ready data and ignores the later duplicate event', async () => {
    const eventSource = new FakeEventSource();
    const saved = [];
    const context = createContext(eventSource);
    context.mainApi = 'textgenerationwebui';
    context.textCompletionSettings = { model: 'text-model', amount_gen: 200 };
    const controller = new CaptureController({
        getContext: () => context,
        store: { addSnapshot: async (snapshot) => saved.push(snapshot) },
        version: 'test',
        settingsWaitMs: 50,
    });
    controller.start();

    eventSource.emitSynchronously('generate_after_combine_prompts', {
        prompt: 'Combined prompt',
        dryRun: false,
    });
    const requestBody = {
        prompt: 'Request-ready text prompt',
        temperature: 0.65,
        max_new_tokens: 200,
    };
    eventSource.emitSynchronously('text_completion_settings_ready', requestBody);
    eventSource.emitSynchronously('generate_after_data', requestBody, false);
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(saved.length, 1);
    assert.equal(saved[0].payload, 'Request-ready text prompt');
    assert.equal(saved[0].capture.eventName, 'TEXT_COMPLETION_SETTINGS_READY');
    assert.equal(saved[0].stats.maxOutput, 200);
});

test('generic text APIs capture generation-ready request data', async () => {
    const eventSource = new FakeEventSource();
    const saved = [];
    const context = createContext(eventSource);
    context.mainApi = 'kobold';
    const controller = new CaptureController({
        getContext: () => context,
        store: { addSnapshot: async (snapshot) => saved.push(snapshot) },
        version: 'test',
        settingsWaitMs: 50,
    });
    controller.start();

    eventSource.emitSynchronously('generate_after_combine_prompts', {
        prompt: 'Combined prompt',
        dryRun: false,
    });
    eventSource.emitSynchronously('generate_after_data', {
        prompt: 'Kobold request prompt',
        max_length: 120,
    }, false);
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(saved.length, 1);
    assert.equal(saved[0].capture.stage, 'generation-data-ready');
    assert.equal(saved[0].payload, 'Kobold request prompt');
    assert.equal(saved[0].stats.maxOutput, 120);
});
