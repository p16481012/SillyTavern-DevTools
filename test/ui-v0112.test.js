import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { DevToolsWindow } from '../src/ui.js';

const UI_SOURCE_URL = new URL('../src/ui.js', import.meta.url);
const I18N_SOURCE_URL = new URL('../src/i18n.js', import.meta.url);
const CSS_SOURCE_URL = new URL('../style.css', import.meta.url);

function fakeSelect() {
    return {
        children: [],
        value: '',
        replaceChildren() {
            this.children = [];
            this.value = '';
        },
        appendChild(child) {
            this.children.push(child);
        },
    };
}

test('semantic profile picker exposes display names while retaining opaque option values', () => {
    const previousDocument = globalThis.document;
    globalThis.document = {
        createElement() {
            return { textContent: '', value: '' };
        },
    };
    try {
        const ui = Object.create(DevToolsWindow.prototype);
        ui.semanticInspector = {
            connectionProfiles() {
                return {
                    status: 'available',
                    profiles: [{
                        id: 'private-opaque-profile-id',
                        name: '검사용 연결',
                        provider: 'provider-id',
                        model: 'model-id',
                    }],
                };
            },
        };
        const select = fakeSelect();
        const status = { textContent: '' };

        const selected = ui.populateSemanticConnectionProfiles(
            select,
            'private-opaque-profile-id',
            status,
        );

        assert.equal(selected, 'private-opaque-profile-id');
        assert.deepEqual(
            select.children.map(({ textContent }) => textContent),
            ['현재 채팅 연결', '검사용 연결'],
        );
        assert.deepEqual(
            select.children.map(({ value }) => value),
            ['', 'private-opaque-profile-id'],
        );
        assert.doesNotMatch(
            select.children.map(({ textContent }) => textContent).join(' '),
            /private-opaque-profile-id|provider-id|model-id/u,
        );
        assert.match(status.textContent, /API 키|연결 비밀값/u);
    } finally {
        globalThis.document = previousDocument;
    }
});

test('temporary profile-list failure preserves the saved opaque selection without displaying it', () => {
    const previousDocument = globalThis.document;
    globalThis.document = {
        createElement() {
            return { textContent: '', value: '', disabled: false };
        },
    };
    try {
        const ui = Object.create(DevToolsWindow.prototype);
        ui.semanticInspector = {
            connectionProfiles() {
                return { status: 'unavailable', profiles: [] };
            },
        };
        const select = fakeSelect();
        const status = { textContent: '' };
        const opaqueId = 'private-saved-profile-id';

        assert.equal(
            ui.populateSemanticConnectionProfiles(select, opaqueId, status),
            opaqueId,
        );
        assert.equal(select.value, opaqueId);
        assert.deepEqual(
            select.children.map(({ value }) => value),
            ['', opaqueId],
        );
        assert.equal(select.children[1].disabled, true);
        assert.doesNotMatch(
            select.children.map(({ textContent }) => textContent).join(' '),
            new RegExp(opaqueId, 'u'),
        );
        assert.notEqual(status.textContent, '');

        ui.semanticInspector.connectionProfiles = () => ({
            status: 'available',
            profiles: [],
        });
        assert.equal(
            ui.populateSemanticConnectionProfiles(select, opaqueId, status),
            null,
        );
        assert.equal(select.value, '');
    } finally {
        globalThis.document = previousDocument;
    }
});

test('settings wire the selected semantic profile through reset, save, and reopen', async () => {
    const ui = await readFile(UI_SOURCE_URL, 'utf8');
    const i18n = await readFile(I18N_SOURCE_URL, 'utf8');

    assert.match(ui, /className: 'st-devtools-semantic-profile'/u);
    assert.match(
        ui,
        /semanticProfileSelect\.setAttribute\(\s*'aria-label',[\s\S]*?settings\.semanticConnectionProfile/u,
    );
    assert.match(ui, /semanticConnectionProfileId: semanticProfileSelect\.value \|\| null/u);
    assert.match(
        ui,
        /requested\.semanticConnectionProfileId[\s\S]*?previousPreferences\.semanticConnectionProfileId/u,
    );
    assert.match(
        ui,
        /populateSemanticConnectionProfiles\([\s\S]*?this\.preferences\.semanticConnectionProfileId/u,
    );
    assert.match(
        ui,
        /DEFAULT_UI_PREFERENCES\.semanticConnectionProfileId/u,
    );
    for (const key of [
        'settings.semanticConnectionProfile',
        'settings.semanticConnectionProfileDescription',
        'settings.semanticConnectionProfile.current',
        'settings.semanticConnectionProfile.savedUnavailable',
        'settings.semanticConnectionProfile.unavailable',
        'settings.semanticConnectionProfile.unavailablePreserved',
        'settings.semanticConnectionProfile.empty',
        'settings.semanticConnectionProfile.privacy',
    ]) {
        assert.equal(i18n.includes(`'${key}':`), true, `missing i18n key: ${key}`);
    }
});

test('theme-resistant controls and disclosure headings use one left-aligned direction', async () => {
    const css = await readFile(CSS_SOURCE_URL, 'utf8');

    assert.match(
        css,
        /\.st-devtools-window \.menu_button\s*\{[\s\S]*?flex:\s*0 0 auto;[\s\S]*?width:\s*auto;/u,
    );
    assert.match(
        css,
        /\.st-devtools-window :where\(details > summary\)\s*\{[\s\S]*?display:\s*list-item;[\s\S]*?text-align:\s*left;/u,
    );
    assert.match(
        css,
        /\.st-devtools-semantic-profile > select\s*\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*100%;/u,
    );
});
