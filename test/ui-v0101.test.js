import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
    DEFAULT_UI_PREFERENCES,
    UI_PREFERENCES_KEY,
    normalizeUiPreferences,
} from '../src/preferences.js';
import {
    PRICING_OVERRIDE_SCHEMA_VERSION,
    normalizePricingOverrides,
} from '../src/pricing-overrides.js';
import { DevToolsWindow } from '../src/ui.js';

const PRICING_KEY = 'st-devtools:pricing-overrides:v1';
const PREFERENCES_KEY = UI_PREFERENCES_KEY;

function catalog(entries = []) {
    return normalizePricingOverrides({
        version: PRICING_OVERRIDE_SCHEMA_VERSION,
        entries,
    });
}

function memoryStorage(entries = [], failPricingOnce = false) {
    const values = new Map(entries);
    let shouldFailPricing = failPricingOnce;
    return {
        getItem(key) {
            return values.has(key) ? values.get(key) : null;
        },
        setItem(key, value) {
            if (key === PRICING_KEY && shouldFailPricing) {
                shouldFailPricing = false;
                throw new Error('quota blocked');
            }
            values.set(key, String(value));
        },
        removeItem(key) {
            values.delete(key);
        },
        value(key) {
            return values.get(key) ?? null;
        },
    };
}

function usage({
    status = 'provider-reported',
    inputTokens = 1_000_000,
    outputTokens = 500_000,
    cachedInputTokens = 0,
    totalTokens = 1_500_000,
    cost = {
        status: 'unavailable',
        amount: null,
        currency: null,
        priceSource: null,
        priceAsOf: null,
    },
} = {}) {
    return {
        status,
        inputTokens,
        outputTokens,
        cachedInputTokens,
        totalTokens,
        sourceEvent: 'generation-ended',
        correlatedAt: 1_000,
        cost,
    };
}

test('pricing override loading fails closed for malformed and blocked local storage', () => {
    const ui = Object.create(DevToolsWindow.prototype);
    const malformed = ui.loadPricingOverrides({
        getItem() {
            return '{"version":1,"entries":[';
        },
    });
    const blocked = ui.loadPricingOverrides({
        getItem() {
            throw new Error('storage blocked');
        },
    });

    assert.deepEqual(malformed, { version: 1, entries: [] });
    assert.deepEqual(blocked, { version: 1, entries: [] });
});

test('settings storage commits preferences and pricing together and rolls both back on failure', () => {
    const oldPreferences = normalizeUiPreferences({
        ...DEFAULT_UI_PREFERENCES,
        themeMode: 'light',
    });
    const nextPreferences = normalizeUiPreferences({
        ...oldPreferences,
        themeMode: 'dark',
    });
    const oldPricing = catalog([{
        provider: 'openai',
        model: 'model-old',
        currency: 'USD',
        inputPerMillion: 1,
        priceAsOf: '2026-07-01',
    }]);
    const nextPricing = catalog([{
        provider: 'openai',
        model: 'model-new',
        currency: 'USD',
        outputPerMillion: 2,
        priceAsOf: '2026-07-31',
    }]);
    const oldPreferencesRaw = JSON.stringify(oldPreferences);
    const oldPricingRaw = JSON.stringify(oldPricing);
    const storage = memoryStorage([
        [PREFERENCES_KEY, oldPreferencesRaw],
        [PRICING_KEY, oldPricingRaw],
    ], true);
    const previousStorage = globalThis.localStorage;
    globalThis.localStorage = storage;
    const ui = Object.create(DevToolsWindow.prototype);
    ui.preferences = oldPreferences;
    ui.pricingOverrides = oldPricing;
    ui.pendingPricingOverrides = nextPricing;

    try {
        assert.throws(
            () => ui.saveUiPreferences(nextPreferences),
            (error) => error?.code === 'settings-storage-write-failed',
        );
        assert.equal(storage.value(PREFERENCES_KEY), oldPreferencesRaw);
        assert.equal(storage.value(PRICING_KEY), oldPricingRaw);
        assert.equal(ui.preferences, oldPreferences);
        assert.equal(ui.pricingOverrides, oldPricing);

        const saved = ui.saveUiPreferences(nextPreferences);
        assert.equal(saved.themeMode, 'dark');
        assert.deepEqual(JSON.parse(storage.value(PRICING_KEY)), nextPricing);
        assert.deepEqual(ui.pricingOverrides, nextPricing);
    } finally {
        globalThis.localStorage = previousStorage;
    }
});

test('settings storage detects silent pricing write loss and restores preferences', () => {
    const oldPreferences = normalizeUiPreferences({
        ...DEFAULT_UI_PREFERENCES,
        themeMode: 'light',
    });
    const nextPreferences = normalizeUiPreferences({
        ...oldPreferences,
        themeMode: 'dark',
    });
    const oldPricing = catalog([{
        provider: 'openai',
        model: 'model-old',
        currency: 'USD',
        inputPerMillion: 1,
        priceAsOf: '2026-07-01',
    }]);
    const nextPricing = catalog([{
        provider: 'openai',
        model: 'model-new',
        currency: 'USD',
        outputPerMillion: 2,
        priceAsOf: '2026-07-31',
    }]);
    const values = new Map([
        [PREFERENCES_KEY, JSON.stringify(oldPreferences)],
        [PRICING_KEY, JSON.stringify(oldPricing)],
    ]);
    let dropPricingWrite = true;
    const storage = {
        getItem: (key) => values.get(key) ?? null,
        setItem(key, value) {
            if (key === PRICING_KEY && dropPricingWrite) {
                dropPricingWrite = false;
                return;
            }
            values.set(key, String(value));
        },
        removeItem: (key) => values.delete(key),
    };
    const previousStorage = globalThis.localStorage;
    globalThis.localStorage = storage;
    const ui = Object.create(DevToolsWindow.prototype);
    ui.preferences = oldPreferences;
    ui.pricingOverrides = oldPricing;
    ui.pendingPricingOverrides = nextPricing;

    try {
        assert.throws(
            () => ui.saveUiPreferences(nextPreferences),
            (error) => error?.code === 'settings-storage-write-failed',
        );
        assert.deepEqual(JSON.parse(values.get(PREFERENCES_KEY)), oldPreferences);
        assert.deepEqual(JSON.parse(values.get(PRICING_KEY)), oldPricing);
        assert.equal(ui.preferences, oldPreferences);
        assert.equal(ui.pricingOverrides, oldPricing);
    } finally {
        globalThis.localStorage = previousStorage;
    }
});

test('usage view recalculates exact single-currency overrides and refuses ambiguous currencies', () => {
    const ui = Object.create(DevToolsWindow.prototype);
    ui.pricingOverrides = catalog([{
        provider: 'openai',
        model: 'gpt-test',
        currency: 'USD',
        inputPerMillion: 2,
        outputPerMillion: 6,
        priceAsOf: '2026-07-31',
    }]);
    const snapshot = {
        provider: 'openai',
        model: 'gpt-test',
        usage: usage(),
    };

    const exact = ui.snapshotUsageView(snapshot);
    assert.equal(exact.cost.status, 'catalog-estimate');
    assert.equal(exact.cost.amount, 5);
    assert.equal(exact.cost.priceSource, 'user-override');

    ui.pricingOverrides = catalog([
        ...ui.pricingOverrides.entries,
        {
            provider: 'openai',
            model: 'gpt-test',
            currency: 'KRW',
            inputPerMillion: 2_000,
            outputPerMillion: 6_000,
            priceAsOf: '2026-07-31',
        },
    ]);
    assert.equal(
        ui.snapshotUsageView(snapshot).cost.status,
        'unavailable',
    );
});

test('provider-reported cost wins and malformed snapshot usage becomes unavailable', () => {
    const ui = Object.create(DevToolsWindow.prototype);
    ui.pricingOverrides = catalog([{
        provider: 'openai',
        model: 'gpt-test',
        currency: 'USD',
        inputPerMillion: 99,
        outputPerMillion: 99,
        priceAsOf: '2026-07-31',
    }]);
    const reported = usage({
        cost: {
            status: 'provider-reported',
            amount: 0.42,
            currency: 'USD',
            priceSource: 'provider-response',
            priceAsOf: null,
        },
    });
    assert.deepEqual(
        ui.snapshotUsageView({
            provider: 'openai',
            model: 'gpt-test',
            usage: reported,
        }).cost,
        reported.cost,
    );

    const malformed = ui.snapshotUsageView({
        provider: 'openai',
        model: 'gpt-test',
        usage: { status: 'provider-reported' },
    });
    assert.equal(malformed.usage.status, 'unavailable');
    assert.equal(malformed.cost.status, 'unavailable');
});

test('v0.10.1 UI contracts expose structured pricing, usage provenance, and 430px layout', async () => {
    const [ui, i18n, css] = await Promise.all([
        readFile(new URL('../src/ui.js', import.meta.url), 'utf8'),
        readFile(new URL('../src/i18n.js', import.meta.url), 'utf8'),
        readFile(new URL('../style.css', import.meta.url), 'utf8'),
    ]);
    const pricingEditor = ui.slice(
        ui.indexOf('buildPricingSettingsEditor()'),
        ui.indexOf('buildSettingsPanel()'),
    );
    const timelineRefreshBoundary = ui.slice(
        ui.indexOf('const timelineSettingsChanged'),
        ui.indexOf('try {', ui.indexOf('const timelineSettingsChanged')),
    );

    assert.match(ui, /PRICING_OVERRIDES_KEY = `\$\{STORAGE_PREFIX\}pricing-overrides:v1`/);
    assert.match(ui, /normalizePricingOverrides\(JSON\.parse\(raw\)\)/);
    assert.match(ui, /this\.pendingPricingOverrides = requestedPricingOverrides/);
    assert.match(ui, /storage\.getItem\(PRICING_OVERRIDES_KEY\) !== pricingOverridesRaw/);
    assert.match(ui, /storage\.getItem\(V2_UI_PREFERENCES_KEY\) !== null/);
    assert.match(ui, /cost\.status !== 'provider-reported'/);
    assert.match(ui, /currencies\.size === 1/);
    assert.match(ui, /normalizeUsageRecord\(snapshot\?\.usage\)/);
    assert.match(ui, /getProviderCapabilities\(provider\)/);
    assert.match(pricingEditor, /inputPerMillion/);
    assert.match(pricingEditor, /cachedInputPerMillion/);
    assert.doesNotMatch(pricingEditor, /textarea/);
    assert.doesNotMatch(timelineRefreshBoundary, /pricing/i);
    assert.match(ui, /if \(timelineSettingsChanged\) this\.scheduleSettingsRefresh\(\)/);
    assert.match(i18n, /내장 가격이나 추정 단가는 사용하지 않습니다/);
    assert.match(i18n, /공개 생성 이벤트에는 공통 응답 본문/);
    assert.match(css, /@media \(max-width: 430px\)/);
    assert.match(css, /\.st-devtools-pricing-fields/);
    assert.match(css, /\.st-devtools-usage-token-grid/);
});
