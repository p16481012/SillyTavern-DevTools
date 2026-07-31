import {
    createLocalEstimatedUsage,
    createUnavailableUsage,
    MAX_USAGE_TOKENS,
    normalizeUsageRecord,
} from './provider-usage.js';

export const SNAPSHOT_PRIVACY_SCHEMA_VERSION = 1;
export const SNAPSHOT_PRIVACY_MODES = Object.freeze([
    'full',
    'redacted',
    'metadata',
]);

export const SNAPSHOT_PRIVACY_LIMITS = Object.freeze({
    inputBytes: 16 * 1024 * 1024,
    outputBytes: 20 * 1024 * 1024,
    depth: 24,
    nodes: 200_000,
    promptLeaves: 10_000,
    promptBytes: 12 * 1024 * 1024,
});

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MODE_RANK = Object.freeze({ full: 0, redacted: 1, metadata: 2 });
const REDACTED_VALUE = /^⟦STDT:redacted chars=\d+ bytes=\d+ sha256=[0-9a-f]{64}⟧$/u;
const PRIVATE_REFERENCE = /^(?:snapshot|chat|source)-[0-9a-f]{24}$/u;
const SAFE_TOKEN = /^[A-Za-z0-9_.:-]{1,128}$/u;
const MAX_CORRELATED_AT = 8_640_000_000_000_000;
const REDACTED_TOP_LEVEL_KEYS = new Set([
    'schemaVersion',
    'id',
    'timestamp',
    'extensionVersion',
    'chatId',
    'messageCount',
    'api',
    'provider',
    'providerTrace',
    'model',
    'preset',
    'profileContext',
    'promptType',
    'generationType',
    'payload',
    'finalText',
    'capture',
    'request',
    'sources',
    'lorebookEntries',
    'usage',
    'stats',
    'privacy',
    'privacySummary',
]);
const METADATA_TOP_LEVEL_KEYS = new Set([
    'schemaVersion',
    'id',
    'chatId',
    'timestamp',
    'extensionVersion',
    'messageCount',
    'api',
    'provider',
    'providerTrace',
    'model',
    'promptType',
    'generationType',
    'capture',
    'usage',
    'stats',
    'privacy',
    'privacySummary',
]);
const SOURCE_KEYS = new Set([
    'id',
    'type',
    'label',
    'labelKey',
    'content',
    'color',
    'attribution',
    'included',
    'tokenCount',
    'metadata',
    'ranges',
    'rangeSummary',
    'provenance',
    'configuredEnabled',
]);
const SOURCE_TYPES = new Set([
    'system',
    'character',
    'persona',
    'authors_note',
    'lorebook',
    'extension',
    'jailbreak',
    'utility',
    'chat_history',
    'assistant_prefill',
    'tool_schema',
    'tool_call',
    'tool_result',
    'multimodal',
    'final',
]);
const STRUCTURAL_STRING_KEYS = new Set([
    'role',
    'type',
    'api',
    'provider',
    'model',
    'promptType',
    'generationType',
]);

export class SnapshotPrivacyError extends Error {
    constructor(code, message = code) {
        super(message);
        this.name = 'SnapshotPrivacyError';
        this.code = code;
    }
}

function reject(code, message) {
    throw new SnapshotPrivacyError(code, message);
}

function encodedBytes(value) {
    return new TextEncoder().encode(String(value ?? '')).length;
}

function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function normalizedLimits(overrides = {}) {
    return Object.fromEntries(Object.entries(SNAPSHOT_PRIVACY_LIMITS).map(
        ([key, fallback]) => {
            const candidate = Number(overrides?.[key]);
            return [
                key,
                Number.isFinite(candidate) && candidate > 0
                    ? Math.min(fallback, Math.trunc(candidate))
                    : fallback,
            ];
        },
    ));
}

export function assertBoundedJsonValue(value, options = {}) {
    const limits = normalizedLimits(options.limits);
    const state = {
        nodes: 0,
        estimatedBytes: 0,
        active: new WeakSet(),
    };

    const visit = (current, depth) => {
        if (depth > limits.depth) {
            reject('input-too-deep', 'Snapshot data is nested too deeply.');
        }
        state.nodes += 1;
        if (state.nodes > limits.nodes) {
            reject('input-too-complex', 'Snapshot data contains too many values.');
        }
        if (current === null || typeof current === 'boolean') {
            state.estimatedBytes += 5;
            return;
        }
        if (typeof current === 'number') {
            if (!Number.isFinite(current)) {
                reject('invalid-number', 'Snapshot data contains a non-finite number.');
            }
            state.estimatedBytes += 24;
            return;
        }
        if (typeof current === 'string') {
            state.estimatedBytes += encodedBytes(current) + 2;
            if (state.estimatedBytes > limits.inputBytes) {
                reject('input-too-large', 'Snapshot data exceeds the size limit.');
            }
            return;
        }
        if (!current || typeof current !== 'object') {
            reject('invalid-value', 'Snapshot data contains a non-JSON value.');
        }
        if (state.active.has(current)) {
            reject('circular-input', 'Snapshot data contains a circular reference.');
        }
        state.active.add(current);
        if (!Array.isArray(current) && !isPlainObject(current)) {
            reject('invalid-object', 'Snapshot data must contain only plain objects.');
        }
        try {
            if (Array.isArray(current)) {
                state.estimatedBytes += 2 + current.length;
                for (let index = 0; index < current.length; index += 1) {
                    if (!Object.prototype.hasOwnProperty.call(current, index)) {
                        reject('invalid-array', 'Snapshot data contains a sparse array.');
                    }
                    visit(current[index], depth + 1);
                }
                return;
            }
            const entries = Object.entries(current);
            state.estimatedBytes += 2 + entries.length;
            for (const [key, child] of entries) {
                if (UNSAFE_KEYS.has(key)) {
                    reject('unsafe-key', 'Snapshot data contains an unsafe object key.');
                }
                state.estimatedBytes += encodedBytes(key) + 3;
                if (state.estimatedBytes > limits.inputBytes) {
                    reject('input-too-large', 'Snapshot data exceeds the size limit.');
                }
                visit(child, depth + 1);
            }
        } finally {
            state.active.delete(current);
        }
    };

    visit(value, 0);
    return {
        nodes: state.nodes,
        estimatedBytes: state.estimatedBytes,
        limits,
    };
}

function cloneJsonValue(value) {
    if (Array.isArray(value)) return value.map(cloneJsonValue);
    if (isPlainObject(value)) {
        return Object.fromEntries(
            Object.entries(value).map(([key, child]) => [key, cloneJsonValue(child)]),
        );
    }
    return value;
}

function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (isPlainObject(value)) {
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .map((key) => [key, canonicalize(value[key])]),
        );
    }
    return value;
}

export function canonicalJson(value, options = {}) {
    const { limits } = assertBoundedJsonValue(value, options);
    const serialized = JSON.stringify(canonicalize(value));
    if (encodedBytes(serialized) > limits.inputBytes) {
        reject('input-too-large', 'Snapshot data exceeds the size limit.');
    }
    return serialized;
}

export async function sha256Hex(value, { digest = null } = {}) {
    const bytes = new TextEncoder().encode(String(value ?? ''));
    let result;
    if (globalThis.crypto?.subtle?.digest) {
        const buffer = await globalThis.crypto.subtle.digest('SHA-256', bytes);
        result = [...new Uint8Array(buffer)]
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join('');
    } else if (typeof digest === 'function') {
        result = await digest(bytes);
        if (result instanceof ArrayBuffer) {
            result = [...new Uint8Array(result)]
                .map((byte) => byte.toString(16).padStart(2, '0'))
                .join('');
        } else if (ArrayBuffer.isView(result)) {
            result = [...new Uint8Array(
                result.buffer,
                result.byteOffset,
                result.byteLength,
            )]
                .map((byte) => byte.toString(16).padStart(2, '0'))
                .join('');
        }
    } else {
        reject(
            'digest-unavailable',
            'SHA-256 is unavailable. A trusted digest implementation is required.',
        );
    }
    const normalized = String(result ?? '').toLowerCase();
    if (!/^[0-9a-f]{64}$/u.test(normalized)) {
        reject('invalid-digest', 'The SHA-256 implementation returned an invalid digest.');
    }
    return normalized;
}

export async function snapshotDigest(snapshot, options = {}) {
    return sha256Hex(canonicalJson(snapshot, options), options);
}

function pushStrings(value, output, state, limits, depth = 0, parentKey = null) {
    if (value == null || depth > limits.depth) return;
    if (typeof value === 'string') {
        if (
            !value
            || STRUCTURAL_STRING_KEYS.has(parentKey)
            || REDACTED_VALUE.test(value)
            || PRIVATE_REFERENCE.test(value)
        ) {
            return;
        }
        state.count += 1;
        state.bytes += encodedBytes(value);
        if (state.count > limits.promptLeaves || state.bytes > limits.promptBytes) {
            reject('prompt-data-too-large', 'Prompt-bearing data exceeds privacy scan limits.');
        }
        output.push(value);
        return;
    }
    if (Array.isArray(value)) {
        value.forEach(
            (child) => pushStrings(child, output, state, limits, depth + 1, parentKey),
        );
        return;
    }
    if (!isPlainObject(value)) return;
    Object.entries(value).forEach(
        ([key, child]) => pushStrings(child, output, state, limits, depth + 1, key),
    );
}

export function collectSensitiveSnapshotSeeds(snapshot, options = {}) {
    const { limits } = assertBoundedJsonValue(snapshot, options);
    const values = [];
    const state = { count: 0, bytes: 0 };
    const collect = (value) => pushStrings(value, values, state, limits);
    collect(snapshot.finalText);
    collect(snapshot.id);
    collect(snapshot.payload);
    collect(snapshot.request?.body);
    collect(snapshot.request?.settings);
    collect(snapshot.request?.correlationId);
    for (const source of snapshot.sources ?? []) {
        collect(source?.id);
        collect(source?.label);
        collect(source?.content);
        collect(source?.metadata);
        collect(source?.ranges);
    }
    collect(snapshot.lorebookEntries);
    collect(snapshot.preset);
    collect(snapshot.profileContext);
    collect(snapshot.chatId);
    collect(snapshot.capture?.correlationId);
    return {
        values,
        uniqueValues: [...new Set(values)],
        leafCount: values.length,
        totalCharacters: values.reduce((total, value) => total + value.length, 0),
        totalBytes: state.bytes,
    };
}

async function redactedString(value, options, cache) {
    if (REDACTED_VALUE.test(value)) return value;
    if (!cache.has(value)) {
        cache.set(value, sha256Hex(value, options).then(
            (digest) => `⟦STDT:redacted chars=${value.length} bytes=${
                encodedBytes(value)
            } sha256=${digest}⟧`,
        ));
    }
    return cache.get(value);
}

async function redactTree(value, options, cache) {
    if (typeof value === 'string') return redactedString(value, options, cache);
    if (Array.isArray(value)) {
        return Promise.all(value.map((child) => redactTree(child, options, cache)));
    }
    if (isPlainObject(value)) {
        return Object.fromEntries(await Promise.all(
            Object.entries(value).map(async ([key, child]) => [
                key,
                await redactTree(child, options, cache),
            ]),
        ));
    }
    return value;
}

function captureLifecycle(capture = {}) {
    return {
        eventName: capture.eventName ?? null,
        stage: capture.stage ?? null,
        requestBodyAvailable: Boolean(capture.requestBodyAvailable),
        fallback: Boolean(capture.fallback),
        clientBackendRequestCaptured: Boolean(capture.clientBackendRequestCaptured),
        serverTransformationsIncluded: Boolean(capture.serverTransformationsIncluded),
        migratedFrom: Number.isFinite(capture.migratedFrom)
            ? capture.migratedFrom
            : null,
        correlationId: null,
        hadCorrelationId: Boolean(capture.hadCorrelationId ?? capture.correlationId),
        correlationMethod: capture.correlationMethod ?? null,
        requestStatus: capture.requestStatus ?? null,
        generationStatus: capture.generationStatus ?? null,
        statusEvent: capture.statusEvent ?? null,
        statusUpdatedAt: Number.isFinite(capture.statusUpdatedAt)
            ? capture.statusUpdatedAt
            : null,
    };
}

function providerTraceSummary(trace = {}) {
    return {
        transport: {
            api: trace.transport?.api ?? 'unknown',
            promptType: trace.transport?.promptType ?? 'unknown',
            generationType: trace.transport?.generationType ?? 'unknown',
        },
        selectedSource: {
            value: trace.selectedSource?.value ?? 'unknown',
            status: trace.selectedSource?.status ?? 'unknown',
            evidencePointer: null,
        },
        upstreamProvider: {
            value: trace.upstreamProvider?.value ?? null,
            status: trace.upstreamProvider?.status ?? 'unknown',
            evidencePointer: null,
        },
    };
}

async function privateReference(prefix, value, fallback, options) {
    const source = String(value ?? fallback ?? '');
    const digest = await sha256Hex(`${prefix}\0${source}`, options);
    return `${prefix}-${digest.slice(0, 24)}`;
}

async function privacySummary(snapshot, seeds, options) {
    const contentDigest = await sha256Hex(
        canonicalJson(seeds.values, {
            limits: {
                ...options.limits,
                inputBytes: SNAPSHOT_PRIVACY_LIMITS.inputBytes,
            },
        }),
        options,
    );
    return {
        sourceCount: Array.isArray(snapshot.sources) ? snapshot.sources.length : 0,
        loreEntryCount: Array.isArray(snapshot.lorebookEntries)
            ? snapshot.lorebookEntries.length
            : 0,
        payloadMessageCount: Array.isArray(snapshot.payload)
            ? snapshot.payload.length
            : snapshot.payload == null
                ? 0
                : 1,
        requestBodyAvailable: snapshot.request?.body != null,
        promptLeafCount: seeds.leafCount,
        promptCharacters: seeds.totalCharacters,
        promptBytes: seeds.totalBytes,
        promptDigest: contentDigest,
    };
}

function privacyMetadata(mode, originalSchemaVersion) {
    return {
        schemaVersion: SNAPSHOT_PRIVACY_SCHEMA_VERSION,
        mode,
        digestAlgorithm: 'SHA-256',
        rawPromptContentIncluded: mode === 'full',
        rawChatIdIncluded: mode === 'full',
        rawRequestIdIncluded: mode === 'full',
        originalSchemaVersion: Number(originalSchemaVersion) || null,
    };
}

function assertPrivacyTransition(snapshot, mode) {
    const existingMode = snapshot?.privacy?.mode;
    if (
        Object.prototype.hasOwnProperty.call(MODE_RANK, existingMode)
        && MODE_RANK[mode] < MODE_RANK[existingMode]
    ) {
        reject(
            'privacy-mode-upgrade',
            'A more private snapshot cannot be converted back to a less private mode.',
        );
    }
}

function everyString(value, predicate) {
    if (typeof value === 'string') return predicate(value);
    if (Array.isArray(value)) return value.every((child) => everyString(child, predicate));
    if (!isPlainObject(value)) return true;
    return Object.values(value).every((child) => everyString(child, predicate));
}

function hasOnlyKeys(value, allowed) {
    return isPlainObject(value)
        && Object.keys(value).every((key) => allowed.has(key));
}

function safeTokenOrNull(value) {
    return value == null || (typeof value === 'string' && SAFE_TOKEN.test(value));
}

function canonicalPrivacyFlags(snapshot, mode) {
    const privacy = snapshot?.privacy;
    return hasOnlyKeys(privacy, new Set([
        'schemaVersion',
        'mode',
        'digestAlgorithm',
        'rawPromptContentIncluded',
        'rawChatIdIncluded',
        'rawRequestIdIncluded',
        'originalSchemaVersion',
    ]))
        && privacy.schemaVersion === SNAPSHOT_PRIVACY_SCHEMA_VERSION
        && privacy.mode === mode
        && privacy.digestAlgorithm === 'SHA-256'
        && privacy.rawPromptContentIncluded === (mode === 'full')
        && privacy.rawChatIdIncluded === (mode === 'full')
        && privacy.rawRequestIdIncluded === (mode === 'full');
}

function canonicalCaptureLifecycle(capture) {
    if (!hasOnlyKeys(capture, new Set([
        'eventName',
        'stage',
        'requestBodyAvailable',
        'fallback',
        'clientBackendRequestCaptured',
        'serverTransformationsIncluded',
        'migratedFrom',
        'correlationId',
        'hadCorrelationId',
        'correlationMethod',
        'requestStatus',
        'generationStatus',
        'statusEvent',
        'statusUpdatedAt',
    ]))) {
        return false;
    }
    return capture.correlationId == null
        && safeTokenOrNull(capture.eventName)
        && safeTokenOrNull(capture.stage)
        && safeTokenOrNull(capture.correlationMethod)
        && safeTokenOrNull(capture.requestStatus)
        && safeTokenOrNull(capture.generationStatus)
        && safeTokenOrNull(capture.statusEvent)
        && typeof capture.requestBodyAvailable === 'boolean'
        && typeof capture.fallback === 'boolean'
        && typeof capture.clientBackendRequestCaptured === 'boolean'
        && typeof capture.serverTransformationsIncluded === 'boolean'
        && typeof capture.hadCorrelationId === 'boolean';
}

function canonicalProviderTrace(trace) {
    if (!hasOnlyKeys(trace, new Set([
        'transport',
        'selectedSource',
        'upstreamProvider',
    ]))) {
        return false;
    }
    return hasOnlyKeys(trace.transport, new Set([
        'api',
        'promptType',
        'generationType',
    ]))
        && hasOnlyKeys(trace.selectedSource, new Set([
            'value',
            'status',
            'evidencePointer',
        ]))
        && hasOnlyKeys(trace.upstreamProvider, new Set([
            'value',
            'status',
            'evidencePointer',
        ]))
        && trace.selectedSource.evidencePointer == null
        && trace.upstreamProvider.evidencePointer == null;
}

function canonicalPrivacySummary(summary) {
    if (!isPlainObject(summary)) return false;
    return Number.isInteger(summary.sourceCount)
        && summary.sourceCount >= 0
        && Number.isInteger(summary.loreEntryCount)
        && summary.loreEntryCount >= 0
        && Number.isInteger(summary.payloadMessageCount)
        && summary.payloadMessageCount >= 0
        && typeof summary.requestBodyAvailable === 'boolean'
        && Number.isInteger(summary.promptLeafCount)
        && summary.promptLeafCount >= 0
        && Number.isInteger(summary.promptCharacters)
        && summary.promptCharacters >= 0
        && Number.isInteger(summary.promptBytes)
        && summary.promptBytes >= 0
        && /^[0-9a-f]{64}$/u.test(String(summary.promptDigest ?? ''));
}

function canonicalUsage(usage) {
    try {
        const normalized = normalizeUsageRecord(usage);
        return JSON.stringify(normalized) === JSON.stringify(usage);
    } catch {
        return false;
    }
}

function privacySafeUsage(snapshot) {
    if (snapshot?.usage != null) {
        try {
            return normalizeUsageRecord(snapshot.usage);
        } catch {
            reject('invalid-usage', 'Snapshot usage is not a canonical bounded record.');
        }
    }
    if ((Number(snapshot?.schemaVersion) || 1) >= 7) {
        reject('invalid-usage', 'Schema v7 snapshots require a usage record.');
    }
    const inputTokens = snapshot?.stats?.totalTokens;
    if (
        Number.isSafeInteger(inputTokens)
        && inputTokens >= 0
        && inputTokens <= MAX_USAGE_TOKENS
    ) {
        return createLocalEstimatedUsage({
            inputTokens,
            outputTokens: null,
            cachedInputTokens: null,
            totalTokens: null,
        }, {
            sourceEvent: 'legacy-snapshot-token-count',
            correlatedAt: Number.isSafeInteger(snapshot?.timestamp)
                && snapshot.timestamp >= 0
                && snapshot.timestamp <= MAX_CORRELATED_AT
                ? snapshot.timestamp
                : null,
        });
    }
    return createUnavailableUsage({
        sourceEvent: 'legacy-snapshot-unavailable',
    });
}

function canonicalRedactedSource(source) {
    return hasOnlyKeys(source, SOURCE_KEYS)
        && /^source-[0-9a-f]{24}$/u.test(String(source.id ?? ''))
        && SOURCE_TYPES.has(source.type)
        && REDACTED_VALUE.test(String(source.label ?? ''))
        && (
            source.labelKey == null
            || (
                typeof source.labelKey === 'string'
                && /^[A-Za-z0-9_.:-]{1,128}$/u.test(source.labelKey)
            )
        )
        && REDACTED_VALUE.test(String(source.content ?? ''))
        && (source.color == null || /^#[0-9a-f]{6}$/iu.test(source.color))
        && safeTokenOrNull(source.attribution)
        && Array.isArray(source.ranges)
        && source.ranges.length === 0
        && Number.isInteger(source.rangeSummary?.count)
        && source.rangeSummary.count >= 0
        && Number.isInteger(source.rangeSummary?.quotedValueCount)
        && source.rangeSummary.quotedValueCount >= 0
        && everyString(source.metadata, (value) => REDACTED_VALUE.test(value))
        && hasOnlyKeys(source.provenance, new Set([
            'method',
            'confidence',
            'availability',
            'locations',
            'locationCount',
            'locationsTruncated',
        ]))
        && safeTokenOrNull(source.provenance.method)
        && source.provenance.availability === 'redacted'
        && Array.isArray(source.provenance.locations)
        && source.provenance.locations.length === 0
        && source.provenance.locationCount === 0
        && source.provenance.locationsTruncated === false;
}

function isCanonicalPrivateSnapshot(snapshot, mode) {
    if (!canonicalPrivacyFlags(snapshot, mode)) return false;
    if (mode === 'full') return true;
    if (mode === 'redacted') {
        return hasOnlyKeys(snapshot, REDACTED_TOP_LEVEL_KEYS)
            && /^snapshot-[0-9a-f]{24}$/u.test(String(snapshot.id ?? ''))
            && /^chat-[0-9a-f]{24}$/u.test(String(snapshot.chatId ?? ''))
            && canonicalCaptureLifecycle(snapshot.capture)
            && canonicalProviderTrace(snapshot.providerTrace)
            && canonicalPrivacySummary(snapshot.privacySummary)
            && canonicalUsage(snapshot.usage)
            && hasOnlyKeys(snapshot.request, new Set([
                'body',
                'settings',
                'bodyKeys',
                'redactedPathCount',
                'omittedMediaPathCount',
                'correlationId',
                'hadCorrelationId',
            ]))
            && snapshot.request.correlationId == null
            && typeof snapshot.request.hadCorrelationId === 'boolean'
            && Array.isArray(snapshot.sources)
            && snapshot.sources.every(canonicalRedactedSource)
            && Array.isArray(snapshot.lorebookEntries)
            && REDACTED_VALUE.test(String(snapshot.finalText ?? ''))
            && everyString([
                snapshot.payload,
                snapshot.request?.body,
                snapshot.request?.settings,
                snapshot.request?.bodyKeys,
                snapshot.lorebookEntries,
                snapshot.preset,
                snapshot.profileContext,
                snapshot.stats,
            ], (value) => REDACTED_VALUE.test(value));
    }
    if (mode === 'metadata') {
        return hasOnlyKeys(snapshot, METADATA_TOP_LEVEL_KEYS)
            && /^snapshot-[0-9a-f]{24}$/u.test(String(snapshot.id ?? ''))
            && /^chat-[0-9a-f]{24}$/u.test(String(snapshot.chatId ?? ''))
            && canonicalCaptureLifecycle(snapshot.capture)
            && canonicalProviderTrace(snapshot.providerTrace)
            && canonicalPrivacySummary(snapshot.privacySummary)
            && canonicalUsage(snapshot.usage)
            && everyString(snapshot.stats, (value) => REDACTED_VALUE.test(value));
    }
    return false;
}

export function validateCanonicalSnapshotPrivacy(
    snapshot,
    mode = snapshot?.privacy?.mode,
    { limits = null } = {},
) {
    normalizeMode(mode);
    assertBoundedJsonValue(snapshot, {
        limits: normalizedLimits(limits),
    });
    if (!isCanonicalPrivateSnapshot(snapshot, mode)) {
        reject(
            'invalid-canonical-privacy',
            'Snapshot privacy structure does not match its declared mode.',
        );
    }
    return true;
}

function normalizeMode(mode) {
    if (!SNAPSHOT_PRIVACY_MODES.includes(mode)) {
        reject('invalid-privacy-mode', 'The requested snapshot privacy mode is unsupported.');
    }
    return mode;
}

export async function transformSnapshotPrivacy(
    snapshot,
    {
        mode = 'full',
        digest = null,
        limits = null,
    } = {},
) {
    normalizeMode(mode);
    if (!isPlainObject(snapshot)) {
        reject('invalid-snapshot', 'A snapshot must be a plain object.');
    }
    const options = { digest, limits: normalizedLimits(limits) };
    const inputBoundary = assertBoundedJsonValue(snapshot, options);
    assertPrivacyTransition(snapshot, mode);
    if (isCanonicalPrivateSnapshot(snapshot, mode)) {
        return cloneJsonValue(snapshot);
    }
    if (mode === 'full') {
        const result = {
            ...cloneJsonValue(snapshot),
            privacy: privacyMetadata(mode, snapshot.schemaVersion),
            privacySummary: {
                sourceCount: Array.isArray(snapshot.sources) ? snapshot.sources.length : 0,
                loreEntryCount: Array.isArray(snapshot.lorebookEntries)
                    ? snapshot.lorebookEntries.length
                    : 0,
                payloadMessageCount: Array.isArray(snapshot.payload)
                    ? snapshot.payload.length
                    : snapshot.payload == null
                        ? 0
                        : 1,
                requestBodyAvailable: snapshot.request?.body != null,
                promptLeafCount: null,
                promptCharacters: null,
                promptBytes: null,
                promptDigest: null,
                measurement: 'not-collected-full-fast-path',
            },
        };
        if (inputBoundary.estimatedBytes + 2_048 > options.limits.outputBytes) {
            reject(
                'output-too-large',
                'Privacy-transformed snapshot exceeds the size limit.',
            );
        }
        return result;
    }
    const seeds = collectSensitiveSnapshotSeeds(snapshot, options);
    const summary = await privacySummary(snapshot, seeds, options);

    let result;
    if (mode === 'metadata') {
        result = {
            schemaVersion: Number(snapshot.schemaVersion) || null,
            id: /^snapshot-[0-9a-f]{24}$/u.test(String(snapshot.id ?? ''))
                ? snapshot.id
                : await privateReference(
                    'snapshot',
                    snapshot.id,
                    summary.promptDigest,
                    options,
                ),
            chatId: /^chat-[0-9a-f]{24}$/u.test(String(snapshot.chatId ?? ''))
                ? snapshot.chatId
                : await privateReference(
                    'chat',
                    snapshot.chatId,
                    'global',
                    options,
                ),
            timestamp: Number(snapshot.timestamp) || 0,
            extensionVersion: snapshot.extensionVersion ?? null,
            messageCount: Number(snapshot.messageCount) || 0,
            api: snapshot.api ?? 'unknown',
            provider: snapshot.provider ?? 'unknown',
            providerTrace: providerTraceSummary(snapshot.providerTrace),
            model: snapshot.model ?? null,
            promptType: snapshot.promptType ?? 'unknown',
            generationType: snapshot.generationType ?? 'unknown',
            capture: captureLifecycle(snapshot.capture),
            usage: cloneJsonValue(privacySafeUsage(snapshot)),
            stats: await redactTree(snapshot.stats ?? {}, options, new Map()),
            privacy: privacyMetadata(mode, snapshot.schemaVersion),
            privacySummary: summary,
        };
    } else {
        const cache = new Map();
        const id = String(snapshot.id ?? '');
        const chatId = String(snapshot.chatId ?? '');
        const redactedSources = await Promise.all((snapshot.sources ?? []).map(
            async (source, sourceIndex) => ({
                id: /^source-[0-9a-f]{24}$/u.test(String(source?.id ?? ''))
                    ? source.id
                    : await privateReference(
                        'source',
                        source?.id,
                        `${source?.type ?? 'utility'}:${sourceIndex}`,
                        options,
                    ),
                type: source?.type ?? 'utility',
                label: await redactedString(String(source?.label ?? ''), options, cache),
                labelKey: source?.labelKey ?? null,
                content: await redactedString(String(source?.content ?? ''), options, cache),
                color: source?.color ?? null,
                attribution: source?.attribution ?? null,
                included: source?.included ?? null,
                tokenCount: Number.isFinite(source?.tokenCount)
                    ? source.tokenCount
                    : null,
                metadata: await redactTree(source?.metadata ?? {}, options, cache),
                ranges: [],
                rangeSummary: {
                    count: Array.isArray(source?.ranges) ? source.ranges.length : 0,
                    quotedValueCount: Array.isArray(source?.ranges)
                        ? source.ranges.filter(
                            (range) => range && Object.values(range).some(
                                (value) => typeof value === 'string',
                            ),
                        ).length
                        : 0,
                },
                provenance: {
                    method: source?.provenance?.method ?? source?.attribution ?? 'unknown',
                    confidence: Number.isFinite(source?.provenance?.confidence)
                        ? source.provenance.confidence
                        : null,
                    availability: 'redacted',
                    locations: [],
                    locationCount: 0,
                    locationsTruncated: false,
                },
                ...(source?.configuredEnabled !== undefined
                    ? { configuredEnabled: Boolean(source.configuredEnabled) }
                    : {}),
            }),
        ));
        const request = snapshot.request ?? {};
        result = {
            schemaVersion: Number(snapshot.schemaVersion) || null,
            id: /^snapshot-[0-9a-f]{24}$/u.test(id)
                ? id
                : await privateReference('snapshot', id, summary.promptDigest, options),
            timestamp: Number(snapshot.timestamp) || 0,
            extensionVersion: snapshot.extensionVersion ?? null,
            chatId: /^chat-[0-9a-f]{24}$/u.test(chatId)
                ? chatId
                : await privateReference('chat', chatId, 'global', options),
            messageCount: Number(snapshot.messageCount) || 0,
            api: snapshot.api ?? 'unknown',
            provider: snapshot.provider ?? 'unknown',
            providerTrace: providerTraceSummary(snapshot.providerTrace),
            model: snapshot.model ?? null,
            preset: await redactedString(String(snapshot.preset ?? ''), options, cache),
            profileContext: await redactTree(snapshot.profileContext ?? {}, options, cache),
            promptType: snapshot.promptType ?? 'unknown',
            generationType: snapshot.generationType ?? 'unknown',
            payload: await redactTree(snapshot.payload ?? null, options, cache),
            finalText: await redactedString(String(snapshot.finalText ?? ''), options, cache),
            capture: captureLifecycle(snapshot.capture),
            request: {
                body: await redactTree(request.body ?? null, options, cache),
                settings: await redactTree(request.settings ?? {}, options, cache),
                bodyKeys: await redactTree(request.bodyKeys ?? [], options, cache),
                redactedPathCount: Array.isArray(request.redactedPaths)
                    ? request.redactedPaths.length
                    : 0,
                omittedMediaPathCount: Array.isArray(request.omittedMediaPaths)
                    ? request.omittedMediaPaths.length
                    : 0,
                correlationId: null,
                hadCorrelationId: Boolean(request.hadCorrelationId ?? request.correlationId),
            },
            sources: redactedSources,
            lorebookEntries: await redactTree(
                snapshot.lorebookEntries ?? [],
                options,
                cache,
            ),
            usage: cloneJsonValue(privacySafeUsage(snapshot)),
            stats: await redactTree(snapshot.stats ?? {}, options, cache),
            privacy: privacyMetadata(mode, snapshot.schemaVersion),
            privacySummary: summary,
        };
    }

    const output = canonicalJson(result, {
        limits: {
            ...options.limits,
            inputBytes: options.limits.outputBytes,
        },
    });
    if (encodedBytes(output) > options.limits.outputBytes) {
        reject('output-too-large', 'Privacy-transformed snapshot exceeds the size limit.');
    }
    return result;
}

export function scanSnapshotSeedLeaks(value, seeds, options = {}) {
    const serialized = canonicalJson(value, options);
    const seedValues = Array.isArray(seeds)
        ? seeds
        : seeds?.uniqueValues ?? [];
    const exactSeeds = new Set(seedValues.filter(Boolean));
    let leaked = false;
    const visit = (current) => {
        if (leaked) return;
        if (typeof current === 'string') {
            if (exactSeeds.has(current)) leaked = true;
            return;
        }
        if (Array.isArray(current)) {
            current.forEach(visit);
            return;
        }
        if (!isPlainObject(current)) return;
        for (const [key, child] of Object.entries(current)) {
            if (exactSeeds.has(key)) {
                leaked = true;
                return;
            }
            visit(child);
        }
    };
    visit(value);
    if (!leaked) {
        for (const seed of exactSeeds) {
            if (seed.length < 8) continue;
            const escaped = JSON.stringify(seed).slice(1, -1);
            if (escaped && serialized.includes(escaped)) {
                leaked = true;
                break;
            }
        }
    }
    return {
        safe: !leaked,
        scannedSeedCount: exactSeeds.size,
        leaked,
    };
}
