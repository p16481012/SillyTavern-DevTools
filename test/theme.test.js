import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { inferPanelThemeFromTextColor } from '../src/theme.js';

function cssBlock(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
    assert.ok(match, `${selector} CSS block must exist`);
    return match[1];
}

function customProperty(block, name) {
    const match = block.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i'));
    assert.ok(match, `${name} must use a six-digit hex color`);
    return match[1];
}

function relativeLuminance(hex) {
    const channels = hex.slice(1).match(/../g).map((value) => {
        const channel = Number.parseInt(value, 16) / 255;
        return channel <= 0.04045
            ? channel / 12.92
            : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
}

function contrastRatio(first, second) {
    const firstLuminance = relativeLuminance(first);
    const secondLuminance = relativeLuminance(second);
    return (Math.max(firstLuminance, secondLuminance) + 0.05)
        / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

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

test('status text colors keep WCAG AA contrast on muted badge surfaces', async () => {
    const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
    const themes = [
        cssBlock(css, '.st-devtools-overlay'),
        cssBlock(css, '.st-devtools-overlay.st-devtools-theme-light'),
    ];
    const statusProperties = [
        '--st-devtools-status-success',
        '--st-devtools-status-info',
        '--st-devtools-status-cyan',
        '--st-devtools-status-warning',
        '--st-devtools-status-danger',
    ];

    for (const theme of themes) {
        const background = customProperty(theme, '--st-devtools-surface-muted');
        for (const property of statusProperties) {
            const color = customProperty(theme, property);
            assert.ok(
                contrastRatio(color, background) >= 4.5,
                `${property} must have at least 4.5:1 contrast against ${background}`,
            );
        }
    }
});

test('tabs and Korean action controls keep distinct, horizontal states', async () => {
    const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
    const ui = await readFile(new URL('../src/ui.js', import.meta.url), 'utf8');
    const actionButton = cssBlock(css, '.st-devtools-window .menu_button');
    const activeTab = cssBlock(css, '.st-devtools-tab.active');
    const focusTab = cssBlock(css, '.st-devtools-tab:focus-visible');
    const searchOptions = cssBlock(css, '.st-devtools-search-options');

    assert.match(actionButton, /white-space:\s*nowrap/);
    assert.match(actionButton, /word-break:\s*keep-all/);
    assert.match(actionButton, /writing-mode:\s*horizontal-tb/);
    assert.match(activeTab, /border-bottom-color:/);
    assert.doesNotMatch(focusTab, /background:/);
    assert.match(searchOptions, /display:\s*flex/);
    assert.match(ui, /className:\s*'st-devtools-search-options'/);
});
