import { SemanticCaptureGateError } from './semantic-capture-gate.js';
import {
    listSemanticConnectionProfiles,
    normalizeSemanticConnectionProfileId,
    resolveSemanticConnectionProfile,
} from './semantic-connection-profiles.js';
import { providerFamily } from './provider-capabilities.js';

const MIN_RESPONSE_TOKEN_CAP = 64;
const MAX_RESPONSE_TOKEN_CAP = 2_048;
const DEFAULT_RESPONSE_TOKEN_CAP = 512;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 5 * 60_000;
const CAPTURE_GATE_GRACE_MS = 30_000;
const MAX_PROMPT_CHARS = 512 * 1024;
const MAX_RESPONSE_CHARS = 2 * 1024 * 1024;
const MAX_RESPONSE_DEPTH = 16;
const MAX_RESPONSE_NODES = 4_096;
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
    AUTHENTICATION_ERROR: 'SEMANTIC_AUTHENTICATION_ERROR',
    RATE_LIMITED: 'SEMANTIC_RATE_LIMITED',
    NETWORK_ERROR: 'SEMANTIC_NETWORK_ERROR',
    PROVIDER_UNAVAILABLE: 'SEMANTIC_PROVIDER_UNAVAILABLE',
    PROVIDER_ERROR: 'SEMANTIC_PROVIDER_ERROR',
    INVALID_RESPONSE: 'SEMANTIC_INVALID_RESPONSE',
});

const SEMANTIC_PROVIDER_ERROR_CODE_SET = new Set(
    Object.values(SEMANTIC_PROVIDER_ERROR_CODES),
);

export const SEMANTIC_PROVIDER_ERROR_REASONS = Object.freeze([
    'provider-aborted',
    'provider-authentication',
    'provider-network',
    'provider-rate-limited',
    'provider-rejected',
    'provider-response-shape',
    'provider-timeout',
    'provider-unavailable',
    'provider-identity-changed',
]);

const PROVIDER_ERROR_REASON_SET = new Set(SEMANTIC_PROVIDER_ERROR_REASONS);

export function normalizeSemanticProviderErrorReason(value) {
    return typeof value === 'string' && PROVIDER_ERROR_REASON_SET.has(value)
        ? value
        : null;
}

export class SemanticProviderError extends Error {
    constructor(code, reason = null) {
        super(code);
        this.name = code === SEMANTIC_PROVIDER_ERROR_CODES.ABORTED
            ? 'AbortError'
            : 'SemanticProviderError';
        this.code = code;
        this.reason = normalizeSemanticProviderErrorReason(reason);
    }
}

function error(code, reason = null) {
    return new SemanticProviderError(code, reason);
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
        routeKind: 'current',
        connectionProfileId: null,
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

function connectionProfileIdentity(profile) {
    const provider = safeIdentityString(profile?.provider);
    const model = safeIdentityString(profile?.model);
    const connectionProfileId = normalizeSemanticConnectionProfileId(profile?.id);
    if (!provider || !connectionProfileId) return unavailableIdentity();
    if (!model) {
        return Object.freeze({
            status: 'partial',
            provider,
            model: null,
            routeKind: 'profile',
            connectionProfileId,
        });
    }
    return Object.freeze({
        status: 'available',
        provider,
        model,
        routeKind: 'profile',
        connectionProfileId,
    });
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
                routeKind: 'current',
                connectionProfileId: null,
            });
        }
        return Object.freeze({
            status: 'available',
            provider,
            model,
            routeKind: 'current',
            connectionProfileId: null,
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

function validJsonData(root, {
    maximumDepth,
    maximumNodes,
    maximumChars,
}) {
    const stack = [{ value: root, depth: 0 }];
    const seen = new WeakSet();
    let nodes = 0;
    let chars = 0;
    while (stack.length > 0) {
        const { value, depth } = stack.pop();
        nodes += 1;
        if (nodes > maximumNodes) return false;
        if (value === null || typeof value === 'boolean') continue;
        if (typeof value === 'number') {
            if (!Number.isFinite(value)) return false;
            continue;
        }
        if (typeof value === 'string') {
            chars += value.length;
            if (chars > maximumChars) return false;
            continue;
        }
        if (!value || typeof value !== 'object' || depth >= maximumDepth) {
            return false;
        }
        if (seen.has(value)) return false;
        seen.add(value);

        let array;
        let prototype;
        let descriptors;
        try {
            array = Array.isArray(value);
            prototype = Object.getPrototypeOf(value);
            descriptors = Object.getOwnPropertyDescriptors(value);
        } catch {
            return false;
        }
        if (
            (array && prototype !== Array.prototype)
            || (!array && prototype !== Object.prototype && prototype !== null)
        ) {
            return false;
        }
        const descriptorKeys = Reflect.ownKeys(descriptors);
        if (descriptorKeys.length > maximumNodes) return false;

        if (array) {
            const lengthDescriptor = descriptors.length;
            const length = lengthDescriptor && 'value' in lengthDescriptor
                ? lengthDescriptor.value
                : -1;
            if (
                !Number.isSafeInteger(length)
                || length < 0
                || length > maximumNodes - nodes
            ) {
                return false;
            }
            for (const key of descriptorKeys) {
                if (key === 'length') continue;
                if (typeof key !== 'string' || key.length > MAX_IDENTITY_CHARS) {
                    return false;
                }
                const index = Number(key);
                const descriptor = descriptors[key];
                if (
                    !Number.isSafeInteger(index)
                    || index < 0
                    || index >= length
                    || String(index) !== key
                    || !descriptor
                    || !('value' in descriptor)
                ) {
                    return false;
                }
            }
            for (let index = 0; index < length; index += 1) {
                const descriptor = descriptors[String(index)];
                stack.push({
                    value: descriptor && 'value' in descriptor
                        ? descriptor.value
                        : null,
                    depth: depth + 1,
                });
            }
            continue;
        }

        for (const key of descriptorKeys) {
            if (typeof key === 'symbol') continue;
            const descriptor = descriptors[key];
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

function validJsonSchema(schema) {
    if (schema === null || schema === undefined) return true;
    return validJsonData(schema, {
        maximumDepth: MAX_SCHEMA_DEPTH,
        maximumNodes: MAX_SCHEMA_NODES,
        maximumChars: MAX_SCHEMA_CHARS,
    });
}

function ownDataValue(value, key) {
    if (!value || typeof value !== 'object') return undefined;
    try {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return descriptor && 'value' in descriptor
            ? descriptor.value
            : undefined;
    } catch {
        return undefined;
    }
}

function boundedArrayLength(value, maximum) {
    if (!Array.isArray(value)) return null;
    const length = ownDataValue(value, 'length');
    return Number.isSafeInteger(length) && length >= 0 && length <= maximum
        ? length
        : null;
}

function serializeJsonData(value) {
    if (value === null || typeof value === 'boolean') return String(value);
    if (typeof value === 'number') return JSON.stringify(value);
    if (typeof value === 'string') return JSON.stringify(value);
    if (Array.isArray(value)) {
        const items = [];
        const length = ownDataValue(value, 'length');
        for (let index = 0; index < length; index += 1) {
            const item = ownDataValue(value, String(index));
            items.push(item === undefined ? 'null' : serializeJsonData(item));
        }
        return `[${items.join(',')}]`;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const fields = [];
    for (const [key, descriptor] of Object.entries(descriptors)) {
        if (!descriptor.enumerable) continue;
        fields.push(`${JSON.stringify(key)}:${serializeJsonData(descriptor.value)}`);
    }
    return `{${fields.join(',')}}`;
}

function stringifyResponseObject(value) {
    if (
        !value
        || typeof value !== 'object'
        || !validJsonData(value, {
            maximumDepth: MAX_RESPONSE_DEPTH,
            maximumNodes: MAX_RESPONSE_NODES,
            maximumChars: MAX_RESPONSE_CHARS,
        })
    ) {
        return null;
    }
    try {
        // Do not call a provider object's toJSON method. The bounded validator
        // already proved that every enumerable field is inert JSON data, so a
        // descriptor-only serializer can preserve it without invoking code.
        const serialized = serializeJsonData(value);
        return serialized.length <= MAX_RESPONSE_CHARS ? serialized : null;
    } catch {
        return null;
    }
}

function responsePartText(value) {
    const length = boundedArrayLength(value, 256);
    if (length === null) return null;
    const parts = [];
    let found = false;
    for (let index = 0; index < length; index += 1) {
        const part = ownDataValue(value, String(index));
        if (typeof part === 'string') {
            parts.push(part);
            found = true;
            continue;
        }
        if (!part || typeof part !== 'object') continue;
        const type = ownDataValue(part, 'type');
        if (type !== undefined && type !== 'text' && type !== 'output_text') {
            continue;
        }
        const text = ownDataValue(part, 'text');
        if (typeof text !== 'string') {
            if (type === 'text' || type === 'output_text') return null;
            continue;
        }
        parts.push(text);
        found = true;
    }
    if (!found) return null;
    const joined = parts.join('');
    return joined.length <= MAX_RESPONSE_CHARS ? joined : null;
}

function responseContentText(value, { allowStructuredObject = false } = {}) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return responsePartText(value);
    if (allowStructuredObject && value && typeof value === 'object') {
        return stringifyResponseObject(value);
    }
    return null;
}

function semanticObjectText(response) {
    if (
        ownDataValue(response, 'version') === undefined
        || !Array.isArray(ownDataValue(response, 'suggestions'))
    ) {
        return null;
    }
    return stringifyResponseObject(response);
}

function openAiResponseText(response) {
    const outputText = ownDataValue(response, 'output_text');
    if (typeof outputText === 'string') return outputText;

    const choices = ownDataValue(response, 'choices');
    const choice = boundedArrayLength(choices, 256) > 0
        ? ownDataValue(choices, '0')
        : null;
    const message = ownDataValue(choice, 'message');
    const messageContent = responseContentText(ownDataValue(message, 'content'));
    if (messageContent !== null) return messageContent;
    const parsed = ownDataValue(message, 'parsed');
    const parsedText = semanticObjectText(parsed);
    if (parsedText !== null) return parsedText;
    const completionText = ownDataValue(choice, 'text');
    if (typeof completionText === 'string') return completionText;

    const output = ownDataValue(response, 'output');
    const outputLength = boundedArrayLength(output, 256);
    if (outputLength !== null) {
        for (let index = 0; index < outputLength; index += 1) {
            const item = ownDataValue(output, String(index));
            const text = responseContentText(ownDataValue(item, 'content'));
            if (text !== null) return text;
        }
    }
    return null;
}

function googleResponseText(response) {
    const candidates = ownDataValue(response, 'candidates');
    const candidate = boundedArrayLength(candidates, 256) > 0
        ? ownDataValue(candidates, '0')
        : null;
    const content = ownDataValue(candidate, 'content');
    return responsePartText(ownDataValue(content, 'parts'));
}

const RESPONSE_REJECTION_MARKERS = new Set([
    'blocklist',
    'content_filter',
    'prohibited_content',
    'recitation',
    'refusal',
    'safety',
]);

function responseMarker(value) {
    if (typeof value !== 'string' || value.length > 80) return null;
    const normalized = value.trim().toLowerCase();
    return /^[a-z0-9_-]+$/u.test(normalized) ? normalized : null;
}

function openAiOutputWasRejected(response) {
    const output = ownDataValue(response, 'output');
    const outputLength = boundedArrayLength(output, 256);
    if (outputLength === null) return false;
    for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
        const item = ownDataValue(output, String(outputIndex));
        const content = ownDataValue(item, 'content');
        const contentLength = boundedArrayLength(content, 256);
        if (contentLength === null) continue;
        for (let partIndex = 0; partIndex < contentLength; partIndex += 1) {
            const part = ownDataValue(content, String(partIndex));
            if (responseMarker(ownDataValue(part, 'type')) !== 'refusal') continue;
            const refusal = ownDataValue(part, 'refusal');
            if (typeof refusal === 'string' && refusal.length > 0) return true;
        }
    }
    return false;
}

function responseWasRejected(response, family) {
    if (!response || typeof response !== 'object') return false;
    if (family === 'openai' || family === 'compatible') {
        const choices = ownDataValue(response, 'choices');
        const choice = boundedArrayLength(choices, 256) > 0
            ? ownDataValue(choices, '0')
            : null;
        const message = ownDataValue(choice, 'message');
        const refusal = ownDataValue(message, 'refusal');
        if (typeof refusal === 'string' && refusal.length > 0) return true;
        if (RESPONSE_REJECTION_MARKERS.has(
            responseMarker(ownDataValue(choice, 'finish_reason')),
        )) {
            return true;
        }
        if (openAiOutputWasRejected(response)) return true;
    }
    if (family === 'anthropic') {
        return RESPONSE_REJECTION_MARKERS.has(
            responseMarker(ownDataValue(response, 'stop_reason')),
        );
    }
    if (family === 'google') {
        const feedback = ownDataValue(response, 'promptFeedback');
        if (RESPONSE_REJECTION_MARKERS.has(
            responseMarker(ownDataValue(feedback, 'blockReason')),
        )) {
            return true;
        }
        const candidates = ownDataValue(response, 'candidates');
        const candidate = boundedArrayLength(candidates, 256) > 0
            ? ownDataValue(candidates, '0')
            : null;
        return RESPONSE_REJECTION_MARKERS.has(
            responseMarker(ownDataValue(candidate, 'finishReason')),
        );
    }
    const data = ownDataValue(response, 'data');
    return data && typeof data === 'object'
        ? responseWasRejected(data, family)
        : false;
}

const STRUCTURED_RESPONSE_REJECTED = Symbol('structured-response-rejected');

function knownEnvelopeText(response, family, routeKind) {
    const semantic = semanticObjectText(response);
    if (semantic !== null) return semantic;

    if (routeKind === 'profile') {
        const content = responseContentText(ownDataValue(response, 'content'), {
            allowStructuredObject: true,
        });
        if (content !== null) return content;
    }

    if (family === 'openai' || family === 'compatible') {
        const openAi = openAiResponseText(response);
        if (openAi !== null) return openAi;
    }
    if (family === 'anthropic') {
        const anthropic = responseContentText(ownDataValue(response, 'content'));
        if (anthropic !== null) return anthropic;
    }
    if (family === 'google') {
        const google = googleResponseText(response);
        if (google !== null) return google;
    }

    const data = ownDataValue(response, 'data');
    if (data && typeof data === 'object') {
        if (family === 'openai' || family === 'compatible') {
            return openAiResponseText(data);
        }
        if (family === 'anthropic') {
            return responseContentText(ownDataValue(data, 'content'));
        }
        if (family === 'google') return googleResponseText(data);
    }
    return null;
}

function generatedResponseText(response, routeKind, family) {
    if (typeof response === 'string') {
        return response.length <= MAX_RESPONSE_CHARS ? response : null;
    }
    if (
        !response
        || typeof response !== 'object'
        || !validJsonData(response, {
            maximumDepth: MAX_RESPONSE_DEPTH,
            maximumNodes: MAX_RESPONSE_NODES,
            maximumChars: MAX_RESPONSE_CHARS,
        })
    ) {
        return null;
    }
    if (responseWasRejected(response, family)) {
        return STRUCTURED_RESPONSE_REJECTED;
    }
    const text = knownEnvelopeText(response, family, routeKind);
    if (typeof text !== 'string' || text.length > MAX_RESPONSE_CHARS) {
        return null;
    }
    return text;
}

function isCompleteJsonObject(text) {
    try {
        const parsed = JSON.parse(text);
        return parsed !== null
            && typeof parsed === 'object'
            && !Array.isArray(parsed);
    } catch {
        return false;
    }
}

function completePrefilledResponse(prefill, text) {
    if (!prefill || text.startsWith(prefill) || isCompleteJsonObject(text)) {
        return text;
    }
    return `${prefill}${text}`;
}

function validatedRequest({
    systemPrompt,
    prompt,
    prefill,
    jsonSchema,
    responseTokenCap,
    timeoutMs,
    signal,
    expectedIdentity,
}) {
    if (
        typeof prompt !== 'string'
        || prompt.length === 0
        || prompt.length > MAX_PROMPT_CHARS
        || typeof systemPrompt !== 'string'
        || systemPrompt.length > 16_384
        || typeof prefill !== 'string'
        || prefill.length > 1_024
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
        systemPrompt,
        prompt,
        prefill,
        jsonSchema: jsonSchema ?? null,
        responseTokenCap,
        timeoutMs,
        signal: validatedSignal(signal),
        expectedIdentity: normalizeExpectedIdentity(expectedIdentity),
    };
}

function normalizeExpectedIdentity(value) {
    if (value == null) return null;
    let prototype;
    let descriptors;
    try {
        prototype = Object.getPrototypeOf(value);
        descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
        throw error(SEMANTIC_PROVIDER_ERROR_CODES.INVALID_INPUT);
    }
    if (
        (prototype !== Object.prototype && prototype !== null)
        || Reflect.ownKeys(descriptors).some((key) => (
            typeof key !== 'string'
            || ![
                'status',
                'provider',
                'model',
                'routeKind',
                'connectionProfileId',
            ].includes(key)
            || !('value' in descriptors[key])
        ))
    ) {
        throw error(SEMANTIC_PROVIDER_ERROR_CODES.INVALID_INPUT);
    }
    const status = ownDataValue(value, 'status');
    const routeKind = ownDataValue(value, 'routeKind') ?? 'current';
    const providerValue = ownDataValue(value, 'provider');
    const modelValue = ownDataValue(value, 'model');
    const profileIdValue = ownDataValue(value, 'connectionProfileId');
    const provider = providerValue == null ? null : safeIdentityString(providerValue);
    const model = modelValue == null ? null : safeIdentityString(modelValue);
    const connectionProfileId = routeKind === 'profile'
        ? normalizeSemanticConnectionProfileId(profileIdValue)
        : null;
    if (
        !['available', 'partial', 'unavailable'].includes(status)
        || !['current', 'profile'].includes(routeKind)
        || (routeKind === 'profile' && !connectionProfileId)
        || (routeKind === 'current' && profileIdValue != null)
        || (status === 'unavailable' && (providerValue != null || modelValue != null))
        || (status !== 'unavailable' && !provider)
        || (status === 'available' && !model)
        || (status === 'partial' && modelValue != null)
    ) {
        throw error(SEMANTIC_PROVIDER_ERROR_CODES.INVALID_INPUT);
    }
    return Object.freeze({
        status,
        provider: status === 'unavailable' ? null : provider,
        model: status === 'available' ? model : null,
        routeKind,
        connectionProfileId,
    });
}

function sameProviderIdentity(left, right) {
    return left?.status === right?.status
        && canonicalIdentityString(left?.provider) === canonicalIdentityString(right?.provider)
        && canonicalIdentityString(left?.model) === canonicalIdentityString(right?.model)
        && left?.routeKind === right?.routeKind
        && left?.connectionProfileId === right?.connectionProfileId;
}

function canonicalIdentityString(value) {
    return value == null ? null : safeIdentityString(value)?.toLowerCase() ?? null;
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

const ABORT_FAILURE_CODES = new Set([
    'aborterror',
    'abort_err',
    'err_aborted',
]);
const TIMEOUT_FAILURE_CODES = new Set([
    'api_connection_timeout',
    'etimedout',
    'esockettimedout',
    'err_http_request_timeout',
    'und_err_connect_timeout',
    'timeout',
    'timeouterror',
    'request_timeout',
]);
const RATE_LIMIT_FAILURE_CODES = new Set([
    'rate_limit_exceeded',
    'rate_limit_error',
    'rate_limited',
    'resource_exhausted',
    'too_many_requests',
]);
const AUTH_FAILURE_CODES = new Set([
    'authentication_error',
    'invalid_api_key',
    'permission_denied',
    'unauthenticated',
    'unauthorized',
]);
const NETWORK_FAILURE_CODES = new Set([
    'api_connection_error',
    'eai_again',
    'econnrefused',
    'econnreset',
    'enetdown',
    'enetunreach',
    'enotfound',
    'err_network',
    'fetch_failed',
    'network_error',
    'und_err_connect',
    'und_err_socket',
]);
const UNAVAILABLE_FAILURE_CODES = new Set([
    'overloaded_error',
    'service_unavailable',
]);

function inheritedDataValue(value, key) {
    let cursor = value;
    for (let depth = 0; cursor && depth < 4; depth += 1) {
        if (typeof cursor !== 'object' && typeof cursor !== 'function') return undefined;
        try {
            const descriptor = Object.getOwnPropertyDescriptor(cursor, key);
            if (descriptor) return 'value' in descriptor ? descriptor.value : undefined;
            cursor = Object.getPrototypeOf(cursor);
        } catch {
            return undefined;
        }
    }
    return undefined;
}

function failureRecords(value) {
    const records = [];
    let cursor = value;
    for (let depth = 0; depth < 3; depth += 1) {
        if (!cursor || (typeof cursor !== 'object' && typeof cursor !== 'function')) break;
        records.push(cursor);
        const response = inheritedDataValue(cursor, 'response');
        if (response && typeof response === 'object') records.push(response);
        cursor = inheritedDataValue(cursor, 'cause');
    }
    return records.slice(0, 6);
}

function failureStatus(records) {
    for (const record of records) {
        for (const key of ['status', 'statusCode']) {
            const value = inheritedDataValue(record, key);
            if (Number.isSafeInteger(value) && value >= 100 && value <= 599) {
                return value;
            }
            if (typeof value === 'string' && /^[1-5][0-9]{2}$/u.test(value)) {
                return Number(value);
            }
        }
    }
    return null;
}

function failureCodes(records) {
    const codes = new Set();
    for (const record of records) {
        for (const key of ['code', 'name', 'type']) {
            const value = inheritedDataValue(record, key);
            if (
                typeof value === 'string'
                && value.length > 0
                && value.length <= 80
                && /^[a-z0-9_.-]+$/iu.test(value)
            ) {
                codes.add(value.toLowerCase());
            }
        }
    }
    return codes;
}

export function classifySemanticProviderFailure(value, signal = null) {
    let semanticProviderFailure = false;
    try {
        semanticProviderFailure = value instanceof SemanticProviderError;
    } catch {
        // A rejected Proxy may trap prototype inspection. Continue with the
        // bounded data-property classifier and fail closed to a generic code.
    }
    if (semanticProviderFailure) {
        const rawCode = inheritedDataValue(value, 'code');
        const code = SEMANTIC_PROVIDER_ERROR_CODE_SET.has(rawCode)
            ? rawCode
            : SEMANTIC_PROVIDER_ERROR_CODES.PROVIDER_ERROR;
        const reason = normalizeSemanticProviderErrorReason(
            inheritedDataValue(value, 'reason'),
        );
        return error(
            code,
            reason ?? (code === SEMANTIC_PROVIDER_ERROR_CODES.PROVIDER_ERROR
                ? 'provider-rejected'
                : null),
        );
    }
    let aborted = false;
    try {
        aborted = signal?.aborted === true;
    } catch {
        aborted = false;
    }
    if (aborted) {
        return error(
            SEMANTIC_PROVIDER_ERROR_CODES.ABORTED,
            'provider-aborted',
        );
    }
    const records = failureRecords(value);
    const status = failureStatus(records);
    const codes = failureCodes(records);
    const hasCode = (set) => [...codes].some((code) => set.has(code));

    if (hasCode(ABORT_FAILURE_CODES)) {
        return error(
            SEMANTIC_PROVIDER_ERROR_CODES.ABORTED,
            'provider-aborted',
        );
    }
    if (status === 408 || status === 504 || hasCode(TIMEOUT_FAILURE_CODES)) {
        return error(
            SEMANTIC_PROVIDER_ERROR_CODES.TIMEOUT,
            'provider-timeout',
        );
    }
    if (status === 429 || hasCode(RATE_LIMIT_FAILURE_CODES)) {
        return error(
            SEMANTIC_PROVIDER_ERROR_CODES.RATE_LIMITED,
            'provider-rate-limited',
        );
    }
    if (status === 401 || status === 403 || hasCode(AUTH_FAILURE_CODES)) {
        return error(
            SEMANTIC_PROVIDER_ERROR_CODES.AUTHENTICATION_ERROR,
            'provider-authentication',
        );
    }
    if (hasCode(NETWORK_FAILURE_CODES)) {
        return error(
            SEMANTIC_PROVIDER_ERROR_CODES.NETWORK_ERROR,
            'provider-network',
        );
    }
    if (
        status === 500
        || status === 502
        || status === 503
        || hasCode(UNAVAILABLE_FAILURE_CODES)
    ) {
        return error(
            SEMANTIC_PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE,
            'provider-unavailable',
        );
    }
    return error(
        SEMANTIC_PROVIDER_ERROR_CODES.PROVIDER_ERROR,
        'provider-rejected',
    );
}

export class SemanticProviderAdapter {
    #activeCalls = 0;

    #idleWaiters = new Set();

    constructor({
        getContext,
        captureGate,
        getConnectionProfileId = () => null,
        defaultTimeoutMs = DEFAULT_TIMEOUT_MS,
    }) {
        if (
            typeof getContext !== 'function'
            || typeof getConnectionProfileId !== 'function'
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
        this.getConnectionProfileId = getConnectionProfileId;
        this.defaultTimeoutMs = defaultTimeoutMs;
    }

    activeCallCount() {
        return this.#activeCalls;
    }

    whenIdle() {
        if (this.#activeCalls === 0) return Promise.resolve();
        return new Promise((resolve) => {
            this.#idleWaiters.add(resolve);
        });
    }

    #trackUnderlyingCall() {
        this.#activeCalls += 1;
        let released = false;
        return () => {
            if (released) return;
            released = true;
            this.#activeCalls -= 1;
            if (this.#activeCalls !== 0) return;
            const waiters = [...this.#idleWaiters];
            this.#idleWaiters.clear();
            for (const resolve of waiters) resolve();
        };
    }

    selectedConnectionProfileId() {
        try {
            return normalizeSemanticConnectionProfileId(
                this.getConnectionProfileId(),
            );
        } catch {
            return null;
        }
    }

    connectionProfiles() {
        let context;
        try {
            context = this.getContext();
        } catch {
            context = null;
        }
        return listSemanticConnectionProfiles(context);
    }

    identity() {
        let context;
        try {
            context = this.getContext();
        } catch {
            return unavailableIdentity();
        }
        const connectionProfile = resolveSemanticConnectionProfile(
            context,
            this.selectedConnectionProfileId(),
        );
        return connectionProfile
            ? connectionProfileIdentity(connectionProfile.profile)
            : readSemanticProviderIdentity(context);
    }

    generate({
        systemPrompt = '',
        prompt,
        prefill = '',
        jsonSchema = null,
        responseTokenCap = DEFAULT_RESPONSE_TOKEN_CAP,
        signal = null,
        timeoutMs = this.defaultTimeoutMs,
        expectedIdentity = null,
    }) {
        let request;
        try {
            request = validatedRequest({
                systemPrompt,
                prompt,
                prefill,
                jsonSchema,
                responseTokenCap,
                timeoutMs,
                signal,
                expectedIdentity,
            });
        } catch (validationError) {
            return Promise.reject(validationError);
        }
        if (request.signal?.aborted) {
            return Promise.reject(error(
                SEMANTIC_PROVIDER_ERROR_CODES.ABORTED,
                'provider-aborted',
            ));
        }

        let context;
        try {
            context = this.getContext();
        } catch {
            return Promise.reject(error(SEMANTIC_PROVIDER_ERROR_CODES.UNSUPPORTED));
        }
        const connectionProfile = resolveSemanticConnectionProfile(
            context,
            this.selectedConnectionProfileId(),
        );
        let route;
        if (connectionProfile) {
            let sendRequest;
            try {
                sendRequest = connectionProfile.service.sendRequest;
            } catch {
                return Promise.reject(error(SEMANTIC_PROVIDER_ERROR_CODES.UNSUPPORTED));
            }
            if (typeof sendRequest !== 'function') {
                return Promise.reject(error(SEMANTIC_PROVIDER_ERROR_CODES.UNSUPPORTED));
            }
            route = {
                kind: 'profile',
                service: connectionProfile.service,
                sendRequest,
                profile: connectionProfile.profile,
                identity: connectionProfileIdentity(connectionProfile.profile),
            };
        } else {
            let generateRaw;
            try {
                generateRaw = context?.generateRaw;
            } catch {
                return Promise.reject(error(SEMANTIC_PROVIDER_ERROR_CODES.UNSUPPORTED));
            }
            if (typeof generateRaw !== 'function') {
                return Promise.reject(error(SEMANTIC_PROVIDER_ERROR_CODES.UNSUPPORTED));
            }
            route = {
                kind: 'current',
                generateRaw,
                identity: readSemanticProviderIdentity(context),
            };
        }
        if (
            request.expectedIdentity
            && !sameProviderIdentity(route.identity, request.expectedIdentity)
        ) {
            return Promise.reject(error(
                SEMANTIC_PROVIDER_ERROR_CODES.INVALID_INPUT,
                'provider-identity-changed',
            ));
        }
        const promptType = route.kind === 'profile'
            ? route.profile.completionType
            : promptTypeForContext(context);
        if (!promptType) {
            return Promise.reject(error(SEMANTIC_PROVIDER_ERROR_CODES.UNSUPPORTED));
        }
        const responseFamily = providerFamily(
            route.identity.provider,
        );

        let armed;
        try {
            armed = this.captureGate.arm({
                prompt: request.prompt,
                promptType,
                ttlMs: request.timeoutMs + CAPTURE_GATE_GRACE_MS,
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
            const cancel = (code, reason) => {
                if (settled || logicallyCancelled) return;
                logicallyCancelled = true;
                cleanupLogicalListeners();
                reject(error(code, reason));
            };
            const onAbort = () => {
                cancel(
                    SEMANTIC_PROVIDER_ERROR_CODES.ABORTED,
                    'provider-aborted',
                );
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
                cancel(
                    SEMANTIC_PROVIDER_ERROR_CODES.ABORTED,
                    'provider-aborted',
                );
                return;
            }
            timeout = setTimeout(() => {
                cancel(
                    SEMANTIC_PROVIDER_ERROR_CODES.TIMEOUT,
                    'provider-timeout',
                );
            }, request.timeoutMs);

            let underlying;
            const releaseUnderlying = this.#trackUnderlyingCall();
            try {
                if (route.kind === 'profile') {
                    const isTextProfile = (
                        route.profile.completionType === 'text-completion'
                    );
                    const profilePrompt = isTextProfile
                        ? [
                            request.systemPrompt,
                            armed.prompt,
                            request.prefill,
                        ].filter(Boolean).join('\n\n')
                        : [
                            ...(request.systemPrompt
                                ? [{ role: 'system', content: request.systemPrompt }]
                                : []),
                            { role: 'user', content: armed.prompt },
                            ...(request.prefill
                                ? [{ role: 'assistant', content: request.prefill }]
                                : []),
                        ];
                    const overridePayload = (
                        route.profile.completionType === 'chat-completion'
                        && request.jsonSchema
                    )
                        ? { json_schema: request.jsonSchema }
                        : {};
                    underlying = Promise.resolve(route.sendRequest.call(
                        route.service,
                        route.profile.id,
                        profilePrompt,
                        request.responseTokenCap,
                        {
                            stream: false,
                            signal: request.signal,
                            extractData: true,
                            includePreset: true,
                            includeInstruct: !isTextProfile,
                        },
                        overridePayload,
                    ));
                } else {
                    underlying = Promise.resolve(route.generateRaw.call(context, {
                        systemPrompt: request.systemPrompt,
                        prompt: armed.prompt,
                        prefill: request.prefill,
                        responseLength: request.responseTokenCap,
                        trimNames: true,
                        jsonSchema: request.jsonSchema,
                    }));
                }
            } catch (providerFailure) {
                safeDisarm();
                releaseUnderlying();
                settled = true;
                cleanupLogicalListeners();
                reject(classifySemanticProviderFailure(
                    providerFailure,
                    request.signal,
                ));
                return;
            }

            underlying.then(
                (response) => {
                    safeDisarm();
                    releaseUnderlying();
                    if (logicallyCancelled) return;
                    settled = true;
                    cleanupLogicalListeners();
                    let text;
                    try {
                        text = generatedResponseText(
                            response,
                            route.kind,
                            responseFamily,
                        );
                    } catch {
                        reject(error(
                            SEMANTIC_PROVIDER_ERROR_CODES.INVALID_RESPONSE,
                            'provider-response-shape',
                        ));
                        return;
                    }
                    if (text === STRUCTURED_RESPONSE_REJECTED) {
                        reject(error(
                            SEMANTIC_PROVIDER_ERROR_CODES.PROVIDER_ERROR,
                            'provider-rejected',
                        ));
                        return;
                    }
                    if (text === null) {
                        reject(error(
                            SEMANTIC_PROVIDER_ERROR_CODES.INVALID_RESPONSE,
                            'provider-response-shape',
                        ));
                        return;
                    }
                    // Some providers honor an assistant prefill and return only the
                    // continuation, while others ignore it and return a complete JSON
                    // object. Never prepend the prefill to an already complete object.
                    const completed = completePrefilledResponse(request.prefill, text);
                    resolve(completed);
                },
                (providerFailure) => {
                    safeDisarm();
                    releaseUnderlying();
                    if (logicallyCancelled) return;
                    settled = true;
                    cleanupLogicalListeners();
                    reject(classifySemanticProviderFailure(
                        providerFailure,
                        request.signal,
                    ));
                },
            );
        });
    }
}

export function createSemanticProviderAdapter(options) {
    return new SemanticProviderAdapter(options);
}
