import { SemanticCaptureGateError } from './semantic-capture-gate.js';

const MIN_RESPONSE_TOKEN_CAP = 64;
const MAX_RESPONSE_TOKEN_CAP = 2_048;
const DEFAULT_RESPONSE_TOKEN_CAP = 512;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 5 * 60_000;
const MAX_PROMPT_CHARS = 512 * 1024;
const MAX_RESPONSE_CHARS = 2 * 1024 * 1024;
const MAX_IDENTITY_CHARS = 256;
const MAX_SCHEMA_DEPTH = 16;
const MAX_SCHEMA_NODES = 1_024;
const MAX_SCHEMA_CHARS = 256 * 1024;

export const SEMANTIC_PROVIDER_ERROR_CODES = Object.freeze({
    UNSUPPORTED: 'SEMANTIC_UNSUPPORTED',
    BUSY: 'SEMANTIC_BUSY',
    INVALID_INPUT: 'SEMANTIC_INVALID_INPUT',
    TIMEOUT: 'SEMANTIC_TIMEOUT',
    ABORTED: 'SEMANTIC_ABORTED',
    PROVIDER_ERROR: 'SEMANTIC_PROVIDER_ERROR',
    INVALID_RESPONSE: 'SEMANTIC_INVALID_RESPONSE',
});

export class SemanticProviderError extends Error {
    constructor(code) {
        super(code);
        this.name = code === SEMANTIC_PROVIDER_ERROR_CODES.ABORTED
            ? 'AbortError'
            : 'SemanticProviderError';
        this.code = code;
    }
}

function error(code) {
    return new SemanticProviderError(code);
}

function safeIdentityString(value) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    if (
        normalized.length === 0
        || normalized.length > MAX_IDENTITY_CHARS
        || /[\u0000-\u001f\u007f]/u.test(normalized)
    ) {
        return null;
    }
    return normalized;
}

function unavailableIdentity() {
    return Object.freeze({
        status: 'unavailable',
        provider: null,
        model: null,
    });
}

function readChatModel(context, settings) {
    try {
        if (typeof context?.getChatCompletionModel === 'function') {
            const model = safeIdentityString(context.getChatCompletionModel());
            if (model) return model;
        }
    } catch {
        // Fall through to the public settings exposed by getContext().
    }
    return safeIdentityString(settings?.model)
        ?? safeIdentityString(settings?.openai_model);
}

export function readSemanticProviderIdentity(context) {
    if (!context || typeof context !== 'object') return unavailableIdentity();
    try {
        const mainApi = safeIdentityString(context.mainApi);
        let provider = null;
        let model = null;
        if (mainApi === 'openai') {
            const settings = context.chatCompletionSettings;
            provider = safeIdentityString(settings?.chat_completion_source)
                ?? mainApi;
            model = readChatModel(context, settings);
        } else if (mainApi) {
            const settings = context.textCompletionSettings;
            provider = safeIdentityString(settings?.type)
                ?? mainApi;
            model = safeIdentityString(settings?.model)
                ?? safeIdentityString(settings?.server_model)
                ?? safeIdentityString(settings?.custom_model);
        }
        if (!provider) return unavailableIdentity();
        if (!model) {
            return Object.freeze({
                status: 'partial',
                provider,
                model: null,
            });
        }
        return Object.freeze({
            status: 'available',
            provider,
            model,
        });
    } catch {
        return unavailableIdentity();
    }
}

function promptTypeForContext(context) {
    let mainApi;
    try {
        mainApi = safeIdentityString(context?.mainApi);
    } catch {
        return null;
    }
    if (!mainApi) return null;
    return mainApi === 'openai'
        ? 'chat-completion'
        : 'text-completion';
}

function validatedSignal(signal) {
    if (signal == null) return null;
    if (
        typeof signal !== 'object'
        || typeof signal.aborted !== 'boolean'
        || typeof signal.addEventListener !== 'function'
        || typeof signal.removeEventListener !== 'function'
    ) {
        throw error(SEMANTIC_PROVIDER_ERROR_CODES.INVALID_INPUT);
    }
    return signal;
}

function validJsonSchema(schema) {
    if (schema === null || schema === undefined) return true;
    const stack = [{ value: schema, depth: 0 }];
    const seen = new WeakSet();
    let nodes = 0;
    let chars = 0;
    while (stack.length > 0) {
        const { value, depth } = stack.pop();
        if (value === null || typeof value === 'boolean') continue;
        if (typeof value === 'number') {
            if (!Number.isFinite(value)) return false;
            continue;
        }
        if (typeof value === 'string') {
            chars += value.length;
            if (chars > MAX_SCHEMA_CHARS) return false;
            continue;
        }
        if (!value || typeof value !== 'object' || depth >= MAX_SCHEMA_DEPTH) {
            return false;
        }
        if (seen.has(value)) return false;
        seen.add(value);
        nodes += 1;
        if (nodes > MAX_SCHEMA_NODES) return false;

        let prototype;
        let descriptors;
        try {
            prototype = Object.getPrototypeOf(value);
            descriptors = Object.getOwnPropertyDescriptors(value);
        } catch {
            return false;
        }
        if (
            !Array.isArray(value)
            && prototype !== Object.prototype
            && prototype !== null
        ) {
            return false;
        }
        for (const [key, descriptor] of Object.entries(descriptors)) {
            if (
                key === '__proto__'
                || key.length > MAX_IDENTITY_CHARS
                || !('value' in descriptor)
            ) {
                return false;
            }
            if (descriptor.enumerable) {
                stack.push({ value: descriptor.value, depth: depth + 1 });
            }
        }
    }
    return true;
}

function validatedRequest({
    prompt,
    jsonSchema,
    responseTokenCap,
    timeoutMs,
    signal,
}) {
    if (
        typeof prompt !== 'string'
        || prompt.length === 0
        || prompt.length > MAX_PROMPT_CHARS
        || !Number.isSafeInteger(responseTokenCap)
        || responseTokenCap < MIN_RESPONSE_TOKEN_CAP
        || responseTokenCap > MAX_RESPONSE_TOKEN_CAP
        || !Number.isSafeInteger(timeoutMs)
        || timeoutMs < 1
        || timeoutMs > MAX_TIMEOUT_MS
        || !validJsonSchema(jsonSchema)
    ) {
        throw error(SEMANTIC_PROVIDER_ERROR_CODES.INVALID_INPUT);
    }
    return {
        prompt,
        jsonSchema: jsonSchema ?? null,
        responseTokenCap,
        timeoutMs,
        signal: validatedSignal(signal),
    };
}

function mapGateError(value) {
    if (
        value instanceof SemanticCaptureGateError
        && value.code === 'SEMANTIC_GATE_CAPACITY'
    ) {
        return error(SEMANTIC_PROVIDER_ERROR_CODES.BUSY);
    }
    if (
        value instanceof SemanticCaptureGateError
        && value.code === 'SEMANTIC_GATE_INVALID_INPUT'
    ) {
        return error(SEMANTIC_PROVIDER_ERROR_CODES.INVALID_INPUT);
    }
    return error(SEMANTIC_PROVIDER_ERROR_CODES.UNSUPPORTED);
}

export class SemanticProviderAdapter {
    constructor({
        getContext,
        captureGate,
        defaultTimeoutMs = DEFAULT_TIMEOUT_MS,
    }) {
        if (
            typeof getContext !== 'function'
            || !captureGate
            || typeof captureGate.arm !== 'function'
            || typeof captureGate.disarm !== 'function'
            || !Number.isSafeInteger(defaultTimeoutMs)
            || defaultTimeoutMs < 1
            || defaultTimeoutMs > MAX_TIMEOUT_MS
        ) {
            throw error(SEMANTIC_PROVIDER_ERROR_CODES.INVALID_INPUT);
        }
        this.getContext = getContext;
        this.captureGate = captureGate;
        this.defaultTimeoutMs = defaultTimeoutMs;
    }

    identity() {
        let context;
        try {
            context = this.getContext();
        } catch {
            return unavailableIdentity();
        }
        return readSemanticProviderIdentity(context);
    }

    generate({
        prompt,
        jsonSchema = null,
        responseTokenCap = DEFAULT_RESPONSE_TOKEN_CAP,
        signal = null,
        timeoutMs = this.defaultTimeoutMs,
    }) {
        let request;
        try {
            request = validatedRequest({
                prompt,
                jsonSchema,
                responseTokenCap,
                timeoutMs,
                signal,
            });
        } catch (validationError) {
            return Promise.reject(validationError);
        }
        if (request.signal?.aborted) {
            return Promise.reject(error(SEMANTIC_PROVIDER_ERROR_CODES.ABORTED));
        }

        let context;
        try {
            context = this.getContext();
        } catch {
            return Promise.reject(error(SEMANTIC_PROVIDER_ERROR_CODES.UNSUPPORTED));
        }
        let generateRaw;
        try {
            generateRaw = context?.generateRaw;
        } catch {
            return Promise.reject(error(SEMANTIC_PROVIDER_ERROR_CODES.UNSUPPORTED));
        }
        if (typeof generateRaw !== 'function') {
            return Promise.reject(error(SEMANTIC_PROVIDER_ERROR_CODES.UNSUPPORTED));
        }
        const promptType = promptTypeForContext(context);
        if (!promptType) {
            return Promise.reject(error(SEMANTIC_PROVIDER_ERROR_CODES.UNSUPPORTED));
        }

        let armed;
        try {
            armed = this.captureGate.arm({
                prompt: request.prompt,
                promptType,
            });
        } catch (gateError) {
            return Promise.reject(mapGateError(gateError));
        }
        if (
            !armed
            || typeof armed !== 'object'
            || !armed.ticket
            || typeof armed.prompt !== 'string'
        ) {
            try {
                if (armed?.ticket) this.captureGate.disarm(armed.ticket);
            } catch {
                // Invalid custom gate results still fail with a stable code.
            }
            return Promise.reject(error(SEMANTIC_PROVIDER_ERROR_CODES.UNSUPPORTED));
        }

        return new Promise((resolve, reject) => {
            let logicallyCancelled = false;
            let settled = false;
            let timeout = null;
            const cleanupLogicalListeners = () => {
                if (timeout !== null) clearTimeout(timeout);
                timeout = null;
                request.signal?.removeEventListener('abort', onAbort);
            };
            const cancel = (code) => {
                if (settled || logicallyCancelled) return;
                logicallyCancelled = true;
                cleanupLogicalListeners();
                reject(error(code));
            };
            const onAbort = () => {
                cancel(SEMANTIC_PROVIDER_ERROR_CODES.ABORTED);
            };
            const safeDisarm = () => {
                try {
                    this.captureGate.disarm(armed.ticket);
                } catch {
                    // Capture cleanup must never strand the caller's promise.
                }
            };

            request.signal?.addEventListener('abort', onAbort, { once: true });
            if (request.signal?.aborted) {
                safeDisarm();
                cancel(SEMANTIC_PROVIDER_ERROR_CODES.ABORTED);
                return;
            }
            timeout = setTimeout(() => {
                cancel(SEMANTIC_PROVIDER_ERROR_CODES.TIMEOUT);
            }, request.timeoutMs);

            let underlying;
            try {
                underlying = Promise.resolve(generateRaw.call(context, {
                    prompt: armed.prompt,
                    responseLength: request.responseTokenCap,
                    trimNames: true,
                    jsonSchema: request.jsonSchema,
                }));
            } catch {
                safeDisarm();
                settled = true;
                cleanupLogicalListeners();
                reject(error(SEMANTIC_PROVIDER_ERROR_CODES.PROVIDER_ERROR));
                return;
            }

            underlying.then(
                (response) => {
                    safeDisarm();
                    if (logicallyCancelled) return;
                    settled = true;
                    cleanupLogicalListeners();
                    if (
                        typeof response !== 'string'
                        || response.length > MAX_RESPONSE_CHARS
                    ) {
                        reject(error(SEMANTIC_PROVIDER_ERROR_CODES.INVALID_RESPONSE));
                        return;
                    }
                    resolve(response);
                },
                () => {
                    safeDisarm();
                    if (logicallyCancelled) return;
                    settled = true;
                    cleanupLogicalListeners();
                    reject(error(SEMANTIC_PROVIDER_ERROR_CODES.PROVIDER_ERROR));
                },
            );
        });
    }
}

export function createSemanticProviderAdapter(options) {
    return new SemanticProviderAdapter(options);
}
