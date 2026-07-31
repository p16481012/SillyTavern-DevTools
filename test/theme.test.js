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

test('tabs stay distinct while Korean action text wraps only at safe boundaries', async () => {
    const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
    const ui = await readFile(new URL('../src/ui.js', import.meta.url), 'utf8');
    const actionButton = cssBlock(css, '.st-devtools-window .menu_button');
    const panel = cssBlock(css, '.st-devtools-window');
    const activeTab = cssBlock(css, '.st-devtools-tab.active');
    const focusTab = cssBlock(css, '.st-devtools-tab:focus-visible');
    const searchOptionsBody = cssBlock(css, '.st-devtools-search-options-body');

    assert.match(actionButton, /white-space:\s*normal/);
    assert.match(actionButton, /min-width:\s*0/);
    assert.match(actionButton, /word-break:\s*keep-all/);
    assert.match(actionButton, /writing-mode:\s*horizontal-tb/);
    assert.match(panel, /overflow-wrap:\s*normal/);
    assert.match(panel, /text-wrap:\s*pretty/);
    assert.match(panel, /word-break:\s*keep-all/);
    assert.match(activeTab, /border-bottom-color:/);
    assert.doesNotMatch(focusTab, /background:/);
    assert.match(searchOptionsBody, /display:\s*flex/);
    assert.match(
        ui,
        /className:\s*'st-devtools-search-options st-devtools-disclosure'/,
    );
});

test('beginner navigation, capture status, and quick start stay compact and accessible', async () => {
    const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
    const i18n = await readFile(new URL('../src/i18n.js', import.meta.url), 'utf8');
    const panel = cssBlock(css, '.st-devtools-window');
    const primaryTabs = cssBlock(css, '.st-devtools-primary-tabs');
    const primaryTab = cssBlock(css, '.st-devtools-primary-tab');
    const secondaryTabs = cssBlock(css, '.st-devtools-secondary-tabs');
    const secondaryButton = cssBlock(css, '.st-devtools-secondary-tabs > button');
    const headerAction = cssBlock(css, '.st-devtools-header-actions .menu_button');
    const captureStatus = cssBlock(css, '.st-devtools-capture-status');
    const helpPanel = cssBlock(css, '.st-devtools-help-panel');
    const quickStartStep = cssBlock(css, '.st-devtools-quick-start-step');
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
        /grid-template-rows:\s*auto auto auto auto minmax\(0, 1fr\)/,
    );
    assert.match(primaryTabs, /display:\s*grid/);
    assert.match(
        primaryTabs,
        /grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/,
    );
    assert.match(primaryTabs, /overflow:\s*visible/);
    assert.match(primaryTab, /min-height:\s*44px/);
    assert.match(primaryTab, /word-break:\s*keep-all/);
    assert.match(secondaryTabs, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    assert.match(secondaryTabs, /overflow-x:\s*hidden/);
    assert.match(secondaryButton, /min-height:\s*44px/);
    assert.match(headerAction, /display:\s*inline-grid/);
    assert.match(headerAction, /width:\s*2\.1rem/);
    assert.match(headerAction, /height:\s*2\.1rem/);
    assert.match(headerAction, /place-items:\s*center/);
    assert.match(captureStatus, /border-left:\s*3px solid var\(--st-devtools-capture-color\)/);
    assert.match(css, /\.st-devtools-capture-status\.is-saved[\s\S]*?--st-devtools-capture-color:\s*var\(--st-devtools-status-success\)/);
    assert.match(css, /\.st-devtools-capture-status\.is-failed[\s\S]*?--st-devtools-capture-color:\s*var\(--st-devtools-status-danger\)/);
    assert.match(css, /\.st-devtools-help-overlay\[hidden\][\s\S]*?display:\s*none/);
    assert.match(helpPanel, /width:\s*min\(560px, 100%\)/);
    assert.match(quickStartStep, /grid-template-columns:\s*1\.75rem minmax\(0, 1fr\)/);
    assert.match(settingsGroupSummary, /min-height:\s*44px/);
    assert.match(settingsGroupContent, /display:\s*grid/);
    assert.match(
        css,
        /@media\s*\(max-width:\s*700px\)[\s\S]*?\.st-devtools-primary-tabs[\s\S]*?overflow-x:\s*hidden/,
    );
    assert.match(
        css,
        /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?animation-duration:\s*0\.01ms\s*!important/,
    );
    assert.match(css, /\.st-devtools-window :is\([\s\S]*?\):focus-visible/);

    const expectedKorean = new Map([
        ['nav.prompt', '프롬프트'],
        ['nav.inspect', '검사'],
        ['nav.history', '기록'],
        ['nav.tools', '도구'],
        ['nav.label', '주요 기능'],
        ['nav.secondaryLabel', '세부 기능'],
        ['tab.explorer', '전송 프롬프트'],
        ['tab.timeline', '기록'],
        ['tab.diff', '변경점'],
        ['tab.context', '요청 상세'],
        ['tab.search', '찾기'],
        ['snapshot.label', '현재 요청'],
        ['capture.status.label', '캡처 상태'],
        ['action.refresh', '새로고침'],
        ['action.help', '사용법'],
        ['action.returnToChat', '채팅으로 돌아가기'],
        ['rules.semanticDisclosureTitle', 'AI로 더 자세히 보기'],
        ['rules.advancedAnalysisTitle', '분석 상세'],
        ['timeline.storageDetailsTitle', '저장 상태와 관리'],
        ['settings.group.basic', '기본'],
        ['settings.group.snapshots', '스냅샷'],
        ['settings.group.advanced', '고급 기능'],
    ]);
    for (const [key, value] of expectedKorean) {
        assert.match(
            i18n,
            new RegExp(`'${key.replaceAll('.', '\\.')}':\\s*'${value}'`),
        );
    }
    for (const key of [
        'capture.status.waiting',
        'capture.status.capturing',
        'capture.status.processing',
        'capture.status.saved',
        'capture.status.failed',
        'capture.status.excludedSemantic',
        'capture.status.skippedSafety',
        'help.title',
        'help.description',
        'help.step1Title',
        'help.step1Description',
        'help.step2Title',
        'help.step2Description',
        'help.step3Title',
        'help.step3Description',
        'help.semanticNote',
        'help.troubleshootTitle',
        'help.troubleshootDescription',
    ]) {
        assert.match(i18n, new RegExp(`'${key.replaceAll('.', '\\.')}':`));
    }
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
    assert.match(cssBlock(css, '.st-devtools-window .st-devtools-help-trigger'), /width:\s*1\.5rem/);
    assert.match(cssBlock(css, '.st-devtools-window .st-devtools-help-trigger::before'), /width:\s*1\.1rem/);
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
    assert.match(cssBlock(css, '.st-devtools-settings-panel'), /width:\s*min\(480px, 100%\)/);
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
});
