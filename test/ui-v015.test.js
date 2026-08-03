import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { DevToolsWindow } from '../src/ui.js';

const UI_URL = new URL('../src/ui.js', import.meta.url);
const I18N_URL = new URL('../src/i18n.js', import.meta.url);
const STYLE_URL = new URL('../style.css', import.meta.url);
const SANDBOX_URL = new URL('../sandbox/ui-harness.js', import.meta.url);

function sourceBlock(source, start, end) {
    const startIndex = source.indexOf(start);
    assert.notEqual(startIndex, -1, `missing block start: ${start}`);
    const endIndex = source.indexOf(end, startIndex + start.length);
    assert.notEqual(endIndex, -1, `missing block end: ${end}`);
    return source.slice(startIndex, endIndex);
}

test('v0.15 onboarding is a skippable modal with explicit focus and replay controls', async () => {
    const ui = await readFile(UI_URL, 'utf8');
    const build = sourceBlock(
        ui,
        '\n    buildOnboardingLayer() {',
        '\n    onboardingIsOpen() {',
    );
    const lifecycle = sourceBlock(
        ui,
        '\n    onboardingIsOpen() {',
        '\n    renderOnboardingInvitation() {',
    );
    assert.match(ui, /className: 'menu_button st-devtools-icon-button st-devtools-onboarding-launcher'/u);
    assert.match(ui, /title: t\('action\.onboarding'\)/u);
    assert.match(ui, /this\.buildOnboardingLayer\(\)/u);
    assert.match(build, /setAttribute\('role', 'dialog'\)/u);
    assert.match(build, /setAttribute\('aria-modal', 'true'\)/u);
    assert.match(build, /aria-labelledby/u);
    assert.match(build, /aria-describedby/u);
    assert.match(build, /setAttribute\('aria-live', 'polite'\)/u);
    assert.match(build, /st-devtools-onboarding-announcement/u);
    assert.match(build, /text: t\('onboarding\.skip'\)/u);
    assert.match(build, /previousOnboardingStep/u);
    assert.match(build, /nextOnboardingStep/u);
    assert.match(lifecycle, /region\.inert = true/u);
    assert.match(lifecycle, /region\.setAttribute\('aria-hidden', 'true'\)/u);
    assert.match(lifecycle, /region\.inert = false/u);
    assert.match(lifecycle, /saveOnboardingState\(persist\)/u);
    assert.match(ui, /this\.onboardingIsOpen\(\)[\s\S]*?this\.onboardingPanel/u);
    assert.match(ui, /if \(this\.onboardingIsOpen\(\)\) \{\s*this\.closeOnboarding\(\{ persist: 'skipped' \}\)/u);
});

test('walkthrough waits for an ordinary AI provider call to settle', () => {
    const state = {
        semanticInspectionState: { status: 'cancelled' },
        semanticInspector: { activeCallCount: () => 1 },
        settingsOverlay: null,
        rulesSettingsOverlay: null,
        semanticConsentOverlay: null,
        semanticEvaluationIsActive: () => false,
    };
    assert.equal(DevToolsWindow.prototype.onboardingCanStart.call(state), false);

    state.semanticInspector.activeCallCount = () => 0;
    assert.equal(DevToolsWindow.prototype.onboardingCanStart.call(state), true);

    state.semanticInspector.activeCallCount = () => {
        throw new Error('private provider state');
    };
    assert.equal(DevToolsWindow.prototype.onboardingCanStart.call(state), false);
});

test('automatic invitation is offered at most once per panel session', async () => {
    let starts = 0;
    const state = {
        onboardingAutoAttempted: false,
        onboardingAutoStart: true,
        onboardingState: {
            schemaVersion: 1,
            tourVersion: 1,
            disposition: 'new',
        },
        startOnboarding() {
            starts += 1;
            return true;
        },
    };
    assert.equal(DevToolsWindow.prototype.maybeOfferOnboarding.call(state), true);
    await new Promise((resolve) => queueMicrotask(resolve));
    assert.equal(starts, 1);
    assert.equal(DevToolsWindow.prototype.maybeOfferOnboarding.call(state), false);
    assert.equal(starts, 1);
});

test('walkthrough examples stay isolated from product data and provider actions', async () => {
    const ui = await readFile(UI_URL, 'utf8');
    const renderer = sourceBlock(
        ui,
        '\n    renderOnboardingInvitation() {',
        '\n    requestOnboardingPosition() {',
    );
    const lifecycle = sourceBlock(
        ui,
        '\n    onboardingIsOpen() {',
        '\n    renderOnboardingInvitation() {',
    );
    const clearLocalData = sourceBlock(
        ui,
        '\n    clearLocalData() {',
        '\n    tabElementId(',
    );

    assert.doesNotMatch(renderer, /innerHTML|insertAdjacentHTML|createElement\(['"]img|<img|https?:\/\//u);
    assert.doesNotMatch(renderer, /selectedSnapshot|getContext|this\.timeline|this\.store|semanticInspector|semanticEvaluationHarness/u);
    assert.doesNotMatch(renderer, /clipboard|download|serialize|export|localStorage/u);
    assert.doesNotMatch(lifecycle, /selectTab|LAST_TAB_KEY|selectedId|openSourceIds/u);
    assert.match(clearLocalData, /this\.onboardingState = readOnboardingState\(\);\s*this\.onboardingAutoAttempted = false/u);
    assert.match(ui, /advanceSemanticProviderEvaluation\(\) \{\s*if \(this\.onboardingIsOpen\(\)\) return Promise\.resolve\(null\)/u);
    assert.match(ui, /requestSemanticConsent\(preview\) \{\s*if \(this\.onboardingIsOpen\(\)\) return Promise\.resolve\(false\)/u);
    assert.match(ui, /async startSemanticInspection\([\s\S]*?this\.onboardingIsOpen\(\)/u);
});

test('every walkthrough step has concrete Korean copy and a persistent practice-data label', async () => {
    const i18n = await readFile(I18N_URL, 'utf8');
    const stepIds = ['capture', 'explorer', 'rules', 'timeline', 'diff', 'search'];
    for (const id of stepIds) {
        assert.match(i18n, new RegExp(`'onboarding\\.step\\.${id}\\.title':`, 'u'));
        assert.match(i18n, new RegExp(`'onboarding\\.step\\.${id}\\.description':`, 'u'));
    }
    assert.match(i18n, /'onboarding\.demoLabel': '연습 데이터 · 저장·전송 안 함'/u);
    assert.match(i18n, /실제 채팅이나 저장된 요청은 바꾸지 않습니다/u);
    assert.match(i18n, /어떤 지시가 실제 요청에 포함됐는지 확인/u);
    assert.match(i18n, /두 근거 문장을 함께 확인/u);
    assert.match(i18n, /토큰이 급증한 시점/u);
    assert.match(i18n, /추가, 수정, 삭제된 소스/u);
    assert.match(i18n, /모든 포함 소스에서 일치한 위치/u);
    assert.match(i18n, /실제 위치 · 하단 ‘\{tab\}’ 탭/u);

    const onboardingCopy = i18n
        .split('\n')
        .filter((line) => line.includes("'onboarding."))
        .join('\n');
    assert.doesNotMatch(onboardingCopy, /https?:\/\/|api[_ -]?key|bearer\s|BEGIN [A-Z ]*PRIVATE KEY|@[a-z0-9.-]+\.[a-z]{2,}/iu);
});

test('coachmark layout is theme-resistant and becomes a bounded mobile bottom sheet', async () => {
    const style = await readFile(STYLE_URL, 'utf8');
    assert.match(style, /\.st-devtools-onboarding-overlay\s*\{[\s\S]*?position: absolute;[\s\S]*?z-index: 80/u);
    assert.match(style, /\.st-devtools-onboarding-highlight\s*\{[\s\S]*?box-shadow:/u);
    assert.match(style, /\.st-devtools-onboarding-panel\s*\{[\s\S]*?max-height:/u);
    assert.match(style, /@media \(max-width: 700px\)[\s\S]*?\.st-devtools-onboarding-overlay:not\(\.is-centered\)[\s\S]*?bottom: calc\(74px \+ env\(safe-area-inset-bottom\)\)/u);
    assert.match(style, /@media \(prefers-reduced-motion: reduce\)/u);
    assert.match(style, /\.st-devtools-onboarding-demo-chart-line/u);
    assert.match(style, /\.st-devtools-onboarding-demo-chart-point\.is-selected/u);
});

test('sandbox exposes deterministic walkthrough controls without automatic product calls', async () => {
    const sandbox = await readFile(SANDBOX_URL, 'utf8');
    assert.match(sandbox, /onboardingAutoStart: false/u);
    assert.match(sandbox, /document\.getElementById\('sandbox-onboarding'\)/u);
    assert.match(sandbox, /onboarding:\s*\{[\s\S]*?start:[\s\S]*?next:[\s\S]*?back:[\s\S]*?skip:[\s\S]*?status:/u);
    assert.match(sandbox, /document\.body\.dataset\.semanticNetworkCallCount = '0'/u);
});
