const REDACTED_VALUE = '[민감 정보 제거됨]';
const CIRCULAR_VALUE = '[순환 참조]';
const PROMPT_BODY_KEYS = new Set(['messages', 'chat', 'prompt', 'input']);

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
    const seen = new WeakSet();

    const visit = (current, path) => {
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
    };
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
        };
    }

    const { body, redactedPaths } = sanitizeRequestBody(requestBody);
    return {
        body,
        settings: extractRequestSettings(body),
        bodyKeys: Array.isArray(body) ? [] : Object.keys(body),
        redactedPaths,
    };
}

export function createCaptureBoundary({
    eventName,
    stage,
    requestBodyAvailable,
    fallback = false,
    migratedFrom = null,
}) {
    return {
        eventName,
        stage,
        requestBodyAvailable: Boolean(requestBodyAvailable),
        fallback: Boolean(fallback),
        clientBackendRequestCaptured: stage === 'backend-request-ready',
        serverTransformationsIncluded: false,
        migratedFrom,
    };
}
