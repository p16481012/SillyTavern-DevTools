const REDACTED_VALUE = '[민감 정보 제거됨]';
const CIRCULAR_VALUE = '[순환 참조]';
const OMITTED_MEDIA_VALUE = '[미디어 데이터 생략됨]';
const UNSUPPORTED_VALUE = '[ST DevTools: unsupported value omitted]';
const SANITIZE_MAX_DEPTH = 24;
const SANITIZE_MAX_NODES = 200_000;
const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const PROMPT_BODY_KEYS = new Set([
    'messages',
    'chat',
    'prompt',
    'input',
    'tools',
    'tool_choice',
    'functions',
    'function_call',
]);
const CORRELATION_KEYS = [
    'request_id',
    'requestId',
    'generation_id',
    'generationId',
    'completion_id',
    'completionId',
    'response_id',
    'responseId',
];
const CORRELATION_CONTAINERS = ['metadata', 'meta', '_meta', 'request_metadata'];
const URL_SECRET_QUERY = /([?&](?:api[_-]?key|access[_-]?token|auth(?:orization)?|bearer|client[_-]?secret|password|secret|signature|sig|token)=)([^&#\s]+)/giu;
const AUTHORIZATION_VALUE = /\bAuthorization\s*:\s*(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/giu;
const TOKEN_VALUE_PATTERNS = [
    /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/gu,
    /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/gu,
    /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/gu,
    /\bAIza[0-9A-Za-z_-]{20,}\b/gu,
    /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu,
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}\b/gu,
];
const PRIVATE_KEY_BEGIN = /-----BEGIN [A-Z0-9 ]{0,64}PRIVATE KEY-----/gu;
const PRIVATE_KEY_END = /-----END [A-Z0-9 ]{0,64}PRIVATE KEY-----/gu;

function isSensitiveKey(key) {
    const normalized = String(key).replace(/[^a-z0-9]/giu, '').toLowerCase();
    return [
        'apikey',
        'accesstoken',
        'refreshtoken',
        'bearertoken',
        'idtoken',
        'csrftoken',
        'authorization',
        'authtoken',
        'password',
        'proxypassword',
        'privatekey',
        'clientsecret',
        'secret',
        'cookie',
        'session',
        'sessionid',
    ].some((candidate) => normalized.includes(candidate));
}

function redactPrivateKeys(value) {
    let output = '';
    let cursor = 0;
    let changed = false;
    PRIVATE_KEY_BEGIN.lastIndex = 0;
    let begin;
    while ((begin = PRIVATE_KEY_BEGIN.exec(value)) !== null) {
        output += value.slice(cursor, begin.index);
        PRIVATE_KEY_END.lastIndex = PRIVATE_KEY_BEGIN.lastIndex;
        const end = PRIVATE_KEY_END.exec(value);
        const endIndex = end
            ? PRIVATE_KEY_END.lastIndex
            : value.length;
        output += REDACTED_VALUE;
        cursor = endIndex;
        changed = true;
        PRIVATE_KEY_BEGIN.lastIndex = endIndex;
        if (!end) break;
    }
    return {
        value: changed ? `${output}${value.slice(cursor)}` : value,
        changed,
    };
}

function redactSensitiveString(value) {
    let result = redactPrivateKeys(value);
    let output = result.value
        .replace(URL_SECRET_QUERY, `$1${REDACTED_VALUE}`)
        .replace(AUTHORIZATION_VALUE, REDACTED_VALUE);
    for (const pattern of TOKEN_VALUE_PATTERNS) {
        output = output.replace(pattern, REDACTED_VALUE);
    }
    return {
        value: output,
        changed: result.changed || output !== value,
    };
}

export function sanitizeRequestBody(value) {
    const redactedPaths = [];
    const omittedMediaPaths = [];
    const seen = new WeakSet();
    let visitedNodes = 0;

    const visit = (current, path, depth = 0) => {
        visitedNodes += 1;
        if (depth > SANITIZE_MAX_DEPTH || visitedNodes > SANITIZE_MAX_NODES) {
            return UNSUPPORTED_VALUE;
        }
        if (typeof current === 'string') {
            if (/^data:(?:image|audio|video)\//iu.test(current)) {
                omittedMediaPaths.push(path);
                return OMITTED_MEDIA_VALUE;
            }
            const sanitized = redactSensitiveString(current);
            if (sanitized.changed) redactedPaths.push(path);
            return sanitized.value;
        }
        if (current === null || typeof current === 'boolean') {
            return current;
        }
        if (typeof current === 'number') {
            return Number.isFinite(current) ? current : null;
        }
        if (typeof current === 'bigint') return String(current);
        if (['undefined', 'function', 'symbol'].includes(typeof current)) {
            return null;
        }
        if (current instanceof Date) {
            try {
                const time = Date.prototype.getTime.call(current);
                return Number.isFinite(time)
                    ? new Date(time).toISOString()
                    : null;
            } catch {
                return null;
            }
        }
        if (
            current instanceof ArrayBuffer
            || ArrayBuffer.isView(current)
            || (typeof Blob !== 'undefined' && current instanceof Blob)
        ) {
            omittedMediaPaths.push(path);
            return OMITTED_MEDIA_VALUE;
        }
        if (seen.has(current)) {
            return CIRCULAR_VALUE;
        }
        seen.add(current);

        if (Array.isArray(current)) {
            const clone = [];
            const length = Math.min(
                current.length,
                Math.max(0, SANITIZE_MAX_NODES - visitedNodes),
            );
            for (let index = 0; index < length; index += 1) {
                let item;
                try {
                    item = current[index];
                } catch {
                    clone.push(UNSUPPORTED_VALUE);
                    continue;
                }
                clone.push(visit(item, `${path}[${index}]`, depth + 1));
            }
            if (length < current.length) clone.push(UNSUPPORTED_VALUE);
            return clone;
        }

        const clone = {};
        let keys;
        try {
            keys = Object.keys(current);
        } catch {
            return UNSUPPORTED_VALUE;
        }
        for (const key of keys) {
            const nextPath = path ? `${path}.${key}` : key;
            if (UNSAFE_OBJECT_KEYS.has(key)) {
                continue;
            }
            if (isSensitiveKey(key)) {
                clone[key] = REDACTED_VALUE;
                redactedPaths.push(nextPath);
                continue;
            }
            let item;
            try {
                item = current[key];
            } catch {
                clone[key] = UNSUPPORTED_VALUE;
                continue;
            }
            clone[key] = visit(item, nextPath, depth + 1);
        }
        return clone;
    };

    return {
        body: visit(value, ''),
        redactedPaths,
        omittedMediaPaths,
    };
}

export function sanitizePromptPayload(value) {
    return sanitizeRequestBody(value).body;
}

function normalizeCorrelationValue(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const normalized = String(value).trim();
    return normalized && normalized.length <= 256 ? normalized : null;
}

export function extractRequestCorrelationId(value) {
    if (!value || typeof value !== 'object') return null;

    for (const key of CORRELATION_KEYS) {
        const normalized = normalizeCorrelationValue(value[key]);
        if (normalized) return normalized;
    }

    for (const containerKey of CORRELATION_CONTAINERS) {
        const container = value[containerKey];
        if (!container || typeof container !== 'object' || Array.isArray(container)) continue;
        for (const key of CORRELATION_KEYS) {
            const normalized = normalizeCorrelationValue(container[key]);
            if (normalized) return normalized;
        }
    }

    return null;
}

export function stripRequestCorrelationIds(value) {
    const seen = new WeakMap();
    const visit = (current, { root = false, correlationContainer = false } = {}) => {
        if (current == null || typeof current !== 'object') return current;
        if (seen.has(current)) return seen.get(current);
        if (Array.isArray(current)) {
            const clone = [];
            seen.set(current, clone);
            for (const item of current) clone.push(visit(item));
            return clone;
        }
        const clone = {};
        seen.set(current, clone);
        for (const [key, item] of Object.entries(current)) {
            if ((root || correlationContainer) && CORRELATION_KEYS.includes(key)) {
                continue;
            }
            clone[key] = visit(item, {
                correlationContainer: CORRELATION_CONTAINERS.includes(key),
            });
        }
        return clone;
    };
    return visit(value, { root: true });
}

export function extractPromptPayload(requestBody, promptType, fallbackPayload) {
    if (requestBody && typeof requestBody === 'object') {
        if (promptType === 'chat-completion') {
            if (Array.isArray(requestBody.messages)) return requestBody.messages;
            if (Array.isArray(requestBody.chat)) return requestBody.chat;
            if (Array.isArray(requestBody.prompt)) return requestBody.prompt;
        } else {
            if (typeof requestBody.prompt === 'string') return requestBody.prompt;
            if (typeof requestBody.input === 'string') return requestBody.input;
        }
    }
    return fallbackPayload;
}

export function extractRequestSettings(sanitizedBody) {
    if (!sanitizedBody || typeof sanitizedBody !== 'object' || Array.isArray(sanitizedBody)) {
        return {};
    }
    return Object.fromEntries(
        Object.entries(sanitizedBody)
            .filter(([key]) => !PROMPT_BODY_KEYS.has(key))
            .map(([key, value]) => [key, value]),
    );
}

export function createRequestRecord(requestBody) {
    if (!requestBody || typeof requestBody !== 'object') {
        return {
            body: null,
            settings: {},
            bodyKeys: [],
            redactedPaths: [],
            omittedMediaPaths: [],
            correlationId: null,
            hadCorrelationId: false,
        };
    }

    const correlationId = extractRequestCorrelationId(requestBody);
    const sanitized = sanitizeRequestBody(requestBody);
    const body = stripRequestCorrelationIds(sanitized.body);
    const { redactedPaths, omittedMediaPaths } = sanitized;
    return {
        body,
        settings: extractRequestSettings(body),
        bodyKeys: Array.isArray(body) ? [] : Object.keys(body),
        redactedPaths,
        omittedMediaPaths,
        correlationId: null,
        hadCorrelationId: Boolean(correlationId),
    };
}

export function createCaptureBoundary({
    eventName,
    stage,
    requestBodyAvailable,
    fallback = false,
    migratedFrom = null,
    correlationId = null,
    hadCorrelationId = false,
    correlationMethod = null,
    requestStatus = null,
    generationStatus = 'unknown',
    statusEvent = null,
    statusUpdatedAt = null,
}) {
    return {
        eventName,
        stage,
        requestBodyAvailable: Boolean(requestBodyAvailable),
        fallback: Boolean(fallback),
        clientBackendRequestCaptured: stage === 'backend-request-ready',
        serverTransformationsIncluded: false,
        migratedFrom,
        correlationId: null,
        hadCorrelationId: Boolean(hadCorrelationId || correlationId),
        correlationMethod: correlationMethod ?? (fallback ? 'prompt-only' : 'fifo'),
        requestStatus: requestStatus ?? (
            requestBodyAvailable
                ? 'captured'
                : fallback
                    ? 'prompt-only-timeout'
                    : 'not-captured'
        ),
        generationStatus,
        statusEvent,
        statusUpdatedAt,
    };
}
