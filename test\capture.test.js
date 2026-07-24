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

    emitSynchronously(name, data) {
        return (this.handlers.get(name) ?? []).map((handler) => handler(data));
    }
}

test('capture listeners return immediately and preserve the mutable event payload', async () => {
    const eventSource = new FakeEventSource();
    const saved = [];
    const context = {
        eventSource,
        eventTypes: {
            GENERATION_STARTED: 'generation_started',
            WORLD_INFO_ACTIVATED: 'world_info_activated',
            CHAT_COMPLETION_PROMPT_READY: 'chat_completion_prompt_ready',
            GENERATE_AFTER_COMBINE_PROMPTS: 'generate_after_combine_prompts',
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
    const controller = new CaptureController({
        getContext: () => context,
        store: { addSnapshot: async (snapshot) => saved.push(snapshot) },
        version: 'test',
    });
    controller.start();

    eventSource.emitSynchronously('generation_started', { type: 'normal' });
    eventSource.emitSynchronously('world_info_activated', [{ uid: 1, world: 'Book', content: 'Lore' }]);

    const payload = [{ role: 'user', content: 'Original' }];
    const returns = eventSource.emitSynchronously('chat_completion_prompt_ready', { chat: payload, dryRun: false });
    assert.deepEqual(returns, [undefined]);
    assert.deepEqual(payload, [{ role: 'user', content: 'Original' }]);

    payload[0].content = 'Mutated later';
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(saved.length, 1);
    assert.equal(saved[0].payload[0].content, 'Original');
    assert.equal(saved[0].lorebookEntries[0].uid, 1);
    assert.equal(saved[0].generationType, 'normal');
});
