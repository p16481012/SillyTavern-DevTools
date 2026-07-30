import {
    findExactRanges,
    findNormalizedRanges,
    findTemplateRanges,
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
        const provenance = source.provenance ?? (
            attribution === 'exact'
                ? { method: 'exact', confidence: 1 }
                : attribution === 'normalized'
                    ? { method: 'normalized', confidence: 0.95 }
                    : attribution === 'template'
                        ? {
                            method: templateMatch.method ?? 'macro-template',
                            confidence: templateMatch.confidence ?? 0.55,
                        }
                        : attribution === 'unmatched'
                            ? { method: 'unmatched', confidence: 0 }
                            : { method: attribution ?? 'unknown', confidence: null }
        );
        return {
            ...source,
            attribution,
            ranges,
            provenance,
        };
    });
    const structured = snapshot.stats?.structured ?? {};
    const multimodalSources = sources.filter((source) => source.type === 'multimodal');
    const multimodalEstimates = multimodalSources
        .map((source) => source.metadata?.tokenEstimate)
        .filter((estimate) => Number.isFinite(estimate?.tokens));
    return {
        ...snapshot,
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        capture: {
            ...legacyCapture,
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

export function migrateTimeline(timeline) {
    let changed = false;
    const snapshots = (timeline ?? []).map((snapshot) => {
        const migrated = migrateSnapshot(snapshot);
        if (migrated !== snapshot) changed = true;
        return migrated;
    });
    return { snapshots, changed };
}
