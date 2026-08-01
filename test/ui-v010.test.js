import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { serializeTimelineDiagnostics } from '../src/diagnostics.js';
import { DevToolsWindow } from '../src/ui.js';

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

function createUi(store = {}) {
    globalThis.localStorage = memoryLocalStorage();
    return new DevToolsWindow({
        getContext: () => ({ chatId: 'storage-chat' }),
        store,
        capture: { addEventListener() {} },
        version: '0.10.0-test',
    });
}

function fakeContent() {
    return {
        children: [],
        attributes: new Map(),
        id: '',
        scrollTop: 0,
        setAttribute(name, value) {
            this.attributes.set(name, String(value));
        },
        getAttribute(name) {
            return this.attributes.get(name) ?? null;
        },
        replaceChildren(...values) {
            this.children = [...values];
        },
        appendChild(value) {
            this.children.push(value);
            return value;
        },
    };
}

function fakeAppTab(id) {
    const classes = new Set();
    const attributes = new Map();
    return {
        dataset: { tab: id },
        tabIndex: -1,
        classList: {
            toggle(name, force) {
                if (force) classes.add(name);
                else classes.delete(name);
            },
            contains(name) {
                return classes.has(name);
            },
        },
        setAttribute(name, value) {
            attributes.set(name, String(value));
        },
        getAttribute(name) {
            return attributes.get(name) ?? null;
        },
    };
}

function privateSnapshot(mode) {
    const value = {
        schemaVersion: 6,
        id: `snapshot-private-${mode}`,
        chatId: `chat-private-${mode}`,
        timestamp: 1,
        provider: 'openai',
        model: 'model',
        promptType: 'chat-completion',
        generationType: 'normal',
        stats: { totalTokens: 12, structured: {} },
        privacy: { mode },
        privacySummary: {
            sourceCount: 2,
            loreEntryCount: 1,
        },
    };
    Object.defineProperty(value, 'storageChatId', {
        value: 'storage-chat',
        enumerable: false,
    });
    if (mode === 'redacted') {
        value.sources = [];
        value.finalText = '⟦STDT:redacted chars=10 bytes=10 sha256=abc⟧';
        value.payload = [];
        value.request = {};
    }
    return value;
}

test('metadata and redacted snapshots are gated before unavailable tab renderers run', () => {
    const ui = createUi();
    const limitedNotices = [];
    ui.content = fakeContent();
    ui.window = { querySelectorAll: () => [] };
    ui.renderScreenHeader = (tab) => ({ kind: 'screen-header', tab });
    ui.renderSnapshotPrivacyNotice = () => ({ kind: 'privacy-notice' });
    ui.renderMetadataOnlySnapshot = (_snapshot, notice) => {
        limitedNotices.push(notice?.kind);
        return { kind: 'metadata-limited' };
    };
    ui.renderRedactedLimitedFeature = (_snapshot, notice) => {
        limitedNotices.push(notice?.kind);
        return { kind: 'redacted-limited' };
    };
    ui.renderTimeline = () => ({ kind: 'timeline' });
    const forbidden = () => {
        throw new Error('private snapshot reached an unavailable renderer');
    };
    ui.renderExplorer = forbidden;
    ui.renderDiff = forbidden;
    ui.renderContext = forbidden;
    ui.renderRules = forbidden;
    ui.renderSearch = forbidden;

    const metadata = privateSnapshot('metadata');
    ui.timeline = [metadata];
    ui.selectedId = metadata.id;
    for (const tab of ['explorer', 'diff', 'context', 'rules', 'search']) {
        ui.activeTab = tab;
        ui.render();
        assert.deepEqual(
            ui.content.children.map(({ kind }) => kind),
            ['screen-header', 'metadata-limited'],
        );
    }
    ui.activeTab = 'timeline';
    ui.render();
    assert.deepEqual(
        ui.content.children.map(({ kind }) => kind),
        ['screen-header', 'privacy-notice', 'timeline'],
    );

    const redacted = privateSnapshot('redacted');
    ui.timeline = [redacted];
    ui.selectedId = redacted.id;
    for (const tab of ['rules', 'search']) {
        ui.activeTab = tab;
        ui.render();
        assert.deepEqual(
            ui.content.children.map(({ kind }) => kind),
            ['screen-header', 'redacted-limited'],
        );
    }
    assert.deepEqual(
        limitedNotices,
        Array(7).fill('privacy-notice'),
    );
});

test('render keeps exactly one of the six direct app tabs selected', () => {
    const ids = ['explorer', 'rules', 'timeline', 'diff', 'context', 'search'];
    const ui = createUi();
    const content = fakeContent();
    const tabs = ids.map(fakeAppTab);
    const snapshot = privateSnapshot('full');
    ui.content = content;
    ui.window = {
        querySelectorAll(selector) {
            assert.equal(selector, '.st-devtools-app-nav-item');
            return tabs;
        },
    };
    ui.timeline = [snapshot];
    ui.selectedId = snapshot.id;
    ui.renderScreenHeader = (id) => ({ kind: 'screen-header', id });
    ui.renderExplorer = () => ({ kind: 'explorer' });
    ui.renderRules = () => ({ kind: 'rules' });
    ui.renderTimeline = () => ({ kind: 'timeline' });
    ui.renderDiff = () => ({ kind: 'diff' });
    ui.renderContext = () => ({ kind: 'context' });
    ui.renderSearch = () => ({ kind: 'search' });

    for (const id of ids) {
        ui.activeTab = id;
        ui.render();

        assert.deepEqual(
            content.children.map(({ kind }) => kind),
            ['screen-header', id],
        );
        assert.equal(content.id, 'st-devtools-panel');
        assert.equal(
            content.getAttribute('aria-labelledby'),
            `st-devtools-tab-${id}`,
        );
        assert.equal(
            tabs.filter((tab) => tab.classList.contains('active')).length,
            1,
        );
        assert.equal(
            tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true').length,
            1,
        );
        assert.equal(tabs.filter((tab) => tab.tabIndex === 0).length, 1);
        for (const tab of tabs) {
            const selected = tab.dataset.tab === id;
            assert.equal(tab.classList.contains('active'), selected);
            assert.equal(tab.getAttribute('aria-selected'), String(selected));
            assert.equal(tab.tabIndex, selected ? 0 : -1);
        }
    }
});

test('non-enumerable storageChatId controls capture routing and deletion', async () => {
    const deleted = [];
    const ui = createUi({
        maxSnapshotsPerChat: 30,
        async deleteSnapshot(chatId, id) {
            deleted.push([chatId, id]);
            return true;
        },
        async getTimelinePage() {
            return {
                snapshots: [],
                totalCount: 0,
                corruptCount: 0,
            };
        },
    });
    ui.render = () => {};
    const snapshot = privateSnapshot('metadata');

    await ui.onSnapshot(snapshot);
    assert.deepEqual(ui.timeline, [snapshot]);
    await ui.deleteTimelineSnapshot(snapshot);
    assert.deepEqual(deleted, [['storage-chat', snapshot.id]]);
});

test('integrity preview exposes aggregates only and retries a stale revision', async () => {
    let inspections = 0;
    let repairs = 0;
    const confirmationMessages = [];
    const ui = createUi({
        async inspectStorageIntegrity() {
            inspections += 1;
            return {
                revision: inspections,
                repairNeeded: true,
                indexRepairNeeded: true,
                summaryRepairNeeded: true,
                counts: {
                    missingRecords: 1,
                    corruptRecords: 1,
                    validOrphans: 1,
                    invalidIndexes: 0,
                    duplicateLegacyContainers: 2,
                    conflictingLegacyContainers: 3,
                },
                issues: [{
                    id: 'private-snapshot-id',
                    chatId: 'private-chat-id',
                }],
            };
        },
        async repairStorageIntegrity() {
            repairs += 1;
            if (repairs === 1) {
                throw Object.assign(new Error('stale'), {
                    code: 'integrity-preview-stale',
                });
            }
            return {
                indexRepairNeeded: false,
                summaryRepairNeeded: false,
                counts: {
                    missingRecords: 0,
                    corruptRecords: 1,
                    validOrphans: 0,
                    invalidIndexes: 0,
                    duplicateLegacyContainers: 0,
                    conflictingLegacyContainers: 3,
                },
                repaired: true,
            };
        },
    });
    const classes = new Set();
    ui.storageToolsStatus = {
        textContent: '',
        classList: {
            toggle(name, enabled) {
                if (enabled) classes.add(name);
                else classes.delete(name);
            },
        },
        setAttribute() {},
    };
    const previousConfirm = globalThis.confirm;
    globalThis.confirm = (message) => {
        confirmationMessages.push(message);
        return true;
    };
    try {
        await ui.reviewStorageIntegrity();
    } finally {
        globalThis.confirm = previousConfirm;
    }

    assert.equal(inspections, 2);
    assert.equal(repairs, 2);
    assert.doesNotMatch(ui.storageToolsStatus.textContent, /private-/u);
    assert.match(confirmationMessages[0], /중복 레거시 컨테이너 2개/u);
    assert.match(confirmationMessages[0], /충돌 레거시 컨테이너 3개/u);
    assert.match(confirmationMessages[0], /인덱스 재작성: 필요/u);
    assert.match(confirmationMessages[0], /저장 요약 재작성: 필요/u);
    assert.match(ui.storageToolsStatus.textContent, /보존된 충돌 레거시 컨테이너 3/u);
    assert.match(ui.storageToolsStatus.textContent, /인덱스 재작성 불필요/u);
    assert.match(ui.storageToolsStatus.textContent, /저장 요약 재작성 불필요/u);
});

test('retention over-budget notice reports protected bytes even with no deletions', () => {
    const ui = createUi();

    assert.equal(ui.retentionOverBudgetText({ overBudget: false }), '');
    assert.match(ui.retentionOverBudgetText({
        overBudget: true,
        overBudgetBytes: 1536,
        deleteCount: 0,
    }), /1\.5 KB/u);
});

test('archive import retention warning is best-effort and never auto-deletes', async () => {
    let previews = 0;
    const ui = createUi({
        async getRetentionPolicyPreview() {
            previews += 1;
            return {
                deleteCount: 0,
                deleteBytes: 0,
                overBudget: true,
                overBudgetBytes: 2048,
            };
        },
    });
    ui.storageToolsStatus = {
        textContent: '',
        classList: { toggle() {} },
        setAttribute() {},
    };

    await ui.reportArchiveImportRetention({ appliedCount: 4 });

    assert.equal(previews, 1);
    assert.match(ui.storageToolsStatus.textContent, /스냅샷 4개/u);
    assert.match(ui.storageToolsStatus.textContent, /정리 후보는 0개/u);
    assert.match(ui.storageToolsStatus.textContent, /2\.0 KB/u);
    assert.match(ui.storageToolsStatus.textContent, /자동 삭제하지 않았습니다/u);

    ui.store.getRetentionPolicyPreview = async () => {
        throw new Error('preview unavailable');
    };
    await assert.doesNotReject(
        ui.reportArchiveImportRetention({ appliedCount: 2 }),
    );
    assert.match(ui.storageToolsStatus.textContent, /스냅샷 2개/u);
});

test('storage status keeps extension estimates separate from origin quota', async () => {
    const ui = createUi({
        getStatus: () => ({ type: 'indexeddb', persistent: true }),
        async getStorageSummary() {
            return {
                type: 'indexeddb',
                persistent: true,
                complete: true,
                chatCount: 1,
                snapshotCount: 2,
                approximateBytes: 100,
            };
        },
        async getStorageQuotaStatus() {
            return {
                available: true,
                scope: 'browser-origin',
                usage: 5_000,
                quota: 10_000,
            };
        },
    });
    const summary = await ui.readStorageSummary();

    assert.equal(summary.snapshotApproximateBytes, 100);
    assert.equal(summary.originStorage.scope, 'browser-origin');
    assert.equal(summary.originStorage.usage, 5_000);
    assert.notEqual(summary.approximateBytes, summary.originStorage.usage);
});

test('diagnostic comparison renders bounded aggregate counts without report ids', async () => {
    const baseSnapshot = {
        schemaVersion: 6,
        extensionVersion: '0.10.0',
        id: 'private-diagnostic-id',
        chatId: 'private-chat-id',
        timestamp: 1,
        api: 'openai',
        provider: 'openai',
        model: 'model-a',
        promptType: 'chat-completion',
        generationType: 'normal',
        capture: {},
        request: {},
        sources: [],
        stats: { totalTokens: 10, structured: {} },
    };
    const before = serializeTimelineDiagnostics([baseSnapshot], 'json');
    const after = serializeTimelineDiagnostics([{
        ...baseSnapshot,
        model: 'model-b',
        stats: { totalTokens: 20, structured: {} },
    }], 'json');
    const ui = createUi();
    ui.storageToolsStatus = {
        textContent: '',
        classList: { toggle() {} },
        setAttribute() {},
    };
    const result = await ui.compareDiagnosticFiles([
        { text: async () => before },
        { text: async () => after },
    ]);

    assert.equal(result.snapshots.changedCount, 1);
    assert.doesNotMatch(ui.storageToolsStatus.textContent, /private-/u);
});

test('v0.10 UI contracts include preview-first settings and responsive sandbox fixtures', async () => {
    const [ui, i18n, css, harness, html] = await Promise.all([
        readFile(new URL('../src/ui.js', import.meta.url), 'utf8'),
        readFile(new URL('../src/i18n.js', import.meta.url), 'utf8'),
        readFile(new URL('../style.css', import.meta.url), 'utf8'),
        readFile(new URL('../sandbox/ui-harness.js', import.meta.url), 'utf8'),
        readFile(new URL('../sandbox/index.html', import.meta.url), 'utf8'),
    ]);

    assert.match(ui, /getRetentionPolicyPreview/);
    assert.match(ui, /applyRetentionPolicy/);
    assert.match(ui, /expectedRevision:\s*preview\.revision/);
    assert.match(ui, /deleteCount > 0 \|\| overBudget/);
    assert.match(ui, /settings\.savedOverBudget/);
    assert.match(ui, /pruneResult\.overBudgetBytes/);
    assert.match(ui, /if \s*\([\s\S]*?!confirm\([\s\S]*?\)\s*\)\s*\{\s*return;/u);
    assert.ok(
        ui.indexOf('this.saveUiPreferences(requested)')
            > ui.indexOf('this.store.applyRetentionPolicy'),
    );
    assert.match(ui, /finally \{[\s\S]*?apply\.disabled = false/u);
    assert.match(ui, /snapshotArchiveReplaceConfirmationToken/);
    assert.match(ui, /reportArchiveImportRetention\(result\)/);
    assert.match(ui, /conflictPolicy/);
    assert.match(ui, /compareDiagnosticReports/);
    assert.match(i18n, /원문 제거본은 문자열을 제거·대체하는 방식/);
    assert.match(i18n, /브라우저 오리진 전체/);
    assert.match(css, /\.st-devtools-settings-tool-controls[\s\S]*?flex-wrap:\s*wrap/u);
    assert.match(css, /@media \(max-width: 700px\)[\s\S]*?width:\s*100%/u);
    assert.match(harness, /transformSnapshotPrivacy/);
    assert.match(harness, /renderPrivacyTabs/);
    assert.match(html, /sandbox-select-redacted/);
    assert.match(html, /sandbox-select-metadata/);
});
