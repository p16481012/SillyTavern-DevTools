import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DevToolsWindow } from '../src/ui.js';

function memoryLocalStorage() {
    const values = new Map();
    return {
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

test('v0.10.0 UI exposes provenance, provider, prefill, and structured diff views', async () => {
    const ui = await readFile(new URL('../src/ui.js', import.meta.url), 'utf8');
    const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
    const i18n = await readFile(new URL('../src/i18n.js', import.meta.url), 'utf8');

    assert.match(ui, /renderProvenanceDetails\(source\)/);
    assert.match(ui, /attachLazyDetailsContent\(details, \(\) => \{/);
    assert.match(ui, /provenance\.locationsTruncated/);
    assert.match(ui, /location\.jsonPointer/);
    assert.match(ui, /renderProviderTrace\(snapshot\)/);
    assert.match(ui, /context\.selectedGenerationSource/);
    assert.match(ui, /context\.upstreamProvider/);
    assert.match(ui, /explorer\.prefillStatus/);
    assert.match(ui, /change\.metadataChanges/);
    assert.match(ui, /lore\.changed/);
    assert.match(ui, /storage\.corruptSnapshotsDescription/);

    assert.match(css, /\.st-devtools-provenance-details/);
    assert.match(css, /\.st-devtools-provider-trace-grid/);
    assert.match(css, /\.st-devtools-field-change-table-wrap/);
    assert.match(css, /\.st-devtools-lore-changed-card/);
    assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.st-devtools-provider-trace-grid/);

    assert.match(i18n, /'explorer\.provenanceAvailability\.legacy-unavailable'/);
    assert.match(i18n, /'explorer\.prefillStatus\.confirmed'/);
    assert.match(i18n, /'context\.providerStatus\.context-fallback'/);
    assert.match(i18n, /'diff\.metadataField\.promptOrder'/);
    assert.match(i18n, /'diff\.loreField\.content'/);
});

test('timeline page keeps only the corrupt count and never exposes raw corrupt entries to UI state', async () => {
    globalThis.localStorage = memoryLocalStorage();
    const secretRecord = {
        id: 'private-record-id',
        errorCode: 'invalid-snapshot',
        raw: 'must not enter UI state',
    };
    const devTools = new DevToolsWindow({
        getContext: () => ({ chatId: 'chat' }),
        store: {
            setMaxSnapshotsPerChat() {},
            async getTimelinePage() {
                return {
                    snapshots: [],
                    totalCount: 2,
                    corruptCount: 2,
                    corruptEntries: [secretRecord],
                };
            },
        },
        capture: { addEventListener() {} },
        version: 'test',
    });

    const page = await devTools.readTimelinePage('chat');

    assert.equal(page.corruptCount, 2);
    assert.equal(Object.hasOwn(page, 'corruptEntries'), false);
    assert.equal(JSON.stringify(page).includes(secretRecord.id), false);
    assert.equal(JSON.stringify(page).includes(secretRecord.raw), false);
});
