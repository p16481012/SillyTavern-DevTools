import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
    inferPanelThemeFromTextColor,
    resolvePanelTheme,
} from '../src/theme.js';

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

function remProperty(block, name) {
    const match = block.match(new RegExp(`${name}:\\s*([0-9.]+)rem`, 'i'));
    assert.ok(match, `${name} must use a rem value`);
    return Number(match[1]);
}

function mediaSection(css, query) {
    const start = css.indexOf(`@media (${query})`);
    assert.notEqual(start, -1, `@media (${query}) must exist`);
    const end = css.indexOf('\n@media ', start + 1);
    return css.slice(start, end === -1 ? css.length : end);
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

test('explicit panel theme overrides SillyTavern while auto keeps inference', () => {
    assert.equal(resolvePanelTheme('light', 'rgb(238, 238, 238)'), 'light');
    assert.equal(resolvePanelTheme('dark', 'rgb(31, 41, 55)'), 'dark');
    assert.equal(resolvePanelTheme('auto', 'rgb(238, 238, 238)'), 'dark');
    assert.equal(resolvePanelTheme('invalid', 'rgb(31, 41, 55)'), 'light');
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

test('panel accents are self-owned and readable in both color schemes', async () => {
    const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
    const themes = [
        cssBlock(css, '.st-devtools-overlay'),
        cssBlock(css, '.st-devtools-overlay.st-devtools-theme-light'),
    ];

    assert.doesNotMatch(css, /--SmartThemeQuoteColor/u);
    for (const theme of themes) {
        const panel = customProperty(theme, '--st-devtools-panel-bg');
        const surface = customProperty(theme, '--st-devtools-surface');
        const primary = customProperty(theme, '--st-devtools-primary');
        const primarySoft = customProperty(theme, '--st-devtools-primary-soft');
        const focus = customProperty(theme, '--st-devtools-focus');
        const mutedText = customProperty(theme, '--st-devtools-text-muted');
        const primaryStrong = customProperty(theme, '--st-devtools-primary-strong');

        assert.ok(
            contrastRatio(primary, panel) >= 4.5,
            `${primary} must remain readable against ${panel}`,
        );
        assert.ok(
            contrastRatio(primary, primarySoft) >= 4.5,
            `${primary} must keep active app navigation text readable against ${primarySoft}`,
        );
        assert.ok(
            contrastRatio(focus, panel) >= 3,
            `${focus} must remain visible against ${panel}`,
        );
        assert.ok(
            contrastRatio(mutedText, surface) >= 4.5,
            `${mutedText} must remain readable against ${surface}`,
        );
        assert.ok(
            contrastRatio(primaryStrong, '#ffffff') >= 4.5,
            `${primaryStrong} must retain AA contrast with primary-button text`,
        );
    }
});

test('app navigation stays visually singular and resists host button styles', async () => {
    const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
    const ui = await readFile(new URL('../src/ui.js', import.meta.url), 'utf8');
    const actionButton = cssBlock(css, '.st-devtools-window .menu_button');
    const panel = cssBlock(css, '.st-devtools-window');
    const appNav = cssBlock(css, '.st-devtools-app-nav');
    const appTab = cssBlock(
        css,
        '.st-devtools-overlay .st-devtools-window .st-devtools-app-nav-item',
    );
    const focusTab = cssBlock(css, '.st-devtools-app-nav-item:focus-visible');
    const searchOptionsBody = cssBlock(css, '.st-devtools-search-options-body');

    assert.match(actionButton, /white-space:\s*normal/);
    assert.match(actionButton, /min-width:\s*0/);
    assert.match(actionButton, /word-break:\s*keep-all/);
    assert.match(actionButton, /writing-mode:\s*horizontal-tb/);
    assert.match(panel, /overflow-wrap:\s*normal/);
    assert.match(panel, /text-wrap:\s*pretty/);
    assert.match(panel, /word-break:\s*keep-all/);
    assert.match(appNav, /display:\s*grid\s*!important/u);
    assert.match(
        appNav,
        /grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/u,
    );
    assert.match(
        css,
        /\.st-devtools-window button,\s*\.st-devtools-window select\s*\{[\s\S]*?box-sizing:\s*border-box/u,
    );
    assert.match(appTab, /display:\s*flex\s*!important/u);
    assert.match(appTab, /width:\s*100%\s*!important/u);
    assert.match(appTab, /min-width:\s*0\s*!important/u);
    assert.match(appTab, /background:\s*transparent\s*!important/u);
    assert.match(appTab, /color:\s*var\(--st-devtools-text-muted\)\s*!important/u);
    assert.match(appTab, /writing-mode:\s*horizontal-tb\s*!important/u);
    assert.match(
        cssBlock(css, '.st-devtools-app-nav-item > i'),
        /color:\s*currentColor\s*!important/u,
    );
    assert.match(
        css,
        /\.st-devtools-app-nav-item\.active,[\s\S]*?\.st-devtools-app-nav-item\[aria-selected='true'\]\s*\{[\s\S]*?background:\s*var\(--st-devtools-primary-soft\)\s*!important;[\s\S]*?color:\s*var\(--st-devtools-primary\)\s*!important/u,
    );
    assert.match(
        css,
        /\.st-devtools-app-nav-item:not\(\.active\):hover\s*\{[\s\S]*?background:\s*var\(--st-devtools-hover\)\s*!important/u,
    );
    assert.doesNotMatch(focusTab, /background:/);
    assert.match(focusTab, /outline:\s*2px solid var\(--st-devtools-focus\)/u);
    assert.doesNotMatch(
        `${css}\n${ui}`,
        /(?:\.|className:\s*['"])st-devtools-(?:primary-tabs?|secondary-tabs?|tab)(?:\b|['"])/u,
    );
    assert.match(searchOptionsBody, /display:\s*flex/);
    assert.match(
        ui,
        /className:\s*'st-devtools-search-options st-devtools-disclosure'/,
    );
});

test('bottom app navigation stays in a three-row shell without mobile overflow', async () => {
    const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
    const i18n = await readFile(new URL('../src/i18n.js', import.meta.url), 'utf8');
    const panel = cssBlock(css, '.st-devtools-window');
    const appNav = cssBlock(css, '.st-devtools-app-nav');
    const appTab = cssBlock(
        css,
        '.st-devtools-overlay .st-devtools-window .st-devtools-app-nav-item',
    );
    const appLabel = cssBlock(css, '.st-devtools-app-nav-item > span');
    const headerAction = cssBlock(css, '.st-devtools-header-actions .menu_button');
    const captureStatus = cssBlock(css, '.st-devtools-capture-status');
    const mobile = mediaSection(css, 'max-width: 700px');
    const settingsGroupSummary = cssBlock(
        css,
        '.st-devtools-settings-group > summary',
    );
    const settingsGroupContent = cssBlock(
        css,
        '.st-devtools-settings-group-content',
    );

    assert.match(
        panel,
        /grid-template-rows:\s*auto minmax\(0, 1fr\) auto/,
    );
    assert.match(panel, /overflow:\s*hidden/u);
    assert.match(appNav, /display:\s*grid\s*!important/u);
    assert.match(
        appNav,
        /grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\)/,
    );
    assert.match(appNav, /min-width:\s*0/u);
    assert.doesNotMatch(appNav, /overflow-x:\s*auto/u);
    assert.match(appTab, /width:\s*100%\s*!important/u);
    assert.match(appTab, /min-width:\s*0\s*!important/u);
    assert.ok(
        Number(appTab.match(/min-height:\s*(\d+)px/u)?.[1] ?? 0) >= 44,
        'each app navigation target must be at least 44px tall',
    );
    assert.match(appTab, /word-break:\s*keep-all/u);
    assert.match(appLabel, /min-width:\s*0/u);
    assert.match(mobile, /width:\s*100vw\s*!important/u);
    assert.match(mobile, /height:\s*100dvh\s*!important/u);
    assert.match(
        mobile,
        /\.st-devtools-app-nav\s*\{[\s\S]*?env\(safe-area-inset-bottom\)/u,
    );
    assert.match(
        mobile,
        /\.st-devtools-app-nav-item\s*\{[\s\S]*?min-height:\s*60px[\s\S]*?flex-direction:\s*column/u,
    );
    assert.match(headerAction, /display:\s*inline-grid/);
    assert.match(headerAction, /width:\s*2\.5rem/);
    assert.match(headerAction, /min-width:\s*2\.5rem/);
    assert.match(headerAction, /height:\s*2\.5rem/);
    assert.match(headerAction, /min-height:\s*2\.5rem/);
    assert.match(headerAction, /place-items:\s*center/);
    assert.match(captureStatus, /display:\s*inline-flex/);
    assert.match(captureStatus, /margin:\s*0/);
    assert.match(captureStatus, /border-radius:\s*999px/);
    assert.match(css, /\.st-devtools-capture-status\.is-saved[\s\S]*?--st-devtools-capture-color:\s*var\(--st-devtools-status-success\)/);
    assert.match(css, /\.st-devtools-capture-status\.is-failed[\s\S]*?--st-devtools-capture-color:\s*var\(--st-devtools-status-danger\)/);
    assert.match(css, /\.st-devtools-help-overlay/);
    assert.match(css, /\.st-devtools-help-panel[\s\S]*?overflow:\s*hidden/);
    assert.match(css, /\.st-devtools-help-body[\s\S]*?overflow-y:\s*auto/);
    assert.match(settingsGroupSummary, /min-height:\s*44px/);
    assert.match(settingsGroupContent, /display:\s*grid/);
    assert.match(
        css,
        /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?animation-duration:\s*0\.01ms\s*!important/,
    );
    assert.match(css, /\.st-devtools-window :is\([\s\S]*?\):focus-visible/);

    const expectedKeys = [
        'nav.label',
        'nav.short.explorer',
        'nav.short.rules',
        'nav.short.timeline',
        'nav.short.diff',
        'nav.short.search',
        'tab.explorer',
        'tab.rules',
        'tab.timeline',
        'tab.diff',
        'tab.search',
        'snapshot.label',
        'capture.status.label',
        'action.refresh',
        'action.returnToChat',
        'rules.semanticDisclosureTitle',
        'rules.advancedAnalysisTitle',
        'timeline.storageDetailsTitle',
        'settings.group.basic',
        'settings.group.snapshots',
        'settings.group.advanced',
    ];
    for (const key of expectedKeys) {
        assert.match(
            i18n,
            new RegExp(`'${key.replaceAll('.', '\\.')}':\\s*'[^']+'`),
        );
    }
    assert.doesNotMatch(
        i18n,
        /'nav\.(?:prompt|inspect|history|tools|secondaryLabel)'/u,
    );
    for (const key of [
        'capture.status.waiting',
        'capture.status.capturing',
        'capture.status.processing',
        'capture.status.saved',
        'capture.status.failed',
        'capture.status.excludedSemantic',
        'capture.status.skippedSafety',
        'help.step1Title',
        'help.step1Description',
        'help.troubleshootTitle',
        'help.troubleshootDescription',
    ]) {
        assert.match(i18n, new RegExp(`'${key.replaceAll('.', '\\.')}':`));
    }
    assert.doesNotMatch(i18n, /'action\.help'|'help\.(?:title|description)'/);
});

test('panel controls and disclosure headings resist host theme layout rules', async () => {
    const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
    const menuButton = cssBlock(css, '.st-devtools-window .menu_button');
    const button = cssBlock(css, '.st-devtools-window button');
    const summary = cssBlock(css, '.st-devtools-window :where(details > summary)');
    const summaryChildren = cssBlock(
        css,
        '.st-devtools-window :where(details > summary > *)',
    );
    const customSummary = cssBlock(css, '.st-devtools-settings-group > summary');
    const settingsPanel = cssBlock(css, '.st-devtools-settings-panel');

    assert.match(menuButton, /box-sizing:\s*border-box/);
    assert.match(menuButton, /flex:\s*0 0 auto/);
    assert.match(menuButton, /width:\s*auto/);
    assert.match(
        css,
        /\.st-devtools-overlay \.st-devtools-window \.menu_button\s*\{[\s\S]*?flex:\s*0 0 auto\s*!important[\s\S]*?width:\s*auto\s*!important[\s\S]*?min-width:\s*0\s*!important/,
    );
    assert.match(
        css,
        /\.st-devtools-overlay \.st-devtools-window \.st-devtools-icon-button\s*\{[\s\S]*?flex:\s*0 0 2\.5rem\s*!important/,
    );
    assert.match(button, /flex-grow:\s*0/);
    assert.match(button, /flex-shrink:\s*0/);
    assert.match(
        css,
        /\.st-devtools-window select\s*\{\s*flex:\s*0 1 auto/,
    );
    assert.match(
        css,
        /\.st-devtools-window button,\s*\.st-devtools-window select\s*\{[\s\S]*?box-sizing:\s*border-box[\s\S]*?writing-mode:\s*horizontal-tb/,
    );
    assert.match(
        css,
        /\.st-devtools-overlay \.st-devtools-window :where\([\s\S]*?select,[\s\S]*?background:\s*var\(--st-devtools-surface\)\s*!important[\s\S]*?color:\s*var\(--st-devtools-text\)\s*!important/,
    );
    assert.match(
        css,
        /@media\s*\(max-width:\s*430px\)[\s\S]*?\.st-devtools-header-actions \.menu_button\s*\{[\s\S]*?width:\s*44px\s*!important[\s\S]*?height:\s*44px\s*!important/,
    );
    assert.match(summary, /display:\s*flex/);
    assert.match(summary, /width:\s*100%/);
    assert.match(summary, /justify-content:\s*flex-start\s*!important/);
    assert.match(summary, /text-align:\s*left\s*!important/);
    assert.match(summaryChildren, /text-align:\s*left/);
    assert.match(customSummary, /display:\s*flex/);
    assert.match(settingsPanel, /overflow-x:\s*hidden/);
});

test('help tooltips and nested disclosures keep responsive interaction contracts', async () => {
    const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
    const ui = await readFile(new URL('../src/ui.js', import.meta.url), 'utf8');
    const i18n = await readFile(new URL('../src/i18n.js', import.meta.url), 'utf8');
    const textFormat = await readFile(new URL('../src/text-format.js', import.meta.url), 'utf8');

    assert.match(
        css,
        /@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)[\s\S]*?\.st-devtools-help-tooltip:hover/,
    );
    assert.match(css, /\.st-devtools-help-tooltip\.is-open\s+\.st-devtools-help-bubble/);
    assert.match(cssBlock(css, '.st-devtools-help-bubble'), /box-sizing:\s*border-box/);
    const helpTrigger = cssBlock(css, '.st-devtools-window .st-devtools-help-trigger');
    const helpVisual = cssBlock(
        css,
        '.st-devtools-window .st-devtools-help-trigger::before',
    );
    assert.ok(remProperty(helpTrigger, 'width') >= 1.25);
    assert.ok(remProperty(helpVisual, 'width') < 1.1);
    assert.equal(
        remProperty(helpVisual, 'width'),
        remProperty(helpVisual, 'height'),
    );
    assert.match(
        css,
        /\.st-devtools-window\s+details:not\(\[open\]\)\s*>\s*:not\(summary\)[\s\S]*?display:\s*none\s*!important/,
    );
    assert.match(ui, /trigger\.setAttribute\('aria-expanded', 'false'\)/);
    assert.match(ui, /trigger\.setAttribute\('aria-describedby', tooltipId\)/);
    assert.match(ui, /event\.preventDefault\(\);\s*event\.stopPropagation\(\);/);
    assert.match(ui, /details\.dataset\.policySection/);
    assert.match(ui, /function positionHelpTooltip\(wrapper\)/);
    assert.match(ui, /boundaryRect\.right - measured\.width/);
    assert.match(ui, /import \{ descriptionParagraphs \} from '\.\/text-format\.js'/);
    assert.match(textFormat, /export function descriptionParagraphs\(text\)/);
    assert.match(ui, /function proseElement\(tag, text, options = \{\}\)/);
    assert.match(css, /\.st-devtools-prose-paragraph \+ \.st-devtools-prose-paragraph[\s\S]*?margin-top:\s*1em/);
    assert.match(ui, /GROWTH_CHART_POINT_LIMIT = 10/);
    assert.match(ui, /analyses\.slice\(-GROWTH_CHART_POINT_LIMIT\)/);
    assert.match(ui, /st-devtools-growth-hit/);
    assert.match(ui, /r:\s*28/);
    assert.match(ui, /detailText\.setAttribute\('role', 'status'\)/);
    assert.match(ui, /isLatest \? 'is-latest' : ''/);
    assert.match(ui, /r:\s*isLatest \? 6 : 4/);
    assert.match(css, /\.st-devtools-growth-hit\.is-latest \+ \.st-devtools-growth-point/);
    assert.match(css, /\.st-devtools-growth-hit\.is-inspected \+ \.st-devtools-growth-point/);
    assert.match(
        css,
        /\.st-devtools-growth-hit\.is-latest\.is-inspected \+ \.st-devtools-growth-point/,
    );
    assert.match(ui, /renderTimelineSelectionToolbar\(\)/);
    assert.match(ui, /deleteSelectedTimelineSnapshots/);
    assert.match(ui, /updateTimelineSelectionControls\(\)/);
    assert.match(ui, /select\.dataset\.snapshotId = snapshot\.id/);
    assert.match(ui, /this\.timelineSnapshotsOpen = snapshots\.open/);
    assert.match(ui, /this\.timelineSelectionChatId !== chatId/);
    assert.doesNotMatch(ui, /t\('snapshot\.description'\)/);
    assert.doesNotMatch(
        ui,
        /t\('comparison\.description'\),\s*t\('comparison\.behaviorDescription'\)/,
    );
    const comparisonDescription = i18n.match(
        /'comparison\.description':\s*'([^']+)'/,
    )?.[1] ?? '';
    assert.doesNotMatch(comparisonDescription, /대안 그룹|내부 무시/);
    assert.match(
        ui,
        /policyField\('comparison\.mode', mode, 'comparison\.behaviorDescription'\)/,
    );
    assert.match(ui, /function describedControlField\(labelText, control, description\)/);
    assert.match(
        ui,
        /className:\s*'st-devtools-explained-title st-devtools-policy-field-heading'/,
    );
    assert.match(ui, /control\.setAttribute\('aria-describedby', tooltipId\)/);
});

test('v0.9.1 safety and theme controls remain responsive', async () => {
    const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
    const ui = await readFile(new URL('../src/ui.js', import.meta.url), 'utf8');
    const i18n = await readFile(new URL('../src/i18n.js', import.meta.url), 'utf8');

    assert.match(ui, /renderStorageOverview\(\)/);
    assert.match(ui, /clearAllSnapshots\(/);
    assert.match(ui, /this\.store\.clearAll\(\)/);
    assert.match(ui, /className:\s*'st-devtools-storage-warning'/);
    assert.match(ui, /warning\.setAttribute\('role', 'alert'\)/);
    assert.match(ui, /this\.runUiAnalysis\('search'/);
    assert.match(ui, /activeSearch\?\.abort\(\)/);
    assert.match(ui, /sequence !== searchSequence \|\| !page\.isConnected/);
    assert.match(ui, /renderExportPrivacyPreview\(snapshot\)/);
    assert.match(ui, /confirm\(t\('export\.copyConfirm'\)\)/);
    assert.match(ui, /confirm\(t\('export\.confirm'/);
    assert.match(ui, /capture\.generationStatus/);
    assert.match(cssBlock(css, '.st-devtools-storage-overview'), /display:\s*flex/);
    assert.match(cssBlock(css, '.st-devtools-storage-metrics'), /flex-wrap:\s*wrap/);
    assert.match(cssBlock(css, '.st-devtools-capture-lifecycle'), /border-radius:\s*999px/);
    assert.match(i18n, /'storage\.memoryWarning':/);
    assert.match(i18n, /'storage\.snapshotCountPending':\s*'스냅샷 수 계산 중'/);
    assert.doesNotMatch(ui, /summary\.snapshotCount\s*\?\?\s*t\('common\.unknown'\)/);
    assert.match(i18n, /'search\.error\.regex-timeout':/);
    assert.match(i18n, /'export\.previewWarning':/);
    assert.match(ui, /buildSettingsPanel\(\)/);
    assert.match(ui, /className:\s*'st-devtools-settings-overlay'/);
    assert.match(ui, /panel\.setAttribute\('aria-modal', 'true'\)/);
    assert.match(ui, /this\.store\.getTimelinePage\(chatId, \{ limit \}\)/);
    assert.match(ui, /function attachLazyDetailsContent\(details, createContent\)/);
    assert.match(cssBlock(css, '.st-devtools-settings-overlay'), /position:\s*absolute/);
    assert.match(cssBlock(css, '.st-devtools-settings-panel'), /width:\s*min\(560px, 100%\)/);
    assert.match(i18n, /'settings\.timelineRetentionLimitHint':/);
    assert.match(i18n, /'settings\.timelineRetentionDecreaseConfirm':/);
    assert.match(i18n, /'settings\.timelineReadLimitHint':/);
    assert.match(i18n, /'settings\.themeMode\.auto':/);
    assert.match(i18n, /'settings\.themeMode\.light':/);
    assert.match(i18n, /'settings\.themeMode\.dark':/);
    assert.match(ui, /this\.preferences\.themeMode/);
    assert.match(ui, /resolvePanelTheme\(/);
    assert.match(ui, /this\.store\.getRetentionPrunePreview/);
    assert.match(ui, /this\.store\.applyRetentionLimit/);
    assert.match(i18n, /'settings\.applying':/);
    assert.match(ui, /if \(timelineSettingsChanged\) this\.scheduleSettingsRefresh\(\)/);
    assert.match(ui, /apply\.removeAttribute\('aria-busy'\)/);
    const submitStart = ui.indexOf("form.addEventListener('submit'");
    const submitEnd = ui.indexOf('\n        panel.append', submitStart);
    const settingsSubmit = ui.slice(submitStart, submitEnd);
    assert.doesNotMatch(settingsSubmit, /await this\.refresh\(\)/);

    const settingsHeader = cssBlock(css, '.st-devtools-settings-header');
    const mobile = mediaSection(css, 'max-width: 430px');
    assert.match(settingsHeader, /display:\s*flex/);
    assert.match(settingsHeader, /align-items:\s*center/);
    assert.match(settingsHeader, /justify-content:\s*space-between/);
    assert.doesNotMatch(
        mobile,
        /\.st-devtools-settings-header\s*,[\s\S]{0,600}?flex-direction:\s*column/u,
    );
    assert.doesNotMatch(
        mobile,
        /\.st-devtools-settings-header\s*\{[^}]*flex-direction:\s*column/u,
    );
});
