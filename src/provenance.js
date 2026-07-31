export const MAX_PROVENANCE_LOCATIONS = 50;

function finiteInteger(value) {
    return Number.isInteger(value) && value >= 0 ? value : null;
}

function normalizedRange(value) {
    if (!value || typeof value !== 'object') return null;
    const start = finiteInteger(value.start);
    const end = finiteInteger(value.end);
    if (start == null || end == null || end <= start) return null;
    return { start, end };
}

function normalizedRole(value) {
    if (typeof value !== 'string') return null;
    const role = value.trim().toLowerCase();
    return role || null;
}

export function escapeJsonPointerSegment(value) {
    return String(value).replaceAll('~', '~0').replaceAll('/', '~1');
}

export function jsonPointer(...segments) {
    if (segments.length === 0) return '';
    return `/${segments.map(escapeJsonPointerSegment).join('/')}`;
}

export function normalizeProvenanceLocation(value) {
    if (!value || typeof value !== 'object') return null;
    const pointer = typeof value.jsonPointer === 'string'
        && (value.jsonPointer === '' || value.jsonPointer.startsWith('/'))
        ? value.jsonPointer
        : null;
    if (pointer == null) return null;

    const messageIndex = value.messageIndex == null
        ? null
        : finiteInteger(value.messageIndex);
    if (value.messageIndex != null && messageIndex == null) return null;

    return {
        jsonPointer: pointer,
        messageIndex,
        role: normalizedRole(value.role),
        valueRange: normalizedRange(value.valueRange),
        finalRange: normalizedRange(value.finalRange),
    };
}

function locationKey(location) {
    const valueRange = location.valueRange
        ? `${location.valueRange.start}:${location.valueRange.end}`
        : '';
    const finalRange = location.finalRange
        ? `${location.finalRange.start}:${location.finalRange.end}`
        : '';
    return [
        location.jsonPointer,
        location.messageIndex ?? '',
        location.role ?? '',
        valueRange,
        finalRange,
    ].join('|');
}

export function attachProvenanceLocations(
    provenance,
    values,
    {
        availability = null,
        limit = MAX_PROVENANCE_LOCATIONS,
    } = {},
) {
    const boundedLimit = Math.max(0, Math.min(
        MAX_PROVENANCE_LOCATIONS,
        Number.isFinite(limit) ? Math.trunc(limit) : MAX_PROVENANCE_LOCATIONS,
    ));
    const locations = [];
    const seen = new Set();
    let locationCount = 0;
    for (const value of values ?? []) {
        const location = normalizeProvenanceLocation(value);
        if (!location) continue;
        const key = locationKey(location);
        if (seen.has(key)) continue;
        seen.add(key);
        locationCount += 1;
        if (locations.length < boundedLimit) locations.push(location);
    }

    return {
        ...(provenance ?? {}),
        availability: availability
            ?? (locationCount > 0 ? 'available' : provenance?.availability ?? 'unavailable'),
        locations,
        locationCount,
        locationsTruncated: locationCount > locations.length,
    };
}

export function legacyUnavailableProvenance(provenance = {}) {
    const {
        locations: _locations,
        locationCount: _locationCount,
        locationsTruncated: _locationsTruncated,
        ...legacy
    } = provenance ?? {};
    return attachProvenanceLocations(legacy, [], {
        availability: 'legacy-unavailable',
    });
}

export function createProviderTrace({
    api,
    promptType,
    generationType = 'unknown',
    selectedSource,
    selectedSourceStatus = 'unknown',
    selectedSourcePointer = null,
}) {
    return {
        transport: {
            api: typeof api === 'string' && api ? api : 'unknown',
            promptType: typeof promptType === 'string' && promptType
                ? promptType
                : 'unknown',
            generationType: typeof generationType === 'string' && generationType
                ? generationType
                : 'unknown',
        },
        selectedSource: {
            value: typeof selectedSource === 'string' && selectedSource
                ? selectedSource
                : 'unknown',
            status: selectedSourceStatus,
            evidencePointer: typeof selectedSourcePointer === 'string'
                ? selectedSourcePointer
                : null,
        },
        upstreamProvider: {
            value: null,
            status: 'unknown',
            evidencePointer: null,
        },
    };
}
