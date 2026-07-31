import assert from 'node:assert/strict';
import test from 'node:test';
import { DevToolsWindow } from '../src/ui.js';

function snapshot(id, chatId, timestamp = 1) {
    return {
        schemaVersion: 4,
        id,
        chatId,
        timestamp,
        sources: [],
        stats: {
            totalTokens: 0,
            structured: {},
        },
    };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function memoryLocalStorage() {
    const values = new Map();
    return {
        get length() {
            return values.size;
        },
        key(index) {
            return [...values.keys()][index] ?? null;
        },
        getItem(key) {
            return values.has(key) ? values.get(key) : null;
        },
        setItem(key, value) {
            values.set(key, String(value));
        },
        removeItem(key) {
            values.delete(key);
        },
    };
}

function createWindow({ current, store }) {
    globalThis.localStorage = memoryLocalStorage();
    const devTools = new DevToolsWindow({
        getContext: () => ({ chatId: current.chatId }),
        store,
        capture: { addEventListener() {} },
        version: 'test',
    });
    devTools.render = () => {};
    return devTools;
}

test('review changes stay in the policy draft until the user applies it', () => {
    globalThis.localStorage = memoryLocalStorage();
    const devTools = new DevToolsWindow({
        getContext: () => ({ chatId: 'chat-a' }),
        store: {},
        capture: { addEventListener() {} },
        version: 'test',
    });
    devTools.render = () => {};
    devTools.comparisonPolicyDirty = true;
    const currentSnapshot = {
        ...snapshot('review', 'chat-a'),
        sources: [{
            id: 'source:one',
            type: 'utility',
            label: 'Prompt one',
            content: 'Use Korean.',
            metadata: {
                sourceKind: 'configuredPrompt',
                identifier: 'prompt-one',
            },
        }],
    };
    const finding = {
        id: 'language:one',
        ruleId: 'language',
        sourceIds: ['source:one'],
        evidence: 'Use Korean.',
    };

    devTools.updateFindingDecision(
        currentSnapshot,
        finding,
        'false-positive',
    );

    assert.equal(devTools.findingReviewDocument.decisions.length, 0);
    assert.equal(devTools.pendingImportedReviews.decisions.length, 1);
    assert.equal(devTools.comparisonPolicyDirty, true);

    const applied = devTools.commitPolicyDraft();
    assert.equal(applied.ok, true);
    assert.equal(devTools.findingReviewDocument.decisions.length, 1);
    assert.equal(devTools.pendingImportedReviews, null);
    assert.equal(devTools.comparisonPolicyDirty, false);
});

test('a delayed refresh for chat A cannot overwrite a newer chat B timeline', async () => {
    const current = { chatId: 'chat-a' };
    const pendingA = deferred();
    const calls = [];
    const store = {
        getTimeline(chatId) {
            calls.push(chatId);
            return chatId === 'chat-a'
                ? pendingA.promise
                : Promise.resolve([snapshot('b', 'chat-b')]);
        },
    };
    const devTools = createWindow({ current, store });

    const refreshA = devTools.refresh();
    current.chatId = 'chat-b';
    await devTools.refresh();
    assert.deepEqual(devTools.timeline.map(({ id }) => id), ['b']);

    pendingA.resolve([snapshot('a', 'chat-a')]);
    await refreshA;

    assert.deepEqual(calls, ['chat-a', 'chat-b']);
    assert.deepEqual(devTools.timeline.map(({ id }) => id), ['b']);
});

test('refresh migrates v0.8.9 read settings without lowering retention', async () => {
    globalThis.localStorage = memoryLocalStorage();
    localStorage.setItem(
        'st-devtools:preferences:v1',
        JSON.stringify({ timelineReadLimit: 7 }),
    );
    const calls = [];
    const retentionLimits = [];
    const devTools = new DevToolsWindow({
        getContext: () => ({ chatId: 'chat-a' }),
        store: {
            setMaxSnapshotsPerChat(limit) {
                retentionLimits.push(limit);
            },
            async getTimelinePage(chatId, options) {
                calls.push([chatId, options]);
                return {
                    snapshots: Array.from(
                        { length: 7 },
                        (_, index) => snapshot(`recent-${index}`, chatId, index),
                    ),
                    totalCount: 42,
                };
            },
        },
        capture: { addEventListener() {} },
        version: 'test',
    });
    devTools.render = () => {};

    assert.equal(await devTools.refresh(), true);
    assert.deepEqual(calls, [['chat-a', { limit: 7 }]]);
    assert.equal(devTools.timeline.length, 7);
    assert.equal(devTools.timelineTotalCount, 42);
    assert.deepEqual(retentionLimits, [100]);
    assert.equal(localStorage.getItem('st-devtools:preferences:v1'), null);
    assert.deepEqual(
        JSON.parse(localStorage.getItem('st-devtools:preferences:v3')),
        {
            timelineRetentionLimit: 100,
            timelineReadLimit: 7,
            retentionMaxAgeDays: 0,
            retentionMaxBytes: 0,
            captureMode: 'full',
            themeMode: 'auto',
        },
    );
});

test('a fresh profile configures the new 30 snapshot retention default', () => {
    globalThis.localStorage = memoryLocalStorage();
    const limits = [];
    const devTools = new DevToolsWindow({
        getContext: () => ({ chatId: 'chat-a' }),
        store: {
            setMaxSnapshotsPerChat(limit) {
                limits.push(limit);
            },
        },
        capture: { addEventListener() {} },
        version: 'test',
    });

    assert.equal(devTools.preferences.timelineRetentionLimit, 30);
    assert.equal(devTools.preferences.timelineReadLimit, 20);
    assert.equal(devTools.preferences.themeMode, 'auto');
    assert.deepEqual(limits, [30]);
});

test('timeline refresh is not blocked by a slow all-chat storage summary', async () => {
    const current = { chatId: 'chat-a' };
    const pendingSummary = deferred();
    let summaryReads = 0;
    const devTools = createWindow({
        current,
        store: {
            async getTimeline() {
                return [snapshot('ready', 'chat-a')];
            },
            getStorageSummary() {
                summaryReads += 1;
                return pendingSummary.promise;
            },
        },
    });
    devTools.root = { hidden: false };
    devTools.activeTab = 'timeline';

    assert.equal(await devTools.refresh(), true);
    assert.deepEqual(devTools.timeline.map(({ id }) => id), ['ready']);
    assert.equal(summaryReads, 1);

    pendingSummary.resolve({
        type: 'indexeddb',
        persistent: true,
        complete: true,
        chatCount: 1,
        snapshotCount: 1,
        approximateBytes: 100,
    });
    await devTools.storageSummaryRefreshPromise;
});

test('non-timeline tabs do not request a storage summary during refresh', async () => {
    const current = { chatId: 'chat-a' };
    let summaryReads = 0;
    const devTools = createWindow({
        current,
        store: {
            async getTimeline() {
                return [snapshot('ready', 'chat-a')];
            },
            async getStorageSummary() {
                summaryReads += 1;
                return {};
            },
        },
    });
    devTools.root = { hidden: false };
    devTools.activeTab = 'rules';

    assert.equal(await devTools.refresh(), true);
    assert.equal(summaryReads, 0);
});

test('visible snapshot updates render before a slow summary and coalesce refreshes', async () => {
    const current = { chatId: 'chat-a' };
    const pendingSummary = deferred();
    let summaryReads = 0;
    let renders = 0;
    const devTools = createWindow({
        current,
        store: {
            getStorageSummary() {
                summaryReads += 1;
                return pendingSummary.promise;
            },
        },
    });
    devTools.root = { hidden: false };
    devTools.activeTab = 'timeline';
    devTools.render = () => {
        renders += 1;
    };

    await devTools.onSnapshot(snapshot('new', 'chat-a'));
    const duplicateRefresh = devTools.refreshStorageSummary();

    assert.deepEqual(devTools.timeline.map(({ id }) => id), ['new']);
    assert.equal(renders, 1);
    assert.equal(summaryReads, 1);

    pendingSummary.resolve({
        type: 'indexeddb',
        persistent: true,
        complete: true,
        chatCount: 1,
        snapshotCount: 1,
        approximateBytes: 100,
    });
    await duplicateRefresh;
});

test('bulk-delete retry stays bound to chat A and cannot mutate chat B', async () => {
    const current = { chatId: 'chat-a' };
    const calls = [];
    let attempts = 0;
    const store = {
        async deleteSnapshots(chatId, ids) {
            calls.push([chatId, [...ids]]);
            attempts += 1;
            if (attempts === 1) throw new Error('temporary failure');
            return ids.length;
        },
        async getTimeline() {
            return [];
        },
    };
    const devTools = createWindow({ current, store });
    devTools.timeline = [snapshot('shared', 'chat-a')];
    devTools.selectedId = 'shared';
    devTools.selectedTimelineIds = new Set(['shared']);
    devTools.timelineSelectionChatId = 'chat-a';

    await devTools.deleteSelectedTimelineSnapshots();
    const retry = devTools.storageErrors.find(({ id }) => id === 'delete:selected')?.retry;
    assert.equal(typeof retry, 'function');

    current.chatId = 'chat-b';
    devTools.timeline = [snapshot('shared', 'chat-b')];
    devTools.selectedId = 'shared';
    devTools.selectedTimelineIds = new Set(['shared']);
    devTools.timelineSelectionChatId = 'chat-b';
    await retry();

    assert.deepEqual(calls, [
        ['chat-a', ['shared']],
        ['chat-a', ['shared']],
    ]);
    assert.deepEqual(devTools.timeline.map(({ chatId }) => chatId), ['chat-b']);
    assert.equal(devTools.selectedId, 'shared');
});

test('bulk deletion reconciles the UI with storage when the deleted count is partial', async () => {
    const current = { chatId: 'chat-a' };
    const remaining = [snapshot('keep', 'chat-a', 2)];
    const store = {
        async deleteSnapshots() {
            return 1;
        },
        async getTimeline() {
            return remaining;
        },
    };
    const devTools = createWindow({ current, store });
    devTools.timeline = [
        snapshot('removed-now', 'chat-a'),
        snapshot('already-missing', 'chat-a'),
        ...remaining,
    ];
    devTools.selectedId = 'already-missing';
    devTools.selectedTimelineIds = new Set(['removed-now', 'already-missing']);
    devTools.timelineSelectionChatId = 'chat-a';

    assert.equal(
        await devTools.deleteSelectedTimelineSnapshots(['removed-now', 'already-missing']),
        true,
    );
    assert.deepEqual(devTools.timeline.map(({ id }) => id), ['keep']);
    assert.equal(devTools.selectedId, 'keep');
    assert.deepEqual([...devTools.selectedTimelineIds], []);
});

test('single-delete retry stays bound to chat A and cannot delete chat B', async () => {
    const current = { chatId: 'chat-a' };
    const calls = [];
    let attempts = 0;
    const store = {
        async deleteSnapshot(chatId, id) {
            calls.push([chatId, id]);
            attempts += 1;
            if (attempts === 1) throw new Error('temporary failure');
            return true;
        },
    };
    const devTools = createWindow({ current, store });
    const snapshotA = snapshot('shared', 'chat-a');
    devTools.timeline = [snapshotA];
    devTools.selectedId = 'shared';

    await devTools.deleteTimelineSnapshot(snapshotA);
    const retry = devTools.storageErrors.find(({ id }) => id === 'delete:shared')?.retry;
    assert.equal(typeof retry, 'function');

    current.chatId = 'chat-b';
    devTools.timeline = [snapshot('shared', 'chat-b')];
    devTools.selectedId = 'shared';
    await retry();

    assert.deepEqual(calls, [
        ['chat-a', 'shared'],
        ['chat-a', 'shared'],
    ]);
    assert.deepEqual(devTools.timeline.map(({ chatId }) => chatId), ['chat-b']);
    assert.equal(devTools.selectedId, 'shared');
});

test('clear retry stays bound to chat A and cannot clear chat B UI state', async () => {
    const current = { chatId: 'chat-a' };
    const calls = [];
    let attempts = 0;
    const store = {
        async clearTimeline(chatId) {
            calls.push(chatId);
            attempts += 1;
            if (attempts === 1) throw new Error('temporary failure');
        },
    };
    const devTools = createWindow({ current, store });
    devTools.timeline = [snapshot('a', 'chat-a')];
    devTools.selectedId = 'a';

    await devTools.clearCurrentTimeline();
    const retry = devTools.storageErrors.find(({ id }) => id === 'clear-timeline')?.retry;
    assert.equal(typeof retry, 'function');

    current.chatId = 'chat-b';
    devTools.timeline = [snapshot('b', 'chat-b')];
    devTools.selectedId = 'b';
    await retry();

    assert.deepEqual(calls, ['chat-a', 'chat-a']);
    assert.deepEqual(devTools.timeline.map(({ id }) => id), ['b']);
    assert.equal(devTools.selectedId, 'b');
});

test('clear from a stale chat A view refreshes chat B without deleting either chat', async () => {
    const current = { chatId: 'chat-a' };
    const calls = [];
    const timelineB = [snapshot('b', 'chat-b')];
    const store = {
        async clearTimeline(chatId) {
            calls.push(['clear', chatId]);
        },
        async getTimeline(chatId) {
            calls.push(['read', chatId]);
            return timelineB;
        },
    };
    const devTools = createWindow({ current, store });
    devTools.timeline = [snapshot('a', 'chat-a')];
    devTools.selectedId = 'a';
    devTools.timelineSelectionChatId = 'chat-a';

    current.chatId = 'chat-b';
    assert.equal(await devTools.clearCurrentTimeline(), false);

    assert.deepEqual(calls, [['read', 'chat-b']]);
    assert.deepEqual(devTools.timeline.map(({ id }) => id), ['b']);
    assert.equal(devTools.selectedId, 'b');
});

test('a lifecycle update replaces its snapshot without stealing the current selection', async () => {
    const current = { chatId: 'chat-a' };
    const devTools = createWindow({
        current,
        store: {
            async getTimeline() {
                return [];
            },
        },
    });
    devTools.timeline = [
        snapshot('older', 'chat-a', 1),
        snapshot('selected', 'chat-a', 2),
    ];
    devTools.selectedId = 'selected';

    await devTools.onSnapshot({
        ...snapshot('older', 'chat-a', 1),
        capture: { generationStatus: 'ended' },
    });

    assert.equal(devTools.selectedId, 'selected');
    assert.equal(
        devTools.timeline.find(({ id }) => id === 'older').capture.generationStatus,
        'ended',
    );
});

test('hidden panels defer the all-chat storage scan until the next refresh', async () => {
    const current = { chatId: 'chat-a' };
    let summaryReads = 0;
    const devTools = createWindow({
        current,
        store: {
            async getStorageSummary() {
                summaryReads += 1;
                return {};
            },
        },
    });

    await devTools.onSnapshot(snapshot('new', 'chat-a'));

    assert.equal(summaryReads, 0);
    assert.deepEqual(devTools.timeline.map(({ id }) => id), ['new']);
});

test('clear-all resets current UI only after every stored timeline is removed', async () => {
    const current = { chatId: 'chat-a' };
    let cleared = false;
    const devTools = createWindow({
        current,
        store: {
            async clearAll() {
                cleared = true;
                return { chatCount: 2, snapshotCount: 3 };
            },
            async getStorageSummary() {
                return {
                    type: 'memory',
                    persistent: false,
                    chatCount: cleared ? 0 : 2,
                    snapshotCount: cleared ? 0 : 3,
                    approximateBytes: cleared ? 0 : 1024,
                };
            },
        },
    });
    devTools.timeline = [snapshot('selected', 'chat-a')];
    devTools.selectedId = 'selected';
    devTools.selectedTimelineIds = new Set(['selected']);
    localStorage.setItem('st-devtools:rule-settings:v1', '{"private":"setting"}');
    localStorage.setItem('st-devtools:comparison-policy:v1', '{"nameRules":[{"pattern":"private"}]}');
    localStorage.setItem('st-devtools:future-setting', 'remove');
    localStorage.setItem('unrelated-setting', 'keep');

    assert.equal(await devTools.clearAllSnapshots(), true);
    assert.deepEqual(devTools.timeline, []);
    assert.equal(devTools.selectedId, null);
    assert.deepEqual([...devTools.selectedTimelineIds], []);
    assert.equal(devTools.storageSummary.snapshotCount, 0);
    assert.equal(devTools.storageSummary.localSettingCount, 0);
    assert.equal(localStorage.getItem('st-devtools:rule-settings:v1'), null);
    assert.equal(localStorage.getItem('st-devtools:comparison-policy:v1'), null);
    assert.equal(localStorage.getItem('st-devtools:future-setting'), null);
    assert.equal(localStorage.getItem('unrelated-setting'), 'keep');
    assert.deepEqual(devTools.comparisonPolicySettings.nameRules, []);
});

test('a late storage summary cannot overwrite the cleared-all zero state', async () => {
    const current = { chatId: 'chat-a' };
    const pendingSummary = deferred();
    const devTools = createWindow({
        current,
        store: {
            getStorageSummary() {
                return pendingSummary.promise;
            },
            async clearAll() {
                return { chatCount: 1, snapshotCount: 4 };
            },
        },
    });
    devTools.root = { hidden: false };
    devTools.activeTab = 'timeline';
    const staleRefresh = devTools.refreshStorageSummary();

    assert.equal(await devTools.clearAllSnapshots(), true);
    pendingSummary.resolve({
        type: 'indexeddb',
        persistent: true,
        complete: true,
        chatCount: 9,
        snapshotCount: 99,
        approximateBytes: 999,
    });
    await staleRefresh;

    assert.equal(devTools.storageSummary.chatCount, 0);
    assert.equal(devTools.storageSummary.snapshotCount, 0);
    assert.equal(devTools.storageSummary.approximateBytes, 0);
});

test('storage summary includes ST DevTools local settings but excludes unrelated keys', async () => {
    const current = { chatId: 'chat-a' };
    const devTools = createWindow({
        current,
        store: {
            async getStorageSummary() {
                return {
                    type: 'indexeddb',
                    persistent: true,
                    chatCount: 1,
                    snapshotCount: 1,
                    approximateBytes: 100,
                };
            },
        },
    });
    localStorage.setItem('st-devtools:rule-settings:v1', '{"enabled":true}');
    localStorage.setItem('unrelated-setting', 'not-counted');

    const summary = await devTools.readStorageSummary();

    assert.equal(summary.localSettingCount, 1);
    assert.equal(summary.snapshotApproximateBytes, 100);
    assert.equal(summary.approximateBytes > 100, true);
});

test('failed clear-all keeps the current timeline available for retry', async () => {
    const current = { chatId: 'chat-a' };
    const devTools = createWindow({
        current,
        store: {
            async clearAll() {
                throw new Error('temporary failure');
            },
        },
    });
    devTools.timeline = [snapshot('keep', 'chat-a')];
    devTools.selectedId = 'keep';

    assert.equal(await devTools.clearAllSnapshots(), false);
    assert.deepEqual(devTools.timeline.map(({ id }) => id), ['keep']);
    assert.equal(devTools.selectedId, 'keep');
    assert.equal(
        typeof devTools.storageErrors.find(({ id }) => id === 'clear-all')?.retry,
        'function',
    );
});
