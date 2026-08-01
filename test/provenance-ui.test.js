import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DevToolsWindow } from '../src/ui.js';

function cssBlock(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
    assert.ok(match, `${selector} CSS block must exist`);
    return match[1];
}

function mediaSection(css, query) {
    const start = css.indexOf(`@media (${query})`);
    assert.notEqual(start, -1, `@media (${query}) must exist`);
    const end = css.indexOf('\n@media ', start + 1);
    return css.slice(start, end === -1 ? css.length : end);
}

function fakeNode(tagName) {
    return {
        tagName: String(tagName).toUpperCase(),
        children: [],
        attributes: new Map(),
        className: '',
        dataset: {},
        textContent: '',
        append(...children) {
            this.children.push(...children);
        },
        appendChild(child) {
            this.children.push(child);
            return child;
        },
        setAttribute(name, value) {
            this.attributes.set(name, String(value));
        },
    };
}

function nodeAttribute(node, name) {
    return node.attributes.get(name) ?? node[name] ?? null;
}

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

test('UI exposes provenance, provider, prefill, and structured diff views', async () => {
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

test('structured field changes expose scoped headers and mobile before-after labels', () => {
    const previousDocument = globalThis.document;
    globalThis.document = {
        createElement(tagName) {
            return fakeNode(tagName);
        },
    };
    try {
        const ui = Object.create(DevToolsWindow.prototype);
        const wrapper = ui.renderFieldChanges([{
            field: 'model',
            before: 'old-model',
            after: 'new-model',
        }], 'diff.metadataField');
        const [table] = wrapper.children;
        const [head, body] = table.children;
        const [headRow] = head.children;
        const [bodyRow] = body.children;

        assert.deepEqual(
            headRow.children.map((cell) => nodeAttribute(cell, 'scope')),
            ['col', 'col', 'col'],
        );
        assert.equal(nodeAttribute(bodyRow.children[0], 'scope'), 'row');
        assert.notEqual(bodyRow.children[1].dataset.label, '');
        assert.notEqual(bodyRow.children[2].dataset.label, '');
        assert.notEqual(
            bodyRow.children[1].dataset.label,
            bodyRow.children[2].dataset.label,
        );
    } finally {
        globalThis.document = previousDocument;
    }
});

test('structured field change tables stay compact instead of forcing mobile overflow', async () => {
    const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
    const table = cssBlock(css, '.st-devtools-field-change-table');
    const mobile = mediaSection(css, 'max-width: 430px');

    assert.match(table, /width:\s*100%/u);
    assert.match(table, /min-width:\s*0/u);
    assert.doesNotMatch(table, /min-width:\s*28rem/u);
    assert.match(
        mobile,
        /\.st-devtools-field-change-table\s+tr\s*\{[^}]*display:\s*grid/u,
    );
    assert.match(
        mobile,
        /\.st-devtools-field-change-table\s+td::before\s*\{[^}]*content:\s*attr\(data-label\)/u,
    );
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
