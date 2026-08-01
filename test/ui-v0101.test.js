import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
    DEFAULT_UI_PREFERENCES,
    UI_PREFERENCES_KEY,
    normalizeUiPreferences,
} from '../src/preferences.js';
import { DevToolsWindow } from '../src/ui.js';

const PRICING_KEY = 'st-devtools:pricing-overrides:v1';

function memoryStorage(entries = [], failPreferencesOnce = false) {
    const values = new Map(entries);
    let shouldFail = failPreferencesOnce;
    return {
        getItem: (key) => values.get(key) ?? null,
        setItem(key, value) {
            if (key === UI_PREFERENCES_KEY && shouldFail) {
                shouldFail = false;
                throw new Error('quota blocked');
            }
            values.set(key, String(value));
        },
        removeItem: (key) => values.delete(key),
        value: (key) => values.get(key) ?? null,
    };
}

function usage(cost = {
    status: 'unavailable',
    amount: null,
    currency: null,
    priceSource: null,
    priceAsOf: null,
}) {
    return {
        status: 'provider-reported',
        inputTokens: 1_000,
        outputTokens: 500,
        cachedInputTokens: 0,
        totalTokens: 1_500,
        sourceEvent: 'generation-ended',
        correlatedAt: 1_000,
        cost,
    };
}

test('settings save preferences without modifying legacy pricing data', () => {
    const previousStorage = globalThis.localStorage;
    const oldPreferences = normalizeUiPreferences({
        ...DEFAULT_UI_PREFERENCES,
        themeMode: 'light',
    });
    const nextPreferences = normalizeUiPreferences({
        ...oldPreferences,
        themeMode: 'dark',
    });
    const oldPricingRaw = '{"version":1,"entries":[{"legacy":true}]}';
    const storage = memoryStorage([
        [UI_PREFERENCES_KEY, JSON.stringify(oldPreferences)],
        [PRICING_KEY, oldPricingRaw],
    ], true);
    globalThis.localStorage = storage;
    const ui = Object.create(DevToolsWindow.prototype);
    ui.preferences = oldPreferences;
    try {
        assert.throws(
            () => ui.saveUiPreferences(nextPreferences),
            (error) => error?.code === 'settings-storage-write-failed',
        );
        assert.deepEqual(ui.preferences, oldPreferences);
        assert.equal(storage.value(PRICING_KEY), oldPricingRaw);

        assert.equal(ui.saveUiPreferences(nextPreferences).themeMode, 'dark');
        assert.equal(storage.value(PRICING_KEY), oldPricingRaw);
    } finally {
        globalThis.localStorage = previousStorage;
    }
});

test('usage view preserves only stored provider cost and never applies a user table', () => {
    const ui = Object.create(DevToolsWindow.prototype);
    ui.pricingOverrides = {
        version: 1,
        entries: [{ provider: 'openai', model: 'gpt-test', inputPerMillion: 99 }],
    };
    assert.equal(ui.snapshotUsageView({ usage: usage() }).cost.status, 'unavailable');

    const reported = {
        status: 'provider-reported',
        amount: 0.42,
        currency: 'USD',
        priceSource: 'provider-response',
        priceAsOf: null,
    };
    assert.deepEqual(ui.snapshotUsageView({ usage: usage(reported) }).cost, reported);
});

test('v0.12.3 UI omits pricing controls and override cost calculation', async () => {
    const [ui, css] = await Promise.all([
        readFile(new URL('../src/ui.js', import.meta.url), 'utf8'),
        readFile(new URL('../style.css', import.meta.url), 'utf8'),
    ]);
    const settingsPanel = ui.slice(
        ui.indexOf('buildSettingsPanel()'),
        ui.indexOf('setStorageToolsStatus('),
    );
    const usageView = ui.slice(
        ui.indexOf('    snapshotUsageView(snapshot) {'),
        ui.indexOf('    renderUsageCard(snapshot) {'),
    );

    assert.doesNotMatch(settingsPanel, /pricingEditor|buildPricingSettingsEditor/);
    assert.doesNotMatch(usageView, /pricingOverrides|calculateUsageCost|currencies/);
    assert.match(usageView, /normalizeUsageRecord\(snapshot\?\.usage\)/);
    assert.match(css, /@media \(max-width: 430px\)/);
    assert.match(css, /\.st-devtools-usage-token-grid/);
});
