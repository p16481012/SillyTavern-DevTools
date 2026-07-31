const AUDIT_VERSION = 1;
const MAX_ENTRIES = 200;
const MAX_BYTES = 262_144;
const MAX_SUMMARY_KEYS = 16;
const MAX_SUMMARY_VALUE_LENGTH = 160;
const ACTION_PATTERN = /^[a-z][a-z0-9.-]{0,63}$/u;

export const DEFAULT_AUDIT_LOG = Object.freeze({
    version: AUDIT_VERSION,
    entries: Object.freeze([]),
});

function text(value, maximum = MAX_SUMMARY_VALUE_LENGTH) {
    return typeof value === 'string'
        ? value.normalize('NFKC').replace(/\s+/gu, ' ').trim().slice(0, maximum)
        : '';
}

function hashText(value) {
    let first = 2166136261;
    let second = 2246822507;
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        first ^= code;
        first = Math.imul(first, 16777619);
        second ^= code + index;
        second = Math.imul(second, 3266489909);
    }
    return `${(first >>> 0).toString(16).padStart(8, '0')}${
        (second >>> 0).toString(16).padStart(8, '0')
    }`;
}

function stableValue(value, depth = 0) {
    if (depth > 8 || value == null) return value == null ? null : '';
    if (typeof value === 'string') return value.slice(0, 65_536);
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (Array.isArray(value)) return value.slice(0, 2_000).map(
        (item) => stableValue(item, depth + 1),
    );
    if (typeof value !== 'object') return '';
    const result = {};
    for (const key of Object.keys(value).sort().slice(0, 2_000)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
        result[key] = stableValue(value[key], depth + 1);
    }
    return result;
}

export function configurationDigest(value) {
    return `config:v1:${hashText(JSON.stringify(stableValue(value)))}`;
}

function timestamp(value) {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function summary(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value)
        .slice(0, MAX_SUMMARY_KEYS)
        .flatMap(([key, item]) => {
            const normalizedKey = text(key, 48);
            if (!/^[a-z][a-z0-9.-]*$/u.test(normalizedKey)) return [];
            if (typeof item === 'number' && Number.isFinite(item)) {
                return [[normalizedKey, item]];
            }
            if (typeof item === 'boolean') return [[normalizedKey, item]];
            const normalizedValue = text(item);
            return normalizedValue ? [[normalizedKey, normalizedValue]] : [];
        }));
}

function normalizeEntry(value) {
    const at = timestamp(value?.at);
    const action = text(value?.action, 64);
    if (!at || !ACTION_PATTERN.test(action)) return null;
    const before = text(value?.before, 64);
    const after = text(value?.after, 64);
    return {
        at,
        action,
        before: /^config:v1:[0-9a-f]{16}$/u.test(before) ? before : null,
        after: /^config:v1:[0-9a-f]{16}$/u.test(after) ? after : null,
        summary: summary(value?.summary),
    };
}

function boundedEntries(entries) {
    const result = entries.slice(-MAX_ENTRIES);
    while (
        result.length > 0
        && new TextEncoder().encode(JSON.stringify({
            version: AUDIT_VERSION,
            entries: result,
        })).length > MAX_BYTES
    ) {
        result.shift();
    }
    return result;
}

export function normalizeAuditLog(value = {}) {
    const entries = Array.isArray(value?.entries)
        ? value.entries.map(normalizeEntry).filter(Boolean)
        : [];
    return {
        version: AUDIT_VERSION,
        entries: boundedEntries(entries),
    };
}

export function appendAuditEntry(
    log,
    {
        action,
        before = null,
        after = null,
        summary: entrySummary = {},
        at = new Date(),
    },
) {
    const normalized = normalizeAuditLog(log);
    const entry = normalizeEntry({
        at,
        action,
        before: before && typeof before === 'string' && before.startsWith('config:v1:')
            ? before
            : before == null ? null : configurationDigest(before),
        after: after && typeof after === 'string' && after.startsWith('config:v1:')
            ? after
            : after == null ? null : configurationDigest(after),
        summary: entrySummary,
    });
    if (!entry) return normalized;
    return normalizeAuditLog({
        entries: [...normalized.entries, entry],
    });
}
