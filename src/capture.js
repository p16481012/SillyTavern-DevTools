import { deepClone, finalizeSnapshot } from './model.js';

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
        personaDescription: context.powerUserSettings?.persona_description ?? '',
        authorsNote: getAuthorsNote(context),
        extensionPrompts: deepClone(context.extensionPrompts ?? {}),
        configuredPrompts: getConfiguredPrompts(context),
    };
}

export class CaptureController extends EventTarget {
    constructor({ getContext, store, version }) {
        super();
        this.getContext = getContext;
        this.store = store;
        this.version = version;
        this.started = false;
        this.pendingLore = [];
        this.generationType = 'unknown';
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

        this.started = true;
    }

    enqueueCapture(promptType, mutablePayload) {
        const payload = deepClone(mutablePayload);
        const contextState = snapshotContext(this.getContext());
        const activatedLore = deepClone(this.pendingLore);
        const generationType = this.generationType;
        this.pendingLore = [];

        setTimeout(() => {
            this.persistCapture({
                contextState,
                payload,
                promptType,
                generationType,
                activatedLore,
            }).catch((error) => {
                console.error('[ST DevTools] Failed to persist prompt snapshot.', error);
            });
        }, 0);
    }

    async persistCapture({ contextState, payload, promptType, generationType, activatedLore }) {
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
        });
        await this.store.addSnapshot(snapshot);
        this.dispatchEvent(new CustomEvent('snapshot', { detail: snapshot }));
    }
}
