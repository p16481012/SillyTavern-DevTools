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
    migrateV1UiPreferences,
    migrateV2UiPreferences,
    legacyUiPreferencesForExistingData,
    normalizeUiPreferences,
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
    });
});

test('v2 and v1 preferences migrate non-destructively to v3 defaults', () => {
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
    });
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

    assert.equal(preferences.timelineRetentionLimit, 88);
    assert.equal(preferences.timelineReadLimit, 11);
    assert.equal(preferences.themeMode, 'dark');
    assert.equal(
        legacyUiPreferencesForExistingData().timelineRetentionLimit,
        LEGACY_TIMELINE_RETENTION_LIMIT,
    );
});
