import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
    UI_PREFERENCES_KEY,
    V2_UI_PREFERENCES_KEY,
} from '../src/preferences.js';
import { DevToolsWindow } from '../src/ui.js';
import { VirtualListMetrics } from '../src/virtual-list.js';

function memoryStorage(entries = []) {
    const values = new Map(entries);
    return {
        get length() {
            return values.size;
        },
        key(index) {
            return [...values.keys()][index] ?? null;
        },
        getItem(key) {
            return values.get(key) ?? null;
        },
        setItem(key, value) {
            values.set(key, String(value));
        },
        removeItem(key) {
            values.delete(key);
        },
    };
}

function createUi({
    storage = memoryStorage(),
    analysisWorkerClass = null,
    analysisTimeoutMs = 100,
} = {}) {
    globalThis.localStorage = storage;
    return new DevToolsWindow({
        getContext: () => ({ chatId: 'performance-chat' }),
        store: {},
        capture: { addEventListener() {} },
        version: '0.10.0-test',
        analysisWorkerClass,
        analysisTimeoutMs,
    });
}

function analysisSnapshot(content, finalText = content) {
    return {
        schemaVersion: 6,
        id: 'same-id',
        timestamp: 1,
        chatId: 'performance-chat',
        finalText,
        sources: [{
            id: 'same-source',
            type: 'utility',
            label: 'Rule',
            content,
            included: true,
            configuredEnabled: true,
            tokenCount: 5,
            metadata: {},
            ranges: [{ start: 0, end: content.length }],
        }],
        lorebookEntries: [],
        stats: { totalTokens: 5, contextUsage: 0.1 },
    };
}

test('UI preference loading falls through malformed v3 and persists valid v2', () => {
    const storage = memoryStorage([
        [UI_PREFERENCES_KEY, '{malformed'],
        [V2_UI_PREFERENCES_KEY, JSON.stringify({
            timelineRetentionLimit: 88,
            timelineReadLimit: 11,
            themeMode: 'dark',
        })],
    ]);
    const ui = createUi({ storage });

    assert.equal(ui.preferences.timelineRetentionLimit, 88);
    assert.equal(ui.preferences.timelineReadLimit, 11);
    assert.equal(ui.preferences.themeMode, 'dark');
    assert.equal(storage.getItem(V2_UI_PREFERENCES_KEY), null);
    assert.deepEqual(
        JSON.parse(storage.getItem(UI_PREFERENCES_KEY)),
        ui.preferences,
    );
});

test('analysis references hash complete content, not ids or text lengths', () => {
    const ui = createUi();
    const prefix = 'a'.repeat(100_000);
    const left = analysisSnapshot(`${prefix}x`, 'same-size-A');
    const right = analysisSnapshot(`${prefix}y`, 'same-size-B');

    const leftDigest = ui.analysisSnapshotReference(left);
    const rightDigest = ui.analysisSnapshotReference(right);
    assert.notEqual(leftDigest, rightDigest);

    const leftKey = ui.analysisCacheKey('search', [left], {
        query: 'private search phrase',
    });
    const rightKey = ui.analysisCacheKey('search', [right], {
        query: 'private search phrase',
    });
    assert.notEqual(leftKey, rightKey);
    assert.doesNotMatch(leftKey, /same-id|private|aaaa/u);
    assert.match(leftKey, /^analysis:v1:search:/u);
});

test('UI revision changes abort an in-flight worker and reject its stale result', async () => {
    class PendingWorker {
        static instances = [];

        constructor(_url, options) {
            this.options = options;
            this.listeners = new Map();
            this.terminated = false;
            PendingWorker.instances.push(this);
        }

        addEventListener(type, callback) {
            this.listeners.set(type, callback);
        }

        removeEventListener(type, callback) {
            if (this.listeners.get(type) === callback) {
                this.listeners.delete(type);
            }
        }

        postMessage(message) {
            this.message = message;
        }

        terminate() {
            this.terminated = true;
        }
    }

    const ui = createUi({ analysisWorkerClass: PendingWorker });
    const snapshot = analysisSnapshot('search target');
    const pending = ui.runUiAnalysis('search', {
        snapshot: { sources: snapshot.sources },
        query: 'target',
        options: {},
    }, {
        snapshots: [snapshot],
        configuration: { query: 'target', options: {} },
    });
    const worker = PendingWorker.instances.at(-1);
    assert.deepEqual(worker.options, {
        type: 'module',
        name: 'st-devtools-analysis-search',
    });

    ui.invalidateAnalysisState();
    await assert.rejects(pending, { code: 'analysis-cancelled' });
    assert.equal(worker.terminated, true);
    assert.equal(ui.analysisControllers.size, 0);
    assert.equal(ui.analysisCache.size, 0);
});

test('500 and 5,000 row fixtures keep virtual DOM windows bounded', () => {
    for (const itemCount of [500, 5_000]) {
        const fixtures = Array.from(
            { length: itemCount },
            (_, index) => ({ id: `fixture-${index}` }),
        );
        const metrics = new VirtualListMetrics({
            itemCount: fixtures.length,
            estimatedRowHeight: 92,
            overscan: 6,
        });
        const first = metrics.getWindow({
            scrollTop: 0,
            viewportHeight: 720,
        });
        const middle = metrics.getWindow({
            scrollTop: metrics.totalHeight() / 2,
            viewportHeight: 720,
        });
        assert.equal(first.visibleCount < 30, true);
        assert.equal(middle.visibleCount < 30, true);
        assert.equal(middle.totalCount, itemCount);
    }
});

test('tab changes preserve selection while pruning removes only missing ids', () => {
    const ui = createUi();
    ui.timeline = [
        { id: 'keep' },
        { id: 'delete' },
    ];
    ui.timelineSelectionChatId = 'performance-chat';
    ui.selectedTimelineIds = new Set(['keep', 'delete']);

    ui.selectTab('search');
    assert.deepEqual(
        [...ui.selectedTimelineIds].sort(),
        ['delete', 'keep'],
    );

    ui.timeline = [{ id: 'keep' }];
    ui.pruneTimelineSelection();
    assert.deepEqual([...ui.selectedTimelineIds], ['keep']);
});

test('performance UI and deterministic sandbox retain bounded async contracts', async () => {
    const [ui, runtime, css, harness] = await Promise.all([
        readFile(new URL('../src/ui.js', import.meta.url), 'utf8'),
        readFile(new URL('../src/analysis-runtime.js', import.meta.url), 'utf8'),
        readFile(new URL('../style.css', import.meta.url), 'utf8'),
        readFile(new URL('../sandbox/ui-harness.js', import.meta.url), 'utf8'),
    ]);

    assert.match(ui, /new AnalysisRuntime\(\{/u);
    assert.match(ui, /new AnalysisCache\(\)/u);
    assert.match(ui, /new VirtualListMetrics\(\{/u);
    assert.match(runtime, /type:\s*'module'/u);
    assert.match(ui, /revision !== this\.analysisRevision/u);
    assert.match(ui, /!page\.isConnected/u);
    assert.match(ui, /this\.disposeVirtualLists\(\)/u);
    assert.match(ui, /attachLazyDetailsContent\(snapshots/u);
    assert.match(ui, /this\.mountVirtualList\(list, timelineItems/u);
    assert.match(ui, /this\.mountVirtualList\(\s*sourceList/u);
    assert.match(ui, /snapshot:\s*this\.analysisRuleSnapshot\(snapshot\)/u);
    assert.match(css, /\.st-devtools-virtual-list\s*\{[^}]*overflow:\s*auto/su);

    assert.match(harness, /fixtureCount\('fixtureSize', 3, 5_000\)/u);
    assert.match(harness, /fixtureCount\('sourceCount', 2, 5_000\)/u);
    assert.match(harness, /createCompactStressSnapshot/u);
    assert.match(harness, /applyStressSources/u);
    assert.match(harness, /dataset\.stressFixture/u);
});
