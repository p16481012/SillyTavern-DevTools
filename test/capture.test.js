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

async function waitFor(predicate, timeoutMs = 500) {
    const started = Date.now();
    while (!predicate()) {
        if (Date.now() - started >= timeoutMs) {
            throw new Error(`Condition was not met within ${timeoutMs}ms.`);
        }
        await new Promise((resolve) => setTimeout(resolve, 2));
    }
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
        max_completion_tokens: 321,
        api_key: 'must-not-be-stored',
    };
    eventSource.on('chat_completion_settings_ready', (data) => {
        data.messages[0].content = 'Request-ready prompt';
    });
    const requestReturns = eventSource.emitSynchronously('chat_completion_settings_ready', requestBody);
    assert.deepEqual(requestReturns, [undefined, undefined]);
    await waitFor(() => saved.length === 1);

    assert.equal(saved.length, 1);
    assert.equal(saved[0].payload[0].content, 'Request-ready prompt');
    assert.equal(saved[0].lorebookEntries[0].uid, 1);
    assert.equal(saved[0].generationType, 'normal');
    assert.equal(saved[0].capture.stage, 'backend-request-ready');
    assert.equal(saved[0].request.settings.temperature, 0.7);
    assert.equal(saved[0].request.body.api_key, '[민감 정보 제거됨]');
    assert.equal(saved[0].model, 'request-model');
    assert.equal(saved[0].stats.maxOutput, 321);
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
    await waitFor(() => saved.length === 1);

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
    await waitFor(() => saved.length === 1);

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
    await waitFor(() => saved.length === 1);

    assert.equal(saved.length, 1);
    assert.equal(saved[0].capture.stage, 'generation-data-ready');
    assert.equal(saved[0].payload, 'Kobold request prompt');
    assert.equal(saved[0].stats.maxOutput, 120);
});

test('overlapping settings-ready events reserve different pending captures', async () => {
    const eventSource = new FakeEventSource();
    const saved = [];
    const context = createContext(eventSource);
    const controller = new CaptureController({
        getContext: () => context,
        store: { addSnapshot: async (snapshot) => saved.push(snapshot) },
        version: 'test',
        settingsWaitMs: 100,
    });
    controller.start();

    eventSource.emitSynchronously('chat_completion_prompt_ready', {
        chat: [{ role: 'user', content: 'Prompt A' }],
        dryRun: false,
    });
    eventSource.emitSynchronously('chat_completion_prompt_ready', {
        chat: [{ role: 'user', content: 'Prompt B' }],
        dryRun: false,
    });
    eventSource.emitSynchronously('chat_completion_settings_ready', {
        messages: [{ role: 'user', content: 'Request A' }],
    });
    eventSource.emitSynchronously('chat_completion_settings_ready', {
        messages: [{ role: 'user', content: 'Request B' }],
    });
    await waitFor(() => saved.length === 2);

    assert.deepEqual(saved.map(({ payload }) => payload[0].content), ['Request A', 'Request B']);
    assert.equal(saved.every(({ capture }) => capture.stage === 'backend-request-ready'), true);
});

test('duplicate text request events do not consume the next pending capture', async () => {
    const eventSource = new FakeEventSource();
    const saved = [];
    const context = createContext(eventSource);
    context.mainApi = 'textgenerationwebui';
    const controller = new CaptureController({
        getContext: () => context,
        store: { addSnapshot: async (snapshot) => saved.push(snapshot) },
        version: 'test',
        settingsWaitMs: 100,
    });
    controller.start();

    eventSource.emitSynchronously('generate_after_combine_prompts', {
        prompt: 'Prompt A',
        dryRun: false,
    });
    eventSource.emitSynchronously('generate_after_combine_prompts', {
        prompt: 'Prompt B',
        dryRun: false,
    });

    const firstRequestBody = { prompt: 'Request A', max_new_tokens: 100 };
    eventSource.emitSynchronously('text_completion_settings_ready', firstRequestBody);
    eventSource.emitSynchronously('generate_after_data', firstRequestBody, false);
    eventSource.emitSynchronously('text_completion_settings_ready', {
        prompt: 'Request B',
        max_new_tokens: 200,
    });
    await waitFor(() => saved.length === 2);

    assert.deepEqual(saved.map(({ payload }) => payload), ['Request A', 'Request B']);
    assert.deepEqual(saved.map(({ stats }) => stats.maxOutput), [100, 200]);
});

test('a late duplicate text request does not capture the next generation', async () => {
    const eventSource = new FakeEventSource();
    const saved = [];
    const context = createContext(eventSource);
    context.mainApi = 'textgenerationwebui';
    const controller = new CaptureController({
        getContext: () => context,
        store: { addSnapshot: async (snapshot) => saved.push(snapshot) },
        version: 'test',
        settingsWaitMs: 100,
    });
    controller.start();

    const firstRequestBody = { prompt: 'Request A', max_new_tokens: 100 };
    eventSource.emitSynchronously('generate_after_combine_prompts', {
        prompt: 'Prompt A',
        dryRun: false,
    });
    eventSource.emitSynchronously('text_completion_settings_ready', firstRequestBody);
    await waitFor(() => saved.length === 1);

    eventSource.emitSynchronously('generate_after_combine_prompts', {
        prompt: 'Prompt B',
        dryRun: false,
    });
    eventSource.emitSynchronously('generate_after_data', firstRequestBody, false);
    eventSource.emitSynchronously('text_completion_settings_ready', {
        prompt: 'Request B',
        max_new_tokens: 200,
    });
    await waitFor(() => saved.length === 2);

    assert.deepEqual(saved.map(({ payload }) => payload), ['Request A', 'Request B']);
});

test('explicit request identifiers pair out-of-order settings with the matching prompt', async () => {
    const eventSource = new FakeEventSource();
    const saved = [];
    const context = createContext(eventSource);
    const controller = new CaptureController({
        getContext: () => context,
        store: { addSnapshot: async (snapshot) => saved.push(snapshot) },
        version: 'test',
        settingsWaitMs: 100,
    });
    controller.start();

    eventSource.emitSynchronously('chat_completion_prompt_ready', {
        request_id: 'request-a',
        chat: [{ role: 'user', content: 'Prompt A' }],
        dryRun: false,
    });
    eventSource.emitSynchronously('chat_completion_prompt_ready', {
        request_id: 'request-b',
        chat: [{ role: 'user', content: 'Prompt B' }],
        dryRun: false,
    });
    eventSource.emitSynchronously('chat_completion_settings_ready', {
        request_id: 'request-b',
        messages: [{ role: 'user', content: 'Request B' }],
    });
    eventSource.emitSynchronously('chat_completion_settings_ready', {
        request_id: 'request-a',
        messages: [{ role: 'user', content: 'Request A' }],
    });
    await waitFor(() => saved.length === 2);

    const byId = Object.fromEntries(saved.map((snapshot) => [
        snapshot.capture.correlationId,
        snapshot,
    ]));
    assert.equal(byId['request-a'].payload[0].content, 'Request A');
    assert.equal(byId['request-b'].payload[0].content, 'Request B');
    assert.equal(byId['request-a'].capture.correlationMethod, 'explicit-id');
    assert.equal(byId['request-b'].capture.correlationMethod, 'explicit-id');
});
