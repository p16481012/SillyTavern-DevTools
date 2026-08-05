import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
    HELP_LABS,
    HELP_TOPIC_VISUALS,
    HELP_TOPICS,
    createHelpLabSession,
    updateHelpLabSession,
} from '../src/help-center.js';
import {
    ADVANCED_ONBOARDING_GUIDES,
    BASIC_ONBOARDING_SECTIONS,
    ONBOARDING_STEPS,
} from '../src/onboarding.js';
import { DevToolsWindow } from '../src/ui.js';

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

test('help registry covers every primary product screen, visual, and isolated lab', () => {
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
    assert.equal(HELP_TOPICS.length, 19);
    assert.equal(Object.keys(HELP_TOPIC_VISUALS).length, 19);
    assert.deepEqual(
        Object.keys(HELP_TOPIC_VISUALS),
        HELP_TOPICS.map(({ id }) => id),
    );
    assert.ok(Object.values(HELP_TOPIC_VISUALS).every((visual) => (
        visual.ariaLabel
        && visual.caption
        && visual.lanes.length > 0
    )));
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

test('the existing book launcher opens the three-path help home', async () => {
    const ui = await readFile(UI_URL, 'utf8');
    const build = sourceBlock(ui, '\n    build() {', '\n    loadRecentHelpTopics() {');

    assert.match(build, /fa-book-open/u);
    assert.match(build, /this\.openHelpCenter\(\{ view: 'home' \}\)/u);
    assert.match(build, /this\.buildHelpCenter\(\)/u);
    assert.doesNotMatch(build, /startOnboarding\(\{ invitation: true, force: true \}\)/u);
    assert.equal((build.match(/className: 'st-devtools-app-nav-item'/gu) ?? []).length, 1);
});

test('help home separates basic usage, advanced coachmarks, and detailed docs', async () => {
    const ui = await readFile(UI_URL, 'utf8');
    const homeCard = sourceBlock(
        ui,
        '\n    renderHelpHomeCard(',
        '\n    renderHelpHome() {',
    );
    const home = sourceBlock(
        ui,
        '\n    renderHelpHome() {',
        '\n    renderBasicHelpIndex() {',
    );
    const basic = sourceBlock(
        ui,
        '\n    renderBasicHelpIndex() {',
        '\n    renderAdvancedHelpIndex() {',
    );
    const advanced = sourceBlock(
        ui,
        '\n    renderAdvancedHelpIndex() {',
        '\n    renderHelpDocsIndex() {',
    );
    const docs = sourceBlock(
        ui,
        '\n    renderHelpDocsIndex() {',
        '\n    renderHelpHub() {',
    );

    assert.match(home, /title: '기본 사용법'/u);
    assert.match(home, /title: '고급 기능 가이드'/u);
    assert.match(home, /title: '기능 설명서'/u);
    assert.doesNotMatch(home, /현재 화면|연습실/u);
    assert.doesNotMatch(homeCard, /\$\{title\}\s*보기|help-home-card-action/u);
    assert.equal((homeCard.match(/card\.append\(/gu) ?? []).length, 1);
    assert.match(basic, /BASIC_ONBOARDING_SECTIONS/u);
    assert.match(basic, /section\.steps\.length/u);
    assert.match(basic, /sectionId: section\.id/u);
    assert.match(advanced, /ADVANCED_ONBOARDING_GUIDES/u);
    assert.match(advanced, /kind: 'advanced'/u);
    assert.doesNotMatch(advanced, /startHelpLab/u);
    assert.match(docs, /HELP_CATEGORIES/u);
    assert.match(docs, /helpTopicsFor/u);
});

test('detailed help articles reuse inert product renderers with onboarding fixtures', async () => {
    const ui = await readFile(UI_URL, 'utf8');
    const article = sourceBlock(
        ui,
        '\n    renderHelpTopicArticle(',
        '\n    renderHelpTopicVisual(',
    );
    const visual = sourceBlock(
        ui,
        '\n    renderHelpTopicVisual(',
        '\n    startHelpLab(',
    );

    assert.match(article, /helpTopicVisualById\(topic\.id\)/u);
    assert.match(article, /this\.renderHelpTopicFragments\(visual, topic\.sections\.length\)/u);
    assert.match(article, /for \(const \[index, \[title, body\]\] of topic\.sections\.entries\(\)\)/u);
    assert.match(article, /section\.append\(copy, visualFragments\[index\]\)/u);
    assert.match(article, /st-devtools-help-topic-section-number/u);
    assert.match(article, /section\.dataset\.helpSection = String\(index\)/u);
    assert.match(article, /article\.appendChild\(sections\)/u);
    assert.match(visual, /className: `st-devtools-help-visual is-\$\{visual\.type\}/u);
    assert.match(visual, /figure\.setAttribute\('role', 'img'\)/u);
    assert.match(visual, /visual\.ariaLabel/u);
    assert.match(visual, /st-devtools-help-visual-preview/u);
    assert.match(visual, /preview\.setAttribute\('aria-hidden', 'true'\)/u);
    assert.match(visual, /preview\.setAttribute\('inert', ''\)/u);
    assert.match(visual, /preview\.dataset\.helpSource = 'product-renderer'/u);
    assert.match(visual, /preview\.dataset\.helpFragment = String\(sectionIndex\)/u);
    assert.doesNotMatch(visual, /실제 화면의 해당 부분/u);
    assert.match(visual, /this\.renderHelpProductExcerpt\(visual\.id\)/u);
    assert.match(visual, /this\.helpProductFragmentNodes\(productSurface, visual\.id\)/u);
    assert.match(visual, /groups\[index\] \?\? groups\.at\(-1\)/u);
    assert.match(visual, /Object\.create\(DevToolsWindow\.prototype\)/u);
    assert.doesNotMatch(visual, /Object\.create\(this\)/u);
    assert.match(visual, /preview\.importedDiagnostics = null/u);
    assert.match(visual, /preview\.diagnosticImportError = null/u);
    assert.match(visual, /preview\.timeline = \[\]/u);
    assert.match(visual, /help-preview-read-only/u);
    assert.match(visual, /ONBOARDING_FIXTURE_SNAPSHOTS/u);
    assert.match(visual, /cloneNode\(true\)/u);
    assert.match(visual, /preview\.renderExplorer\(snapshot\)/u);
    assert.match(visual, /preview\.renderRules\(snapshot\)/u);
    assert.match(visual, /preview\.renderTimeline\(\)/u);
    assert.match(visual, /preview\.renderDiff\(\)/u);
    assert.match(visual, /preview\.renderSearch\(snapshot\)/u);
    assert.match(visual, /finally \{[\s\S]*?preview\.disposeVirtualLists\(\)/u);
    assert.match(visual, /ONBOARDING_FIXTURE_SNAPSHOTS\.slice\(1\)/u);
    assert.match(visual, /includedSources/u);
    assert.match(visual, /input\.value = query/u);
    assert.match(visual, /clone\.matches\?\.\('\.st-devtools-help-tooltip'\)/u);
    assert.match(visual, /clone\.querySelectorAll\?\.\([\s\S]*?\.st-devtools-help-tooltip/u);
    assert.doesNotMatch(visual, /localStorage|fetch\(/u);

    const fragmentRouter = sourceBlock(
        visual,
        '\n    helpProductFragmentNodes(',
        '\n    cloneHelpProductNode(',
    );
    for (const topic of HELP_TOPICS) {
        assert.match(
            fragmentRouter,
            new RegExp(`case '${topic.id}'`, 'u'),
            `missing product fragment route: ${topic.id}`,
        );
    }
});

test('empty state and help indexes keep compact, mobile-safe vertical rhythm', async () => {
    const [ui, style] = await Promise.all([
        readFile(UI_URL, 'utf8'),
        readFile(STYLE_URL, 'utf8'),
    ]);

    assert.match(ui, /st-devtools-help-full-start/u);
    assert.match(ui, /st-devtools-help-doc-results/u);
    assert.match(ui, /st-devtools-help-doc-category/u);
    assert.match(ui, /element\('details', \{[\s\S]*?st-devtools-help-doc-category/u);
    assert.match(ui, /st-devtools-help-doc-category-summary/u);
    assert.match(ui, /compact: true/u);
    assert.match(
        style,
        /\.st-devtools-empty \{[\s\S]*?display: grid;[\s\S]*?gap: 0\.75rem;/u,
    );
    assert.match(
        style,
        /\.st-devtools-empty-actions > \.menu_button \{[\s\S]*?min-height: 44px !important;[\s\S]*?padding: 0\.65rem 0\.9rem !important;/u,
    );
    assert.match(
        style,
        /\.st-devtools-help-full-start \{[\s\S]*?width: 100% !important;[\s\S]*?min-height: 46px !important;/u,
    );
    assert.match(
        style,
        /\.st-devtools-help-doc-results \{[\s\S]*?gap: 0\.8rem;[\s\S]*?margin-top: 0\.45rem;/u,
    );
    assert.match(
        style,
        /button\.st-devtools-help-list-row \{[\s\S]*?min-height: 60px !important;/u,
    );
    assert.match(
        style,
        /\.st-devtools-help-advanced-index[\s\S]*?\.st-devtools-help-accordion-list \{[\s\S]*?gap: 0\.75rem;/u,
    );
    assert.match(
        style,
        /\.st-devtools-help-section-row\.is-advanced-guide \{[\s\S]*?padding: 0\.9rem;/u,
    );
    assert.match(
        style,
        /\.st-devtools-help-list\.is-compact[\s\S]*?gap: 0;[\s\S]*?padding: 0\.18rem 0\.75rem;/u,
    );
    assert.match(
        style,
        /@container \(min-width: 680px\) \{[\s\S]*?\.st-devtools-help-list \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/u,
    );
    assert.match(
        style,
        /\.st-devtools-help-topic-section \{[\s\S]*?grid-template-columns: minmax\(14rem, 0\.8fr\) minmax\(0, 1\.2fr\);/u,
    );
    assert.match(
        style,
        /\.st-devtools-help-product-surface\[data-help-part\] \{[\s\S]*?max-height: none;[\s\S]*?overflow: visible;/u,
    );
});

test('basic sections cover the complete walkthrough once in the requested order', () => {
    assert.deepEqual(
        BASIC_ONBOARDING_SECTIONS.map(({ id }) => id),
        ['prompt', 'timeline', 'diff', 'rules', 'search'],
    );
    assert.deepEqual(
        BASIC_ONBOARDING_SECTIONS.map(({ steps }) => steps.length),
        [13, 6, 8, 7, 5],
    );
    const stepIds = BASIC_ONBOARDING_SECTIONS.flatMap(({ steps }) => (
        steps.map(({ id }) => id)
    ));
    assert.equal(stepIds.length, ONBOARDING_STEPS.length);
    assert.equal(new Set(stepIds).size, ONBOARDING_STEPS.length);
});

test('navigation actions keep their product destination as the debrief target', () => {
    const expected = new Map([
        [
            'rules-related-sources',
            ['explorer', '.st-devtools-source[data-source-id="tutorial:source:output"]'],
        ],
        ['timeline-open-snapshot', ['explorer', '.st-devtools-overview-card']],
        [
            'search-result-main-source',
            ['explorer', '.st-devtools-source[data-source-id="tutorial:source:main"]'],
        ],
    ]);

    for (const [id, [tabId, target]] of expected) {
        const step = ONBOARDING_STEPS.find((candidate) => candidate.id === id);
        assert.ok(step, `missing onboarding step: ${id}`);
        assert.equal(step.resultTabId, tabId);
        assert.equal(step.resultTarget, target);
    }
});

test('the included-only action highlights the filtered source result, not only its switch', () => {
    const step = ONBOARDING_STEPS.find((candidate) => (
        candidate.id === 'explorer-included-filter'
    ));
    assert.ok(step);
    assert.equal(step.target, '.st-devtools-explorer-filter');
    assert.equal(
        step.resultTarget,
        '.st-devtools-source-group[data-group="configured"]',
    );
});

test('advanced entries are coachmark step collections with no provider action', async () => {
    assert.deepEqual(
        ADVANCED_ONBOARDING_GUIDES.map(({ id }) => id),
        [
            'comparison-policy',
            'semantic-ai',
            'finding-review',
            'rule-structure',
            'diff-replacement',
        ],
    );
    assert.deepEqual(
        ADVANCED_ONBOARDING_GUIDES.map(({ steps }) => steps.length),
        [9, 10, 7, 7, 6],
    );
    assert.ok(ADVANCED_ONBOARDING_GUIDES.every(({ steps }) => steps.length >= 5));
    const ui = await readFile(UI_URL, 'utf8');
    const comparison = sourceBlock(
        ui,
        '\n    renderAdvancedComparisonGuide() {',
        '\n    renderAdvancedSemanticGuide() {',
    );
    const semantic = sourceBlock(
        ui,
        '\n    renderAdvancedSemanticGuide() {',
        '\n    renderAdvancedFindingReviewGuide() {',
    );
    const findingReview = sourceBlock(
        ui,
        '\n    renderAdvancedFindingReviewGuide() {',
        '\n    renderAdvancedRuleStructureGuide() {',
    );
    const ruleStructure = sourceBlock(
        ui,
        '\n    renderAdvancedRuleStructureGuide() {',
        '\n    renderAdvancedDiffReplacementGuide() {',
    );
    const diffReplacement = sourceBlock(
        ui,
        '\n    renderAdvancedDiffReplacementGuide() {',
        '\n    renderAdvancedOnboardingGuide() {',
    );
    const forbidden = /fetch\(|semanticInspector\.|startSemanticInspection|saveUiPreferences|localStorage/u;
    for (const renderer of [
        comparison,
        semantic,
        findingReview,
        ruleStructure,
        diffReplacement,
    ]) {
        assert.doesNotMatch(renderer, forbidden);
    }
    assert.match(semantic, /실제 제공자 요청과 비용은 발생하지 않습니다/u);
});

test('section and advanced routes cannot overwrite global onboarding completion', () => {
    const basic = {};
    assert.equal(DevToolsWindow.prototype.configureOnboardingRoute.call(basic, {
        kind: 'basic',
        sectionId: 'timeline',
    }), true);
    assert.equal(basic.onboardingPersistCompletion, false);
    assert.equal(basic.onboardingPersistSkip, false);
    assert.equal(basic.onboardingCheckpoint, 'timeline');
    assert.equal(basic.onboardingSteps.length, 6);

    const advanced = {};
    assert.equal(DevToolsWindow.prototype.configureOnboardingRoute.call(advanced, {
        kind: 'advanced',
        guideId: 'semantic-ai',
    }), true);
    assert.equal(advanced.onboardingPersistCompletion, false);
    assert.equal(advanced.onboardingPersistSkip, false);
    assert.equal(advanced.onboardingCheckpoint, 'advanced');

    const full = {};
    assert.equal(DevToolsWindow.prototype.configureOnboardingRoute.call(full), true);
    assert.equal(full.onboardingPersistCompletion, true);
    assert.equal(full.onboardingPersistSkip, true);
    assert.strictEqual(full.onboardingSteps, ONBOARDING_STEPS);
});

test('tooltip details are text deep links inside the short tooltip', async () => {
    const ui = await readFile(UI_URL, 'utf8');
    const tooltip = sourceBlock(ui, '\nfunction helpTooltip(', '\nfunction snapshotProviderDisplay(');
    const title = sourceBlock(ui, '\nfunction explainedTitle(', '\nfunction describedControlField(');
    assert.match(tooltip, /text: '자세히 보기'/u);
    assert.match(tooltip, /details\.dataset\.helpTopic = helpTopicId/u);
    assert.match(title, /helpTooltip\(description, title, \{ helpTopicId \}\)/u);
    assert.doesNotMatch(title, /fa-book-open/u);
});

test('help-started guides return to their index and legacy lab state cannot replace home', async () => {
    const ui = await readFile(UI_URL, 'utf8');
    const open = sourceBlock(ui, '\n    openHelpCenter(', '\n    closeHelpCenter(');
    const closeGuide = sourceBlock(
        ui,
        '\n    closeOnboarding(',
        '\n    beginOnboardingPractice()',
    );
    const closeWindow = sourceBlock(ui, '\n    close() {', '\n    build() {');

    assert.match(open, /this\.helpLabSession = null/u);
    assert.match(closeGuide, /helpReturnView && returnToHelp/u);
    assert.match(closeGuide, /this\.openHelpCenter\(\{ view: helpReturnView \}\)/u);
    assert.match(closeWindow, /returnToHelp: false/u);
});

test('advanced coachmarks stay on their declared screen and keep real settings hidden', async () => {
    const ui = await readFile(UI_URL, 'utf8');
    const style = await readFile(STYLE_URL, 'utf8');
    const selectTab = sourceBlock(ui, '\n    selectTab(', '\n    render() {');
    assert.deepEqual(
        ADVANCED_ONBOARDING_GUIDES.map(({ steps }) => steps[0].tabId),
        ['rules', 'rules', 'rules', 'rules', 'diff'],
    );
    assert.match(selectTab, /this\.onboardingKind === 'advanced'/u);
    assert.match(selectTab, /advancedOnboardingGuideById\(this\.onboardingGuideId\)/u);
    assert.match(selectTab, /\?\.steps\?\.\[0\]\?\.tabId \?\? 'rules'/u);
    assert.match(style, /\.st-devtools-window \.st-devtools-icon-button\[hidden\][\s\S]*?display:\s*none !important/u);
});

test('new detailed documents are reachable from related tooltip deep links', async () => {
    const ui = await readFile(UI_URL, 'utf8');
    for (const topicId of [
        'request-details',
        'diff-statuses',
        'rule-v3-structure',
        'semantic-provider-evaluation',
        'storage-data-tools',
    ]) {
        assert.match(ui, new RegExp(`helpTopicId: '${topicId}'`, 'u'));
    }
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
    assert.match(annotate, /TUTORIAL_COMPARISON_POLICY_SETTINGS/u);
    assert.match(annotate, /startsWith\('tutorial:snapshot:'\)/u);
    assert.match(annotate, /this\.savedComparisonPolicySettings/u);
    assert.match(diff, /source-lore-diff:v2/u);
    assert.match(diff, /comparisonPolicyDigest/u);
    assert.match(sourceChanges, /change\.status === 'replaced'/u);
    assert.match(sourceChanges, /diff\.replacementDescription/u);
    assert.match(sourceChanges, /change\.status === 'changed' && change\.optionChange/u);
    assert.match(sourceChanges, /diff\.optionChangeDescription/u);
});

test('sandbox exposes all three help paths and verifies storage/provider isolation', async () => {
    const sandbox = await readFile(SANDBOX_URL, 'utf8');
    const hook = sourceBlock(
        sandbox,
        '\nconst sandboxHelpHook = Object.freeze({',
        '\n\nconst sandboxApi = {',
    );
    assert.match(hook, /openHome/u);
    assert.match(hook, /openView/u);
    assert.match(hook, /startBasic/u);
    assert.match(hook, /startAdvanced/u);
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

test('search onboarding keeps horizontal scroll pinned while moving targets vertically', async () => {
    const ui = await readFile(UI_URL, 'utf8');
    const style = await readFile(STYLE_URL, 'utf8');
    const focusTarget = sourceBlock(
        ui,
        '\n    focusOnboardingTarget(',
        '\n    scheduleOnboardingGuidePosition(',
    );
    const selectTab = sourceBlock(ui, '\n    selectTab(', '\n    render() {');
    const content = sourceBlock(
        style,
        '.st-devtools-content {',
        '.st-devtools-screen-header {',
    );
    const overflowGuards = sourceBlock(
        style,
        '/* v0.16.2 — keep coachmark copy readable over large revealed targets. */',
        '/* Feature manual diagrams use product tokens so they remain legible in themes. */',
    );

    assert.match(content, /overflow-x:\s*hidden/u);
    assert.match(content, /overflow-y:\s*auto/u);
    assert.match(style, /\.st-devtools-window\.is-onboarding-practice \.st-devtools-content \{[\s\S]*?overflow-anchor: none;/u);
    assert.doesNotMatch(focusTarget, /scrollIntoView/u);
    assert.doesNotMatch(focusTarget, /onboardingPracticeBackButton/u);
    assert.match(
        focusTarget,
        /viewport\.scrollTo\(\{[\s\S]*?top: nextScrollTop,[\s\S]*?left: 0,[\s\S]*?behavior: scrollBehavior,[\s\S]*?\}\)/u,
    );
    assert.match(
        focusTarget,
        /const shouldScroll = \([\s\S]*?Math\.abs\(nextScrollTop - currentScrollTop\) > 0\.5[\s\S]*?Math\.abs\(currentScrollLeft\) > 0\.5[\s\S]*?\);/u,
    );
    assert.match(focusTarget, /if \(shouldScroll\) \{/u);
    assert.doesNotMatch(
        focusTarget,
        /if \(targetInContent\) viewport\.scrollLeft = 0/u,
    );
    assert.match(
        selectTab,
        /if \(changed && this\.content\) \{[\s\S]*?this\.content\.scrollTop = 0;[\s\S]*?this\.content\.scrollLeft = 0;/u,
    );
    assert.match(
        overflowGuards,
        /\.st-devtools-page,[\s\S]*?\.st-devtools-search-controls[\s\S]*?max-width:\s*100%;[\s\S]*?min-width:\s*0;/u,
    );
});

test('coachmark no-fit placement uses an opaque collision-safe callout', async () => {
    const ui = await readFile(UI_URL, 'utf8');
    const style = await readFile(STYLE_URL, 'utf8');
    const position = sourceBlock(
        ui,
        '\n    positionOnboardingGuide() {',
        '\n    buildCaptureStatus() {',
    );
    const clearTarget = sourceBlock(
        ui,
        '\n    clearOnboardingTarget({ preserveGuideGeometry = false } = {}) {',
        '\n    onboardingVisualTarget(',
    );
    const readability = sourceBlock(
        style,
        '/* v0.16.2 — keep coachmark copy readable over large revealed targets. */',
        '/* Feature manual diagrams use product tokens so they remain legible in themes. */',
    );

    assert.match(position, /const topFits = topSpace >= calloutHeight \+ pointerGap/u);
    assert.match(position, /const bottomFits = bottomSpace >= calloutHeight \+ pointerGap/u);
    assert.match(position, /const calloutOverTarget = !topFits && !bottomFits/u);
    assert.match(
        position,
        /classList\.toggle\([\s\S]*?'is-callout-over-target',[\s\S]*?calloutOverTarget/u,
    );
    assert.match(clearTarget, /'is-callout-over-target'/u);
    assert.match(
        readability,
        /\.st-devtools-onboarding-guide-body \{[\s\S]*?background(?:-color)?:\s*rgb\(6 11 22 \/ 96%\)/u,
    );
    assert.match(
        readability,
        /\[data-stage='debrief'\][\s\S]*?\.st-devtools-onboarding-guide-body \{[\s\S]*?background:\s*#061913/u,
    );
    assert.match(
        readability,
        /\.is-callout-over-target[\s\S]*?::before,[\s\S]*?\.is-callout-over-target[\s\S]*?::after \{[\s\S]*?display:\s*none/u,
    );
});

test('coachmark stages preposition before reveal and keep disclosure expansion stationary', async () => {
    const [ui, style] = await Promise.all([
        readFile(UI_URL, 'utf8'),
        readFile(STYLE_URL, 'utf8'),
    ]);
    const update = sourceBlock(
        ui,
        '\n    updateOnboardingView() {',
        '\n    syncOnboardingModalState(',
    );
    const surface = sourceBlock(
        ui,
        '\n    setOnboardingSurfaceActive(',
        '\n    synchronizeOnboardingStepCompletion(',
    );
    const focusable = sourceBlock(
        ui,
        '\n    focusableElements() {',
        '\n    handleDialogKeydown(',
    );
    const replaceBody = sourceBlock(
        ui,
        '\n    replaceOnboardingGuideBody(',
        '\n    synchronizeOnboardingStepCompletion(',
    );
    const recordAction = sourceBlock(
        ui,
        '\n    recordOnboardingAction(',
        '\n    handleOnboardingInteraction(',
    );
    const preposition = sourceBlock(
        ui,
        '\n    prepositionOnboardingTarget() {',
        '\n    onboardingSafeViewportBounds(',
    );
    const syncPreposition = sourceBlock(
        ui,
        '\n    synchronizeOnboardingPrepositionState(',
        '\n    cancelOnboardingPreposition(',
    );
    const settle = sourceBlock(
        ui,
        '\n    scheduleOnboardingRevealSettle(',
        '\n    onboardingAutoScrollAtDestination(',
    );
    const stableCoachmark = sourceBlock(
        style,
        '/* v0.16.10 — stable coachmark shading and calmer help information hierarchy. */',
        '.st-devtools-advanced-guide-card',
    );
    const stableSpotlight = sourceBlock(
        stableCoachmark,
        '.st-devtools-onboarding-spotlight {',
        '.st-devtools-onboarding-guide.is-prepositioning',
    );

    assert.match(update, /setOnboardingSurfaceActive\(this\.onboardingGuidePanel, modalStage\)/u);
    assert.match(update, /setOnboardingSurfaceActive\(this\.onboardingPracticeDock, !modalStage\)/u);
    assert.match(update, /refreshOnboardingTarget\(\{ preserveGuideGeometry \}\)/u);
    assert.match(update, /const settlingReveal = disclosureCompleted/u);
    assert.match(
        update,
        /const targetAvailable = Boolean\(this\.onboardingTarget\)/u,
    );
    assert.match(update, /let actionCompleted = false/u);
    assert.match(update, /actionCompleted = Boolean\([\s\S]*?!stepChanged[\s\S]*?stageChanged/u);
    assert.match(
        update,
        /shouldPreposition = Boolean\([\s\S]*?\(stepChanged \|\| stageChanged\)[\s\S]*?!disclosureCompleted/u,
    );
    assert.match(update, /synchronizeOnboardingPrepositionState\(\{/u);
    assert.match(
        syncPreposition,
        /if \(shouldPreposition\) \{[\s\S]*?setOnboardingPrepositioning\(true\)/u,
    );
    assert.match(
        syncPreposition,
        /if \(contextChanged \|\| !prepositionInProgress\)[\s\S]*?cancelOnboardingPreposition/u,
    );
    assert.match(update, /if \(shouldPreposition && targetAvailable\) \{[\s\S]*?prepositionOnboardingTarget\(\)/u);
    assert.match(
        update,
        /else if \(shouldPreposition\) \{[\s\S]*?cancelOnboardingPreposition\(\)[\s\S]*?clearOnboardingTarget\(\)[\s\S]*?scheduleOnboardingGuidePosition\(\)/u,
    );
    assert.match(
        update,
        /if \(disclosureCompleted && this\.content\)[\s\S]*?top: Number\(this\.content\.scrollTop/u,
    );
    assert.match(
        update,
        /if \(disclosureScrollPosition\) \{[\s\S]*?restoreOnboardingScrollPosition\(disclosureScrollPosition\)/u,
    );
    assert.match(
        update,
        /if \(settlingReveal\)[\s\S]*?scheduleOnboardingRevealSettle\(300\)/u,
    );
    assert.doesNotMatch(update, /const targetAvailable[\s\S]*?focusOnboardingTarget/u);
    assert.match(preposition, /anchor: 'upper-center'/u);
    assert.match(preposition, /behavior: 'auto'/u);
    assert.doesNotMatch(preposition, /behavior: 'smooth'/u);
    assert.doesNotMatch(settle, /refocus:\s*true/u);
    assert.match(settle, /setOnboardingDisclosureRevealing\(false\)/u);
    assert.doesNotMatch(
        stableSpotlight,
        /transition:[^;]*(?:opacity|box-shadow)/u,
    );
    assert.match(
        stableCoachmark,
        /\.is-disclosure-revealing[\s\S]*?\.st-devtools-onboarding-spotlight \{[\s\S]*?transition: none;[\s\S]*?animation: none;/u,
    );
    assert.match(
        stableCoachmark,
        /\[data-stage='debrief'\][\s\S]*?\.st-devtools-onboarding-spotlight \{[\s\S]*?filter: none;[\s\S]*?animation: none;/u,
    );
    assert.match(surface, /surface\.hidden = false/u);
    assert.match(surface, /classList\.toggle\('is-active', active\)/u);
    assert.match(surface, /toggleAttribute\('inert', !active\)/u);
    assert.match(surface, /setAttribute\('aria-hidden', String\(!active\)\)/u);
    assert.match(replaceBody, /body\.replaceChildren\(content\)/u);
    assert.doesNotMatch(recordAction, /preserveContentScrollTop|restoreActionScroll/u);
    assert.doesNotMatch(ui, /st-devtools-onboarding-copy-leaving/u);
    assert.doesNotMatch(ui, /st-devtools-onboarding-copy-entering/u);
    assert.doesNotMatch(ui, /onboardingTransitionLocked/u);
    assert.match(
        focusable,
        /!node\.closest\('\[hidden\], \[inert\], \[aria-hidden="true"\]'\)/u,
    );
    assert.match(
        style,
        /\.st-devtools-onboarding-guide-panel:not\(\.is-active\),[\s\S]*?visibility: hidden;[\s\S]*?pointer-events: none !important;/u,
    );
    assert.doesNotMatch(style, /@keyframes st-devtools-onboarding-copy-enter/u);
    assert.doesNotMatch(style, /st-devtools-onboarding-copy-leaving/u);
    assert.doesNotMatch(style, /st-devtools-onboarding-copy-entering/u);
    assert.match(style, /@supports \(interpolate-size: allow-keywords\)/u);
    assert.match(style, /details::details-content \{[\s\S]*?transition: block-size 240ms/u);
    assert.match(style, /\.st-devtools-onboarding-guide\.is-prepositioning[\s\S]*?\.st-devtools-onboarding-spotlight \{[\s\S]*?opacity:\s*0/u);
    assert.match(style, /\.st-devtools-onboarding-practice-dock\.has-panel-action \{[\s\S]*?width: min\(560px/u);
    assert.match(
        style,
        /@container \(max-width: 520px\) \{[\s\S]*?\.st-devtools-onboarding-practice-dock\.has-panel-action \{[\s\S]*?display: grid;[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/u,
    );
    assert.match(
        style,
        /\.st-devtools-onboarding-practice-dock\.has-panel-action[\s\S]*?> \.st-devtools-onboarding-practice-action \{[\s\S]*?width: 100% !important/u,
    );
});

test('completed onboarding actions remain available to the deferred positioning pass', () => {
    const step = ONBOARDING_STEPS.find(({ id }) => id === 'explorer-included-filter');
    assert.ok(step);

    const scheduledPositions = [];
    const prepositioned = [];
    const guideClasses = new Set();
    const state = {
        onboardingPhase: 'steps',
        onboardingSteps: [step],
        onboardingStepIndex: 0,
        onboardingStepStage: 'debrief',
        onboardingKind: 'basic',
        onboardingGuide: {
            hidden: true,
            dataset: {
                step: step.id,
                stage: 'practice',
            },
            classList: {
                toggle(name, force) {
                    if (force) guideClasses.add(name);
                    else guideClasses.delete(name);
                },
                contains: (name) => guideClasses.has(name),
            },
        },
        onboardingSession: {
            tabId: step.tabId,
            completedActions: new Set([step.id]),
            skippedActions: new Set(),
        },
        onboardingInvitationOverlay: { hidden: false },
        onboardingProgress: { textContent: '' },
        onboardingAnnouncement: { textContent: '' },
        onboardingGuidePanel: {
            contains: () => false,
            focus() {},
        },
        onboardingPracticeDock: {},
        onboardingPracticeBackButton: {},
        onboardingPracticeExitButton: {},
        onboardingBlocker: {
            hidden: true,
            classList: { toggle() {} },
        },
        onboardingBackButton: {},
        onboardingNextButton: {
            setAttribute() {},
        },
        onboardingBody: {
            firstElementChild: {},
            scrollTop: 0,
        },
        onboardingPracticeActions: {
            replaceChildren() {},
        },
        window: {
            dataset: {},
            classList: {
                remove() {},
                toggle() {},
            },
        },
        onboardingIsOpen: () => true,
        onboardingGroupLabel: () => '프롬프트',
        onboardingStepCopy: () => '테스트 단계',
        currentOnboardingStep: () => step,
        syncOnboardingModalState() {},
        setOnboardingSurfaceActive() {},
        replaceOnboardingGuideBody() {},
        renderOnboardingStep: () => ({}),
        setOnboardingPrepositioning(active) {
            this.onboardingGuide.classList.toggle('is-prepositioning', active);
        },
        setOnboardingDisclosureRevealing() {},
        synchronizeOnboardingPrepositionState(options) {
            return DevToolsWindow.prototype.synchronizeOnboardingPrepositionState.call(
                this,
                options,
            );
        },
        cancelOnboardingPreposition() {},
        refreshOnboardingTarget() {
            this.onboardingTarget = {};
        },
        prepositionOnboardingTarget() {
            prepositioned.push(this.onboardingTarget);
        },
        scheduleOnboardingRevealSettle() {
            assert.fail('a click action must not use the toggle reveal-settle path');
        },
        scheduleOnboardingGuidePosition(options) {
            scheduledPositions.push(options);
        },
    };

    const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const originalQueueMicrotask = globalThis.queueMicrotask;
    Object.defineProperty(globalThis, 'document', {
        configurable: true,
        writable: true,
        value: { activeElement: null },
    });
    globalThis.queueMicrotask = (callback) => callback();
    try {
        assert.doesNotThrow(() => {
            DevToolsWindow.prototype.updateOnboardingView.call(state);
        });
    } finally {
        globalThis.queueMicrotask = originalQueueMicrotask;
        if (documentDescriptor) {
            Object.defineProperty(globalThis, 'document', documentDescriptor);
        } else {
            delete globalThis.document;
        }
    }

    assert.equal(prepositioned.length, 1);
    assert.deepEqual(scheduledPositions, []);
});

test('advanced guide previews and results stay hidden until their step reveals them', async () => {
    const style = await readFile(STYLE_URL, 'utf8');
    assert.match(
        style,
        /\.st-devtools-advanced-guide-page \[hidden\] \{[\s\S]*?display:\s*none !important;/u,
    );
});

test('AI practice copy stays explicit without sounding like a fake provider action', async () => {
    const ui = await readFile(UI_URL, 'utf8');
    assert.match(ui, /text: '연습 AI 분석 실행'/u);
    assert.doesNotMatch(ui, /가짜 AI 분석 실행/u);
    assert.equal(HELP_LABS.some(({ description }) => description.includes('가짜 AI')), false);
});
