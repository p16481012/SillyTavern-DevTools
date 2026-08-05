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
        onboardingStepStage: 'idle',
        onboardingStepIndex: -1,
        onboardingStepComplete: true,
        onboardingStepSkipped: true,
        primaryRegions: [],
        onboardingSessionBadge: { hidden: true },
        onboardingInvitationOverlay: { hidden: false },
        onboardingGuide: {
            hidden: true,
        },
        window: {
            setAttribute() {},
            classList: { add() {} },
            addEventListener(type) {
                listeners.push(type);
            },
        },
        tutorialIsActive() {
            return DevToolsWindow.prototype.tutorialIsActive.call(this);
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
    assert.equal(state.onboardingInvitationOverlay.hidden, true);
    assert.equal(state.onboardingGuide.hidden, false);
    assert.equal(state.onboardingStepStage, 'briefing');
    assert.equal(state.onboardingSession.skippedActions.size, 0);
    assert.deepEqual(
        listeners,
        ['click', 'change', 'input', 'toggle'],
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
            onboardingSession: {
                completedActions: new Set(),
                skippedActions: new Set(),
            },
            onboardingApplyingSkippedState: false,
            onboardingStepStage: 'practice',
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
    value.state.onboardingStepStage = 'briefing';
    assert.equal(
        DevToolsWindow.prototype.recordOnboardingAction.call(
            value.state,
            value.step.interaction.event,
            valueCandidate,
        ),
        false,
    );
    assert.equal(value.state.onboardingSession.completedActions.size, 0);
    value.state.onboardingStepStage = 'practice';
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
        assert.equal(state.onboardingStepStage, 'debrief');
        assert.equal(state.onboardingSession.completedActions.has(step.id), true);
        assert.equal(state.onboardingSession.skippedActions.has(step.id), false);
        assert.equal(state.updates, 1);
    }
});

test('switch completion waits until the control event has committed its new state', async () => {
    const step = onboardingStep('explorer-included-filter');
    const toggle = (checked) => ({
        ariaChecked: String(checked),
        matches: (selector) => selector === step.interaction.selector,
        closest: () => null,
        getAttribute(name) {
            return name === 'aria-checked' ? this.ariaChecked : null;
        },
    });
    const scenario = (checked) => {
        let renderedToggle = toggle(checked);
        const state = {
            onboardingSession: {
                completedActions: new Set(),
                skippedActions: new Set(),
            },
            onboardingApplyingSkippedState: false,
            onboardingStepStage: 'practice',
            onboardingStepComplete: false,
            onboardingStepSkipped: false,
            onboardingGuide: { contains: () => false },
            tutorialIsActive: () => true,
            currentOnboardingStep: () => step,
            window: { querySelector: () => renderedToggle },
            onboardingInteractionCandidate(interaction, node) {
                return DevToolsWindow.prototype.onboardingInteractionCandidate.call(
                    { window: this.window },
                    interaction,
                    node,
                );
            },
            recordOnboardingAction(eventType, node) {
                return DevToolsWindow.prototype.recordOnboardingAction.call(
                    this,
                    eventType,
                    node,
                );
            },
            updateOnboardingView() {},
        };
        return {
            initial: renderedToggle,
            state,
            commit(nextChecked) {
                renderedToggle = toggle(nextChecked);
            },
        };
    };

    const enabled = scenario(false);
    DevToolsWindow.prototype.handleOnboardingInteraction.call(enabled.state, {
        type: 'click',
        target: enabled.initial,
    });
    await Promise.resolve();
    assert.equal(enabled.state.onboardingStepStage, 'practice');
    enabled.commit(true);
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(enabled.state.onboardingStepStage, 'debrief');
    assert.equal(enabled.state.onboardingSession.completedActions.has(step.id), true);

    const disabled = scenario(true);
    DevToolsWindow.prototype.handleOnboardingInteraction.call(disabled.state, {
        type: 'click',
        target: disabled.initial,
    });
    await Promise.resolve();
    disabled.commit(false);
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(disabled.state.onboardingStepStage, 'practice');
    assert.equal(disabled.state.onboardingSession.completedActions.has(step.id), false);

    const stale = scenario(false);
    DevToolsWindow.prototype.handleOnboardingInteraction.call(stale.state, {
        type: 'click',
        target: stale.initial,
    });
    await Promise.resolve();
    stale.commit(true);
    stale.state.onboardingSession = {
        completedActions: new Set(),
        skippedActions: new Set(),
    };
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(stale.state.onboardingStepStage, 'practice');
    assert.equal(stale.state.onboardingSession.completedActions.has(step.id), false);
});

test('returning to the Korean search step restores completion from existing results', async () => {
    const step = onboardingStep('search-query-korean');
    const input = { value: step.interaction.value };
    let resultExists = false;
    const calls = [];
    const state = {
        onboardingStepStage: 'practice',
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

test('practice recognizes value, open, and checked states that are already satisfied', async () => {
    const exercise = async (stepId, candidate) => {
        const step = onboardingStep(stepId);
        const calls = [];
        const state = {
            onboardingStepStage: 'practice',
            onboardingStepComplete: false,
            currentOnboardingStep: () => step,
            window: {
                querySelector(selector) {
                    return selector === step.interaction.selector ? candidate : null;
                },
            },
            recordOnboardingAction(event, node) {
                calls.push([event, node]);
                return true;
            },
        };
        DevToolsWindow.prototype.synchronizeOnboardingStepCompletion.call(state, step);
        await new Promise((resolve) => queueMicrotask(resolve));
        return { calls, step };
    };

    const checkedCandidate = {
        checked: false,
        getAttribute: (name) => name === 'aria-checked' ? 'true' : null,
    };
    const checked = await exercise('explorer-included-filter', checkedCandidate);
    assert.deepEqual(checked.calls, [[checked.step.interaction.event, checkedCandidate]]);

    const openCandidate = { open: true };
    const open = await exercise('explorer-configured-group', openCandidate);
    assert.deepEqual(open.calls, [[open.step.interaction.event, openCandidate]]);

    const valueStep = onboardingStep('explorer-snapshot-3');
    const valueCandidate = { value: valueStep.interaction.value, dataset: {} };
    const value = await exercise(valueStep.id, valueCandidate);
    assert.deepEqual(value.calls, [[value.step.interaction.event, valueCandidate]]);

    checkedCandidate.getAttribute = () => 'false';
    const incomplete = await exercise('explorer-included-filter', checkedCandidate);
    assert.equal(incomplete.calls.length, 0);

    const captureStep = onboardingStep('capture-practice');
    const panel = await exercise(captureStep.id, {
        value: captureStep.interaction.value,
        dataset: { value: captureStep.interaction.value },
    });
    assert.equal(panel.calls.length, 0);
});

test('a disclosure expands its debrief spotlight from the summary to the opened details', () => {
    const step = onboardingStep('explorer-configured-group');
    const summary = { tagName: 'SUMMARY' };
    const revealed = { tagName: 'DIV' };
    const disclosure = {
        open: true,
        children: [summary, revealed],
    };
    const state = {
        onboardingStepStage: 'debrief',
        currentOnboardingStep: () => step,
        window: {
            querySelector(selector) {
                if (selector === step.target) return summary;
                if (selector === step.interaction.selector) return disclosure;
                return null;
            },
        },
    };

    assert.equal(
        DevToolsWindow.prototype.onboardingVisualTarget.call(state, step),
        disclosure,
    );
    state.onboardingStepStage = 'practice';
    assert.equal(
        DevToolsWindow.prototype.onboardingVisualTarget.call(state, step),
        disclosure,
    );
    state.onboardingStepStage = 'debrief';
    disclosure.open = false;
    assert.equal(
        DevToolsWindow.prototype.onboardingVisualTarget.call(state, step),
        disclosure,
    );
});

test('an intentional navigation action highlights its declared result target', () => {
    const step = onboardingStep('rules-related-sources');
    const action = {};
    const result = {};
    const state = {
        onboardingStepStage: 'debrief',
        currentOnboardingStep: () => step,
        window: {
            querySelector(selector) {
                if (selector === step.target) return action;
                if (selector === step.resultTarget) return result;
                return null;
            },
        },
    };

    assert.equal(
        DevToolsWindow.prototype.onboardingVisualTarget.call(state, step),
        result,
    );
});

test('an expanded action target gets a debounced smooth reveal after layout settles', async () => {
    const target = {};
    const reveal = {};
    const focusCalls = [];
    let positionCalls = 0;
    const state = {
        onboardingTarget: target,
        onboardingRevealSettleTimer: null,
        onboardingStepStage: 'debrief',
        tutorialIsActive: () => true,
        onboardingRevealVisibilityTarget(candidate) {
            assert.equal(candidate, target);
            return reveal;
        },
        focusOnboardingTarget(options) {
            focusCalls.push(options);
        },
        scheduleOnboardingGuidePosition() {
            positionCalls += 1;
        },
    };

    assert.equal(
        DevToolsWindow.prototype.scheduleOnboardingRevealSettle.call(state, 0),
        true,
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(focusCalls, [{
        nearestOnly: true,
        focus: false,
        behavior: 'smooth',
        visibilityTarget: reveal,
    }]);
    assert.equal(positionCalls, 1);
    assert.equal(state.onboardingRevealSettleTimer, null);
});

test('reveal scrolling measures the opened body instead of the disclosure summary', () => {
    const summary = { tagName: 'SUMMARY', hidden: false };
    const body = {
        tagName: 'DIV',
        hidden: false,
        getBoundingClientRect: () => ({
            left: 20,
            top: 180,
            right: 360,
            bottom: 520,
            width: 340,
            height: 340,
        }),
    };
    const disclosure = {
        children: [summary, body],
        matches: (selector) => selector === 'details[open]',
    };

    assert.equal(
        DevToolsWindow.prototype.onboardingRevealVisibilityTarget.call(
            { onboardingTarget: disclosure },
            disclosure,
        ),
        body,
    );
});

test('interactive steps enter practice directly and keep one result acknowledgement', async () => {
    const stepIndex = ONBOARDING_STEPS.findIndex(({ id }) => id === 'explorer-tab');
    assert.ok(stepIndex >= 0);
    const nextState = {
        onboardingPhase: 'steps',
        onboardingStepStage: 'debrief',
        onboardingStepIndex: stepIndex - 1,
        onboardingStepComplete: false,
        onboardingStepSkipped: false,
        onboardingIsOpen: () => true,
        onboardingSession: {
            completedActions: new Set(),
            skippedActions: new Set(),
        },
        updateOnboardingViewCalls: 0,
        updateOnboardingView() {
            this.updateOnboardingViewCalls += 1;
        },
    };
    assert.equal(DevToolsWindow.prototype.nextOnboardingStep.call(nextState), true);
    assert.equal(nextState.onboardingStepIndex, stepIndex);
    assert.equal(nextState.onboardingStepStage, 'practice');

    assert.equal(DevToolsWindow.prototype.nextOnboardingStep.call(nextState), false);
    assert.equal(nextState.onboardingStepIndex, stepIndex);
    assert.equal(nextState.onboardingStepStage, 'practice');

    nextState.onboardingStepComplete = true;
    assert.equal(DevToolsWindow.prototype.nextOnboardingStep.call(nextState), true);
    assert.equal(nextState.onboardingStepIndex, stepIndex);
    assert.equal(nextState.onboardingStepStage, 'debrief');

    assert.equal(DevToolsWindow.prototype.nextOnboardingStep.call(nextState), true);
    assert.equal(nextState.onboardingStepIndex, stepIndex + 1);
    assert.equal(nextState.onboardingStepStage, 'practice');
    assert.equal(nextState.onboardingStepComplete, false);
    assert.equal(nextState.updateOnboardingViewCalls, 3);

    const backState = {
        onboardingPhase: 'steps',
        onboardingStepStage: 'practice',
        onboardingStepIndex: stepIndex + 1,
        onboardingIsOpen: () => true,
        onboardingSession: {
            completedActions: new Set(
                ONBOARDING_STEPS.slice(0, stepIndex + 1).map(({ id }) => id),
            ),
            skippedActions: new Set(),
        },
        updateOnboardingViewCalls: 0,
        updateOnboardingView() {
            this.updateOnboardingViewCalls += 1;
        },
    };
    assert.equal(DevToolsWindow.prototype.previousOnboardingStep.call(backState), true);
    assert.equal(backState.onboardingStepIndex, stepIndex);
    assert.equal(backState.onboardingStepStage, 'debrief');
    assert.equal(DevToolsWindow.prototype.previousOnboardingStep.call(backState), true);
    assert.equal(backState.onboardingStepIndex, stepIndex - 1);
    assert.equal(
        backState.onboardingStepStage,
        ONBOARDING_STEPS[stepIndex - 1].interaction ? 'debrief' : 'briefing',
    );
    assert.equal(DevToolsWindow.prototype.previousOnboardingStep.call(backState), true);
    assert.equal(backState.onboardingStepIndex, stepIndex - 2);
    assert.equal(
        backState.onboardingStepStage,
        ONBOARDING_STEPS[stepIndex - 2].interaction ? 'debrief' : 'briefing',
    );
    assert.equal(backState.updateOnboardingViewCalls, 3);

    const roundTripState = {
        onboardingPhase: 'steps',
        onboardingStepStage: 'debrief',
        onboardingStepIndex: stepIndex + 1,
        onboardingStepComplete: true,
        onboardingStepSkipped: false,
        onboardingIsOpen: () => true,
        onboardingSession: {
            completedActions: new Set([
                ONBOARDING_STEPS[stepIndex].id,
                ONBOARDING_STEPS[stepIndex + 1].id,
            ]),
            skippedActions: new Set(),
        },
        updateOnboardingViewCalls: 0,
        updateOnboardingView() {
            this.updateOnboardingViewCalls += 1;
        },
    };
    assert.equal(
        DevToolsWindow.prototype.previousOnboardingStep.call(roundTripState),
        true,
    );
    assert.equal(roundTripState.onboardingStepIndex, stepIndex);
    assert.equal(roundTripState.onboardingStepStage, 'debrief');
    assert.equal(
        DevToolsWindow.prototype.nextOnboardingStep.call(roundTripState),
        true,
    );
    assert.equal(roundTripState.onboardingStepIndex, stepIndex + 1);
    assert.equal(roundTripState.onboardingStepStage, 'debrief');
    assert.equal(roundTripState.onboardingStepComplete, true);

    const firstState = {
        onboardingPhase: 'steps',
        onboardingStepStage: 'briefing',
        onboardingStepIndex: 0,
        onboardingIsOpen: () => true,
    };
    assert.equal(DevToolsWindow.prototype.previousOnboardingStep.call(firstState), false);
});

test('read-only coachmarks advance once into the next step entry stage', () => {
    const passiveStepIndex = ONBOARDING_STEPS.findIndex(
        ({ id }) => id === 'capture-purpose',
    );
    const state = {
        onboardingPhase: 'steps',
        onboardingStepStage: 'briefing',
        onboardingStepIndex: passiveStepIndex,
        onboardingStepComplete: false,
        onboardingStepSkipped: false,
        onboardingSession: {
            completedActions: new Set(),
            skippedActions: new Set(),
        },
        onboardingIsOpen: () => true,
        updateOnboardingViewCalls: 0,
        updateOnboardingView() {
            this.updateOnboardingViewCalls += 1;
        },
    };

    assert.equal(DevToolsWindow.prototype.nextOnboardingStep.call(state), true);
    assert.equal(state.onboardingStepIndex, passiveStepIndex + 1);
    assert.equal(state.onboardingStepStage, 'practice');
    assert.equal(state.onboardingStepComplete, false);
    assert.equal(state.onboardingSession.completedActions.has('capture-purpose'), true);
    assert.equal(state.updateOnboardingViewCalls, 1);

    const completedNext = ONBOARDING_STEPS[passiveStepIndex + 1];
    const restoredState = {
        ...state,
        onboardingStepIndex: passiveStepIndex,
        onboardingStepStage: 'briefing',
        onboardingStepComplete: true,
        onboardingSession: {
            completedActions: new Set([
                ONBOARDING_STEPS[passiveStepIndex].id,
                completedNext.id,
            ]),
            skippedActions: new Set(),
        },
        updateOnboardingViewCalls: 0,
    };
    assert.equal(
        DevToolsWindow.prototype.nextOnboardingStep.call(restoredState),
        true,
    );
    assert.equal(restoredState.onboardingStepIndex, passiveStepIndex + 1);
    assert.equal(restoredState.onboardingStepStage, 'debrief');
    assert.equal(restoredState.onboardingStepComplete, true);
    assert.equal(restoredState.updateOnboardingViewCalls, 1);
});

test('passive confirmation and step skip finish in debrief without advancing', async () => {
    const stepIndex = ONBOARDING_STEPS.findIndex(({ id }) => id === 'explorer-tab');
    assert.ok(stepIndex >= 0);

    const skipState = {
        onboardingStepIndex: stepIndex,
        onboardingStepStage: 'practice',
        onboardingStepComplete: false,
        onboardingStepSkipped: false,
        onboardingSession: {
            completedActions: new Set(),
            skippedActions: new Set(),
        },
        onboardingApplyingSkippedState: false,
        tutorialIsActive: () => true,
        applySkippedOnboardingStepState: () => true,
        updateOnboardingViewCalls: 0,
        updateOnboardingView() {
            this.updateOnboardingViewCalls += 1;
        },
    };
    assert.equal(DevToolsWindow.prototype.skipOnboardingStep.call(skipState), true);
    assert.equal(skipState.onboardingStepIndex, stepIndex);
    assert.equal(skipState.onboardingStepStage, 'debrief');
    assert.equal(skipState.onboardingStepComplete, true);
    assert.equal(skipState.onboardingStepSkipped, true);
    assert.equal(
        skipState.onboardingSession.completedActions.has(ONBOARDING_STEPS[stepIndex].id),
        true,
    );
    assert.equal(
        skipState.onboardingSession.skippedActions.has(ONBOARDING_STEPS[stepIndex].id),
        true,
    );
    assert.equal(skipState.updateOnboardingViewCalls, 1);

    const passiveStep = onboardingStep('capture-purpose');
    assert.equal(Boolean(passiveStep.interaction), false);
    const passiveState = {
        onboardingStepStage: 'practice',
        onboardingStepComplete: false,
        onboardingStepSkipped: false,
        onboardingSession: {
            completedActions: new Set(),
            skippedActions: new Set(),
        },
        tutorialIsActive: () => true,
        currentOnboardingStep: () => passiveStep,
        updateOnboardingViewCalls: 0,
        updateOnboardingView() {
            this.updateOnboardingViewCalls += 1;
        },
    };
    assert.equal(
        DevToolsWindow.prototype.completePassiveOnboardingStep.call(passiveState),
        true,
    );
    assert.equal(passiveState.onboardingStepStage, 'debrief');
    assert.equal(passiveState.onboardingStepComplete, true);
    assert.equal(passiveState.onboardingStepSkipped, false);
    assert.equal(passiveState.onboardingSession.completedActions.has(passiveStep.id), true);
    assert.equal(passiveState.updateOnboardingViewCalls, 1);

    passiveState.onboardingStepStage = 'briefing';
    assert.equal(
        DevToolsWindow.prototype.completePassiveOnboardingStep.call(passiveState),
        false,
    );
});

test('Escape skips the walkthrough from every step stage', async () => {
    for (const onboardingStepStage of ['briefing', 'practice', 'debrief']) {
        let prevented = 0;
        let closeOptions = null;
        const escapeState = {
            root: { hidden: false },
            onboardingStepStage,
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
    }

    const ui = await readFile(UI_URL, 'utf8');
    const next = sourceBlock(ui, '\n    nextOnboardingStep() {', '\n    previousOnboardingStep() {');
    assert.match(next, /onboardingStepStage === 'briefing'[\s\S]*?= 'practice'/u);
    assert.match(next, /onboardingStepStage === 'practice'[\s\S]*?!this\.onboardingStepComplete[\s\S]*?= 'debrief'/u);
    assert.match(next, /onboardingStepStage !== 'debrief'[\s\S]*?onboardingStepIndex \+= 1[\s\S]*?onboardingEntryStage/u);
});

test('briefing and debrief are modal and inert while practice is freely interactive', async () => {
    const ui = await readFile(UI_URL, 'utf8');
    const style = await readFile(STYLE_URL, 'utf8');
    const invitation = sourceBlock(
        ui,
        '\n    buildOnboardingInvitationLayer() {',
        '\n    buildOnboardingGuide() {',
    );
    const guide = sourceBlock(
        ui,
        '\n    buildOnboardingGuide() {',
        '\n    onboardingIsOpen() {',
    );
    const view = sourceBlock(
        ui,
        '\n    updateOnboardingView() {',
        '\n    syncOnboardingModalState(modal) {',
    );
    const modalSync = sourceBlock(
        ui,
        '\n    syncOnboardingModalState(modal) {',
        '\n    synchronizeOnboardingStepCompletion(step) {',
    );
    const close = sourceBlock(ui, '\n    closeOnboarding(', '\n    beginOnboardingPractice() {');
    const focus = sourceBlock(ui, '\n    focusableElements() {', '\n    handleDialogKeydown(event) {');

    assert.match(invitation, /setAttribute\('role', 'dialog'\)/u);
    assert.match(invitation, /setAttribute\('aria-modal', 'true'\)/u);
    assert.match(guide, /className: 'st-devtools-onboarding-blocker'/u);
    assert.match(guide, /className: 'st-devtools-onboarding-spotlight'/u);
    assert.match(guide, /className: 'st-devtools-onboarding-guide-panel'/u);
    assert.match(guide, /panel\.setAttribute\('role', 'dialog'\)/u);
    assert.match(guide, /panel\.setAttribute\('aria-modal', 'true'\)/u);
    assert.match(guide, /className: 'st-devtools-onboarding-practice-dock'/u);
    assert.match(guide, /practiceDock\.setAttribute\('role', 'region'\)/u);
    assert.doesNotMatch(guide, /practiceDock\.setAttribute\('aria-modal'/u);
    assert.match(guide, /actions\.append\(back, progress, next\)/u);
    assert.doesNotMatch(guide, /actions\.append\(exit/u);
    assert.match(guide, /panel\.append\(announcement, exit, body, actions\)/u);
    assert.match(guide, /className: 'menu_button st-devtools-onboarding-practice-back/u);
    assert.match(view, /const modalStage = this\.onboardingStepStage !== 'practice'/u);
    assert.match(view, /this\.syncOnboardingModalState\(modalStage\)/u);
    assert.match(view, /this\.setOnboardingSurfaceActive\(this\.onboardingGuidePanel, modalStage\)/u);
    assert.match(view, /this\.setOnboardingSurfaceActive\(this\.onboardingPracticeDock, !modalStage\)/u);
    assert.match(view, /this\.onboardingBlocker\.classList\.toggle\('is-active', modalStage\)/u);
    assert.match(modalSync, /region\.inert = modal/u);
    assert.match(modalSync, /if \(modal\) region\.setAttribute\('aria-hidden', 'true'\)/u);
    assert.match(modalSync, /else region\.removeAttribute\('aria-hidden'\)/u);
    assert.match(focus, /tutorialIsActive\(\) && this\.onboardingStepStage !== 'practice'[\s\S]*?this\.onboardingGuidePanel/u);
    assert.match(close, /this\.onboardingInvitationOverlay\.hidden = true/u);
    assert.match(close, /this\.onboardingGuide\.hidden = true/u);
    assert.match(close, /this\.onboardingGuidePanel\.hidden = true/u);
    assert.match(close, /this\.onboardingPracticeDock\.hidden = true/u);
    assert.match(ui, /className: 'st-devtools-onboarding-session-badge'/u);
    assert.match(close, /this\.onboardingSessionBadge\.hidden = true/u);
    assert.match(style, /\.st-devtools-onboarding-session-badge\s*\{/u);

    const attributes = new Map();
    const regions = [0, 1].map(() => {
        const ownAttributes = new Map();
        return {
            inert: false,
            setAttribute(name, value) {
                ownAttributes.set(name, String(value));
            },
            removeAttribute(name) {
                ownAttributes.delete(name);
            },
            getAttribute(name) {
                return ownAttributes.get(name) ?? null;
            },
        };
    });
    const state = {
        primaryRegions: regions,
        window: {
            setAttribute(name, value) {
                attributes.set(name, String(value));
            },
        },
    };
    DevToolsWindow.prototype.syncOnboardingModalState.call(state, true);
    assert.equal(attributes.get('aria-modal'), 'false');
    assert.equal(regions.every((region) => region.inert), true);
    assert.equal(regions.every((region) => region.getAttribute('aria-hidden') === 'true'), true);

    DevToolsWindow.prototype.syncOnboardingModalState.call(state, false);
    assert.equal(attributes.get('aria-modal'), 'true');
    assert.equal(regions.every((region) => !region.inert), true);
    assert.equal(regions.every((region) => region.getAttribute('aria-hidden') == null), true);
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

test('async diff rendering restores the active comparison spotlight target', async () => {
    const ui = await readFile(UI_URL, 'utf8');
    const renderDiff = sourceBlock(
        ui,
        '\n    renderDiff() {',
        '\n    appendDiffMarkup(',
    );

    assert.match(
        renderDiff,
        /this\.renderLoreChanges\([\s\S]*?if \(this\.tutorialIsActive\(\)\)[\s\S]*?queueMicrotask\([\s\S]*?currentOnboardingStep\(\)\?\.tabId === 'diff'[\s\S]*?refreshOnboardingTarget\(\{[\s\S]*?preserveGuideGeometry: true[\s\S]*?\}\)[\s\S]*?scheduleOnboardingGuidePosition\(\{ refocus: true \}\)/u,
    );
});

test('automatic invitation is offered at most once per panel session', async () => {
    let starts = 0;
    const state = {
        onboardingAutoAttempted: false,
        onboardingAutoStart: true,
        onboardingState: {
            schemaVersion: 1,
            tourVersion: 5,
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
        /const sandboxOnboardingHook = Object\.freeze\(\{[\s\S]*?startPractice\(\)[\s\S]*?next\(\)[\s\S]*?enterPractice\(\)[\s\S]*?acknowledge\(\)[\s\S]*?back\(\)[\s\S]*?skipStep\(\)[\s\S]*?exit\(\)[\s\S]*?status:[\s\S]*?performCurrentAction:[\s\S]*?isolationStatus:/u,
    );
    assert.match(sandbox, /onboarding: sandboxOnboardingHook/u);
    assert.match(sandbox, /document\.body\.dataset\.semanticNetworkCallCount = '0'/u);
});

test('spotlight guide overlays the unchanged product workspace', async () => {
    const ui = await readFile(UI_URL, 'utf8');
    const style = await readFile(STYLE_URL, 'utf8');
    const build = sourceBlock(ui, '\n    build() {', '\n    buildOnboardingInvitationLayer() {');
    const guideBuilder = sourceBlock(
        ui,
        '\n    buildOnboardingGuide() {',
        '\n    onboardingIsOpen() {',
    );
    const guideStyle = sourceBlock(
        style,
        '.st-devtools-onboarding-guide {',
        '.st-devtools-onboarding-blocker {',
    );

    assert.match(build, /className: 'st-devtools-workspace'/u);
    assert.match(build, /workspace\.append\(this\.content\)/u);
    assert.match(build, /this\.window\.append\(\s*header,\s*workspace,\s*tabList/u);
    assert.match(build, /this\.buildOnboardingGuide\(\)/u);
    assert.match(guideBuilder, /className: 'st-devtools-onboarding-guide'/u);
    assert.match(
        guideBuilder,
        /guide\.append\([\s\S]*?blocker,[\s\S]*?spotlight,[\s\S]*?panel,[\s\S]*?practiceDock,[\s\S]*?practiceBack,[\s\S]*?practiceExit/u,
    );
    assert.match(guideStyle, /position: absolute/u);
    assert.match(guideStyle, /inset: 0/u);
    assert.match(
        style,
        /\.st-devtools-onboarding-blocker\s*\{[\s\S]*?background:\s*rgb\(3 7 18 \/ 72%\)/u,
    );
    assert.match(
        style,
        /\.st-devtools-onboarding-guide\.has-onboarding-spotlight[\s\S]*?\.st-devtools-onboarding-blocker\s*\{[\s\S]*?background:\s*transparent/u,
    );
    assert.match(
        style,
        /\.st-devtools-onboarding-guide \[hidden\]\s*\{[\s\S]*?display:\s*none !important/u,
    );
});

test('spotlight geometry never overrides the real target position', async () => {
    const ui = await readFile(UI_URL, 'utf8');
    const style = await readFile(STYLE_URL, 'utf8');
    const spotlightStyle = sourceTail(
        style,
        '/* Spotlight onboarding: explain, practice in place, then debrief. */',
    );
    const position = sourceBlock(
        ui,
        '\n    positionOnboardingGuide() {',
        '\n    buildCaptureStatus() {',
    );
    const practiceTarget = sourceBlock(
        spotlightStyle,
        ".st-devtools-window[data-onboarding-stage='practice']\n.st-devtools-onboarding-target {",
        '.st-devtools-onboarding-invitation-overlay {',
    );

    assert.match(position, /Object\.assign\(this\.onboardingSpotlight\.style,\s*\{/u);
    assert.match(position, /left:[\s\S]*?top:[\s\S]*?width:[\s\S]*?height:/u);
    assert.doesNotMatch(position, /if \(isPractice\) \{[\s\S]*?onboardingSpotlight\.hidden = true/u);
    assert.match(position, /--st-devtools-onboarding-nav-clearance/u);
    assert.match(
        position,
        /this\.window\.style\.setProperty\([\s\S]*?--st-devtools-onboarding-nav-clearance/u,
    );
    assert.match(position, /reservedBottom = navigationClearance \+ 70/u);
    assert.doesNotMatch(position, /onboardingTarget\.style|target\.style/u);
    assert.match(spotlightStyle, /\.st-devtools-onboarding-spotlight\s*\{[\s\S]*?position: absolute/u);
    assert.match(
        style,
        /\[data-onboarding-stage='practice'\][\s\S]*?\.st-devtools-onboarding-spotlight\s*\{[\s\S]*?box-shadow:[\s\S]*?0 0 22px/u,
    );
    assert.match(practiceTarget, /outline:/u);
    assert.match(practiceTarget, /box-shadow:/u);
    assert.doesNotMatch(practiceTarget, /position\s*:|top\s*:|right\s*:|bottom\s*:|left\s*:/u);
});

test('unrelated practice interactions remain available and are never cancelled', async () => {
    let prevented = 0;
    let stopped = 0;
    const step = onboardingStep('explorer-tab');
    const state = {
        onboardingStepStage: 'practice',
        onboardingApplyingSkippedState: false,
        onboardingGuide: { contains: () => false },
        tutorialIsActive: () => true,
        currentOnboardingStep: () => step,
        onboardingInteractionCandidate: () => null,
    };
    const event = {
        type: 'click',
        target: {},
        preventDefault() {
            prevented += 1;
        },
        stopImmediatePropagation() {
            stopped += 1;
        },
    };

    DevToolsWindow.prototype.handleOnboardingInteraction.call(state, event);
    assert.equal(prevented, 0);
    assert.equal(stopped, 0);

    const ui = await readFile(UI_URL, 'utf8');
    const interaction = sourceBlock(
        ui,
        '\n    handleOnboardingInteraction(event) {',
        '\n    clearOnboardingTarget({ preserveGuideGeometry = false } = {}) {',
    );
    assert.doesNotMatch(interaction, /preventDefault|stopImmediatePropagation/u);
});

test('target recovery uses the content viewport without treating a corner back button as full-width occlusion', () => {
    const scrollOptions = [];
    const focusOptions = [];
    const classNames = new Set();
    let contentScrollTop = 0;
    const focusControl = {
        focus(options) {
            focusOptions.push(options);
        },
    };
    const target = {
        offsetWidth: 40,
        classList: {
            add(name) {
                classNames.add(name);
            },
            remove(name) {
                classNames.delete(name);
            },
        },
        getBoundingClientRect: () => ({
            left: 40,
            top: 520 - contentScrollTop,
            right: 180,
            bottom: 560 - contentScrollTop,
            width: 140,
            height: 40,
        }),
        matches: () => false,
        querySelector: () => focusControl,
    };
    const state = {
        onboardingTarget: target,
        onboardingLocateTimer: null,
        onboardingTargetAddedTabIndex: false,
        content: {
            scrollTop: 0,
            scrollLeft: 24,
            contains: () => true,
            getBoundingClientRect: () => ({
                left: 0,
                top: 100,
                right: 400,
                bottom: 500,
            }),
            scrollTo(options) {
                scrollOptions.push(options);
                this.scrollTop = options.top;
                this.scrollLeft = options.left;
                contentScrollTop = options.top;
            },
        },
        window: {
            getBoundingClientRect: () => ({
                left: 0,
                top: 0,
                right: 1000,
                bottom: 700,
            }),
        },
    };

    assert.equal(
        DevToolsWindow.prototype.focusOnboardingTarget.call(
            state,
            { nearestOnly: true },
        ),
        true,
    );
    assert.deepEqual(scrollOptions[0], {
        top: 72,
        left: 0,
        behavior: 'auto',
    });
    assert.equal(state.content.scrollLeft, 0);

    state.onboardingStepStage = 'practice';
    state.onboardingPracticeBackButton = {
        hidden: false,
        getBoundingClientRect: () => ({ top: 450 }),
    };
    assert.equal(
        DevToolsWindow.prototype.focusOnboardingTarget.call(
            state,
            { nearestOnly: true },
        ),
        true,
    );
    assert.equal(scrollOptions.length, 1);
    assert.equal(state.content.scrollTop, 72);

    assert.equal(
        DevToolsWindow.prototype.focusOnboardingTarget.call(
            state,
            { focus: true },
        ),
        true,
    );
    assert.deepEqual(scrollOptions[1], {
        top: 408,
        left: 0,
        behavior: 'auto',
    });
    assert.deepEqual(focusOptions, [{ preventScroll: true }]);
    assert.equal(classNames.has('is-locating'), true);
    clearTimeout(state.onboardingLocateTimer);
});

test('viewport resizing measures clearance before refocusing and repositioning', async () => {
    const ui = await readFile(UI_URL, 'utf8');
    const constructor = sourceBlock(
        ui,
        '\n    constructor({',
        '\n    activeTimeline()',
    );
    const close = sourceBlock(ui, '\n    closeOnboarding(', '\n    beginOnboardingPractice()');
    const begin = sourceBlock(ui, '\n    beginOnboardingPractice()', '\n    nextOnboardingStep()');

    assert.match(
        constructor,
        /onboardingViewportResizeHandler = \(\) => \{[\s\S]*?scheduleOnboardingGuidePosition\(\{ refocus: true \}\)/u,
    );
    assert.match(begin, /addEventListener\?\.\([\s\S]*?'resize',[\s\S]*?onboardingViewportResizeHandler/u);
    assert.match(close, /removeEventListener\?\.\([\s\S]*?'resize',[\s\S]*?onboardingViewportResizeHandler/u);

    const schedule = sourceBlock(
        ui,
        '\n    scheduleOnboardingGuidePosition(',
        '\n    positionOnboardingGuide()',
    );
    assert.match(schedule, /\{ refocus = false \} = \{\}/u);
    assert.match(schedule, /if \(refocus\) this\.onboardingRefocusAfterPosition = true/u);
    assert.match(
        schedule,
        /this\.positionOnboardingGuide\(\);[\s\S]*?if \(shouldRefocus\)[\s\S]*?focusOnboardingTarget\(\{ nearestOnly: true, focus: false \}\)[\s\S]*?this\.positionOnboardingGuide\(\)/u,
    );
});

test('target descriptions are stage-specific and temporary tabindex is restored exactly', () => {
    const exercise = (initialAttributes = {}, stage = 'practice') => {
        const attributes = new Map(Object.entries(initialAttributes));
        const classes = new Set();
        let focused = 0;
        const target = {
            offsetWidth: 20,
            classList: {
                add(name) {
                    classes.add(name);
                },
                remove(name) {
                    classes.delete(name);
                },
            },
            getAttribute(name) {
                return attributes.get(name) ?? null;
            },
            setAttribute(name, value) {
                attributes.set(name, String(value));
            },
            removeAttribute(name) {
                attributes.delete(name);
            },
            matches(selector) {
                return selector.includes('[tabindex]') && attributes.has('tabindex');
            },
            querySelector: () => null,
            getBoundingClientRect: () => ({
                left: 10,
                top: 10,
                right: 60,
                bottom: 40,
            }),
            scrollIntoView() {},
            focus() {
                focused += 1;
            },
        };
        const step = onboardingStep('capture-purpose');
        const state = {
            onboardingStepStage: stage,
            onboardingTarget: null,
            onboardingTargetDescriptionId: null,
            onboardingTargetAddedTabIndex: false,
            onboardingLocateTimer: null,
            onboardingSpotlight: { hidden: false },
            onboardingIsOpen: () => true,
            tutorialIsActive: () => true,
            currentOnboardingStep: () => step,
            window: {
                querySelector: () => target,
                getBoundingClientRect: () => ({
                    left: 0,
                    top: 0,
                    right: 400,
                    bottom: 300,
                }),
            },
            content: {
                contains: () => false,
            },
            clearOnboardingTarget() {
                return DevToolsWindow.prototype.clearOnboardingTarget.call(this);
            },
            scheduleOnboardingGuidePosition() {
                this.positionScheduled = true;
                return true;
            },
        };

        DevToolsWindow.prototype.refreshOnboardingTarget.call(state);
        assert.equal(
            attributes.get('aria-describedby'),
            stage === 'practice'
                ? 'st-devtools-onboarding-practice-copy'
                : 'st-devtools-onboarding-guide-body',
        );
        if (stage === 'practice') {
            DevToolsWindow.prototype.focusOnboardingTarget.call(state, { focus: true });
        }
        DevToolsWindow.prototype.clearOnboardingTarget.call(state);
        return { attributes, classes, focused, state };
    };

    const temporary = exercise();
    assert.equal(temporary.focused, 1);
    assert.equal(temporary.attributes.has('tabindex'), false);
    assert.equal(temporary.attributes.has('aria-describedby'), false);
    assert.equal(temporary.classes.has('st-devtools-onboarding-target'), false);
    assert.equal(temporary.state.onboardingTarget, null);

    const briefing = exercise({}, 'briefing');
    assert.equal(briefing.focused, 0);
    assert.equal(briefing.state.positionScheduled, true);
    assert.equal(briefing.attributes.has('aria-describedby'), false);

    const existing = exercise({
        'aria-describedby': 'existing-description',
        tabindex: '0',
    });
    assert.equal(existing.attributes.get('tabindex'), '0');
    assert.equal(existing.attributes.get('aria-describedby'), 'existing-description');
});

test('coachmarks use a panel-free overlay with mobile-safe icon navigation', async () => {
    const style = await readFile(STYLE_URL, 'utf8');
    const coachmarkStyle = sourceTail(
        style,
        '/* v0.15.5 — reference-style coachmarks: dim, point, act. */',
    );
    const panel = sourceBlock(
        coachmarkStyle,
        '.st-devtools-onboarding-guide-panel {',
        '.st-devtools-onboarding-announcement {',
    );
    const body = sourceBlock(
        coachmarkStyle,
        '.st-devtools-onboarding-guide-body {',
        '.st-devtools-onboarding-step {',
    );
    const actions = sourceBlock(
        coachmarkStyle,
        '.st-devtools-onboarding-guide-actions {',
        '.st-devtools-onboarding-progress {',
    );

    assert.match(panel, /inset:\s*0/u);
    assert.match(panel, /background(?:-color)?:\s*transparent/u);
    assert.match(panel, /border:\s*0/u);
    assert.match(panel, /box-shadow:\s*none/u);
    assert.match(panel, /pointer-events:\s*none/u);
    assert.match(
        coachmarkStyle,
        /\.st-devtools-onboarding-guide-body,[\s\S]*?overflow:\s*visible/u,
    );
    assert.doesNotMatch(body, /overflow-y:\s*auto/u);
    assert.match(actions, /bottom:\s*var\(--st-devtools-onboarding-nav-clearance, 76px\)/u);
    assert.match(actions, /grid-template-columns:\s*52px minmax\(0, 1fr\) 52px/u);
    assert.match(
        style,
        /\.st-devtools-window\.is-onboarding-practice \.st-devtools-content\s*\{[\s\S]*?padding-bottom:[\s\S]*?--st-devtools-onboarding-nav-clearance/u,
    );
    assert.match(coachmarkStyle, /min-width:\s*52px[\s\S]*?min-height:\s*44px/u);
    assert.match(coachmarkStyle, /@container \(max-width: 520px\)/u);
});

test('coachmarks expose a named capture action, richer copy, and finite success motion', async () => {
    const ui = await readFile(UI_URL, 'utf8');
    const style = await readFile(STYLE_URL, 'utf8');
    const patchStyle = sourceTail(
        style,
        '/* v0.15.6 — clearer coaching, visible actions, and gentle success feedback. */',
    );
    const renderer = sourceBlock(
        ui,
        '\n    renderOnboardingStep(step, stage = \'briefing\') {',
        '\n    renderOnboardingPracticeActions(step) {',
    );
    const actionRenderer = sourceBlock(
        ui,
        '\n    renderOnboardingPracticeActions(step) {',
        '\n    renderOnboardingDemo(kind) {',
    );
    const view = sourceBlock(
        ui,
        '\n    updateOnboardingView() {',
        '\n    syncOnboardingModalState(modal) {',
    );
    const interactionHandler = sourceBlock(
        ui,
        '\n    handleOnboardingInteraction(event) {',
        '\n    clearOnboardingTarget({ preserveGuideGeometry = false } = {}) {',
    );

    assert.match(renderer, /onboarding\.step\.\$\{step\.id\}\.what/u);
    assert.match(renderer, /onboarding\.successTitle/u);
    assert.match(renderer, /st-devtools-onboarding-result-context/u);
    assert.match(actionRenderer, /st-devtools-onboarding-practice-action-label/u);
    assert.doesNotMatch(actionRenderer, /st-devtools-onboarding-round-button/u);
    assert.match(view, /st-devtools-onboarding-practice-title/u);
    assert.match(view, /st-devtools-onboarding-practice-meaning/u);
    assert.match(view, /st-devtools-onboarding-practice-context/u);
    assert.match(view, /st-devtools-onboarding-practice-task/u);
    assert.match(interactionHandler, /setTimeout\(\(\) => \{/u);
    assert.match(interactionHandler, /this\.onboardingSession !== session/u);
    assert.match(interactionHandler, /currentOnboardingStep\(\)\?\.id !== stepId/u);
    assert.match(
        style,
        /> \.st-devtools-onboarding-practice-exit\[hidden\]\s*\{[\s\S]*?display:\s*none !important/u,
    );
    assert.match(patchStyle, /min-width:\s*132px !important/u);
    assert.match(patchStyle, /data-stage='debrief'/u);
    assert.match(patchStyle, /st-devtools-coachmark-success-pop/u);
    assert.match(patchStyle, /900ms ease-out 2/u);
    assert.match(patchStyle, /@container \(max-width: 360px\)/u);
    assert.match(patchStyle, /prefers-reduced-motion: reduce/u);
});
