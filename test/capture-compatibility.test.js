import assert from 'node:assert/strict';
import test from 'node:test';
import { CaptureController } from '../src/capture.js';
import { CAPTURE_COMPATIBILITY_FIXTURES } from '../fixtures/capture-cases.js';

const EVENT_TYPES = {
    GENERATION_STARTED: 'generation_started',
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
        for (const handler of this.handlers.get(name) ?? []) handler(...args);
    }
}

async function waitFor(predicate, timeoutMs = 500) {
    const started = Date.now();
    while (!predicate()) {
        if (Date.now() - started >= timeoutMs) {
            throw new Error(`Capture fixture timed out after ${timeoutMs}ms.`);
        }
        await new Promise((resolve) => setTimeout(resolve, 2));
    }
}

for (const fixture of CAPTURE_COMPATIBILITY_FIXTURES) {
    test(`capture compatibility fixture: ${fixture.name}`, async () => {
        const eventSource = new FakeEventSource();
        const saved = [];
        const events = { ...EVENT_TYPES };
        for (const name of fixture.omittedEvents ?? []) delete events[name];
        const context = {
            eventSource,
            mainApi: fixture.mainApi,
            chat: [],
            chatId: 'fixture-chat',
            characters: [],
            characterId: undefined,
            extensionPrompts: {},
            chatCompletionSettings: { openai_max_tokens: 128, prompts: [] },
            textCompletionSettings: { amount_gen: 128 },
            powerUserSettings: {},
            chatMetadata: {},
            maxContext: 4096,
            getCurrentChatId: () => 'fixture-chat',
            getChatCompletionModel: () => 'context-model',
            getTokenCountAsync: async (text) => Math.ceil(text.length / 4),
            ...(fixture.useSnakeCaseEvents ? { event_types: events } : { eventTypes: events }),
        };
        const controller = new CaptureController({
            getContext: () => context,
            store: { addSnapshot: async (snapshot) => saved.push(snapshot) },
            version: 'fixture',
            settingsWaitMs: 5,
        });
        controller.start();

        eventSource.emit(fixture.promptEvent, ...fixture.promptArgs);
        if (fixture.requestEvent) {
            eventSource.emit(fixture.requestEvent, ...fixture.requestArgs);
        }
        await waitFor(() => saved.length === 1);

        const captured = saved[0];
        const payloadText = Array.isArray(captured.payload)
            ? captured.payload[0]?.content
            : captured.payload;
        assert.equal(captured.capture.eventName, fixture.expected.eventName);
        assert.equal(captured.capture.stage, fixture.expected.stage);
        assert.equal(payloadText, fixture.expected.payloadText);
        if (fixture.expected.maxOutput != null) {
            assert.equal(captured.stats.maxOutput, fixture.expected.maxOutput);
        }
        if (fixture.expected.fallback != null) {
            assert.equal(captured.capture.fallback, fixture.expected.fallback);
        }
    });
}
