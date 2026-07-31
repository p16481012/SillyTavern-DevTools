import {
    normalizeSemanticConnectionProfileId,
} from './semantic-connection-profiles.js';

export const UI_PREFERENCES_KEY = 'st-devtools:preferences:v5';
export const V4_UI_PREFERENCES_KEY = 'st-devtools:preferences:v4';
export const V3_UI_PREFERENCES_KEY = 'st-devtools:preferences:v3';
export const V2_UI_PREFERENCES_KEY = 'st-devtools:preferences:v2';
export const V1_UI_PREFERENCES_KEY = 'st-devtools:preferences:v1';
// Kept for callers that only know about one previous preference version.
export const LEGACY_UI_PREFERENCES_KEY = V4_UI_PREFERENCES_KEY;
export const MIN_TIMELINE_READ_LIMIT = 1;
export const MAX_TIMELINE_READ_LIMIT = 5_000;
export const MIN_TIMELINE_RETENTION_LIMIT = 1;
export const MAX_TIMELINE_RETENTION_LIMIT = 5_000;
export const LEGACY_TIMELINE_RETENTION_LIMIT = 100;
export const MIN_RETENTION_MAX_AGE_DAYS = 1;
export const MAX_RETENTION_MAX_AGE_DAYS = 3_650;
export const MAX_RETENTION_MAX_BYTES = 2_147_483_648;
export const MIN_SEMANTIC_RESPONSE_TOKEN_CAP = 64;
export const MAX_SEMANTIC_RESPONSE_TOKEN_CAP = 2_048;
export const DEFAULT_SEMANTIC_RESPONSE_TOKEN_CAP = 512;
export const PANEL_THEME_MODES = Object.freeze(['auto', 'light', 'dark']);
export const SNAPSHOT_CAPTURE_MODES = Object.freeze([
    'full',
    'redacted',
    'metadata',
]);
export const DEFAULT_UI_PREFERENCES = Object.freeze({
    timelineRetentionLimit: 30,
    timelineReadLimit: 20,
    retentionMaxAgeDays: 0,
    retentionMaxBytes: 0,
    captureMode: 'full',
    themeMode: 'auto',
    semanticInspectorEnabled: false,
    semanticResponseTokenCap: DEFAULT_SEMANTIC_RESPONSE_TOKEN_CAP,
    // null deliberately means "use the connection currently active in SillyTavern".
    semanticConnectionProfileId: null,
});

function clampInteger(value, fallback, minimum, maximum) {
    const requested = Number(value);
    return Number.isFinite(requested)
        ? Math.min(maximum, Math.max(minimum, Math.trunc(requested)))
        : fallback;
}

function clampDisabledInteger(value, fallback, maximum, minimumWhenEnabled = 1) {
    const requested = Number(value);
    if (!Number.isFinite(requested)) return fallback;
    const integer = Math.trunc(requested);
    if (integer <= 0) return 0;
    return Math.min(maximum, Math.max(minimumWhenEnabled, integer));
}

export { normalizeSemanticConnectionProfileId };

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
    const retentionMaxAgeDays = clampDisabledInteger(
        value?.retentionMaxAgeDays,
        DEFAULT_UI_PREFERENCES.retentionMaxAgeDays,
        MAX_RETENTION_MAX_AGE_DAYS,
        MIN_RETENTION_MAX_AGE_DAYS,
    );
    const retentionMaxBytes = clampDisabledInteger(
        value?.retentionMaxBytes,
        DEFAULT_UI_PREFERENCES.retentionMaxBytes,
        MAX_RETENTION_MAX_BYTES,
    );
    const requestedCaptureMode = String(value?.captureMode ?? '');
    const captureMode = SNAPSHOT_CAPTURE_MODES.includes(requestedCaptureMode)
        ? requestedCaptureMode
        : DEFAULT_UI_PREFERENCES.captureMode;
    const semanticInspectorEnabled = value?.semanticInspectorEnabled === true;
    const semanticResponseTokenCap = clampInteger(
        value?.semanticResponseTokenCap,
        DEFAULT_UI_PREFERENCES.semanticResponseTokenCap,
        MIN_SEMANTIC_RESPONSE_TOKEN_CAP,
        MAX_SEMANTIC_RESPONSE_TOKEN_CAP,
    );
    const semanticConnectionProfileId = normalizeSemanticConnectionProfileId(
        value?.semanticConnectionProfileId,
    );
    return {
        timelineRetentionLimit,
        timelineReadLimit,
        retentionMaxAgeDays,
        retentionMaxBytes,
        captureMode,
        themeMode,
        semanticInspectorEnabled,
        semanticResponseTokenCap,
        semanticConnectionProfileId,
    };
}

export function migrateV4UiPreferences(value = {}) {
    return normalizeUiPreferences(value);
}

export function migrateV3UiPreferences(value = {}) {
    return normalizeUiPreferences(value);
}

export function migrateV2UiPreferences(value = {}) {
    return normalizeUiPreferences(value);
}

export function migrateV1UiPreferences(value = {}) {
    return normalizeUiPreferences({
        ...value,
        timelineRetentionLimit: LEGACY_TIMELINE_RETENTION_LIMIT,
    });
}

export function migrateLegacyUiPreferences(value = {}) {
    return Object.prototype.hasOwnProperty.call(value ?? {}, 'timelineRetentionLimit')
        ? migrateV2UiPreferences(value)
        : migrateV1UiPreferences(value);
}

export function readUiPreferencesFromStorage(storage = globalThis.localStorage) {
    const read = (key) => {
        try {
            return JSON.parse(storage?.getItem?.(key) ?? 'null');
        } catch {
            return null;
        }
    };
    const current = read(UI_PREFERENCES_KEY);
    if (current) return normalizeUiPreferences(current);
    const v4 = read(V4_UI_PREFERENCES_KEY);
    if (v4) return migrateV4UiPreferences(v4);
    const v3 = read(V3_UI_PREFERENCES_KEY);
    if (v3) return migrateV3UiPreferences(v3);
    const v2 = read(V2_UI_PREFERENCES_KEY);
    if (v2) return migrateV2UiPreferences(v2);
    const v1 = read(V1_UI_PREFERENCES_KEY);
    if (v1) return migrateV1UiPreferences(v1);
    return normalizeUiPreferences(DEFAULT_UI_PREFERENCES);
}

export function legacyUiPreferencesForExistingData() {
    return migrateV1UiPreferences({
        timelineReadLimit: DEFAULT_UI_PREFERENCES.timelineReadLimit,
        themeMode: DEFAULT_UI_PREFERENCES.themeMode,
    });
}
