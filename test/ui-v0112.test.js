import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { DevToolsWindow } from '../src/ui.js';

const UI_SOURCE_URL = new URL('../src/ui.js', import.meta.url);
const I18N_SOURCE_URL = new URL('../src/i18n.js', import.meta.url);
const CSS_SOURCE_URL = new URL('../style.css', import.meta.url);

function sourceBlock(source, start, end) {
    const startIndex = source.indexOf(start);
    assert.notEqual(startIndex, -1, `missing source block start: ${start}`);
    const endIndex = source.indexOf(end, startIndex + start.length);
    assert.notEqual(endIndex, -1, `missing source block end: ${end}`);
    return source.slice(startIndex, endIndex);
}

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

test('rules AI mode persists its profile and response cap outside general settings', async () => {
    const ui = await readFile(UI_SOURCE_URL, 'utf8');
    const i18n = await readFile(I18N_SOURCE_URL, 'utf8');
    const generalSettings = sourceBlock(
        ui,
        '\n    buildSettingsPanel() {',
        '\n    setStorageToolsStatus(',
    );
    const semanticSettings = sourceBlock(
        ui,
        '\n    renderSemanticInspectorSettings() {',
        '\n    semanticSnapshotSupportsInspection(',
    );
    const updatePreferences = sourceBlock(
        ui,
        '\n    updateSemanticInspectorPreferences(',
        '\n    setSemanticInspectionMode(',
    );

    assert.doesNotMatch(generalSettings, /st-devtools-semantic-profile/u);
    assert.doesNotMatch(generalSettings, /settings\.semanticResponseCap/u);
    assert.match(semanticSettings, /className: 'st-devtools-semantic-profile'/u);
    assert.match(
        semanticSettings,
        /profile\.setAttribute\('aria-label', t\('settings\.semanticConnectionProfile'\)\)/u,
    );
    assert.match(
        semanticSettings,
        /populateSemanticConnectionProfiles\([\s\S]*?this\.preferences\.semanticConnectionProfileId/u,
    );
    assert.match(
        semanticSettings,
        /semanticConnectionProfileId: profile\.value \|\| null/u,
    );
    assert.match(
        semanticSettings,
        /cap\.value = String\(this\.preferences\.semanticResponseTokenCap\)/u,
    );
    assert.match(semanticSettings, /semanticResponseTokenCap: cap\.value/u);
    assert.match(updatePreferences, /this\.saveUiPreferences\(/u);
    assert.match(updatePreferences, /this\.resetSemanticInspectionForSettingsChange\(preferences\)/u);
    assert.match(updatePreferences, /this\.ruleViewMode = preferences\.semanticInspectorEnabled/u);
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

test('settings open without surprising input focus and keep an explicit top close action', async () => {
    const ui = await readFile(UI_SOURCE_URL, 'utf8');
    const settings = sourceBlock(
        ui,
        '\n    buildSettingsPanel() {',
        '\n    setStorageToolsStatus(',
    );
    const open = sourceBlock(
        ui,
        '\n    openSettings(',
        '\n    closeSettings(',
    );
    const focusTask = sourceBlock(
        open,
        'queueMicrotask(() => {',
        '\n        });',
    );

    assert.match(settings, /panel\.tabIndex = -1/u);
    assert.match(
        settings,
        /className: 'menu_button st-devtools-icon-button st-devtools-settings-close'/u,
    );
    assert.match(settings, /title: t\('action\.close'\)/u);
    assert.match(settings, /close\.setAttribute\('aria-label', t\('action\.close'\)\)/u);
    assert.doesNotMatch(open, /timelineRetentionLimitInput\?\.focus\(\)/u);
    assert.doesNotMatch(open, /timelineRetentionLimitInput\?\.select\(\)/u);
    assert.match(open, /this\.settingsPanel\.scrollTop = 0/u);
    assert.match(focusTask, /settingsOverlay(?:\.|\?\.)hidden/u);
    assert.match(
        focusTask,
        /settingsPanel\?\.focus\(\{ preventScroll: true \}\)/u,
    );
    assert.match(
        focusTask,
        /if\s*\([^)]*settingsOverlay[^)]*!this\.settingsOverlay\.hidden[^)]*\)\s*\{/u,
    );
});

test('settings expose common controls and collapse only advanced controls', async () => {
    const ui = await readFile(UI_SOURCE_URL, 'utf8');
    const settings = sourceBlock(
        ui,
        '\n    buildSettingsPanel() {',
        '\n    setStorageToolsStatus(',
    );

    assert.match(settings, /className: 'st-devtools-settings-section'/u);
    assert.match(
        settings,
        /settingsGroup\('settings\.group\.basic', \[themeField\]\)/u,
    );
    assert.match(
        settings,
        /settingsGroup\(\s*'settings\.group\.snapshots',[\s\S]*?\[retentionField, readField, captureField\][\s\S]*?\)/u,
    );
    assert.match(
        settings,
        /settingsGroup\(\s*'settings\.group\.advanced',[\s\S]*?\{ collapsible: true \}[\s\S]*?\)/u,
    );
    assert.doesNotMatch(settings, /settings\.group\.advanced'[\s\S]{0,300}?open:\s*true/u);
});

test('theme-resistant controls and disclosure headings use one left-aligned direction', async () => {
    const css = await readFile(CSS_SOURCE_URL, 'utf8');

    assert.match(
        css,
        /\.st-devtools-window \.menu_button\s*\{[\s\S]*?flex:\s*0 0 auto;[\s\S]*?width:\s*auto;/u,
    );
    assert.match(
        css,
        /\.st-devtools-window :where\(details > summary\)\s*\{[\s\S]*?display:\s*flex;[\s\S]*?justify-content:\s*flex-start\s*!important;[\s\S]*?text-align:\s*left\s*!important;/u,
    );
    assert.match(
        css,
        /\.st-devtools-semantic-profile > select\s*\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*100%;/u,
    );
});
