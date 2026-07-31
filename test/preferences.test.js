import assert from 'node:assert/strict';
import test from 'node:test';
import {
    DEFAULT_UI_PREFERENCES,
    LEGACY_TIMELINE_RETENTION_LIMIT,
    MAX_RETENTION_MAX_AGE_DAYS,
    MAX_RETENTION_MAX_BYTES,
    MAX_TIMELINE_READ_LIMIT,
    MAX_TIMELINE_RETENTION_LIMIT,
    migrateLegacyUiPreferences,
    migrateV4UiPreferences,
    migrateV3UiPreferences,
    migrateV1UiPreferences,
    migrateV2UiPreferences,
    legacyUiPreferencesForExistingData,
    normalizeUiPreferences,
    normalizeSemanticConnectionProfileId,
    readUiPreferencesFromStorage,
} from '../src/preferences.js';

test('retention and read limits use separate defaults and clamp to supported ranges', () => {
    assert.deepEqual(normalizeUiPreferences(), DEFAULT_UI_PREFERENCES);
    assert.deepEqual(normalizeUiPreferences({
        timelineRetentionLimit: 0,
        timelineReadLimit: 999,
    }), {
        timelineRetentionLimit: 1,
        timelineReadLimit: 1,
        retentionMaxAgeDays: 0,
        retentionMaxBytes: 0,
        captureMode: 'full',
        themeMode: 'auto',
        semanticInspectorEnabled: false,
        semanticResponseTokenCap: 512,
        semanticConnectionProfileId: null,
    });
    assert.deepEqual(normalizeUiPreferences({
        timelineRetentionLimit: 12.9,
        timelineReadLimit: 8.8,
    }), {
        timelineRetentionLimit: 12,
        timelineReadLimit: 8,
        retentionMaxAgeDays: 0,
        retentionMaxBytes: 0,
        captureMode: 'full',
        themeMode: 'auto',
        semanticInspectorEnabled: false,
        semanticResponseTokenCap: 512,
        semanticConnectionProfileId: null,
    });
    assert.deepEqual(normalizeUiPreferences({
        timelineRetentionLimit: 999,
        timelineReadLimit: 999,
    }), {
        timelineRetentionLimit: 999,
        timelineReadLimit: 999,
        retentionMaxAgeDays: 0,
        retentionMaxBytes: 0,
        captureMode: 'full',
        themeMode: 'auto',
        semanticInspectorEnabled: false,
        semanticResponseTokenCap: 512,
        semanticConnectionProfileId: null,
    });
    assert.equal(
        normalizeUiPreferences({
            timelineRetentionLimit: Number.MAX_SAFE_INTEGER,
        }).timelineRetentionLimit,
        MAX_TIMELINE_RETENTION_LIMIT,
    );
    assert.equal(
        normalizeUiPreferences({
            timelineRetentionLimit: MAX_TIMELINE_RETENTION_LIMIT,
            timelineReadLimit: Number.MAX_SAFE_INTEGER,
        }).timelineReadLimit,
        MAX_TIMELINE_READ_LIMIT,
    );
});

test('invalid limits return to defaults and reads cannot exceed retention', () => {
    assert.deepEqual(normalizeUiPreferences({
        timelineRetentionLimit: 'not-a-number',
        timelineReadLimit: 'not-a-number',
    }), DEFAULT_UI_PREFERENCES);
    assert.equal(normalizeUiPreferences({
        timelineRetentionLimit: 7,
        timelineReadLimit: 20,
    }).timelineReadLimit, 7);
    assert.equal(normalizeUiPreferences({ themeMode: 'light' }).themeMode, 'light');
    assert.equal(normalizeUiPreferences({ themeMode: 'dark' }).themeMode, 'dark');
    assert.equal(normalizeUiPreferences({ themeMode: 'unknown' }).themeMode, 'auto');
});

test('v0.8.9 read preferences retain the legacy 100 snapshot storage cap', () => {
    assert.deepEqual(migrateLegacyUiPreferences({ timelineReadLimit: 7 }), {
        timelineRetentionLimit: LEGACY_TIMELINE_RETENTION_LIMIT,
        timelineReadLimit: 7,
        retentionMaxAgeDays: 0,
        retentionMaxBytes: 0,
        captureMode: 'full',
        themeMode: 'auto',
        semanticInspectorEnabled: false,
        semanticResponseTokenCap: 512,
        semanticConnectionProfileId: null,
    });
});

test('v4 through v1 preferences migrate non-destructively to v5 defaults', () => {
    assert.deepEqual(migrateV4UiPreferences({
        timelineRetentionLimit: 36,
        semanticConnectionProfileId: 'profile-from-v4-compatible-data',
    }), {
        ...DEFAULT_UI_PREFERENCES,
        timelineRetentionLimit: 36,
        timelineReadLimit: 20,
        semanticConnectionProfileId: 'profile-from-v4-compatible-data',
    });
    assert.deepEqual(migrateV3UiPreferences({
        timelineRetentionLimit: 42,
        semanticInspectorEnabled: true,
        semanticResponseTokenCap: 768,
    }), {
        ...DEFAULT_UI_PREFERENCES,
        timelineRetentionLimit: 42,
        timelineReadLimit: 20,
        semanticInspectorEnabled: true,
        semanticResponseTokenCap: 768,
    });
    assert.deepEqual(migrateV2UiPreferences({
        timelineRetentionLimit: 81,
        timelineReadLimit: 17,
        themeMode: 'dark',
    }), {
        timelineRetentionLimit: 81,
        timelineReadLimit: 17,
        retentionMaxAgeDays: 0,
        retentionMaxBytes: 0,
        captureMode: 'full',
        themeMode: 'dark',
        semanticInspectorEnabled: false,
        semanticResponseTokenCap: 512,
        semanticConnectionProfileId: null,
    });
    assert.deepEqual(migrateV1UiPreferences({
        timelineReadLimit: 9,
        themeMode: 'light',
    }), {
        timelineRetentionLimit: LEGACY_TIMELINE_RETENTION_LIMIT,
        timelineReadLimit: 9,
        retentionMaxAgeDays: 0,
        retentionMaxBytes: 0,
        captureMode: 'full',
        themeMode: 'light',
        semanticInspectorEnabled: false,
        semanticResponseTokenCap: 512,
        semanticConnectionProfileId: null,
    });
});

test('semantic connection selection stores only a bounded opaque profile id', () => {
    assert.equal(normalizeSemanticConnectionProfileId('profile-id'), 'profile-id');
    assert.equal(normalizeSemanticConnectionProfileId(''), null);
    assert.equal(normalizeSemanticConnectionProfileId('bad\nprofile'), null);
    assert.equal(normalizeSemanticConnectionProfileId('x'.repeat(257)), null);
    assert.equal(normalizeSemanticConnectionProfileId({ id: 'not-a-string' }), null);

    const selected = normalizeUiPreferences({
        semanticConnectionProfileId: 'opaque-profile-id',
        semanticConnectionProfile: {
            name: 'must not be persisted',
            secret: 'must not be persisted',
        },
    });
    assert.equal(selected.semanticConnectionProfileId, 'opaque-profile-id');
    assert.equal(Object.hasOwn(selected, 'semanticConnectionProfile'), false);
});

test('age, byte and capture policies clamp safely and use zero as disabled', () => {
    assert.deepEqual(normalizeUiPreferences({
        retentionMaxAgeDays: -4,
        retentionMaxBytes: 0,
        captureMode: 'metadata',
    }), {
        ...DEFAULT_UI_PREFERENCES,
        retentionMaxAgeDays: 0,
        captureMode: 'metadata',
    });
    const maximums = normalizeUiPreferences({
        retentionMaxAgeDays: Number.MAX_SAFE_INTEGER,
        retentionMaxBytes: Number.MAX_SAFE_INTEGER,
        captureMode: 'redacted',
    });
    assert.equal(maximums.retentionMaxAgeDays, MAX_RETENTION_MAX_AGE_DAYS);
    assert.equal(maximums.retentionMaxBytes, MAX_RETENTION_MAX_BYTES);
    assert.equal(maximums.captureMode, 'redacted');
    assert.equal(normalizeUiPreferences({
        captureMode: 'unknown',
    }).captureMode, 'full');
});

test('storage reads fall through malformed newer preferences without lowering legacy retention', () => {
    const values = new Map([
        ['st-devtools:preferences:v5', '{malformed'],
        ['st-devtools:preferences:v4', JSON.stringify({
            timelineRetentionLimit: 77,
            timelineReadLimit: 10,
            semanticConnectionProfileId: 'saved-profile',
        })],
        ['st-devtools:preferences:v3', '{malformed'],
        ['st-devtools:preferences:v2', JSON.stringify({
            timelineRetentionLimit: 88,
            timelineReadLimit: 11,
            themeMode: 'dark',
        })],
    ]);
    const preferences = readUiPreferencesFromStorage({
        getItem: (key) => values.get(key) ?? null,
    });

    assert.equal(preferences.timelineRetentionLimit, 77);
    assert.equal(preferences.timelineReadLimit, 10);
    assert.equal(preferences.semanticConnectionProfileId, 'saved-profile');
    assert.equal(
        legacyUiPreferencesForExistingData().timelineRetentionLimit,
        LEGACY_TIMELINE_RETENTION_LIMIT,
    );
});
