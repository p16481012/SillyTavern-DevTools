import {
    findExactRanges,
    findNormalizedRanges,
    findTemplateRanges,
    SNAPSHOT_SCHEMA_VERSION,
    snapshotProvider,
} from './model.js';
import {
    createProviderTrace,
    legacyUnavailableProvenance,
    MAX_PROVENANCE_LOCATIONS,
    normalizeProvenanceLocation,
} from './provenance.js';
import {
    createLocalEstimatedUsage,
    createUnavailableUsage,
    MAX_USAGE_TOKENS,
    normalizeUsageRecord,
} from './provider-usage.js';
import {
    createCaptureBoundary,
    createRequestRecord,
    stripRequestCorrelationIds,
} from './request.js';

const SCHEMA_V5 = 5;
const SCHEMA_V6 = 6;
const SCHEMA_V7 = 7;
const MAX_JSON_POINTER_LENGTH = 1_024;
const MAX_PROVENANCE_ROLE_LENGTH = 64;
const MAX_PROVENANCE_LOCATION_COUNT = 100_000;
const MAX_CORRELATED_AT = 8_640_000_000_000_000;
const REQUEST_CORRELATION_KEYS = [
    'request_id',
    'requestId',
    'generation_id',
    'generationId',
    'completion_id',
    'completionId',
    'response_id',
    'responseId',
];
const REQUEST_CORRELATION_CONTAINERS = ['metadata', 'meta', '_meta', 'request_metadata'];

export class SnapshotMigrationError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'SnapshotMigrationError';
        this.code = code;
    }
}

function legacyEventName(snapshot) {
    return snapshot.promptType === 'chat-completion'
        ? 'CHAT_COMPLETION_PROMPT_READY'
        : 'GENERATE_AFTER_COMBINE_PROMPTS';
}

function validRange(range) {
    return Number.isInteger(range?.start)
        && Number.isInteger(range?.end)
        && range.start >= 0
        && range.end > range.start;
}

function validJsonPointer(value) {
    return typeof value === 'string'
        && value.length <= MAX_JSON_POINTER_LENGTH
        && (value === '' || (value.startsWith('/') && !/~(?![01])/u.test(value)));
}

function jsonPointerSegments(pointer) {
    if (!validJsonPointer(pointer)) return null;
    if (pointer === '') return [];
    return pointer
        .slice(1)
        .split('/')
        .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function resolveJsonPointer(root, pointer) {
    const segments = jsonPointerSegments(pointer);
    if (!segments) return { exists: false, value: undefined, segments: [] };
    let value = root;
    for (const segment of segments) {
        if (Array.isArray(value)) {
            if (!/^(?:0|[1-9]\d*)$/u.test(segment)) {
                return { exists: false, value: undefined, segments };
            }
            const index = Number(segment);
            if (!Number.isSafeInteger(index) || index >= value.length) {
                return { exists: false, value: undefined, segments };
            }
            value = value[index];
            continue;
        }
        if (
            !value
            || typeof value !== 'object'
            || !Object.prototype.hasOwnProperty.call(value, segment)
        ) {
            return { exists: false, value: undefined, segments };
        }
        value = value[segment];
    }
    return { exists: true, value, segments };
}

function explicitRangeIsValid(location, key) {
    return !Object.prototype.hasOwnProperty.call(location, key)
        || location[key] === null
        || validRange(location[key]);
}

function provenanceLocationIsValid(snapshot, source, location) {
    if (
        !location
        || typeof location !== 'object'
        || Array.isArray(location)
        || !explicitRangeIsValid(location, 'valueRange')
        || !explicitRangeIsValid(location, 'finalRange')
    ) {
        return false;
    }
    if (
        Object.prototype.hasOwnProperty.call(location, 'role')
        && location.role !== null
        && (
            typeof location.role !== 'string'
            || !location.role.trim()
            || location.role.length > MAX_PROVENANCE_ROLE_LENGTH
        )
    ) {
        return false;
    }

    const normalized = normalizeProvenanceLocation(location);
    if (!normalized || !validJsonPointer(normalized.jsonPointer)) return false;
    const resolved = resolveJsonPointer(snapshot, normalized.jsonPointer);
    if (!resolved.exists) return false;

    const finalText = snapshot.finalText ?? '';
    if (normalized.finalRange && normalized.finalRange.end > finalText.length) {
        return false;
    }
    if (
        normalized.valueRange
        && (
            typeof resolved.value !== 'string'
            || normalized.valueRange.end > resolved.value.length
        )
    ) {
        return false;
    }
    if (normalized.finalRange) {
        const matchesSourceRange = (source.ranges ?? []).some(
            (range) => normalized.finalRange.start >= range.start
                && normalized.finalRange.end <= range.end,
        );
        const fragment = finalText.slice(
            normalized.finalRange.start,
            normalized.finalRange.end,
        );
        const matchesSourceContent = typeof source.content === 'string'
            && source.content.includes(fragment);
        if (!matchesSourceRange && !matchesSourceContent) return false;
    }
    if (
        normalized.valueRange
        && normalized.finalRange
        && resolved.value.slice(
            normalized.valueRange.start,
            normalized.valueRange.end,
        ) !== finalText.slice(
            normalized.finalRange.start,
            normalized.finalRange.end,
        )
    ) {
        return false;
    }

    if (normalized.messageIndex != null) {
        if (
            !Array.isArray(snapshot.payload)
            || normalized.messageIndex >= snapshot.payload.length
        ) {
            return false;
        }
        const payloadIndex = resolved.segments[0] === 'payload'
            && /^(?:0|[1-9]\d*)$/u.test(resolved.segments[1] ?? '')
            ? Number(resolved.segments[1])
            : null;
        if (payloadIndex != null && payloadIndex !== normalized.messageIndex) {
            return false;
        }
        if (normalized.role) {
            const payloadRole = String(
                snapshot.payload[normalized.messageIndex]?.role ?? 'unknown',
            ).trim().toLowerCase();
            if (payloadRole !== normalized.role) return false;
        }
    }
    return true;
}

function providerEvidencePointersAreValid(snapshot) {
    const pointers = [
        snapshot.providerTrace?.selectedSource?.evidencePointer,
        snapshot.providerTrace?.upstreamProvider?.evidencePointer,
    ].filter((pointer) => pointer != null);
    return pointers.every((pointer) => (
        validJsonPointer(pointer)
        && resolveJsonPointer(snapshot, pointer).exists
    ));
}

function usageRecordsEqual(left, right) {
    const usageKeys = [
        'status',
        'inputTokens',
        'outputTokens',
        'cachedInputTokens',
        'totalTokens',
        'sourceEvent',
        'correlatedAt',
    ];
    const costKeys = ['status', 'amount', 'currency', 'priceSource', 'priceAsOf'];
    return usageKeys.every((key) => left?.[key] === right?.[key])
        && costKeys.every((key) => left?.cost?.[key] === right?.cost?.[key]);
}

function hasKnownRequestCorrelationId(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    if (REQUEST_CORRELATION_KEYS.some((key) => Object.hasOwn(value, key))) return true;
    return REQUEST_CORRELATION_CONTAINERS.some((containerKey) => {
        const container = value[containerKey];
        return container
            && typeof container === 'object'
            && !Array.isArray(container)
            && REQUEST_CORRELATION_KEYS.some((key) => Object.hasOwn(container, key));
    });
}

function assertV7UsageAndCorrelation(snapshot) {
    let normalizedUsage;
    try {
        normalizedUsage = normalizeUsageRecord(snapshot.usage);
    } catch {
        throw new SnapshotMigrationError(
            'invalid-usage',
            'Snapshot usage is not a canonical v7 usage record.',
        );
    }
    if (!usageRecordsEqual(normalizedUsage, snapshot.usage)) {
        throw new SnapshotMigrationError(
            'invalid-usage',
            'Snapshot usage is not a canonical v7 usage record.',
        );
    }
    if (
        (snapshot.capture && snapshot.capture.correlationId !== null)
        || (snapshot.request && snapshot.request.correlationId !== null)
        || hasKnownRequestCorrelationId(snapshot.request?.body)
        || hasKnownRequestCorrelationId(snapshot.request?.settings)
    ) {
        throw new SnapshotMigrationError(
            'raw-correlation-id',
            'Snapshot contains a raw request correlation identifier.',
        );
    }
}

function assertMigratableSnapshot(snapshot, {
    validateV6 = false,
    validateV7 = false,
} = {}) {
    if (snapshot.finalText != null && typeof snapshot.finalText !== 'string') {
        throw new SnapshotMigrationError(
            'invalid-final-text',
            'Snapshot finalText must be a string.',
        );
    }
    if (snapshot.sources != null && !Array.isArray(snapshot.sources)) {
        throw new SnapshotMigrationError(
            'invalid-sources',
            'Snapshot sources must be an array.',
        );
    }
    for (const source of snapshot.sources ?? []) {
        if (!source || typeof source !== 'object' || Array.isArray(source)) {
            throw new SnapshotMigrationError(
                'invalid-source',
                'Snapshot source must be an object.',
            );
        }
        if (
            source.ranges != null
            && (
                !Array.isArray(source.ranges)
                || source.ranges.some((range) => !validRange(range))
                || (
                    validateV6
                    && source.ranges.some(
                        (range) => range.end > (snapshot.finalText ?? '').length,
                    )
                )
            )
        ) {
            throw new SnapshotMigrationError(
                'invalid-source-ranges',
                'Snapshot source ranges are invalid.',
            );
        }
        if (validateV6 && source.provenance?.locations != null) {
            const locations = source.provenance.locations;
            if (
                !Array.isArray(locations)
                || locations.length > MAX_PROVENANCE_LOCATIONS
                || locations.some(
                    (location) => !provenanceLocationIsValid(snapshot, source, location),
                )
            ) {
                throw new SnapshotMigrationError(
                    'invalid-provenance-locations',
                    'Snapshot provenance locations are invalid.',
                );
            }
            const locationCount = source.provenance.locationCount;
            if (
                locationCount != null
                && (
                    !Number.isInteger(locationCount)
                    || locationCount < locations.length
                    || locationCount > MAX_PROVENANCE_LOCATION_COUNT
                )
            ) {
                throw new SnapshotMigrationError(
                    'invalid-provenance-count',
                    'Snapshot provenance location count is invalid.',
                );
            }
        }
    }
    if (validateV6 && !providerEvidencePointersAreValid(snapshot)) {
        throw new SnapshotMigrationError(
            'invalid-provider-trace',
            'Snapshot provider trace evidence pointers are invalid.',
        );
    }
    if (validateV7) assertV7UsageAndCorrelation(snapshot);
}

function legacySourceProvenance(attribution, templateMatch) {
    if (attribution === 'exact') return { method: 'exact', confidence: 1 };
    if (attribution === 'normalized') {
        return { method: 'normalized', confidence: 0.95 };
    }
    if (attribution === 'template') {
        return {
            method: templateMatch.method ?? 'macro-template',
            confidence: templateMatch.confidence ?? 0.55,
        };
    }
    if (attribution === 'unmatched') return { method: 'unmatched', confidence: 0 };
    return { method: attribution ?? 'unknown', confidence: null };
}

export function migrateV4ToV5(snapshot, originalVersion = Number(snapshot?.schemaVersion) || 1) {
    assertMigratableSnapshot(snapshot);
    if ((Number(snapshot.schemaVersion) || 1) >= SCHEMA_V5) return snapshot;

    const finalText = snapshot.finalText ?? '';
    const legacyCapture = snapshot.capture ?? createCaptureBoundary({
        eventName: legacyEventName(snapshot),
        stage: 'prompt-ready',
        requestBodyAvailable: false,
        fallback: true,
        migratedFrom: originalVersion,
    });
    const legacyRequest = snapshot.request ?? createRequestRecord(null);
    const sources = (snapshot.sources ?? []).map((source) => {
        const exactRanges = source.ranges ?? findExactRanges(finalText, source.content);
        const normalizedRanges = exactRanges.length
            ? []
            : findNormalizedRanges(finalText, source.content);
        const templateMatch = exactRanges.length || normalizedRanges.length
            ? { ranges: [], confidence: null, method: null }
            : findTemplateRanges(finalText, source.content);
        const ranges = exactRanges.length
            ? exactRanges
            : normalizedRanges.length
                ? normalizedRanges
                : templateMatch.ranges;
        const attribution = source.attribution === 'unmatched'
            ? normalizedRanges.length
                ? 'normalized'
                : templateMatch.ranges.length
                    ? 'template'
                    : source.attribution
            : source.attribution;
        return {
            ...source,
            attribution,
            ranges,
            provenance: source.provenance
                ?? legacySourceProvenance(attribution, templateMatch),
        };
    });
    const structured = snapshot.stats?.structured ?? {};
    const multimodalSources = sources.filter((source) => source.type === 'multimodal');
    const multimodalEstimates = multimodalSources
        .map((source) => source.metadata?.tokenEstimate)
        .filter((estimate) => Number.isFinite(estimate?.tokens));
    return {
        ...snapshot,
        schemaVersion: SCHEMA_V5,
        capture: {
            ...legacyCapture,
            migratedFrom: legacyCapture.migratedFrom ?? originalVersion,
            correlationId: legacyCapture.correlationId ?? null,
            correlationMethod: legacyCapture.correlationMethod
                ?? (legacyCapture.fallback ? 'prompt-only' : 'fifo'),
            requestStatus: legacyCapture.requestStatus ?? (
                legacyRequest.body
                    ? 'captured'
                    : legacyCapture.fallback
                        ? 'prompt-only-timeout'
                        : 'not-captured'
            ),
            generationStatus: legacyCapture.generationStatus ?? 'unknown',
            statusEvent: legacyCapture.statusEvent ?? null,
            statusUpdatedAt: legacyCapture.statusUpdatedAt ?? null,
        },
        request: {
            ...legacyRequest,
            omittedMediaPaths: legacyRequest.omittedMediaPaths ?? [],
            correlationId: legacyRequest.correlationId ?? null,
        },
        sources,
        stats: {
            ...snapshot.stats,
            structured: {
                toolSchemas: structured.toolSchemas
                    ?? sources.filter((source) => source.type === 'tool_schema').length,
                toolCalls: structured.toolCalls
                    ?? sources.filter((source) => source.type === 'tool_call').length,
                toolResults: structured.toolResults
                    ?? sources.filter((source) => source.type === 'tool_result').length,
                multimodalParts: structured.multimodalParts ?? multimodalSources.length,
                multimodalEstimatedTokens: structured.multimodalEstimatedTokens
                    ?? multimodalEstimates.reduce((sum, estimate) => sum + estimate.tokens, 0),
                multimodalEstimateCoverage: structured.multimodalEstimateCoverage
                    ?? (multimodalSources.length
                        ? multimodalEstimates.length / multimodalSources.length
                        : null),
            },
        },
    };
}

function legacyProviderTrace(snapshot) {
    const selectedSource = snapshotProvider(snapshot) ?? 'unknown';
    const hasProvider = typeof snapshot.provider === 'string' && snapshot.provider;
    const hasApi = typeof snapshot.api === 'string' && snapshot.api;
    return createProviderTrace({
        api: snapshot.api ?? 'unknown',
        promptType: snapshot.promptType ?? 'unknown',
        generationType: snapshot.generationType ?? 'unknown',
        selectedSource,
        selectedSourceStatus: selectedSource === 'unknown'
            ? 'unknown'
            : 'legacy-fallback',
        selectedSourcePointer: hasProvider
            ? '/provider'
            : hasApi
                ? '/api'
                : null,
    });
}

export function migrateV5ToV6(snapshot, originalVersion = Number(snapshot?.schemaVersion) || 5) {
    assertMigratableSnapshot(snapshot);
    if ((Number(snapshot.schemaVersion) || 1) >= SCHEMA_V6) return snapshot;

    const sources = (snapshot.sources ?? []).map((source) => {
        const metadata = source.type === 'assistant_prefill'
            ? {
                ...(source.metadata ?? {}),
                inferred: source.metadata?.prefillStatus === 'confirmed'
                    ? false
                    : source.metadata?.inferred !== false,
                prefillStatus: source.metadata?.prefillStatus === 'confirmed'
                    ? 'confirmed'
                    : 'inferred',
            }
            : source.metadata;
        return {
            ...source,
            ...(metadata !== undefined ? { metadata } : {}),
            provenance: legacyUnavailableProvenance(
                source.provenance
                    ?? legacySourceProvenance(source.attribution, {}),
            ),
        };
    });

    return {
        ...snapshot,
        schemaVersion: SCHEMA_V6,
        capture: snapshot.capture
            ? {
                ...snapshot.capture,
                migratedFrom: snapshot.capture.migratedFrom ?? originalVersion,
            }
            : snapshot.capture,
        providerTrace: snapshot.providerTrace ?? legacyProviderTrace(snapshot),
        sources,
    };
}

function legacyUsage(snapshot) {
    const totalTokens = snapshot.stats?.totalTokens;
    const correlatedAt = Number.isSafeInteger(snapshot.timestamp)
        && snapshot.timestamp >= 0
        && snapshot.timestamp <= MAX_CORRELATED_AT
        ? snapshot.timestamp
        : null;
    if (
        Number.isSafeInteger(totalTokens)
        && totalTokens >= 0
        && totalTokens <= MAX_USAGE_TOKENS
    ) {
        return createLocalEstimatedUsage({
            inputTokens: totalTokens,
            outputTokens: null,
            cachedInputTokens: null,
            totalTokens: null,
        }, {
            sourceEvent: 'legacy-snapshot-token-count',
            correlatedAt,
        });
    }
    return createUnavailableUsage();
}

function migratedRequest(request) {
    if (!request) return request;
    const hasBody = Object.hasOwn(request, 'body');
    const hasSettings = Object.hasOwn(request, 'settings');
    const body = hasBody ? stripRequestCorrelationIds(request.body) : undefined;
    const settings = hasSettings ? stripRequestCorrelationIds(request.settings) : undefined;
    return {
        ...request,
        ...(hasBody ? { body } : {}),
        ...(hasSettings ? { settings } : {}),
        ...(hasBody ? {
            bodyKeys: body && typeof body === 'object' && !Array.isArray(body)
                ? Object.keys(body)
                : [],
        } : {}),
        correlationId: null,
        hadCorrelationId: Boolean(request.hadCorrelationId || request.correlationId),
    };
}

export function migrateV6ToV7(snapshot) {
    assertMigratableSnapshot(snapshot, { validateV6: true });
    if ((Number(snapshot.schemaVersion) || 1) >= SCHEMA_V7) return snapshot;
    const migrated = {
        ...snapshot,
        schemaVersion: SCHEMA_V7,
        ...(snapshot.capture !== undefined ? {
            capture: snapshot.capture
                ? {
                    ...snapshot.capture,
                    correlationId: null,
                    hadCorrelationId: Boolean(
                        snapshot.capture.hadCorrelationId
                        || snapshot.capture.correlationId,
                    ),
                }
                : snapshot.capture,
        } : {}),
        ...(snapshot.request !== undefined
            ? { request: migratedRequest(snapshot.request) }
            : {}),
        usage: legacyUsage(snapshot),
    };
    assertMigratableSnapshot(migrated, { validateV6: true, validateV7: true });
    return migrated;
}

export function migrateSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        return snapshot;
    }
    const version = Number(snapshot.schemaVersion) || 1;
    if (version >= SNAPSHOT_SCHEMA_VERSION) {
        if (version === SNAPSHOT_SCHEMA_VERSION) {
            assertMigratableSnapshot(snapshot, { validateV6: true, validateV7: true });
        }
        return snapshot;
    }

    let migrated = snapshot;
    if (version < SCHEMA_V5) {
        migrated = migrateV4ToV5(migrated, version);
    }
    if ((Number(migrated.schemaVersion) || 1) < SCHEMA_V6) {
        migrated = migrateV5ToV6(migrated, version);
    }
    if ((Number(migrated.schemaVersion) || 1) < SCHEMA_V7) {
        migrated = migrateV6ToV7(migrated);
    }
    assertMigratableSnapshot(migrated, { validateV6: true, validateV7: true });
    return migrated;
}

export function migrateTimeline(timeline) {
    let changed = false;
    const snapshots = (timeline ?? []).map((snapshot) => {
        const migrated = migrateSnapshot(snapshot);
        if (migrated !== snapshot) changed = true;
        return migrated;
    });
    return { snapshots, changed };
}
