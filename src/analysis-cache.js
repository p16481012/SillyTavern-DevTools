const DEFAULT_MAX_ENTRIES = 32;
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const CACHE_KEY_PREFIX = 'analysis:v1';
const CACHE_KINDS = new Set(['search', 'diff', 'rules']);
const DIGEST_PATTERN = /^(?:[a-f0-9]{16,128}|sha256-[a-f0-9]{16,64}|config-v1-[a-f0-9]{16,64})$/iu;
const VARIANT_PATTERN = /^(?:default|[a-f0-9]{16,128})$/iu;

function boundedInteger(value, fallback, minimum, maximum) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(maximum, Math.max(minimum, Math.trunc(number)));
}

function safeKindPart(value) {
    const text = String(value ?? '').trim();
    return CACHE_KINDS.has(text) ? text : null;
}

function safeDigestPart(value) {
    const text = String(value ?? '').trim();
    const configurationMatch = /^config:v1:([a-f0-9]{16,64})$/iu.exec(text);
    const shaMatch = /^sha256:([a-f0-9]{16,64})$/iu.exec(text);
    const normalized = configurationMatch
        ? `config-v1-${configurationMatch[1]}`
        : shaMatch
            ? `sha256-${shaMatch[1]}`
            : text;
    return DIGEST_PATTERN.test(normalized) ? normalized.toLowerCase() : null;
}

function safeVariantPart(value) {
    const text = String(value ?? '').trim();
    return VARIANT_PATTERN.test(text) ? text.toLowerCase() : null;
}

function parseCacheKey(value) {
    if (typeof value !== 'string' || value.length > 512 || /\s/u.test(value)) {
        return null;
    }
    const parts = value.split(':');
    if (parts.length !== 7 || `${parts[0]}:${parts[1]}` !== CACHE_KEY_PREFIX) {
        return null;
    }
    const kind = safeKindPart(parts[2]);
    const snapshotDigest = safeDigestPart(parts[3]);
    const configurationDigest = safeDigestPart(parts[4]);
    const variant = safeVariantPart(parts[5]);
    const revision = Number(parts[6]);
    if (
        !kind
        || !snapshotDigest
        || !configurationDigest
        || !variant
        || !/^(?:0|[1-9]\d*)$/u.test(parts[6])
        || !Number.isSafeInteger(revision)
    ) {
        return null;
    }
    return {
        kind,
        snapshotDigest,
        configurationDigest,
        variant,
        revision,
    };
}

function approximateBytes(value) {
    try {
        const serialized = JSON.stringify(value);
        return typeof serialized === 'string'
            ? new TextEncoder().encode(serialized).length
            : Number.POSITIVE_INFINITY;
    } catch {
        return Number.POSITIVE_INFINITY;
    }
}

export function createAnalysisCacheKey({
    kind,
    snapshotDigest,
    configurationDigest,
    revision = 0,
    variant = 'default',
} = {}) {
    const parts = [
        safeKindPart(kind),
        safeDigestPart(snapshotDigest),
        safeDigestPart(configurationDigest),
        safeVariantPart(variant),
    ];
    if (parts.some((part) => part == null)) return null;
    if (!Number.isSafeInteger(revision) || revision < 0) return null;
    return `${CACHE_KEY_PREFIX}:${parts.join(':')}:${revision}`;
}

export class AnalysisCache {
    constructor({
        maxEntries = DEFAULT_MAX_ENTRIES,
        maxBytes = DEFAULT_MAX_BYTES,
        ttlMs = DEFAULT_TTL_MS,
        now = () => Date.now(),
    } = {}) {
        this.maxEntries = boundedInteger(maxEntries, DEFAULT_MAX_ENTRIES, 1, 256);
        this.maxBytes = boundedInteger(
            maxBytes,
            DEFAULT_MAX_BYTES,
            1024,
            64 * 1024 * 1024,
        );
        this.ttlMs = boundedInteger(ttlMs, DEFAULT_TTL_MS, 100, 24 * 60 * 60 * 1000);
        this.now = now;
        this.entries = new Map();
        this.totalBytes = 0;
        this.lastNow = Number.NEGATIVE_INFINITY;
    }

    get size() {
        this.pruneExpired();
        return this.entries.size;
    }

    get estimatedBytes() {
        this.pruneExpired();
        return this.totalBytes;
    }

    currentTime() {
        let current;
        try {
            current = Number(this.now());
        } catch {
            current = Number.NaN;
        }
        if (!Number.isFinite(current)) {
            current = Number.isFinite(this.lastNow) ? this.lastNow : Date.now();
        }
        this.lastNow = Math.max(this.lastNow, current);
        return this.lastNow;
    }

    pruneExpired() {
        const currentTime = this.currentTime();
        for (const [key, entry] of this.entries) {
            if (entry.expiresAt > currentTime) continue;
            this.entries.delete(key);
            this.totalBytes -= entry.bytes;
        }
        this.totalBytes = Math.max(0, this.totalBytes);
    }

    get(key, { revision = null } = {}) {
        const parsedKey = parseCacheKey(key);
        if (!parsedKey) return undefined;
        const expectedRevision = revision ?? parsedKey.revision;
        if (
            !Number.isSafeInteger(expectedRevision)
            || expectedRevision < 0
            || expectedRevision !== parsedKey.revision
        ) {
            return undefined;
        }
        const entry = this.entries.get(key);
        if (!entry) return undefined;
        if (
            entry.expiresAt <= this.currentTime()
            || entry.revision !== expectedRevision
        ) {
            this.entries.delete(key);
            this.totalBytes -= entry.bytes;
            this.totalBytes = Math.max(0, this.totalBytes);
            return undefined;
        }
        this.entries.delete(key);
        this.entries.set(key, entry);
        return entry.value;
    }

    set(key, value, { revision = null, estimatedBytes = null } = {}) {
        const parsedKey = parseCacheKey(key);
        if (!parsedKey) return false;
        const effectiveRevision = revision ?? parsedKey.revision;
        if (
            !Number.isSafeInteger(effectiveRevision)
            || effectiveRevision < 0
            || effectiveRevision !== parsedKey.revision
        ) {
            return false;
        }
        const measuredBytes = approximateBytes(value);
        const suppliedBytes = Number.isFinite(estimatedBytes)
            ? Math.max(0, Math.trunc(estimatedBytes))
            : 0;
        const bytes = Math.max(measuredBytes, suppliedBytes);
        if (!Number.isFinite(bytes) || bytes > this.maxBytes) return false;

        const previous = this.entries.get(key);
        if (previous) {
            this.entries.delete(key);
            this.totalBytes -= previous.bytes;
        }
        this.entries.set(key, {
            value,
            revision: effectiveRevision,
            bytes,
            expiresAt: this.currentTime() + this.ttlMs,
        });
        this.totalBytes += bytes;
        this.evict();
        return this.entries.has(key);
    }

    evict() {
        this.pruneExpired();
        while (
            this.entries.size > this.maxEntries
            || this.totalBytes > this.maxBytes
        ) {
            const oldestKey = this.entries.keys().next().value;
            if (oldestKey == null) break;
            const entry = this.entries.get(oldestKey);
            this.entries.delete(oldestKey);
            this.totalBytes -= entry?.bytes ?? 0;
        }
    }

    delete(key) {
        if (!parseCacheKey(key)) return false;
        const entry = this.entries.get(key);
        if (!entry) return false;
        this.entries.delete(key);
        this.totalBytes -= entry.bytes;
        this.totalBytes = Math.max(0, this.totalBytes);
        return true;
    }

    clear() {
        this.entries.clear();
        this.totalBytes = 0;
    }

    status() {
        this.pruneExpired();
        return {
            storage: 'memory-only',
            entryCount: this.entries.size,
            estimatedBytes: this.totalBytes,
            maxEntries: this.maxEntries,
            maxBytes: this.maxBytes,
            ttlMs: this.ttlMs,
        };
    }
}
