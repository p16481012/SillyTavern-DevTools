export const UI_PREFERENCES_KEY = 'st-devtools:preferences:v2';
export const LEGACY_UI_PREFERENCES_KEY = 'st-devtools:preferences:v1';
export const MIN_TIMELINE_READ_LIMIT = 1;
export const MAX_TIMELINE_READ_LIMIT = 100;
export const MIN_TIMELINE_RETENTION_LIMIT = 1;
export const MAX_TIMELINE_RETENTION_LIMIT = 100;
export const LEGACY_TIMELINE_RETENTION_LIMIT = 100;
export const PANEL_THEME_MODES = Object.freeze(['auto', 'light', 'dark']);
export const DEFAULT_UI_PREFERENCES = Object.freeze({
    timelineRetentionLimit: 30,
    timelineReadLimit: 20,
    themeMode: 'auto',
});

function clampInteger(value, fallback, minimum, maximum) {
    const requested = Number(value);
    return Number.isFinite(requested)
        ? Math.min(maximum, Math.max(minimum, Math.trunc(requested)))
        : fallback;
}

export function normalizeUiPreferences(value = {}) {
    const timelineRetentionLimit = clampInteger(
        value?.timelineRetentionLimit,
        DEFAULT_UI_PREFERENCES.timelineRetentionLimit,
        MIN_TIMELINE_RETENTION_LIMIT,
        MAX_TIMELINE_RETENTION_LIMIT,
    );
    const timelineReadLimit = Math.min(
        timelineRetentionLimit,
        clampInteger(
            value?.timelineReadLimit,
            DEFAULT_UI_PREFERENCES.timelineReadLimit,
            MIN_TIMELINE_READ_LIMIT,
            MAX_TIMELINE_READ_LIMIT,
        ),
    );
    const requestedThemeMode = String(value?.themeMode ?? '');
    const themeMode = PANEL_THEME_MODES.includes(requestedThemeMode)
        ? requestedThemeMode
        : DEFAULT_UI_PREFERENCES.themeMode;
    return { timelineRetentionLimit, timelineReadLimit, themeMode };
}

export function migrateLegacyUiPreferences(value = {}) {
    return normalizeUiPreferences({
        ...value,
        timelineRetentionLimit: LEGACY_TIMELINE_RETENTION_LIMIT,
    });
}
