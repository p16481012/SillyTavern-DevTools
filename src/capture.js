import { deepClone, finalizeSnapshot } from './model.js';
import {
    createCaptureBoundary,
    createRequestRecord,
    extractPromptPayload,
    extractRequestCorrelationId,
    sanitizePromptPayload,
} from './request.js';

const DEFAULT_SETTINGS_WAIT_MS = 1500;

function getEventTypes(context) {
    return context.eventTypes ?? context.event_types ?? {};
}

function selectPromptOrder(settings, prompts) {
    const orderLists = Array.isArray(settings?.prompt_order)
        ? settings.prompt_order.filter((entry) => Array.isArray(entry?.order))
        : [];
    if (orderLists.length === 0) return null;

    const identifiers = new Set(
        prompts.map((prompt) => prompt?.identifier).filter(Boolean),
    );
    return [...orderLists].sort((left, right) => {
        const preferredLeft = String(left?.character_id) === '100001' ? 1 : 0;
        const preferredRight = String(right?.character_id) === '100001' ? 1 : 0;
        if (preferredLeft !== preferredRight) return preferredRight - preferredLeft;
        const overlap = (entry) => entry.order.reduce(
            (count, item) => count + (identifiers.has(item?.identifier) ? 1 : 0),
            0,
        );
        return overlap(right) - overlap(left);
    })[0];
}

export function getConfiguredPrompts(context) {
    const settings = context.chatCompletionSettings ?? {};
    const prompts = Array.isArray(settings.prompts) ? deepClone(settings.prompts) : [];
    const selectedOrder = selectPromptOrder(settings, prompts);
    if (!selectedOrder) {
        return prompts.map((prompt, promptOrder) => ({
            ...prompt,
            promptOrder,
            promptOrderSource: 'settings-array',
        }));
    }
    if (selectedOrder.order.length === 0) return [];

    const promptByIdentifier = new Map(
        prompts
            .filter((prompt) => prompt?.identifier)
            .map((prompt) => [prompt.identifier, prompt]),
    );
    return selectedOrder.order.flatMap((entry, promptOrder) => {
        const prompt = promptByIdentifier.get(entry?.identifier);
        if (!prompt) return [];
        return [{
            ...prompt,
            enabled: entry.enabled ?? prompt.enabled ?? null,
            promptOrder,
            promptOrderSource: 'prompt-manager',
        }];
    });
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
        this.attachedRequestBodies = new WeakSet();
        this.attachedCorrelationIds = new Set();
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
            this.enqueueCapture('chat-completion', data.chat, {
                correlationId: extractRequestCorrelationId(data),
            });
        });

        context.eventSource.on(events.GENERATE_AFTER_COMBINE_PROMPTS, (data) => {
            if (data?.dryRun || typeof data?.prompt !== 'string') {
                return;
            }
            const current = this.getContext();
            if (current.mainApi === 'openai') {
                return;
            }
            this.enqueueCapture('text-completion', data.prompt, {
                correlationId: extractRequestCorrelationId(data),
            });
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
                const firstPending = this.pending['text-completion']
                    .find((item) => !item.settled && !item.reserved);
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

    enqueueCapture(promptType, mutablePayload, { correlationId = null } = {}) {
        const key = pendingKey(promptType);
        const pending = {
            contextState: snapshotContext(this.getContext()),
            promptType,
            promptReadyPayload: sanitizePromptPayload(deepClone(mutablePayload)),
            activatedLore: deepClone(this.pendingLore),
            generationType: this.generationType,
            correlationId,
            settled: false,
            reserved: false,
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
                correlationMethod: 'prompt-only',
            });
        }, this.settingsWaitMs);
    }

    attachRequestBody(promptType, mutableRequestBody, eventName, stage) {
        const key = pendingKey(promptType);
        const requestCorrelationId = extractRequestCorrelationId(mutableRequestBody);
        const available = this.pending[key].filter((item) => !item.settled && !item.reserved);
        const exact = requestCorrelationId
            ? available.find((item) => item.correlationId === requestCorrelationId)
            : null;
        const hasConflictingExplicitId = Boolean(
            requestCorrelationId
            && available.some((item) => item.correlationId)
            && !exact,
        );
        const pending = exact ?? (hasConflictingExplicitId ? null : available[0]);
        if (!pending || pending.settled) return;
        const canTrackRequestBody = mutableRequestBody !== null
            && (typeof mutableRequestBody === 'object' || typeof mutableRequestBody === 'function');
        if (canTrackRequestBody && this.attachedRequestBodies.has(mutableRequestBody)) {
            return;
        }
        if (requestCorrelationId && this.attachedCorrelationIds.has(requestCorrelationId)) {
            return;
        }
        pending.reserved = true;
        if (canTrackRequestBody) {
            this.attachedRequestBodies.add(mutableRequestBody);
        }
        if (requestCorrelationId) {
            this.attachedCorrelationIds.add(requestCorrelationId);
            if (this.attachedCorrelationIds.size > 512) {
                this.attachedCorrelationIds.delete(this.attachedCorrelationIds.values().next().value);
            }
        }

        setTimeout(() => {
            if (pending.settled || !this.pending[key].includes(pending)) return;
            const requestBody = deepClone(mutableRequestBody);
            const payload = sanitizePromptPayload(deepClone(extractPromptPayload(
                requestBody,
                promptType,
                pending.promptReadyPayload,
            )));
            this.finishPending(pending, {
                payload,
                requestBody,
                eventName,
                stage,
                fallback: false,
                correlationMethod: exact ? 'explicit-id' : 'fifo',
            });
        }, 0);
    }

    finishPending(pending, {
        payload,
        requestBody,
        eventName,
        stage,
        fallback,
        correlationMethod,
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
            correlationId: request.correlationId ?? pending.correlationId,
            correlationMethod,
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
        await this.storeSnapshot(snapshot);
        return snapshot;
    }

    async retrySnapshot(snapshot) {
        return this.storeSnapshot(deepClone(snapshot));
    }

    async storeSnapshot(snapshot) {
        try {
            await this.store.addSnapshot(snapshot);
        } catch (error) {
            this.dispatchEvent(new CustomEvent('capture-error', {
                detail: {
                    operation: 'addSnapshot',
                    snapshot,
                    error,
                },
            }));
            throw error;
        }
        this.dispatchEvent(new CustomEvent('snapshot', { detail: snapshot }));
        return snapshot;
    }
}
