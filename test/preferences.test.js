import assert from 'node:assert/strict';
import test from 'node:test';
import {
    DEFAULT_UI_PREFERENCES,
    LEGACY_TIMELINE_RETENTION_LIMIT,
    migrateLegacyUiPreferences,
    normalizeUiPreferences,
} from '../src/preferences.js';

test('retention and read limits use separate defaults and clamp to supported ranges', () => {
    assert.deepEqual(normalizeUiPreferences(), DEFAULT_UI_PREFERENCES);
    assert.deepEqual(normalizeUiPreferences({
        timelineRetentionLimit: 0,
        timelineReadLimit: 999,
    }), {
        timelineRetentionLimit: 1,
        timelineReadLimit: 1,
        themeMode: 'auto',
    });
    assert.deepEqual(normalizeUiPreferences({
        timelineRetentionLimit: 12.9,
        timelineReadLimit: 8.8,
    }), {
        timelineRetentionLimit: 12,
        timelineReadLimit: 8,
        themeMode: 'auto',
    });
    assert.deepEqual(normalizeUiPreferences({
        timelineRetentionLimit: 999,
        timelineReadLimit: 999,
    }), {
        timelineRetentionLimit: 100,
        timelineReadLimit: 100,
        themeMode: 'auto',
    });
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
        themeMode: 'auto',
    });
});
