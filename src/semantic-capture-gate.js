const PROMPT_TYPES = new Set([
    'chat-completion',
    'text-completion',
]);
const PHASES = new Set([
    'prompt',
    'request',
]);

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_MAX_ACTIVE = 4;
const MAX_ACTIVE_LIMIT = 16;
const MAX_PROMPT_CHARS = 512 * 1024;
const MAX_SCAN_DEPTH = 8;
const MAX_SCAN_NODES = 512;
const MAX_SCAN_STRINGS = 256;
const MAX_SCAN_CHARS = 2 * 1024 * 1024;
const NONCE_BYTES = 16;
const NONCE_ATTEMPTS = 4;

export const SEMANTIC_CAPTURE_DECISION = Object.freeze({
    SUPPRESS: 'suppress',
    ALLOW: 'allow',
    AMBIGUOUS: 'ambiguous',
});

export class SemanticCaptureGateError extends Error {
    constructor(code) {
        super(code);
        this.name = 'SemanticCaptureGateError';
        this.code = code;
    }
}

function fail(code) {
    throw new SemanticCaptureGateError(code);
}

function boundedInteger(value, minimum, maximum, code) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        fail(code);
    }
    return value;
}

function normalizePromptType(value) {
    return PROMPT_TYPES.has(value) ? value : null;
}

function normalizePhase(value) {
    return PHASES.has(value) ? value : null;
}

function toHex(bytes) {
    return [...bytes]
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('');
}

function countOccurrences(value, needle) {
    let count = 0;
    let cursor = 0;
    while (cursor <= value.length - needle.length) {
        const found = value.indexOf(needle, cursor);
        if (found === -1) break;
        count += 1;
        cursor = found + needle.length;
        if (count > 1) break;
    }
    return count;
}

function ownDataValues(value) {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const values = [];
    for (const [key, descriptor] of Object.entries(descriptors)) {
        if (key === '__proto__' || !descriptor.enumerable || !('value' in descriptor)) {
            continue;
        }
        values.push(descriptor.value);
    }
    return values;
}

function boundedStrings(root) {
    const strings = [];
    const stack = [{ value: root, depth: 0 }];
    const seen = new WeakSet();
    let nodes = 0;
    let chars = 0;
    let complete = true;

    while (stack.length > 0) {
        const current = stack.pop();
        const value = current.value;
        if (typeof value === 'string') {
            chars += value.length;
            if (strings.length >= MAX_SCAN_STRINGS || chars > MAX_SCAN_CHARS) {
                complete = false;
                break;
            }
            strings.push(value);
            continue;
        }
        if (!value || typeof value !== 'object') continue;
        if (seen.has(value)) continue;
        seen.add(value);
        nodes += 1;
        if (nodes > MAX_SCAN_NODES || current.depth >= MAX_SCAN_DEPTH) {
            complete = false;
            break;
        }

        let prototype;
        try {
            prototype = Object.getPrototypeOf(value);
        } catch {
            complete = false;
            continue;
        }
        if (
            !Array.isArray(value)
            && prototype !== Object.prototype
            && prototype !== null
        ) {
            complete = false;
            continue;
        }

        let values;
        try {
            values = ownDataValues(value);
        } catch {
            complete = false;
            continue;
        }
        for (let index = values.length - 1; index >= 0; index -= 1) {
            stack.push({
                value: values[index],
                depth: current.depth + 1,
            });
        }
    }

    return { strings, complete };
}

function exactMatch(record, strings) {
    return strings.some((value) => (
        value.includes(record.expectedPrompt)
        && countOccurrences(value, record.nonce) === 1
    ));
}

function ticketObject() {
    return Object.freeze(Object.create(null));
}

export class SemanticCaptureGate {
    #crypto;

    #now;

    #ttlMs;

    #maxActive;

    #active;

    #delete(ticket) {
        const record = this.#active.get(ticket);
        if (!record) return false;
        this.#active.delete(ticket);
        if (record.expiryTimer !== null) {
            clearTimeout(record.expiryTimer);
            record.expiryTimer = null;
        }
        return true;
    }

    constructor({
        crypto = globalThis.crypto,
        now = Date.now,
        ttlMs = DEFAULT_TTL_MS,
        maxActive = DEFAULT_MAX_ACTIVE,
    } = {}) {
        if (!crypto || typeof crypto.getRandomValues !== 'function') {
            fail('SEMANTIC_GATE_UNAVAILABLE');
        }
        if (typeof now !== 'function') {
            fail('SEMANTIC_GATE_INVALID_CONFIG');
        }
        this.#crypto = crypto;
        this.#now = now;
        this.#ttlMs = boundedInteger(
            ttlMs,
            1,
            5 * 60_000,
            'SEMANTIC_GATE_INVALID_CONFIG',
        );
        this.#maxActive = boundedInteger(
            maxActive,
            1,
            MAX_ACTIVE_LIMIT,
            'SEMANTIC_GATE_INVALID_CONFIG',
        );
        this.#active = new Map();
    }

    get activeCount() {
        this.purgeExpired();
        return this.#active.size;
    }

    purgeExpired() {
        const now = Number(this.#now());
        for (const [ticket, record] of this.#active) {
            if (!Number.isFinite(now) || now >= record.expiresAt) {
                this.#delete(ticket);
            }
        }
    }

    createNonce(prompt) {
        for (let attempt = 0; attempt < NONCE_ATTEMPTS; attempt += 1) {
            const bytes = new Uint8Array(NONCE_BYTES);
            this.#crypto.getRandomValues(bytes);
            const nonce = toHex(bytes);
            const collision = prompt.includes(nonce)
                || [...this.#active.values()].some((record) => record.nonce === nonce);
            if (!collision) return nonce;
        }
        fail('SEMANTIC_GATE_NONCE_FAILED');
    }

    arm({ prompt, promptType }) {
        this.purgeExpired();
        const normalizedType = normalizePromptType(promptType);
        if (
            !normalizedType
            || typeof prompt !== 'string'
            || prompt.length === 0
            || prompt.length > MAX_PROMPT_CHARS
        ) {
            fail('SEMANTIC_GATE_INVALID_INPUT');
        }
        if (this.#active.size >= this.#maxActive) {
            fail('SEMANTIC_GATE_CAPACITY');
        }

        const issuedAt = Number(this.#now());
        if (!Number.isFinite(issuedAt)) {
            fail('SEMANTIC_GATE_INVALID_CONFIG');
        }
        const nonce = this.createNonce(prompt);
        const marker = `\n\n<!-- ST_DEVTOOLS_SEMANTIC:${nonce} -->`;
        const expectedPrompt = `${prompt}${marker}`;
        const ticket = ticketObject();
        const record = {
            promptType: normalizedType,
            nonce,
            expectedPrompt,
            expiresAt: issuedAt + this.#ttlMs,
            expiryTimer: null,
            consumed: {
                prompt: false,
                request: false,
            },
        };
        this.#active.set(ticket, record);
        record.expiryTimer = setTimeout(() => {
            if (this.#active.get(ticket) === record) {
                this.#delete(ticket);
            }
        }, this.#ttlMs);
        record.expiryTimer?.unref?.();
        return Object.freeze({
            ticket,
            prompt: expectedPrompt,
        });
    }

    disarm(ticket) {
        this.purgeExpired();
        return this.#delete(ticket);
    }

    decide({ phase, promptType, payload }) {
        this.purgeExpired();
        const normalizedPhase = normalizePhase(phase);
        const normalizedType = normalizePromptType(promptType);
        if (!normalizedPhase || !normalizedType) {
            return SEMANTIC_CAPTURE_DECISION.ALLOW;
        }

        const records = [...this.#active.values()]
            .filter((record) => record.promptType === normalizedType);
        if (records.length === 0) {
            return SEMANTIC_CAPTURE_DECISION.ALLOW;
        }

        const scan = boundedStrings(payload);
        const matches = records.filter((record) => exactMatch(record, scan.strings));
        if (matches.length > 0) {
            for (const record of matches) {
                record.consumed[normalizedPhase] = true;
            }
            return SEMANTIC_CAPTURE_DECISION.SUPPRESS;
        }
        if (!scan.complete) {
            return SEMANTIC_CAPTURE_DECISION.AMBIGUOUS;
        }
        if (
            normalizedPhase === 'request'
            && records.some((record) => !record.consumed.request)
        ) {
            return SEMANTIC_CAPTURE_DECISION.AMBIGUOUS;
        }
        return SEMANTIC_CAPTURE_DECISION.ALLOW;
    }
}

export function createSemanticCaptureGate(options) {
    return new SemanticCaptureGate(options);
}
