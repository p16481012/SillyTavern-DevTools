import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createOnboardingSession } from '../src/onboarding-fixture.js';
import { ONBOARDING_STEPS } from '../src/onboarding.js';
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

function sourceTail(source, start) {
    const startIndex = source.indexOf(start);
    assert.notEqual(startIndex, -1, `missing block start: ${start}`);
    return source.slice(startIndex);
}

function onboardingStep(id) {
    const step = ONBOARDING_STEPS.find((candidate) => candidate.id === id);
    assert.ok(step, `missing onboarding step: ${id}`);
    return step;
}

test('hands-on practice owns an isolated two-snapshot view instead of borrowing live state', () => {
    const first = createOnboardingSession();
    const second = createOnboardingSession();

    assert.equal(first.timeline.length, 2);
    assert.equal(first.availableTimeline.length, 3);
    assert.equal(first.selectedId, first.timeline.at(-1).id);
    assert.notStrictEqual(first.timeline, first.availableTimeline);
    assert.notStrictEqual(first.timeline, second.timeline);
    assert.notStrictEqual(first.openSourceIds, second.openSourceIds);
    assert.notStrictEqual(first.completedActions, second.completedActions);

    first.timeline.push(first.availableTimeline.at(-1));
    first.openSourceIds.add('tutorial:source:main');
    assert.equal(first.timeline.length, 3);
    assert.equal(second.timeline.length, 2);
    assert.equal(second.openSourceIds.size, 0);

    const liveTimeline = [{ id: 'live:snapshot' }];
    const listeners = [];
    const state = {
        timeline: liveTimeline,
        selectedId: 'live:snapshot',
        onboardingSession: null,
        onboardingPhase: 'idle',
        onboardingStepIndex: -1,
        onboardingStepComplete: true,
        onboardingStepSkipped: true,
        primaryRegions: [],
        onboardingSessionBadge: { hidden: true },
        window: {
            setAttribute() {},
            classList: { add() {} },
            addEventListener(type) {
                listeners.push(type);
            },
        },
        updateCaptureStatus() {},
        render() {},
        updateOnboardingView() {},
    };

    assert.equal(DevToolsWindow.prototype.beginOnboardingPractice.call(state), true);
    assert.deepEqual(state.timeline, liveTimeline);
    assert.equal(state.selectedId, 'live:snapshot');
    assert.deepEqual(
        state.onboardingSession.timeline.map(({ id }) => id),
        ['tutorial:snapshot:1', 'tutorial:snapshot:2'],
    );
    assert.equal(state.onboardingSessionBadge.hidden, false);
    assert.deepEqual(
        listeners,
        ['click', 'change', 'input', 'toggle', 'focusin'],
    );
});

test('active view accessors and tab changes stay inside the practice session', async () => {
    const session = createOnboardingSession();
    const liveTimeline = [{ id: 'live:snapshot' }];
    const state = {
        onboardingSession: session,
        onboardingPhase: 'steps',
        timeline: liveTimeline,
        timelineTotalCount: 99,
        selectedId: 'live:snapshot',
        activeTab: 'search',
        content: { scrollTop: 120 },
        root: null,
        tutorialIsActive() {
            return DevToolsWindow.prototype.tutorialIsActive.call(this);
        },
        activeTabId() {
            return DevToolsWindow.prototype.activeTabId.call(this);
        },
        renderCalls: 0,
        render() {
            this.renderCalls += 1;
        },
    };

    assert.strictEqual(DevToolsWindow.prototype.activeTimeline.call(state), session.timeline);
    assert.equal(DevToolsWindow.prototype.activeTimelineTotalCount.call(state), 2);
    assert.equal(DevToolsWindow.prototype.activeSelectedId.call(state), session.selectedId);
    assert.equal(DevToolsWindow.prototype.activeTabId.call(state), 'explorer');
    assert.equal(DevToolsWindow.prototype.selectedSnapshot.call({
        ...state,
        activeTimeline: () => DevToolsWindow.prototype.activeTimeline.call(state),
        activeSelectedId: () => DevToolsWindow.prototype.activeSelectedId.call(state),
    }).id, session.selectedId);

    // The tutorial branch must not need or write global localStorage.
    DevToolsWindow.prototype.selectTab.call(state, 'rules');
    assert.equal(session.tabId, 'rules');
    assert.equal(state.activeTab, 'search');
    assert.equal(state.renderCalls, 1);
    assert.equal(state.content.scrollTop, 0);

    state.onboardingPhase = 'idle';
    assert.strictEqual(DevToolsWindow.prototype.activeTimeline.call(state), liveTimeline);
    assert.equal(DevToolsWindow.prototype.activeTimelineTotalCount.call(state), 99);
    assert.equal(DevToolsWindow.prototype.activeSelectedId.call(state), 'live:snapshot');
    assert.equal(DevToolsWindow.prototype.activeTabId.call(state), 'search');

    const ui = await readFile(UI_URL, 'utf8');
    const selectTab = sourceBlock(ui, '\n    selectTab(id, { focus = false } = {}) {', '\n    render() {');
    assert.match(
        selectTab,
        /if \(this\.tutorialIsActive\(\)\) \{\s*this\.onboardingSession\.tabId = nextTab;\s*\} else \{[\s\S]*?localStorage\.setItem\(LAST_TAB_KEY, this\.activeTab\)/u,
    );
});

test('all product renderers resolve the active practice view', async () => {
    const ui = await readFile(UI_URL, 'utf8');
    const accessors = sourceBlock(ui, '\n    tutorialIsActive() {', '\n    invalidateAnalysisState() {');
    const render = sourceBlock(ui, '\n    render() {', '\n    renderSnapshotPrivacyNotice(');
    const picker = sourceBlock(ui, '\n    renderSnapshotPicker(', '\n    renderProvenanceDetails(');
    const explorer = sourceBlock(ui, '\n    renderExplorer(snapshot) {', '\n    renderPromptRequestData(');
    const timeline = sourceBlock(ui, '\n    renderTimeline() {', '\n    renderTimelineSelectionToolbar() {');
    const diff = sourceBlock(ui, '\n    renderDiff() {', '\n    appendDiffMarkup(');
    const rules = sourceBlock(ui, '\n    renderRules(snapshot, providedAnalysis = undefined) {', '\n    renderSearch(snapshot) {');
    const search = sourceTail(ui, '\n    renderSearch(snapshot) {');

    assert.match(accessors, /activeTimeline\(\)[\s\S]*?this\.onboardingSession\.timeline[\s\S]*?: this\.timeline/u);
    assert.match(accessors, /activeSelectedId\(\)[\s\S]*?this\.onboardingSession\.selectedId[\s\S]*?: this\.selectedId/u);
    assert.match(accessors, /activeTabId\(\)[\s\S]*?this\.onboardingSession\.tabId[\s\S]*?: this\.activeTab/u);
    assert.match(render, /const activeTab = this\.activeTabId\(\)/u);
    assert.match(render, /const snapshot = this\.selectedSnapshot\(\)/u);
    assert.match(render, /explorer: \(\) => this\.renderExplorer\(snapshot\)/u);
    assert.match(render, /timeline: \(\) => this\.renderTimeline\(\)/u);
    assert.match(render, /diff: \(\) => this\.renderDiff\(\)/u);
    assert.match(render, /rules: \(\) => this\.renderRules\(snapshot\)/u);
    assert.match(render, /search: \(\) => this\.renderSearch\(snapshot\)/u);

    assert.match(picker, /\[\.\.\.this\.activeTimeline\(\)\]\.reverse\(\)/u);
    assert.match(picker, /snapshot\.id === this\.activeSelectedId\(\)/u);
    assert.match(explorer, /const includedOnly = this\.activeExplorerIncludedOnly\(\)/u);
    assert.match(explorer, /const openSourceIds = this\.activeOpenSourceIds\(\)/u);
    assert.match(timeline, /const timeline = this\.activeTimeline\(\)/u);
    assert.match(timeline, /const totalCount = this\.activeTimelineTotalCount\(\)/u);
    assert.match(timeline, /const selectedId = this\.activeSelectedId\(\)/u);
    assert.match(diff, /const timeline = this\.activeTimeline\(\)/u);
    assert.match(diff, /this\.selectedSnapshot\(\)\?\.id/u);
    assert.match(rules, /const tutorial = this\.tutorialIsActive\(\)/u);
    assert.match(rules, /this\.renderSnapshotPicker\(\)/u);
    assert.match(search, /const tutorial = this\.tutorialIsActive\(\)/u);
    assert.match(search, /this\.renderSnapshotPicker\(\)/u);
});

test('practice keeps provider and AI paths guarded and uses deterministic local analysis', async () => {
    const state = {
        semanticInspectionState: { status: 'cancelled' },
        semanticInspector: { activeCallCount: () => 1 },
        settingsOverlay: null,
        rulesSettingsOverlay: null,
        semanticConsentOverlay: null,
        activeBlockingTaskCount: 0,
        semanticEvaluationIsActive: () => false,
    };
    assert.equal(DevToolsWindow.prototype.onboardingCanStart.call(state), false);
    state.semanticInspector.activeCallCount = () => 0;
    assert.equal(DevToolsWindow.prototype.onboardingCanStart.call(state), true);
    state.activeBlockingTaskCount = 1;
    assert.equal(DevToolsWindow.prototype.onboardingCanStart.call(state), false);
    state.activeBlockingTaskCount = 0;
    state.storageSummaryRebuildPromise = Promise.resolve();
    assert.equal(DevToolsWindow.prototype.onboardingCanStart.call(state), false);
    state.storageSummaryRebuildPromise = null;
    assert.equal(DevToolsWindow.prototype.onboardingCanStart.call(state), true);
    state.semanticInspector.activeCallCount = () => {
        throw new Error('private provider state');
    };
    assert.equal(DevToolsWindow.prototype.onboardingCanStart.call(state), false);

    const ui = await readFile(UI_URL, 'utf8');
    const rules = sourceBlock(ui, '\n    renderRules(snapshot, providedAnalysis = undefined) {', '\n    renderSearch(snapshot) {');
    const search = sourceTail(ui, '\n    renderSearch(snapshot) {');
    assert.match(ui, /advanceSemanticProviderEvaluation\(\) \{\s*if \(this\.onboardingIsOpen\(\)\) return Promise\.resolve\(null\)/u);
    assert.match(ui, /requestSemanticConsent\(preview\) \{\s*if \(this\.onboardingIsOpen\(\)\) return Promise\.resolve\(false\)/u);
    assert.match(ui, /async startSemanticInspection\([\s\S]*?this\.onboardingIsOpen\(\)/u);
    assert.match(rules, /const effectiveRuleSettings = tutorial\s*\? DEFAULT_RULE_SETTINGS/u);
    assert.match(
        rules,
        /analyzeSnapshotDetailed\(\s*snapshot,\s*DEFAULT_RULE_SETTINGS,\s*DEFAULT_COMPARISON_POLICY_SETTINGS/u,
    );
    assert.match(rules, /if \(\s*!tutorial\s*&&\s*providedAnalysis === undefined/u);
    assert.match(rules, /if \(!tutorial && this\.ruleViewMode === 'ai'\)/u);
    assert.match(rules, /if \(!tutorial\) card\.appendChild\(this\.renderFindingReviewControls/u);
    assert.match(search, /const matches = tutorial\s*\? searchSnapshot\(/u);
    assert.match(search, /: \(await this\.runUiAnalysis\('search'/u);
});

test('blocking tasks keep practice unavailable until every async mutation settles', async () => {
    let release;
    const pending = new Promise((resolve) => {
        release = resolve;
    });
    const state = { activeBlockingTaskCount: 0 };
    const running = DevToolsWindow.prototype.withActiveBlockingTask.call(
        state,
        () => pending,
    );
    assert.equal(state.activeBlockingTaskCount, 1);
    release('done');
    assert.equal(await running, 'done');
    assert.equal(state.activeBlockingTaskCount, 0);
});

test('practice omits copy, delete, bulk-selection, and storage-management UI', async () => {
    const ui = await readFile(UI_URL, 'utf8');
    const explorer = sourceBlock(ui, '\n    renderExplorer(snapshot) {', '\n    renderPromptRequestData(');
    const payload = sourceBlock(ui, '\n    renderPromptRequestData(snapshot) {', '\n    renderMappedFinalPrompt(');
    const timeline = sourceBlock(ui, '\n    renderTimeline() {', '\n    renderTimelineSelectionToolbar() {');

    assert.match(
        explorer,
        /hasRawPromptContent\(snapshot\) && !this\.tutorialIsActive\(\)[\s\S]*?copyButton\(/u,
    );
    assert.match(
        payload,
        /hasRawPromptContent\(snapshot\) && !this\.tutorialIsActive\(\)[\s\S]*?copyButton\(/u,
    );
    assert.match(
        timeline,
        /if \(tutorial\) \{\s*entry\.append\(button\);\s*\} else \{\s*entry\.append\(selectWrapper, button, remove\);/u,
    );
    assert.match(
        timeline,
        /if \(!tutorial\) content\.appendChild\(this\.renderTimelineSelectionToolbar\(\)\)/u,
    );
    assert.match(
        timeline,
        /let storageDetails = null;\s*if \(!tutorial\) \{[\s\S]*?this\.buildStorageToolsPanel\(\)/u,
    );
    assert.match(timeline, /if \(storageDetails\) page\.appendChild\(storageDetails\)/u);
});

test('interaction validation enforces value, open, and checked contracts', () => {
    const exercise = (stepId, candidate) => {
        const step = onboardingStep(stepId);
        candidate.matches = (selector) => selector === step.interaction.selector;
        candidate.closest = () => null;
        const state = {
            onboardingSession: { completedActions: new Set() },
            onboardingStepComplete: false,
            onboardingStepSkipped: true,
            updates: 0,
            currentOnboardingStep: () => step,
            window: { querySelector: () => candidate },
            onboardingInteractionCandidate: (
                interaction,
                node,
            ) => DevToolsWindow.prototype.onboardingInteractionCandidate.call(
                { window: { querySelector: () => candidate } },
                interaction,
                node,
            ),
            updateOnboardingView() {
                this.updates += 1;
            },
        };
        return { step, state };
    };

    const valueCandidate = { value: 'wrong', dataset: {} };
    const value = exercise('explorer-snapshot-3', valueCandidate);
    assert.equal(
        DevToolsWindow.prototype.recordOnboardingAction.call(
            value.state,
            value.step.interaction.event,
            valueCandidate,
        ),
        false,
    );
    valueCandidate.value = value.step.interaction.value;
    assert.equal(
        DevToolsWindow.prototype.recordOnboardingAction.call(
            value.state,
            value.step.interaction.event,
            valueCandidate,
        ),
        true,
    );

    const openCandidate = { open: false };
    const open = exercise('explorer-configured-group', openCandidate);
    assert.equal(
        DevToolsWindow.prototype.recordOnboardingAction.call(
            open.state,
            open.step.interaction.event,
            openCandidate,
        ),
        false,
    );
    openCandidate.open = true;
    assert.equal(
        DevToolsWindow.prototype.recordOnboardingAction.call(
            open.state,
            open.step.interaction.event,
            openCandidate,
        ),
        true,
    );

    const checkedCandidate = {
        checked: false,
        ariaChecked: 'false',
        getAttribute(name) {
            return name === 'aria-checked' ? this.ariaChecked : null;
        },
    };
    const checked = exercise('explorer-included-filter', checkedCandidate);
    assert.equal(
        DevToolsWindow.prototype.recordOnboardingAction.call(
            checked.state,
            checked.step.interaction.event,
            checkedCandidate,
        ),
        false,
    );
    checkedCandidate.ariaChecked = 'true';
    assert.equal(
        DevToolsWindow.prototype.recordOnboardingAction.call(
            checked.state,
            checked.step.interaction.event,
            checkedCandidate,
        ),
        true,
    );

    for (const { step, state } of [value, open, checked]) {
        assert.equal(state.onboardingStepComplete, true);
        assert.equal(state.onboardingStepSkipped, false);
        assert.equal(state.onboardingSession.completedActions.has(step.id), true);
        assert.equal(state.updates, 1);
    }
});

test('returning to the Korean search step restores completion from existing results', async () => {
    const step = onboardingStep('search-query-korean');
    const input = { value: step.interaction.value };
    let resultExists = false;
    const calls = [];
    const state = {
        onboardingStepComplete: false,
        currentOnboardingStep: () => step,
        window: {
            querySelector(selector) {
                if (selector === step.interaction.selector) return input;
                if (selector === '.st-devtools-search-result' && resultExists) return {};
                return null;
            },
        },
        recordOnboardingAction(event, candidate) {
            calls.push([event, candidate]);
            return true;
        },
    };

    DevToolsWindow.prototype.synchronizeOnboardingStepCompletion.call(state, step);
    await new Promise((resolve) => queueMicrotask(resolve));
    assert.equal(calls.length, 0);

    resultExists = true;
    DevToolsWindow.prototype.synchronizeOnboardingStepCompletion.call(state, step);
    await new Promise((resolve) => queueMicrotask(resolve));
    assert.deepEqual(calls, [[step.interaction.event, input]]);
});

test('required actions gate Next while step skip and Escape remain available', async () => {
    const stepIndex = ONBOARDING_STEPS.findIndex(({ id }) => id === 'explorer-tab');
    assert.ok(stepIndex >= 0);
    const nextState = {
        onboardingPhase: 'steps',
        onboardingStepIndex: stepIndex,
        onboardingStepComplete: false,
        onboardingStepSkipped: false,
        onboardingIsOpen: () => true,
        updateOnboardingViewCalls: 0,
        updateOnboardingView() {
            this.updateOnboardingViewCalls += 1;
        },
    };
    assert.equal(DevToolsWindow.prototype.nextOnboardingStep.call(nextState), false);
    assert.equal(nextState.onboardingStepIndex, stepIndex);
    nextState.onboardingStepComplete = true;
    assert.equal(DevToolsWindow.prototype.nextOnboardingStep.call(nextState), true);
    assert.equal(nextState.onboardingStepIndex, stepIndex + 1);
    assert.equal(nextState.updateOnboardingViewCalls, 1);

    let advanced = 0;
    const skipState = {
        onboardingStepIndex: stepIndex,
        onboardingStepComplete: false,
        onboardingStepSkipped: false,
        onboardingSession: { completedActions: new Set() },
        onboardingApplyingSkippedState: false,
        tutorialIsActive: () => true,
        applySkippedOnboardingStepState: () => true,
        nextOnboardingStep() {
            advanced += 1;
            assert.equal(this.onboardingStepComplete, true);
            assert.equal(this.onboardingStepSkipped, true);
            return true;
        },
    };
    assert.equal(DevToolsWindow.prototype.skipOnboardingStep.call(skipState), true);
    assert.equal(advanced, 1);
    assert.equal(
        skipState.onboardingSession.completedActions.has(ONBOARDING_STEPS[stepIndex].id),
        true,
    );

    let prevented = 0;
    let closeOptions = null;
    const escapeState = {
        root: { hidden: false },
        onboardingIsOpen: () => true,
        closeOnboarding(options) {
            closeOptions = options;
        },
    };
    DevToolsWindow.prototype.handleDialogKeydown.call(escapeState, {
        key: 'Escape',
        preventDefault() {
            prevented += 1;
        },
    });
    assert.equal(prevented, 1);
    assert.deepEqual(closeOptions, { persist: 'skipped' });

    const ui = await readFile(UI_URL, 'utf8');
    const view = sourceBlock(ui, '\n    updateOnboardingView() {', '\n    renderOnboardingInvitation() {');
    assert.match(
        view,
        /this\.onboardingNextButton\.disabled = Boolean\(\s*step\.interaction && !this\.onboardingStepComplete/u,
    );
    assert.match(
        view,
        /this\.onboardingStepSkipButton\.hidden = !step\.interaction\s*\|\| this\.onboardingStepComplete/u,
    );
});

test('only the invitation is modal and inert; practice stays visibly identified', async () => {
    const ui = await readFile(UI_URL, 'utf8');
    const style = await readFile(STYLE_URL, 'utf8');
    const start = sourceBlock(ui, '\n    startOnboarding({ invitation = true, force = false } = {}) {', '\n    closeOnboarding(');
    const close = sourceBlock(ui, '\n    closeOnboarding(', '\n    beginOnboardingPractice() {');
    const begin = sourceBlock(ui, '\n    beginOnboardingPractice() {', '\n    nextOnboardingStep() {');
    const view = sourceBlock(ui, '\n    updateOnboardingView() {', '\n    renderOnboardingInvitation() {');
    const render = sourceBlock(ui, '\n    render() {', '\n    renderSnapshotPrivacyNotice(');

    assert.match(start, /if \(invitation\) \{[\s\S]*?region\.inert = true;[\s\S]*?aria-hidden/u);
    assert.match(begin, /region\.inert = false;[\s\S]*?removeAttribute\('aria-hidden'\)/u);
    assert.match(begin, /this\.window\.setAttribute\('aria-modal', 'true'\)/u);
    assert.match(view, /setAttribute\('role', 'dialog'\)[\s\S]*?setAttribute\('aria-modal', 'true'\)/u);
    assert.match(view, /setAttribute\('role', 'complementary'\)[\s\S]*?setAttribute\('aria-modal', 'false'\)/u);
    assert.match(ui, /className: 'st-devtools-onboarding-session-badge'/u);
    assert.match(begin, /this\.onboardingSessionBadge\.hidden = false/u);
    assert.match(close, /this\.onboardingSessionBadge\.hidden = true/u);
    assert.match(render, /className: 'st-devtools-onboarding-practice-notice'/u);
    assert.match(style, /\.st-devtools-onboarding-session-badge\s*\{/u);
    assert.match(style, /\.st-devtools-onboarding-practice-notice\s*\{/u);
});

test('capture growth and every hands-on selector have a matching product marker', async () => {
    const ui = await readFile(UI_URL, 'utf8');
    const captureRun = sourceBlock(ui, '\n    async runOnboardingCaptureDemo() {', '\n    onboardingInteractionCandidate(');
    assert.match(captureRun, /for \(const state of \['capturing', 'processing', 'saved'\]\)/u);
    assert.match(captureRun, /session\.timeline = \[\.\.\.session\.availableTimeline\]/u);

    assert.match(ui, /region\.dataset\.tourId = 'capture-status'/u);
    assert.match(ui, /details\.dataset\.sourceId = source\.id/u);
    assert.match(ui, /card\.dataset\.ruleId = item\.ruleId/u);
    assert.match(ui, /'data-snapshot-id': snapshot\.id/u);
    assert.match(ui, /wrapper\.dataset\.diffRole = role/u);
    assert.match(ui, /item\.dataset\.sourceId = match\.sourceId/u);

    assert.match(onboardingStep('capture-purpose').target, /capture-status/u);
    assert.match(onboardingStep('explorer-format-source').target, /data-source-id/u);
    assert.match(onboardingStep('rules-finding').target, /data-rule-id/u);
    assert.match(onboardingStep('timeline-point-snapshot-2').target, /data-snapshot-id/u);
    const diffBaseStep = ONBOARDING_STEPS.find((step) => (
        step.group === 'diff'
        && step.interaction?.selector?.includes('data-diff-role="base"')
    ));
    assert.ok(diffBaseStep, 'missing diff base selector step');
    assert.match(diffBaseStep.target, /data-diff-role/u);
    assert.match(onboardingStep('search-result-main-source').target, /data-source-id/u);
});

test('automatic invitation is offered at most once per panel session', async () => {
    let starts = 0;
    const state = {
        onboardingAutoAttempted: false,
        onboardingAutoStart: true,
        onboardingState: {
            schemaVersion: 1,
            tourVersion: 2,
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

test('sandbox exposes deterministic walkthrough controls without automatic product calls', async () => {
    const sandbox = await readFile(SANDBOX_URL, 'utf8');
    assert.match(sandbox, /onboardingAutoStart: false/u);
    assert.match(sandbox, /document\.getElementById\('sandbox-onboarding'\)/u);
    assert.match(
        sandbox,
        /const sandboxOnboardingHook = Object\.freeze\(\{[\s\S]*?startPractice\(\)[\s\S]*?next\(\)[\s\S]*?back\(\)[\s\S]*?skipStep\(\)[\s\S]*?exit\(\)[\s\S]*?status:[\s\S]*?performCurrentAction:[\s\S]*?isolationStatus:/u,
    );
    assert.match(sandbox, /onboarding: sandboxOnboardingHook/u);
    assert.match(sandbox, /document\.body\.dataset\.semanticNetworkCallCount = '0'/u);
});
