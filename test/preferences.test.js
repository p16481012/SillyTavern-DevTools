import assert from 'node:assert/strict';
import test from 'node:test';
import {
    DEFAULT_UI_PREFERENCES,
    normalizeUiPreferences,
} from '../src/preferences.js';

test('timeline read limit defaults to 20 and clamps to the supported range', () => {
    assert.deepEqual(normalizeUiPreferences(), DEFAULT_UI_PREFERENCES);
    assert.equal(normalizeUiPreferences({ timelineReadLimit: 0 }).timelineReadLimit, 1);
    assert.equal(normalizeUiPreferences({ timelineReadLimit: 12.9 }).timelineReadLimit, 12);
    assert.equal(normalizeUiPreferences({ timelineReadLimit: 999 }).timelineReadLimit, 100);
});

test('invalid timeline read limits return to the default', () => {
    assert.equal(
        normalizeUiPreferences({ timelineReadLimit: 'not-a-number' }).timelineReadLimit,
        DEFAULT_UI_PREFERENCES.timelineReadLimit,
    );
});
