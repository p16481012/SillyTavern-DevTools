import assert from 'node:assert/strict';
import test from 'node:test';
import { CaptureController, getConfiguredPrompts } from '../src/capture.js';

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
            GENERATION_STOPPED: 'generation_stopped',
            GENERATION_ENDED: 'generation_ended',
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
        chatCompletionSettings: {
            openai_max_tokens: 128,
            chat_completion_source: 'makersuite',
            prompts: [],
        },
        textCompletionSettings: {},
        powerUserSettings: {},
        chatMetadata: {},
        maxContext: 4096,
        getCurrentChatId: () => 'chat',
        getChatCompletionModel: () => 'test-model',
        getTokenCountAsync: async (text) => Math.ceil(text.length / 4),
    };
}

test('configured prompts follow Prompt Manager order and enabled state', () => {
    const prompts = getConfiguredPrompts({
        chatCompletionSettings: {
            prompts: [
                { identifier: 'dropdown-only', name: 'Dropdown only', enabled: true },
                { identifier: 'second', name: 'Second', enabled: true },
                { identifier: 'first', name: 'First', enabled: false },
            ],
            prompt_order: [{
                character_id: 100001,
                order: [
                    { identifier: 'first', enabled: true },
                    { identifier: 'second', enabled: false },
                ],
            }],
        },
    });

    assert.deepEqual(
        prompts.map(({ identifier, enabled, promptOrder, promptOrderSource }) => ({
            identifier,
            enabled,
            promptOrder,
            promptOrderSource,
        })),
        [
            {
                identifier: 'first',
                enabled: true,
                promptOrder: 0,
                promptOrderSource: 'prompt-manager',
            },
            {
                identifier: 'second',
                enabled: false,
                promptOrder: 1,
                promptOrderSource: 'prompt-manager',
            },
        ],
    );
});

test('an empty Prompt Manager order does not expose unattached prompt definitions', () => {
    assert.deepEqual(getConfiguredPrompts({
        chatCompletionSettings: {
            prompts: [{ identifier: 'dropdown-only', name: 'Dropdown only' }],
            prompt_order: [{ character_id: 100001, order: [] }],
        },
    }), []);
});

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
        chat_completion_source: 'openrouter',
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
    assert.equal(saved[0].provider, 'openrouter');
    assert.equal(saved[0].stats.maxOutput, 321);
    assert.match(saved[0].profileContext.chat.key, /^scope-v1:/u);
    assert.equal(saved[0].profileContext.chat.key.includes('chat'), false);
});

test('capture namespaces a shared chat id by character or group owner', async () => {
    const captureContext = async (overrides) => {
        const eventSource = new FakeEventSource();
        const saved = [];
        const context = Object.assign(createContext(eventSource), overrides);
        const controller = new CaptureController({
            getContext: () => context,
            store: { addSnapshot: async (snapshot) => saved.push(snapshot) },
            version: 'test',
            settingsWaitMs: 5,
        });
        controller.start();
        eventSource.emitSynchronously('chat_completion_prompt_ready', {
            chat: [{ role: 'user', content: 'Owner scope' }],
            dryRun: false,
        });
        await waitFor(() => saved.length === 1);
        return saved[0].profileContext.chat.key;
    };

    const alice = await captureContext({
        characters: [{ avatar: 'alice.png', name: 'Alice' }],
        characterId: 0,
    });
    const bob = await captureContext({
        characters: [{ avatar: 'bob.png', name: 'Bob' }],
        characterId: 0,
    });
    const firstGroup = await captureContext({
        characters: [{ avatar: 'member.png', name: 'Member' }],
        characterId: 0,
        groups: [{ id: 'group-a', name: 'Group A' }],
        groupId: 'group-a',
    });
    const secondGroup = await captureContext({
        characters: [{ avatar: 'member.png', name: 'Member' }],
        characterId: 0,
        groups: [{ id: 'group-b', name: 'Group B' }],
        groupId: 'group-b',
    });

    assert.notEqual(alice, bob);
    assert.notEqual(firstGroup, secondGroup);
    assert.notEqual(firstGroup, alice);
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
    assert.equal(saved[0].provider, 'makersuite');
});

test('text completion prefers settings-ready data and ignores the later duplicate event', async () => {
    const eventSource = new FakeEventSource();
    const saved = [];
    const context = createContext(eventSource);
    context.mainApi = 'textgenerationwebui';
    context.textCompletionSettings = {
        model: 'text-model',
        amount_gen: 200,
        type: 'openrouter',
    };
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
    assert.equal(saved[0].provider, 'openrouter');
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

test('storage failures expose the same snapshot for an idempotent retry', async () => {
    let attempts = 0;
    const saved = [];
    const controller = new CaptureController({
        getContext: () => ({}),
        store: {
            async addSnapshot(snapshot) {
                attempts += 1;
                if (attempts === 1) throw new Error('IndexedDB unavailable');
                saved.push(snapshot);
            },
        },
        version: 'test',
    });
    const snapshot = {
        schemaVersion: 4,
        id: 'retry-me',
        timestamp: 1,
        chatId: 'chat',
    };
    let failure = null;
    let success = null;
    controller.addEventListener('capture-error', (event) => {
        failure = event.detail;
    });
    controller.addEventListener('snapshot', (event) => {
        success = event.detail;
    });

    await assert.rejects(() => controller.storeSnapshot(snapshot), /IndexedDB unavailable/);
    assert.equal(failure.snapshot, snapshot);
    assert.equal(failure.operation, 'addSnapshot');

    const retried = await controller.retrySnapshot(failure.snapshot);
    assert.equal(attempts, 2);
    assert.equal(saved.length, 1);
    assert.equal(retried.id, snapshot.id);
    assert.equal(success.id, snapshot.id);
    assert.notEqual(retried, snapshot);
});

test('generation stop updates an already stored snapshot without changing its id', async () => {
    const eventSource = new FakeEventSource();
    const stored = new Map();
    const context = createContext(eventSource);
    const controller = new CaptureController({
        getContext: () => context,
        store: {
            async addSnapshot(snapshot) {
                stored.set(snapshot.id, structuredClone(snapshot));
            },
        },
        version: 'test',
        settingsWaitMs: 50,
    });
    controller.start();

    eventSource.emitSynchronously('generation_started', 'normal');
    eventSource.emitSynchronously('chat_completion_prompt_ready', {
        chat: [{ role: 'user', content: 'Lifecycle prompt' }],
        dryRun: false,
    });
    eventSource.emitSynchronously('chat_completion_settings_ready', {
        messages: [{ role: 'user', content: 'Lifecycle prompt' }],
    });
    await waitFor(() => stored.size === 1);
    const snapshotId = [...stored.keys()][0];
    assert.equal(stored.get(snapshotId).capture.requestStatus, 'captured');
    assert.equal(stored.get(snapshotId).capture.generationStatus, 'started');

    eventSource.emitSynchronously('generation_stopped');
    await waitFor(() => stored.get(snapshotId)?.capture?.generationStatus === 'stopped');

    assert.equal(stored.size, 1);
    assert.equal(stored.get(snapshotId).capture.statusEvent, 'GENERATION_STOPPED');
});

test('generation ended and prompt-only timeout remain separate capture states', async () => {
    const eventSource = new FakeEventSource();
    const stored = new Map();
    const context = createContext(eventSource);
    const controller = new CaptureController({
        getContext: () => context,
        store: {
            async addSnapshot(snapshot) {
                stored.set(snapshot.id, structuredClone(snapshot));
            },
        },
        version: 'test',
        settingsWaitMs: 5,
    });
    controller.start();

    eventSource.emitSynchronously('generation_started', 'normal');
    eventSource.emitSynchronously('chat_completion_prompt_ready', {
        chat: [{ role: 'user', content: 'Fallback lifecycle prompt' }],
        dryRun: false,
    });
    eventSource.emitSynchronously('generation_ended');
    await waitFor(() => stored.size === 1);

    const captured = [...stored.values()][0];
    assert.equal(captured.capture.requestStatus, 'prompt-only-timeout');
    assert.equal(captured.capture.generationStatus, 'ended');
    assert.equal(captured.capture.statusEvent, 'GENERATION_ENDED');
});

test('capture sanitizes secrets from context, lore, payload, and request structures', async () => {
    const eventSource = new FakeEventSource();
    const saved = [];
    const context = createContext(eventSource);
    const secrets = {
        persona: ['sk', 'proj', 'abcdefghijklmnopqrstuvwxyz123456'].join('-'),
        lore: ['ghp', 'abcdefghijklmnopqrstuvwxyz123456'].join('_'),
        prompt: ['xoxb', '1234567890', 'abcdefghijklmnop'].join('-'),
    };
    context.powerUserSettings.persona_description = `Persona ${secrets.persona}`;
    context.chatCompletionSettings.prompts = [{
        identifier: 'sensitive-prompt',
        name: 'Sensitive prompt',
        content: `Configured ${secrets.prompt}`,
        enabled: true,
    }];
    const controller = new CaptureController({
        getContext: () => context,
        store: { addSnapshot: async (snapshot) => saved.push(structuredClone(snapshot)) },
        version: 'test',
        settingsWaitMs: 50,
    });
    controller.start();

    eventSource.emitSynchronously('generation_started', 'normal');
    eventSource.emitSynchronously('world_info_activated', [{
        uid: 1,
        world: 'Book',
        content: `Lore ${secrets.lore}`,
    }]);
    eventSource.emitSynchronously('chat_completion_prompt_ready', {
        chat: [{ role: 'system', content: `Prompt ${secrets.prompt}` }],
        dryRun: false,
    });
    eventSource.emitSynchronously('chat_completion_settings_ready', {
        messages: [{ role: 'system', content: `Prompt ${secrets.prompt}` }],
        note: `Persona ${secrets.persona}`,
    });
    await waitFor(() => saved.length === 1);

    const serialized = JSON.stringify(saved[0]);
    for (const secret of Object.values(secrets)) {
        assert.equal(serialized.includes(secret), false);
    }
    assert.equal(
        saved[0].request.redactedPaths.some((path) => path.startsWith('contextState.')),
        true,
    );
    assert.equal(
        saved[0].request.redactedPaths.some((path) => path.startsWith('activatedLore[')),
        true,
    );
});

test('capture applies the selected privacy mode before persistent storage', async () => {
    const eventSource = new FakeEventSource();
    const saved = [];
    const context = createContext(eventSource);
    const controller = new CaptureController({
        getContext: () => context,
        store: {
            addSnapshot: async (snapshot, options) => saved.push({
                snapshot: structuredClone(snapshot),
                options: structuredClone(options),
            }),
        },
        version: 'test',
        settingsWaitMs: 50,
        getCaptureMode: () => 'metadata',
    });
    controller.start();

    eventSource.emitSynchronously('generation_started', 'normal');
    eventSource.emitSynchronously('chat_completion_prompt_ready', {
        chat: [{ role: 'system', content: 'Never persist this original prompt' }],
        dryRun: false,
        requestId: 'private-request-id',
    });
    eventSource.emitSynchronously('chat_completion_settings_ready', {
        messages: [{ role: 'system', content: 'Never persist this original prompt' }],
        requestId: 'private-request-id',
    });
    await waitFor(() => saved.length === 1);

    const { snapshot, options } = saved[0];
    const serialized = JSON.stringify(snapshot);
    assert.equal(snapshot.privacy.mode, 'metadata');
    assert.equal(snapshot.privacy.rawPromptContentIncluded, false);
    assert.equal(snapshot.privacy.rawChatIdIncluded, false);
    assert.match(snapshot.id, /^snapshot-[0-9a-f]{24}$/u);
    assert.match(snapshot.chatId, /^chat-[0-9a-f]{24}$/u);
    assert.equal(options.partitionChatId, 'chat');
    assert.equal(Object.hasOwn(snapshot, 'payload'), false);
    assert.equal(Object.hasOwn(snapshot, 'sources'), false);
    assert.equal(serialized.includes('Never persist this original prompt'), false);
    assert.equal(serialized.includes('private-request-id'), false);
});
