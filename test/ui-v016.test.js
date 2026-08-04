import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
    HELP_LABS,
    HELP_TOPICS,
    createHelpLabSession,
    updateHelpLabSession,
} from '../src/help-center.js';

const UI_URL = new URL('../src/ui.js', import.meta.url);
const STYLE_URL = new URL('../style.css', import.meta.url);
const SANDBOX_URL = new URL('../sandbox/ui-harness.js', import.meta.url);

function sourceBlock(source, start, end) {
    const startIndex = source.indexOf(start);
    assert.notEqual(startIndex, -1, `missing block start: ${start}`);
    const endIndex = source.indexOf(end, startIndex + start.length);
    assert.notEqual(endIndex, -1, `missing block end: ${end}`);
    return source.slice(startIndex, endIndex);
}

test('help registry covers every primary product screen and both isolated labs', () => {
    const coveredTabs = new Set(HELP_TOPICS.map(({ tabId }) => tabId).filter(Boolean));
    assert.deepEqual(
        [...coveredTabs].sort(),
        ['diff', 'explorer', 'rules', 'search', 'timeline'],
    );
    assert.deepEqual(
        HELP_LABS.map(({ id }) => id),
        ['comparison-policy', 'semantic-ai'],
    );
    assert.ok(HELP_TOPICS.some(({ id }) => id === 'diff-statuses'));
    assert.ok(HELP_TOPICS.some(({ id }) => id === 'settings-storage'));
});

test('help labs are deterministic memory-only state machines', () => {
    let comparison = createHelpLabSession('comparison-policy');
    comparison = updateHelpLabSession(comparison, {
        type: 'choose-matcher',
        value: '{group} | {option}',
    });
    comparison = updateHelpLabSession(comparison, {
        type: 'choose-mode',
        value: 'alternative',
    });
    comparison = updateHelpLabSession(comparison, { type: 'preview' });
    comparison = updateHelpLabSession(comparison, { type: 'finish' });
    assert.equal(comparison.completed, true);
    assert.deepEqual(comparison.isolation, {
        dummyData: true,
        writesStorage: false,
        sendsProviderRequest: false,
        incursCost: false,
    });

    let semantic = createHelpLabSession('semantic-ai');
    semantic = updateHelpLabSession(semantic, {
        type: 'select-finding',
        value: 'language-conflict',
    });
    semantic = updateHelpLabSession(semantic, { type: 'preview' });
    semantic = updateHelpLabSession(semantic, { type: 'consent', value: true });
    semantic = updateHelpLabSession(semantic, { type: 'run' });
    semantic = updateHelpLabSession(semantic, { type: 'complete' });
    assert.equal(semantic.completed, true);
    assert.strictEqual(semantic.isolation, comparison.isolation);
});

test('the existing help launcher opens one help hub instead of adding navigation', async () => {
    const ui = await readFile(UI_URL, 'utf8');
    const build = sourceBlock(ui, '\n    build() {', '\n    loadRecentHelpTopics() {');

    assert.match(build, /fa-book-open/u);
    assert.match(build, /this\.openHelpCenter\(\{ view: 'current' \}\)/u);
    assert.match(build, /this\.buildHelpCenter\(\)/u);
    assert.doesNotMatch(build, /startOnboarding\(\{ invitation: true, force: true \}\)/u);
    assert.equal((build.match(/className: 'st-devtools-app-nav-item'/gu) ?? []).length, 1);
});

test('help dialog owns focus, Escape, and timer cancellation', async () => {
    const ui = await readFile(UI_URL, 'utf8');
    const focus = sourceBlock(ui, '\n    focusableElements() {', '\n    handleDialogKeydown(event) {');
    const keydown = sourceBlock(ui, '\n    handleDialogKeydown(event) {', '\n    loadComparisonPolicySettings() {');
    const close = sourceBlock(ui, '\n    closeHelpCenter(', '\n    clearHelpLabTimer() {');
    const canStart = sourceBlock(ui, '\n    onboardingCanStart() {', '\n    maybeOfferOnboarding() {');
    const updateLab = sourceBlock(ui, '\n    updateHelpLab(action) {', '\n    renderHelpLabBanner() {');

    assert.match(focus, /this\.helpOverlay && !this\.helpOverlay\.hidden[\s\S]*?this\.helpPanel/u);
    assert.match(keydown, /this\.closeHelpCenter\(\)/u);
    assert.match(keydown, /this\.helpPanel/u);
    assert.match(keydown, /active === focusScope/u);
    assert.match(close, /this\.clearHelpLabTimer\(\)/u);
    assert.match(canStart, /this\.helpOverlay && !this\.helpOverlay\.hidden/u);
    assert.equal((updateLab.match(/this\.resetHelpScroll\(\)/gu) ?? []).length, 2);
});

test('practice renderers never call the real store or semantic provider path', async () => {
    const ui = await readFile(UI_URL, 'utf8');
    const comparison = sourceBlock(
        ui,
        '\n    renderComparisonPolicyLab(session) {',
        '\n    renderHelpMetric(',
    );
    const semantic = sourceBlock(
        ui,
        '\n    renderSemanticAiLab(session) {',
        '\n    renderHelpLab(session) {',
    );
    const update = sourceBlock(ui, '\n    updateHelpLab(action) {', '\n    renderHelpLabBanner() {');
    const forbidden = /store\.|saveComparison|saveSemantic|startSemanticInspection|semanticInspector\.|semanticProvider|fetch\(/u;

    assert.doesNotMatch(comparison, forbidden);
    assert.doesNotMatch(semantic, forbidden);
    assert.doesNotMatch(update, forbidden);
    assert.match(comparison, /refreshHelpCenter\(\{ focusTitle: true \}\);\s*this\.resetHelpScroll\(\)/u);
    assert.match(update, /setTimeout/u);
    assert.match(update, /this\.helpLabSession !== expectedSession/u);
});

test('source comparison annotates saved policies and renders option replacement', async () => {
    const ui = await readFile(UI_URL, 'utf8');
    const annotate = sourceBlock(
        ui,
        '\n    snapshotWithSavedComparisonPolicies(snapshot) {',
        '\n    renderDiff() {',
    );
    const diff = sourceBlock(ui, '\n    renderDiff() {', '\n    appendDiffMarkup(');
    const sourceChanges = sourceBlock(
        ui,
        '\n    renderSourceChanges(',
        '\n    renderLoreChanges(',
    );

    assert.match(annotate, /annotateSourcesWithPolicies/u);
    assert.match(annotate, /this\.savedComparisonPolicySettings/u);
    assert.match(diff, /source-lore-diff:v2/u);
    assert.match(diff, /comparisonPolicyDigest/u);
    assert.match(sourceChanges, /change\.status === 'replaced'/u);
    assert.match(sourceChanges, /diff\.replacementDescription/u);
    assert.match(sourceChanges, /change\.status === 'changed' && change\.optionChange/u);
    assert.match(sourceChanges, /diff\.optionChangeDescription/u);
});

test('sandbox exposes help flows and verifies storage/provider isolation', async () => {
    const sandbox = await readFile(SANDBOX_URL, 'utf8');
    const hook = sourceBlock(
        sandbox,
        '\nconst sandboxHelpHook = Object.freeze({',
        '\n\nconst sandboxApi = {',
    );
    assert.match(hook, /openHome/u);
    assert.match(hook, /startLab/u);
    assert.match(hook, /waitForCompletion/u);
    assert.match(sandbox, /function sandboxHelpIsolationStatus\(\)[\s\S]*?providerCalls/u);
    assert.match(sandbox, /function sandboxHelpIsolationSnapshot\(\)[\s\S]*?comparisonPolicySettings/u);
    assert.match(sandbox, /help: sandboxHelpHook/u);
});

test('help center has one scroll owner and a mobile full-screen layout', async () => {
    const style = await readFile(STYLE_URL, 'utf8');
    assert.match(style, /\.st-devtools-help-panel/u);
    assert.match(style, /\.st-devtools-help-body/u);
    assert.match(style, /@media \(max-width: 520px\)/u);
    assert.match(
        sourceBlock(style, '.st-devtools-help-panel {', '.st-devtools-help-header {'),
        /overflow:\s*hidden/u,
    );
    assert.match(
        sourceBlock(style, '.st-devtools-help-body {', '.st-devtools-help-view {'),
        /overflow-y:\s*auto/u,
    );
    assert.doesNotMatch(
        sourceBlock(style, '.st-devtools-help-view {', '.st-devtools-help-view :is('),
        /overflow(?:-y)?:\s*(?:auto|scroll)/u,
    );
    assert.match(
        style,
        /@media \(max-width: 700px\)[\s\S]*?\.st-devtools-window \{[\s\S]*?min-height:\s*0;/u,
    );
});

test('AI practice copy stays explicit without sounding like a fake provider action', async () => {
    const ui = await readFile(UI_URL, 'utf8');
    assert.match(ui, /text: '연습 AI 분석 실행'/u);
    assert.doesNotMatch(ui, /가짜 AI 분석 실행/u);
    assert.equal(HELP_LABS.some(({ description }) => description.includes('가짜 AI')), false);
});
