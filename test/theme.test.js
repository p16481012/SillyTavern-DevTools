import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { inferPanelThemeFromTextColor } from '../src/theme.js';

test('light theme text selects a dark opaque panel', () => {
    assert.equal(inferPanelThemeFromTextColor('rgb(238, 238, 238)'), 'dark');
});

test('dark theme text selects a light opaque panel', () => {
    assert.equal(inferPanelThemeFromTextColor('rgba(31, 41, 55, 0.7)'), 'light');
});

test('panel background does not depend on a transparent SillyTavern tint', async () => {
    const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
    assert.doesNotMatch(css, /background(?:-color)?:\s*var\(--SmartThemeBlurTintColor/);
    assert.match(css, /--st-devtools-panel-bg:\s*#[0-9a-f]{6}/i);
    assert.match(css, /background-color:\s*var\(--st-devtools-panel-bg\)/);
});
