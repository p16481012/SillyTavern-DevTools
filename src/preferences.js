export const UI_PREFERENCES_KEY = 'st-devtools:preferences:v1';
export const MIN_TIMELINE_READ_LIMIT = 1;
export const MAX_TIMELINE_READ_LIMIT = 100;
export const DEFAULT_UI_PREFERENCES = Object.freeze({
    timelineReadLimit: 20,
});

export function normalizeUiPreferences(value = {}) {
    const requestedLimit = Number(value?.timelineReadLimit);
    const timelineReadLimit = Number.isFinite(requestedLimit)
        ? Math.min(
            MAX_TIMELINE_READ_LIMIT,
            Math.max(MIN_TIMELINE_READ_LIMIT, Math.trunc(requestedLimit)),
        )
        : DEFAULT_UI_PREFERENCES.timelineReadLimit;
    return { timelineReadLimit };
}
