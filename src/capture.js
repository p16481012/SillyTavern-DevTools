import { deepClone, finalizeSnapshot } from './model.js';
import {
    createCaptureBoundary,
    createRequestRecord,
    extractPromptPayload,
} from './request.js';

const DEFAULT_SETTINGS_WAIT_MS = 1500;

function getEventTypes(context) {
    return context.eventTypes ?? context.event_types ?? {};
}

function getConfiguredPrompts(context) {
    const prompts = context.chatCompletionSettings?.prompts;
    return Array.isArray(prompts) ? deepClone(prompts) : [];
}

function getModel(context) {
    try {
        if (context.mainApi === 'openai' && typeof context.getChatCompletionModel === 'function') {
            return context.getChatCompletionModel();
        }
    } catch {
        // Fall back to common text-completion settings.
    }

    const settings = context.textCompletionSettings ?? {};
    return settings.model
        ?? settings.server_model
        ?? settings.custom_model
        ?? null;
}

function getMaxOutput(context) {
    if (context.mainApi === 'openai') {
        return context.chatCompletionSettings?.openai_max_tokens ?? null;
    }
    return context.textCompletionSettings?.amount_gen
        ?? context.textCompletionSettings?.max_tokens
        ?? null;
}

function getAuthorsNote(context) {
    return context.chatMetadata?.note_prompt
        ?? context.chatMetadata?.authors_note
        ?? context.chatMetadata?.author_note
        ?? '';
}

function getCharacterFields(context, character) {
    try {
        const fields = context.getCharacterCardFields?.();
        if (fields) {
            return deepClone({
                description: fields.description ?? '',
                personality: fields.personality ?? '',
                scenario: fields.scenario ?? '',
                exampleDialogue: fields.mesExamples ?? '',
                firstMessage: fields.firstMessage ?? '',
                systemPrompt: fields.system ?? '',
                postHistoryInstructions: fields.jailbreak ?? '',
                depthPrompt: fields.charDepthPrompt ?? '',
            });
        }
    } catch {
        // Use raw card fields on older SillyTavern versions.
    }

    const data = character?.data ?? character ?? {};
    return deepClone({
        description: data.description ?? character?.description ?? '',
        personality: data.personality ?? character?.personality ?? '',
        scenario: context.chatMetadata?.scenario ?? data.scenario ?? character?.scenario ?? '',
        exampleDialogue: context.chatMetadata?.mes_example ?? data.mes_example ?? character?.mes_example ?? '',
        firstMessage: data.first_mes ?? character?.first_mes ?? '',
        systemPrompt: context.chatMetadata?.system_prompt ?? data.system_prompt ?? '',
        postHistoryInstructions: data.post_history_instructions ?? '',
        depthPrompt: data.extensions?.depth_prompt?.prompt ?? '',
    });
}

function snapshotContext(context) {
    const character = context.characters?.[context.characterId] ?? null;
    let preset = null;
    try {
        const presetManager = context.getPresetManager?.();
        preset = presetManager?.getSelectedPreset?.()
            ?? presetManager?.selectedPreset
            ?? null;
    } catch {
        // A preset manager is not available for every API or app state.
    }
    return {
        chatId: context.getCurrentChatId?.() ?? context.chatId ?? '__global__',
        messageCount: context.chat?.length ?? 0,
        mainApi: context.mainApi,
        model: getModel(context),
        preset,
        maxContext: context.maxContext,
        maxOutput: getMaxOutput(context),
        character: deepClone(character),
        characterFields: getCharacterFields(context, character),
        personaDescription: context.powerUserSettings?.persona_description ?? '',
        authorsNote: getAuthorsNote(context),
        extensionPrompts: deepClone(context.extensionPrompts ?? {}),
        configuredPrompts: getConfiguredPrompts(context),
    };
}

function pendingKey(promptType) {
    return promptType === 'chat-completion' ? 'chat-completion' : 'text-completion';
}

export class CaptureController extends EventTarget {
    constructor({
        getContext,
        store,
        version,
        settingsWaitMs = DEFAULT_SETTINGS_WAIT_MS,
    }) {
        super();
        this.getContext = getContext;
        this.store = store;
        this.version = version;
        this.settingsWaitMs = settingsWaitMs;
        this.started = false;
        this.pendingLore = [];
        this.generationType = 'unknown';
        this.pending = {
            'chat-completion': [],
            'text-completion': [],
        };
    }

    start() {
        if (this.started) {
            return;
        }

        const context = this.getContext();
        const events = getEventTypes(context);

        if (events.GENERATION_STARTED) {
            context.eventSource.on(events.GENERATION_STARTED, (data) => {
                this.generationType = typeof data === 'string'
                    ? data
                    : data?.type ?? data?.generationType ?? 'unknown';
                this.pendingLore = [];
            });
        }

        if (events.WORLD_INFO_ACTIVATED) {
            context.eventSource.on(events.WORLD_INFO_ACTIVATED, (entries) => {
                this.pendingLore = deepClone(Array.isArray(entries) ? entries : []);
            });
        }

        context.eventSource.on(events.CHAT_COMPLETION_PROMPT_READY, (data) => {
            if (data?.dryRun || !Array.isArray(data?.chat)) {
                return;
            }
            this.enqueueCapture('chat-completion', data.chat);
        });

        context.eventSource.on(events.GENERATE_AFTER_COMBINE_PROMPTS, (data) => {
            if (data?.dryRun || typeof data?.prompt !== 'string') {
                return;
            }
            const current = this.getContext();
            if (current.mainApi === 'openai') {
                return;
            }
            this.enqueueCapture('text-completion', data.prompt);
        });

        if (events.CHAT_COMPLETION_SETTINGS_READY) {
            context.eventSource.on(events.CHAT_COMPLETION_SETTINGS_READY, (data) => {
                this.attachRequestBody(
                    'chat-completion',
                    data,
                    'CHAT_COMPLETION_SETTINGS_READY',
                    'backend-request-ready',
                );
            });
        }

        if (events.TEXT_COMPLETION_SETTINGS_READY) {
            context.eventSource.on(events.TEXT_COMPLETION_SETTINGS_READY, (data) => {
                this.attachRequestBody(
                    'text-completion',
                    data,
                    'TEXT_COMPLETION_SETTINGS_READY',
                    'backend-request-ready',
                );
            });
        }

        if (events.GENERATE_AFTER_DATA) {
            context.eventSource.on(events.GENERATE_AFTER_DATA, (data, dryRun) => {
                if (dryRun) return;
                const firstPending = this.pending['text-completion'][0];
                if (!firstPending || firstPending.contextState.mainApi === 'openai') return;
                this.attachRequestBody(
                    'text-completion',
                    data,
                    'GENERATE_AFTER_DATA',
                    'generation-data-ready',
                );
            });
        }

        this.started = true;
    }

    enqueueCapture(promptType, mutablePayload) {
        const key = pendingKey(promptType);
        const pending = {
            contextState: snapshotContext(this.getContext()),
            promptType,
            promptReadyPayload: deepClone(mutablePayload),
            activatedLore: deepClone(this.pendingLore),
            generationType: this.generationType,
            settled: false,
            timer: null,
        };
        this.pendingLore = [];
        this.pending[key].push(pending);
        pending.timer = setTimeout(() => {
            this.finishPending(pending, {
                payload: pending.promptReadyPayload,
                requestBody: null,
                eventName: promptType === 'chat-completion'
                    ? 'CHAT_COMPLETION_PROMPT_READY'
                    : 'GENERATE_AFTER_COMBINE_PROMPTS',
                stage: 'prompt-ready',
                fallback: true,
            });
        }, this.settingsWaitMs);
    }

    attachRequestBody(promptType, mutableRequestBody, eventName, stage) {
        const key = pendingKey(promptType);
        const pending = this.pending[key][0];
        if (!pending || pending.settled) return;

        setTimeout(() => {
            if (pending.settled || this.pending[key][0] !== pending) return;
            const requestBody = deepClone(mutableRequestBody);
            const payload = deepClone(extractPromptPayload(
                requestBody,
                promptType,
                pending.promptReadyPayload,
            ));
            this.finishPending(pending, {
                payload,
                requestBody,
                eventName,
                stage,
                fallback: false,
            });
        }, 0);
    }

    finishPending(pending, {
        payload,
        requestBody,
        eventName,
        stage,
        fallback,
    }) {
        if (pending.settled) return;
        pending.settled = true;
        clearTimeout(pending.timer);
        const key = pendingKey(pending.promptType);
        this.pending[key] = this.pending[key].filter((item) => item !== pending);

        const request = createRequestRecord(requestBody);
        const capture = createCaptureBoundary({
            eventName,
            stage,
            requestBodyAvailable: Boolean(request.body),
            fallback,
        });

        setTimeout(() => {
            this.persistCapture({
                contextState: pending.contextState,
                payload,
                promptType: pending.promptType,
                generationType: pending.generationType,
                activatedLore: pending.activatedLore,
                capture,
                request,
            }).catch((error) => {
                console.error('[ST DevTools] Failed to persist prompt snapshot.', error);
            });
        }, 0);
    }

    async persistCapture({
        contextState,
        payload,
        promptType,
        generationType,
        activatedLore,
        capture,
        request,
    }) {
        const context = this.getContext();
        const tokenCounter = typeof context.getTokenCountAsync === 'function'
            ? (text) => context.getTokenCountAsync(text)
            : async (text) => Math.ceil(new TextEncoder().encode(text).length / 3.35);
        const snapshot = await finalizeSnapshot({
            contextState,
            payload,
            promptType,
            generationType,
            activatedLore,
            extensionVersion: this.version,
            tokenCounter,
            capture,
            request,
        });
        await this.store.addSnapshot(snapshot);
        this.dispatchEvent(new CustomEvent('snapshot', { detail: snapshot }));
    }
}
