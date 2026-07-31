import {
    MAX_TIMELINE_RETENTION_LIMIT,
    normalizeUiPreferences,
} from './preferences.js';

export function automaticRetentionPolicyFromPreferences(value) {
    const preferences = normalizeUiPreferences(value);
    return {
        maxSnapshotsPerChat: MAX_TIMELINE_RETENTION_LIMIT,
        maxAgeDays: preferences.retentionMaxAgeDays,
        maxTotalBytes: preferences.retentionMaxBytes,
    };
}

/**
 * Keep non-count limits current without silently applying a destructive count
 * change that did not pass through the settings preview and confirmation flow.
 * SnapshotStore's capture-time count limit remains the configured user value.
 */
export async function applyAutomaticRetentionMaintenance(store, value) {
    const preferences = normalizeUiPreferences(value);
    const configuredCount = preferences.timelineRetentionLimit;
    store.setMaxSnapshotsPerChat?.(configuredCount);
    if (
        preferences.retentionMaxAgeDays === 0
        && preferences.retentionMaxBytes === 0
    ) {
        return null;
    }
    if (typeof store.applyRetentionPolicy !== 'function') return null;

    try {
        return await store.applyRetentionPolicy(
            automaticRetentionPolicyFromPreferences(preferences),
        );
    } finally {
        store.setMaxSnapshotsPerChat?.(configuredCount);
    }
}
