import { deepClone, finalizeSnapshot } from './model.js';
import { createProfileContext } from './profile-context.js';
import {
    createCaptureBoundary,
    createRequestRecord,
    extractPromptPayload,
    extractRequestCorrelationId,
    sanitizeRequestBody,
} from './request.js';
import { transformSnapshotPrivacy } from './snapshot-privacy.js';

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

function selectedGroupContext(context) {
    const rawDirectGroup = context.group ?? context.selectedGroup ?? null;
    const directGroup = rawDirectGroup && typeof rawDirectGroup === 'object'
        ? rawDirectGroup
        : null;
    const groupId = context.groupId
        ?? context.group_id
        ?? context.selectedGroupId
        ?? (directGroup ? null : rawDirectGroup)
        ?? directGroup?.id
        ?? directGroup?.group_id
        ?? null;
    const groups = context.groups;
    let group = directGroup;
    if (!group && groupId != null && groups instanceof Map) {
        group = groups.get(groupId) ?? groups.get(String(groupId)) ?? null;
    } else if (!group && groupId != null && Array.isArray(groups)) {
        group = groups.find((item) => (
            String(item?.id ?? item?.group_id) === String(groupId)
        )) ?? null;
    } else if (!group && groupId != null && groups && typeof groups === 'object') {
        group = groups[groupId] ?? groups[String(groupId)] ?? null;
    }
    return { group, groupId };
}

function snapshotContext(context) {
    const character = context.characters?.[context.characterId] ?? null;
    const { group, groupId } = selectedGroupContext(context);
    const chatId = context.getCurrentChatId?.() ?? context.chatId ?? '__global__';
    let preset = null;
    let presetNamespace = context.mainApi ?? null;
    try {
        const presetManager = context.getPresetManager?.();
        preset = presetManager?.getSelectedPreset?.()
            ?? presetManager?.selectedPreset
            ?? null;
        presetNamespace = presetManager?.apiId
            ?? presetManager?.api
            ?? presetManager?.type
            ?? presetNamespace;
    } catch {
        // A preset manager is not available for every API or app state.
    }
    return {
        chatId,
        messageCount: context.chat?.length ?? 0,
        mainApi: context.mainApi,
        chatCompletionSource: context.chatCompletionSettings?.chat_completion_source ?? null,
        textCompletionSource: context.textCompletionSettings?.type ?? null,
        model: getModel(context),
        preset,
        profileContext: createProfileContext({
            chatId,
            preset,
            presetNamespace,
            character,
            characterId: context.characterId,
            group,
            groupId,
        }),
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

function sanitizeCaptureValue(value, pathPrefix) {
    const sanitized = sanitizeRequestBody(value);
    const prefix = (path) => {
        if (!path) return pathPrefix;
        return path.startsWith('[')
            ? `${pathPrefix}${path}`
            : `${pathPrefix}.${path}`;
    };
    return {
        value: sanitized.body,
        redactedPaths: sanitized.redactedPaths.map(prefix),
        omittedMediaPaths: sanitized.omittedMediaPaths.map(prefix),
    };
}

function emptySanitizedLore() {
    return {
        value: [],
        redactedPaths: [],
        omittedMediaPaths: [],
    };
}

function attachStorageChatId(snapshot, chatId) {
    if (!snapshot || typeof snapshot !== 'object') return snapshot;
    Object.defineProperty(snapshot, 'storageChatId', {
        configurable: true,
        enumerable: false,
        writable: false,
        value: String(chatId || '__global__'),
    });
    return snapshot;
}

export class CaptureController extends EventTarget {
    constructor({
        getContext,
        store,
        version,
        settingsWaitMs = DEFAULT_SETTINGS_WAIT_MS,
        getCaptureMode = () => 'full',
    }) {
        super();
        this.getContext = getContext;
        this.store = store;
        this.version = version;
        this.settingsWaitMs = settingsWaitMs;
        this.getCaptureMode = getCaptureMode;
        this.started = false;
        this.pendingLore = emptySanitizedLore();
        this.generationType = 'unknown';
        this.pending = {
            'chat-completion': [],
            'text-completion': [],
        };
        this.generationSequence = 0;
        this.activeGeneration = null;
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
            context.eventSource.on(events.GENERATION_STARTED, (data, _options, dryRun) => {
                if (dryRun) return;
                this.generationType = typeof data === 'string'
                    ? data
                    : data?.type ?? data?.generationType ?? 'unknown';
                this.pendingLore = emptySanitizedLore();
                this.activeGeneration = {
                    id: ++this.generationSequence,
                    status: 'started',
                    statusEvent: 'GENERATION_STARTED',
                    statusUpdatedAt: Date.now(),
                    snapshots: new Map(),
                };
            });
        }

        if (events.GENERATION_STOPPED) {
            context.eventSource.on(events.GENERATION_STOPPED, () => {
                this.markGenerationStatus('stopped', 'GENERATION_STOPPED');
            });
        }

        if (events.GENERATION_ENDED) {
            context.eventSource.on(events.GENERATION_ENDED, () => {
                this.markGenerationStatus('ended', 'GENERATION_ENDED');
            });
        }

        if (events.WORLD_INFO_ACTIVATED) {
            context.eventSource.on(events.WORLD_INFO_ACTIVATED, (entries) => {
                this.pendingLore = sanitizeCaptureValue(
                    Array.isArray(entries) ? entries : [],
                    'activatedLore',
                );
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
        const contextState = sanitizeCaptureValue(
            snapshotContext(this.getContext()),
            'contextState',
        );
        const activatedLore = this.pendingLore;
        const pending = {
            contextState: contextState.value,
            promptType,
            promptReadyPayload: deepClone(mutablePayload),
            promptReadySanitized: null,
            activatedLore: activatedLore.value,
            supplementalRedactedPaths: [
                ...contextState.redactedPaths,
                ...activatedLore.redactedPaths,
            ],
            supplementalOmittedMediaPaths: [
                ...contextState.omittedMediaPaths,
                ...activatedLore.omittedMediaPaths,
            ],
            fallbackRedactedPaths: [],
            fallbackOmittedMediaPaths: [],
            generationType: this.generationType,
            generation: this.activeGeneration,
            correlationId,
            settled: false,
            reserved: false,
            timer: null,
        };
        this.pendingLore = emptySanitizedLore();
        this.pending[key].push(pending);
        pending.timer = setTimeout(() => {
            const promptReady = this.sanitizePendingPrompt(pending);
            this.finishPending(pending, {
                payload: promptReady.value,
                request: null,
                eventName: promptType === 'chat-completion'
                    ? 'CHAT_COMPLETION_PROMPT_READY'
                    : 'GENERATE_AFTER_COMBINE_PROMPTS',
                stage: 'prompt-ready',
                fallback: true,
                correlationMethod: 'prompt-only',
            });
        }, this.settingsWaitMs);
    }

    sanitizePendingPrompt(pending) {
        if (!pending.promptReadySanitized) {
            pending.promptReadySanitized = sanitizeCaptureValue(
                pending.promptReadyPayload,
                'promptReadyPayload',
            );
            pending.fallbackRedactedPaths = pending.promptReadySanitized.redactedPaths;
            pending.fallbackOmittedMediaPaths = pending.promptReadySanitized.omittedMediaPaths;
        }
        return pending.promptReadySanitized;
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
            const request = createRequestRecord(mutableRequestBody);
            const requestPayload = extractPromptPayload(
                request.body,
                promptType,
                null,
            );
            const payload = requestPayload ?? this.sanitizePendingPrompt(pending).value;
            this.finishPending(pending, {
                payload,
                request,
                eventName,
                stage,
                fallback: false,
                correlationMethod: exact ? 'explicit-id' : 'fifo',
            });
        }, 0);
    }

    finishPending(pending, {
        payload,
        request = null,
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

        const normalizedRequest = request ?? createRequestRecord(null);
        normalizedRequest.redactedPaths = [...new Set([
            ...normalizedRequest.redactedPaths,
            ...pending.supplementalRedactedPaths,
            ...pending.fallbackRedactedPaths,
        ])];
        normalizedRequest.omittedMediaPaths = [...new Set([
            ...normalizedRequest.omittedMediaPaths,
            ...pending.supplementalOmittedMediaPaths,
            ...pending.fallbackOmittedMediaPaths,
        ])];
        const capture = createCaptureBoundary({
            eventName,
            stage,
            requestBodyAvailable: Boolean(normalizedRequest.body),
            fallback,
            correlationId: normalizedRequest.correlationId ?? pending.correlationId,
            correlationMethod,
            generationStatus: pending.generation?.status ?? 'unknown',
            statusEvent: pending.generation?.statusEvent ?? null,
            statusUpdatedAt: pending.generation?.statusUpdatedAt ?? null,
        });

        setTimeout(() => {
            this.persistCapture({
                contextState: pending.contextState,
                payload,
                promptType: pending.promptType,
                generationType: pending.generationType,
                activatedLore: pending.activatedLore,
                capture,
                request: normalizedRequest,
                generation: pending.generation,
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
        generation = null,
    }) {
        const context = this.getContext();
        if (generation) {
            capture.generationStatus = generation.status;
            capture.statusEvent = generation.statusEvent;
            capture.statusUpdatedAt = generation.statusUpdatedAt;
        }
        const tokenCounter = typeof context.getTokenCountAsync === 'function'
            ? (text) => context.getTokenCountAsync(text)
            : async (text) => Math.ceil(new TextEncoder().encode(text).length / 3.35);
        const finalizedSnapshot = await finalizeSnapshot({
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
        const snapshot = await transformSnapshotPrivacy(finalizedSnapshot, {
            mode: this.getCaptureMode(),
        });
        await this.storeSnapshot(snapshot, {
            storageChatId: finalizedSnapshot.chatId,
        });
        return this.registerGenerationSnapshot(generation, snapshot);
    }

    async registerGenerationSnapshot(generation, snapshot) {
        if (!generation) return snapshot;
        generation.snapshots.set(snapshot.id, snapshot);
        if (
            snapshot.capture?.generationStatus === generation.status
            && snapshot.capture?.statusEvent === generation.statusEvent
        ) {
            return snapshot;
        }
        const updated = {
            ...snapshot,
            capture: {
                ...(snapshot.capture ?? {}),
                generationStatus: generation.status,
                statusEvent: generation.statusEvent,
                statusUpdatedAt: generation.statusUpdatedAt,
            },
        };
        generation.snapshots.set(updated.id, updated);
        await this.storeSnapshot(updated, {
            storageChatId: snapshot.storageChatId ?? snapshot.chatId,
        });
        return updated;
    }

    markGenerationStatus(status, statusEvent) {
        const generation = this.activeGeneration;
        if (!generation) return;
        if (generation.status === 'stopped' && status === 'ended') {
            this.activeGeneration = null;
            return;
        }
        generation.status = status;
        generation.statusEvent = statusEvent;
        generation.statusUpdatedAt = Date.now();
        if (status === 'stopped' || status === 'ended') {
            this.activeGeneration = null;
        }
        for (const snapshot of generation.snapshots.values()) {
            this.registerGenerationSnapshot(generation, snapshot).catch((error) => {
                console.error('[ST DevTools] Failed to update capture lifecycle.', error);
            });
        }
    }

    async retrySnapshot(snapshot) {
        return this.storeSnapshot(deepClone(snapshot), {
            storageChatId: snapshot?.storageChatId ?? snapshot?.chatId,
        });
    }

    async storeSnapshot(snapshot, {
        storageChatId = snapshot?.storageChatId ?? snapshot?.chatId,
    } = {}) {
        attachStorageChatId(snapshot, storageChatId);
        try {
            await this.store.addSnapshot(snapshot, {
                partitionChatId: snapshot.storageChatId,
            });
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
