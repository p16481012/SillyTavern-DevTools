const REDACTED_VALUE = '[민감 정보 제거됨]';
const CIRCULAR_VALUE = '[순환 참조]';
const OMITTED_MEDIA_VALUE = '[미디어 데이터 생략됨]';
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

function isSensitiveKey(key) {
    const normalized = String(key).replace(/[^a-z0-9]/giu, '').toLocaleLowerCase();
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
        'secret',
        'cookie',
        'session',
        'sessionid',
    ].some((candidate) => normalized.includes(candidate));
}

export function sanitizeRequestBody(value) {
    const redactedPaths = [];
    const omittedMediaPaths = [];
    const seen = new WeakSet();

    const visit = (current, path) => {
        if (typeof current === 'string' && /^data:(?:image|audio|video)\//iu.test(current)) {
            omittedMediaPaths.push(path);
            return OMITTED_MEDIA_VALUE;
        }
        if (current == null || typeof current !== 'object') {
            return current;
        }
        if (seen.has(current)) {
            return CIRCULAR_VALUE;
        }
        seen.add(current);

        if (Array.isArray(current)) {
            return current.map((item, index) => visit(item, `${path}[${index}]`));
        }

        const clone = {};
        for (const [key, item] of Object.entries(current)) {
            const nextPath = path ? `${path}.${key}` : key;
            if (isSensitiveKey(key)) {
                clone[key] = REDACTED_VALUE;
                redactedPaths.push(nextPath);
                continue;
            }
            clone[key] = visit(item, nextPath);
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
        };
    }

    const { body, redactedPaths, omittedMediaPaths } = sanitizeRequestBody(requestBody);
    return {
        body,
        settings: extractRequestSettings(body),
        bodyKeys: Array.isArray(body) ? [] : Object.keys(body),
        redactedPaths,
        omittedMediaPaths,
        correlationId: extractRequestCorrelationId(requestBody),
    };
}

export function createCaptureBoundary({
    eventName,
    stage,
    requestBodyAvailable,
    fallback = false,
    migratedFrom = null,
    correlationId = null,
    correlationMethod = null,
}) {
    return {
        eventName,
        stage,
        requestBodyAvailable: Boolean(requestBodyAvailable),
        fallback: Boolean(fallback),
        clientBackendRequestCaptured: stage === 'backend-request-ready',
        serverTransformationsIncluded: false,
        migratedFrom,
        correlationId,
        correlationMethod: correlationMethod ?? (fallback ? 'prompt-only' : 'fifo'),
    };
}
