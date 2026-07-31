import { deepClone, finalizeSnapshot } from './model.js';
import { GenerationLedger } from './generation-ledger.js';
import { createProfileContext } from './profile-context.js';
import {
    createLocalEstimatedUsage,
    normalizeProviderUsage,
    normalizeUsageRecord,
} from './provider-usage.js';
import {
    createCaptureBoundary,
    createRequestRecord,
    extractPromptPayload,
    extractRequestCorrelationId,
    sanitizeRequestBody,
} from './request.js';
import { transformSnapshotPrivacy } from './snapshot-privacy.js';

const DEFAULT_SETTINGS_WAIT_MS = 1500;
const CAPTURE_STATUS_STATES = new Set([
    'capturing',
    'processing',
    'saved',
    'failed',
    'excluded-semantic',
    'skipped-safety',
]);
const CAPTURE_PROMPT_TYPES = new Set([
    'chat-completion',
    'text-completion',
]);

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

function correlationIdFromArgs(args) {
    for (const value of args) {
        const correlationId = extractRequestCorrelationId(value);
        if (correlationId) return correlationId;
    }
    return null;
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

function unlinkedUsage(usage) {
    return normalizeUsageRecord({
        ...usage,
        status: 'unlinked',
    });
}

function mergeSnapshotUsage(existing, incoming) {
    if (!incoming || incoming.status === 'unavailable' || incoming.status === 'unlinked') {
        return existing ?? incoming ?? null;
    }
    if (incoming.status === 'provider-reported') return incoming;
    if (existing?.status === 'provider-reported') return existing;
    const inputTokens = incoming.inputTokens ?? existing?.inputTokens ?? null;
    const outputTokens = incoming.outputTokens ?? existing?.outputTokens ?? null;
    return createLocalEstimatedUsage({
        inputTokens,
        outputTokens,
        cachedInputTokens: null,
        totalTokens: inputTokens !== null && outputTokens !== null
            ? inputTokens + outputTokens
            : null,
    }, {
        sourceEvent: incoming.sourceEvent,
        correlatedAt: incoming.correlatedAt,
    });
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
        generationLedger = null,
        semanticCaptureGate = null,
    }) {
        super();
        this.getContext = getContext;
        this.store = store;
        this.version = version;
        this.settingsWaitMs = settingsWaitMs;
        this.getCaptureMode = getCaptureMode;
        this.started = false;
        this.semanticCaptureGate = semanticCaptureGate;
        this.generationLedger = generationLedger ?? new GenerationLedger({
            sessionTimeoutMs: Math.max(120_000, settingsWaitMs * 4),
        });
    }

    semanticCaptureDecision(phase, promptType, payload) {
        try {
            return this.semanticCaptureGate?.decide({
                phase,
                promptType,
                payload,
            }) ?? 'allow';
        } catch {
            return 'allow';
        }
    }

    dispatchCaptureStatus(state, {
        promptType = null,
        stage = null,
    } = {}) {
        if (!CAPTURE_STATUS_STATES.has(state)) return null;
        const detail = { state };
        if (CAPTURE_PROMPT_TYPES.has(promptType)) {
            detail.promptType = promptType;
        }
        if (typeof stage === 'string' && stage.length > 0 && stage.length <= 64) {
            detail.stage = stage;
        }
        detail.at = Date.now();
        Object.freeze(detail);
        this.dispatchEvent(new CustomEvent('capture-status', { detail }));
        return detail;
    }

    start() {
        if (this.started) {
            return;
        }

        const context = this.getContext();
        const events = getEventTypes(context);

        if (events.GENERATION_STARTED) {
            context.eventSource.on(events.GENERATION_STARTED, (...args) => {
                const [data, _options, dryRun] = args;
                if (dryRun) return;
                this.generationLedger.beginGeneration({
                    publicId: correlationIdFromArgs(args),
                    generationType: typeof data === 'string'
                        ? data
                        : data?.type ?? data?.generationType ?? 'unknown',
                });
            });
        }

        if (events.GENERATION_STOPPED) {
            context.eventSource.on(events.GENERATION_STOPPED, (...args) => {
                this.markGenerationStatus(
                    'stopped',
                    'GENERATION_STOPPED',
                    correlationIdFromArgs(args),
                );
            });
        }

        if (events.GENERATION_ENDED) {
            context.eventSource.on(events.GENERATION_ENDED, (...args) => {
                this.markGenerationStatus(
                    'ended',
                    'GENERATION_ENDED',
                    correlationIdFromArgs(args),
                );
            });
        }

        if (events.MESSAGE_RECEIVED) {
            context.eventSource.on(events.MESSAGE_RECEIVED, (messageId, type) => {
                this.recordMessageReceivedUsage(messageId, type);
            });
        }

        if (events.WORLD_INFO_ACTIVATED) {
            context.eventSource.on(events.WORLD_INFO_ACTIVATED, (...args) => {
                const entries = args.find((value) => Array.isArray(value)) ?? [];
                this.generationLedger.recordLore(
                    sanitizeCaptureValue(
                        entries,
                        'activatedLore',
                    ),
                    { publicId: correlationIdFromArgs(args) },
                );
            });
        }

        context.eventSource.on(events.CHAT_COMPLETION_PROMPT_READY, (data) => {
            if (data?.dryRun || !Array.isArray(data?.chat)) {
                return;
            }
            const semanticDecision = this.semanticCaptureDecision(
                'prompt',
                'chat-completion',
                data.chat,
            );
            if (semanticDecision === 'suppress') {
                this.dispatchCaptureStatus('excluded-semantic', {
                    promptType: 'chat-completion',
                    stage: 'prompt-ready',
                });
                return;
            }
            if (semanticDecision === 'ambiguous') {
                this.dispatchCaptureStatus('skipped-safety', {
                    promptType: 'chat-completion',
                    stage: 'prompt-ready',
                });
                return;
            }
            if (semanticDecision !== 'allow') {
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
            const semanticDecision = this.semanticCaptureDecision(
                'prompt',
                'text-completion',
                data.prompt,
            );
            if (semanticDecision === 'suppress') {
                this.dispatchCaptureStatus('excluded-semantic', {
                    promptType: 'text-completion',
                    stage: 'prompt-ready',
                });
                return;
            }
            if (semanticDecision === 'ambiguous') {
                this.dispatchCaptureStatus('skipped-safety', {
                    promptType: 'text-completion',
                    stage: 'prompt-ready',
                });
                return;
            }
            if (semanticDecision !== 'allow') {
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
                this.attachRequestBody(
                    'text-completion',
                    data,
                    'GENERATE_AFTER_DATA',
                    'generation-data-ready',
                    (pending) => pending.contextState.mainApi !== 'openai',
                );
            });
        }

        this.started = true;
    }

    enqueueCapture(promptType, mutablePayload, { correlationId = null } = {}) {
        this.dispatchCaptureStatus('capturing', { promptType });
        const contextState = sanitizeCaptureValue(
            snapshotContext(this.getContext()),
            'contextState',
        );
        const pending = {
            contextState: contextState.value,
            promptType,
            promptReadyPayload: deepClone(mutablePayload),
            promptReadySanitized: null,
            activatedLore: [],
            supplementalRedactedPaths: [
                ...contextState.redactedPaths,
            ],
            supplementalOmittedMediaPaths: [
                ...contextState.omittedMediaPaths,
            ],
            fallbackRedactedPaths: [],
            fallbackOmittedMediaPaths: [],
            generationType: 'unknown',
            generationHandle: null,
            ledgerPromptHandle: null,
            correlationId,
            settled: false,
            reserved: false,
            timer: null,
        };
        const opened = this.generationLedger.openPrompt({
            promptType,
            publicId: correlationId,
            value: pending,
        });
        const activatedLore = opened.activatedLore ?? emptySanitizedLore();
        pending.activatedLore = activatedLore.value;
        pending.supplementalRedactedPaths.push(...activatedLore.redactedPaths);
        pending.supplementalOmittedMediaPaths.push(...activatedLore.omittedMediaPaths);
        pending.generationType = opened.session?.generationType ?? 'unknown';
        pending.generationHandle = opened.sessionHandle;
        pending.ledgerPromptHandle = opened.promptHandle;
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

    attachRequestBody(
        promptType,
        mutableRequestBody,
        eventName,
        stage,
        acceptPending = null,
    ) {
        const requestCorrelationId = extractRequestCorrelationId(mutableRequestBody);
        const semanticDecision = this.semanticCaptureDecision(
            'request',
            promptType,
            mutableRequestBody,
        );
        if (semanticDecision === 'suppress') {
            this.dispatchCaptureStatus('excluded-semantic', {
                promptType,
                stage,
            });
            return;
        }
        if (semanticDecision === 'ambiguous' && !requestCorrelationId) {
            return;
        }
        const claim = this.generationLedger.claimRequest({
            promptType,
            publicId: requestCorrelationId,
            requestIdentity: mutableRequestBody,
            acceptValue: acceptPending,
        });
        if (claim.status !== 'matched') return;
        const pending = claim.value;
        if (!pending || pending.settled) return;
        pending.reserved = true;

        setTimeout(() => {
            if (pending.settled) return;
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
                correlationMethod: claim.method,
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
        this.generationLedger.settlePrompt(pending.ledgerPromptHandle);

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
            correlationId: null,
            hadCorrelationId: Boolean(
                normalizedRequest.hadCorrelationId || pending.correlationId,
            ),
            correlationMethod,
            generationStatus: this.generationLedger
                .getSessionView(pending.generationHandle)?.status ?? 'unknown',
            statusEvent: this.generationLedger
                .getSessionView(pending.generationHandle)?.statusEvent ?? null,
            statusUpdatedAt: this.generationLedger
                .getSessionView(pending.generationHandle)?.statusUpdatedAt ?? null,
        });

        setTimeout(() => {
            this.dispatchCaptureStatus('processing', {
                promptType: pending.promptType,
                stage,
            });
            this.persistCapture({
                contextState: pending.contextState,
                payload,
                promptType: pending.promptType,
                generationType: pending.generationType,
                activatedLore: pending.activatedLore,
                capture,
                request: normalizedRequest,
                generationHandle: pending.generationHandle,
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
        generationHandle = null,
    }) {
        const context = this.getContext();
        const generation = this.generationLedger.getSessionView(generationHandle);
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
        return this.registerGenerationSnapshot(generationHandle, snapshot);
    }

    async registerGenerationSnapshot(generationHandle, snapshot) {
        if (!generationHandle) return snapshot;
        const generation = this.generationLedger.registerSnapshot(
            generationHandle,
            snapshot,
        );
        if (!generation) return snapshot;
        let stored = snapshot;
        if (
            snapshot.capture?.generationStatus !== generation.status
            || snapshot.capture?.statusEvent !== generation.statusEvent
        ) {
            stored = await this.updateGenerationSnapshot(
                generationHandle,
                snapshot,
                {
                    ...(snapshot.capture ?? {}),
                    generationStatus: generation.status,
                    statusEvent: generation.statusEvent,
                    statusUpdatedAt: generation.statusUpdatedAt,
                },
            );
        }
        return this.syncGenerationUsage(
            generationHandle,
            [[stored.id, stored]],
        );
    }

    async updateGenerationSnapshot(generationHandle, snapshot, capture) {
        const storageChatId = snapshot.storageChatId ?? snapshot.chatId;
        if (typeof this.store.updateSnapshot === 'function') {
            const result = await this.store.updateSnapshot(
                storageChatId,
                snapshot.id,
                (current) => ({
                    ...current,
                    capture: {
                        ...(current.capture ?? {}),
                        ...capture,
                    },
                }),
            );
            if (result.updated || result.reason === 'unchanged') {
                const stored = attachStorageChatId(result.snapshot, storageChatId);
                this.generationLedger.replaceSnapshot(generationHandle, stored);
                if (result.updated) {
                    this.dispatchEvent(new CustomEvent('snapshot', { detail: stored }));
                }
                return stored;
            }
            throw new Error(
                `Stored snapshot lifecycle update failed closed: ${result.reason ?? 'unknown'}`,
            );
        }
        const updated = attachStorageChatId({
            ...snapshot,
            capture: {
                ...(snapshot.capture ?? {}),
                ...capture,
            },
        }, storageChatId);
        this.generationLedger.replaceSnapshot(generationHandle, updated);
        await this.storeSnapshot(updated, { storageChatId });
        return updated;
    }

    async updateGenerationUsage(generationHandle, snapshot, usage) {
        const storageChatId = snapshot.storageChatId ?? snapshot.chatId;
        if (typeof this.store.updateSnapshot === 'function') {
            const result = await this.store.updateSnapshot(
                storageChatId,
                snapshot.id,
                (current) => {
                    const merged = mergeSnapshotUsage(current.usage, usage);
                    if (JSON.stringify(merged) === JSON.stringify(current.usage ?? null)) {
                        return null;
                    }
                    return { ...current, usage: merged };
                },
            );
            if (result.updated || result.reason === 'unchanged') {
                const stored = attachStorageChatId(result.snapshot, storageChatId);
                this.generationLedger.replaceSnapshot(generationHandle, stored);
                if (result.updated) {
                    this.dispatchEvent(new CustomEvent('snapshot', { detail: stored }));
                }
                return stored;
            }
            throw new Error(
                `Stored snapshot usage update failed closed: ${result.reason ?? 'unknown'}`,
            );
        }
        const merged = mergeSnapshotUsage(snapshot.usage, usage);
        if (JSON.stringify(merged) === JSON.stringify(snapshot.usage ?? null)) {
            return snapshot;
        }
        const updated = attachStorageChatId({
            ...snapshot,
            usage: merged,
        }, storageChatId);
        this.generationLedger.replaceSnapshot(generationHandle, updated);
        await this.storeSnapshot(updated, { storageChatId });
        return updated;
    }

    async syncGenerationUsage(
        generationHandle,
        snapshotEntries = this.generationLedger.getSnapshotEntries(generationHandle),
    ) {
        const records = this.generationLedger.getUsageRecords(generationHandle);
        if (records.length === 0 || snapshotEntries.length === 0) {
            return snapshotEntries[0]?.[1] ?? null;
        }
        const providerUsage = [...records]
            .reverse()
            .find(({ usage }) => usage?.status === 'provider-reported')?.usage ?? null;
        const localUsage = records
            .map(({ usage }) => usage)
            .filter((usage) => usage?.status === 'local-estimate')
            .at(-1) ?? null;
        const usage = providerUsage ?? localUsage;
        if (!usage) return snapshotEntries[0]?.[1] ?? null;
        const updated = await Promise.all(snapshotEntries.map(async ([id, snapshot]) => {
            if (id !== snapshot?.id) return snapshot;
            return this.updateGenerationUsage(generationHandle, snapshot, usage);
        }));
        return updated[0] ?? null;
    }

    markGenerationStatus(status, statusEvent, correlationId = null) {
        const result = this.generationLedger.completeGeneration({
            status,
            statusEvent,
            publicId: correlationId,
        });
        if (result.status !== 'matched') return result;
        for (const [snapshotId, snapshot] of result.snapshotEntries ?? []) {
            if (snapshotId !== snapshot?.id) continue;
            this.updateGenerationSnapshot(
                result.sessionHandle,
                snapshot,
                {
                    generationStatus: result.session.status,
                    statusEvent: result.session.statusEvent,
                    statusUpdatedAt: result.session.statusUpdatedAt,
                },
            ).catch((error) => {
                console.error('[ST DevTools] Failed to update capture lifecycle.', error);
            });
        }
        this.syncGenerationUsage(
            result.sessionHandle,
            result.snapshotEntries,
        ).catch((error) => {
            console.error('[ST DevTools] Failed to update capture usage.', error);
        });
        return result;
    }

    recordMessageReceivedUsage(messageId, type = null) {
        const message = this.getContext()?.chat?.[messageId];
        const outputTokens = Number(message?.extra?.token_count);
        if (!Number.isSafeInteger(outputTokens) || outputTokens < 0) {
            const result = {
                status: 'unavailable',
                reason: 'local-token-count-unavailable',
            };
            this.dispatchEvent(new CustomEvent('capture-usage', { detail: result }));
            return result;
        }
        try {
            const usage = createLocalEstimatedUsage({
                inputTokens: null,
                outputTokens,
                cachedInputTokens: null,
                totalTokens: null,
            }, {
                sourceEvent: 'message-received',
                correlatedAt: Date.now(),
            });
            const result = this.generationLedger.recordLocalUsage(usage, {
                eventName: 'MESSAGE_RECEIVED',
                unlinkedUsage: unlinkedUsage(usage),
                generationType: type,
            });
            if (result.status === 'linked') {
                this.syncGenerationUsage(result.sessionHandle).catch((error) => {
                    console.error('[ST DevTools] Failed to update local capture usage.', error);
                });
            }
            const notification = result.status === 'unlinked'
                && (
                    result.reason === 'active-session-not-found'
                    || result.reason === 'generation-type-session-not-found'
                )
                ? {
                    ...result,
                    status: 'unavailable',
                    correlationStatus: 'unlinked',
                }
                : result;
            this.dispatchEvent(new CustomEvent('capture-usage', { detail: notification }));
            return notification;
        } catch (error) {
            const result = {
                status: 'rejected',
                reason: 'invalid-local-usage',
                code: typeof error?.code === 'string' ? error.code : null,
            };
            this.dispatchEvent(new CustomEvent('capture-usage', { detail: result }));
            return result;
        }
    }

    recordResponseUsage(payload, ...eventArgs) {
        const publicId = correlationIdFromArgs([payload, ...eventArgs]);
        try {
            const context = this.getContext();
            const provider = context?.chatCompletionSettings?.chat_completion_source
                ?? context?.textCompletionSettings?.type
                ?? context?.mainApi
                ?? 'unknown';
            const usage = normalizeProviderUsage(payload, {
                provider,
                linked: Boolean(publicId),
                sourceEvent: 'provider-response-usage',
                correlatedAt: Date.now(),
            });
            if (usage.status === 'unavailable') {
                const result = { status: 'unavailable', reason: 'provider-usage-not-found' };
                this.dispatchEvent(new CustomEvent('capture-usage', { detail: result }));
                return result;
            }
            const linkedUsage = usage.status === 'unlinked'
                ? normalizeUsageRecord({ ...usage, status: 'provider-reported' })
                : usage;
            const result = this.generationLedger.recordUsage(linkedUsage, {
                publicId,
                eventName: 'PROVIDER_RESPONSE_USAGE',
                unlinkedUsage: unlinkedUsage(linkedUsage),
            });
            if (result.status === 'linked') {
                this.syncGenerationUsage(result.sessionHandle).catch((error) => {
                    console.error('[ST DevTools] Failed to update provider capture usage.', error);
                });
            }
            this.dispatchEvent(new CustomEvent('capture-usage', { detail: result }));
            return result;
        } catch (error) {
            const result = {
                status: 'rejected',
                reason: 'invalid-provider-usage',
                code: typeof error?.code === 'string' ? error.code : null,
            };
            this.dispatchEvent(new CustomEvent('capture-usage', { detail: result }));
            return result;
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
            this.dispatchCaptureStatus('failed', {
                promptType: snapshot?.promptType,
                stage: snapshot?.capture?.stage,
            });
            this.dispatchEvent(new CustomEvent('capture-error', {
                detail: {
                    operation: 'addSnapshot',
                    snapshot,
                    error,
                },
            }));
            throw error;
        }
        this.dispatchCaptureStatus('saved', {
            promptType: snapshot?.promptType,
            stage: snapshot?.capture?.stage,
        });
        this.dispatchEvent(new CustomEvent('snapshot', { detail: snapshot }));
        return snapshot;
    }
}
