import {
    findExactRanges,
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
    return {
        ...snapshot,
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        capture: snapshot.capture ?? createCaptureBoundary({
            eventName: legacyEventName(snapshot),
            stage: 'prompt-ready',
            requestBodyAvailable: false,
            fallback: true,
            migratedFrom: Number(snapshot.schemaVersion) || 1,
        }),
        request: snapshot.request ?? createRequestRecord(null),
        sources: (snapshot.sources ?? []).map((source) => ({
            ...source,
            ranges: source.ranges ?? findExactRanges(finalText, source.content),
        })),
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
