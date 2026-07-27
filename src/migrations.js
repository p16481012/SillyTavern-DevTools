import {
    findExactRanges,
    findNormalizedRanges,
    SNAPSHOT_SCHEMA_VERSION,
} from './model.js';
import { createCaptureBoundary, createRequestRecord } from './request.js';

function legacyEventName(snapshot) {
    return snapshot.promptType === 'chat-completion'
        ? 'CHAT_COMPLETION_PROMPT_READY'
        : 'GENERATE_AFTER_COMBINE_PROMPTS';
}

export function migrateSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
        return snapshot;
    }
    if ((Number(snapshot.schemaVersion) || 1) >= SNAPSHOT_SCHEMA_VERSION) {
        return snapshot;
    }

    const finalText = snapshot.finalText ?? '';
    const legacyVersion = Number(snapshot.schemaVersion) || 1;
    const legacyCapture = snapshot.capture ?? createCaptureBoundary({
        eventName: legacyEventName(snapshot),
        stage: 'prompt-ready',
        requestBodyAvailable: false,
        fallback: true,
        migratedFrom: legacyVersion,
    });
    const legacyRequest = snapshot.request ?? createRequestRecord(null);
    const sources = (snapshot.sources ?? []).map((source) => {
        const exactRanges = source.ranges ?? findExactRanges(finalText, source.content);
        const normalizedRanges = exactRanges.length
            ? []
            : findNormalizedRanges(finalText, source.content);
        return {
            ...source,
            attribution: source.attribution === 'unmatched' && normalizedRanges.length
                ? 'normalized'
                : source.attribution,
            ranges: exactRanges.length ? exactRanges : normalizedRanges,
        };
    });
    return {
        ...snapshot,
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        capture: {
            ...legacyCapture,
            correlationId: legacyCapture.correlationId ?? null,
            correlationMethod: legacyCapture.correlationMethod
                ?? (legacyCapture.fallback ? 'prompt-only' : 'fifo'),
        },
        request: {
            ...legacyRequest,
            omittedMediaPaths: legacyRequest.omittedMediaPaths ?? [],
            correlationId: legacyRequest.correlationId ?? null,
        },
        sources,
        stats: {
            ...snapshot.stats,
            structured: snapshot.stats?.structured ?? {
                toolSchemas: sources.filter((source) => source.type === 'tool_schema').length,
                toolCalls: sources.filter((source) => source.type === 'tool_call').length,
                toolResults: sources.filter((source) => source.type === 'tool_result').length,
                multimodalParts: sources.filter((source) => source.type === 'multimodal').length,
            },
        },
    };
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
