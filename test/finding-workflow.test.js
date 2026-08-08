import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
    DevToolsWindow,
    findingWorkflowEvidence,
} from '../src/ui.js';

const UI_URL = new URL('../src/ui.js', import.meta.url);
const STYLE_URL = new URL('../style.css', import.meta.url);
const I18N_URL = new URL('../src/i18n.js', import.meta.url);

function sourceBlock(source, start, end) {
    const startIndex = source.indexOf(start);
    assert.notEqual(startIndex, -1, `missing block start: ${start}`);
    const endIndex = source.indexOf(end, startIndex + start.length);
    assert.notEqual(endIndex, -1, `missing block end: ${end}`);
    return source.slice(startIndex, endIndex);
}

function evidenceRecord({
    atomId = 'atom-a',
    sourceId = 'source-a',
    sourceLabel = 'Main Prompt',
    text = '한국어로 답합니다.',
    start = 0,
    end = text.length,
} = {}) {
    return {
        atomId,
        sourceId,
        sourceLabel,
        text,
        localRange: { start, end },
    };
}

test('finding workflow evidence joins atom facts by atomId, deduplicates, and caps at two', () => {
    const first = evidenceRecord();
    const model = {
        // Deliberately reverse the evidence order so an array-index join would fail.
        atoms: [
            {
                id: 'atom-b',
                property: 'response.language',
                value: 'English',
                finalRanges: [{ start: 40, end: 60 }],
            },
            {
                id: 'atom-a',
                property: 'response.language',
                valueLabel: '한국어',
                condition: '일반 응답일 때',
                exception: '인용문은 제외',
                finalRanges: [
                    { start: 10, end: 30 },
                    { start: 8, end: 8 },
                ],
            },
            {
                id: 'atom-c',
                property: 'response.tone.formality',
                value: 'formal',
                finalRanges: [{ start: 70, end: 90 }],
            },
        ],
    };
    const result = findingWorkflowEvidence({
        evidenceRecords: [
            first,
            { ...first, localRange: { ...first.localRange } },
            evidenceRecord({
                atomId: 'atom-b',
                sourceId: 'source-b',
                sourceLabel: 'Language option',
                text: 'Reply in English.',
            }),
            evidenceRecord({
                atomId: 'atom-c',
                sourceId: 'source-c',
                text: 'Use a formal tone.',
            }),
        ],
    }, model);

    assert.equal(result.length, 2);
    assert.deepEqual(result.map(({ atomId }) => atomId), ['atom-a', 'atom-b']);
    assert.deepEqual(result[0].comparison, {
        property: 'response.language',
        value: '한국어',
        polarity: null,
        participantScope: null,
        condition: '일반 응답일 때',
        exception: '인용문은 제외',
    });
    assert.deepEqual(result[0].finalRanges, [{ start: 10, end: 30 }]);
    assert.equal(result.some(({ sourceId }) => sourceId === 'source-c'), false);
});

test('finding workflow evidence safely handles zero, one, and three records', () => {
    assert.deepEqual(findingWorkflowEvidence(null), []);
    assert.deepEqual(findingWorkflowEvidence({ evidenceRecords: [] }), []);

    const one = findingWorkflowEvidence({
        evidenceRecords: [evidenceRecord()],
    });
    assert.equal(one.length, 1);
    assert.equal(one[0].comparison, null);
    assert.equal(one[0].text, '한국어로 답합니다.');

    const three = findingWorkflowEvidence({
        evidenceRecords: [
            evidenceRecord({ atomId: 'atom-1', sourceId: 'source-1' }),
            evidenceRecord({ atomId: 'atom-2', sourceId: 'source-2' }),
            evidenceRecord({ atomId: 'atom-3', sourceId: 'source-3' }),
        ],
    });
    assert.equal(three.length, 2);
    assert.deepEqual(
        three.map(({ sourceId }) => sourceId),
        ['source-1', 'source-2'],
    );

    assert.deepEqual(findingWorkflowEvidence({
        evidenceRecords: [
            evidenceRecord({ sourceId: '', text: 'discard me' }),
            evidenceRecord({ sourceId: 'source-empty', text: '   ' }),
            null,
        ],
    }), []);
});

test('one finding is prepared as the only AI target without calling a provider', () => {
    let prepareCount = 0;
    let inspectCount = 0;
    let renderCount = 0;
    let invalidationCount = 0;
    const state = {
        targetIds: new Set(['finding:old', 'cluster:old']),
        status: 'complete',
    };
    const ui = Object.create(DevToolsWindow.prototype);
    ui.semanticInspector = {
        prepare() {
            prepareCount += 1;
        },
        inspect() {
            inspectCount += 1;
        },
    };
    ui.preferences = { semanticInspectorEnabled: true };
    ui.tutorialIsActive = () => false;
    ui.semanticSnapshotSupportsInspection = () => true;
    ui.semanticTargetHasClosure = () => true;
    ui.ensureSemanticInspectionSnapshot = () => state;
    ui.invalidateSemanticInspectionOutcome = (next) => {
        assert.equal(next, state);
        invalidationCount += 1;
        next.status = 'idle';
    };
    ui.render = () => {
        renderCount += 1;
    };

    const previousToastr = globalThis.toastr;
    globalThis.toastr = { info() {} };
    try {
        assert.equal(ui.prepareSemanticWorkflowForFinding(
            { id: 'snapshot-1' },
            { id: 'finding-7', sourceIds: ['source-7'] },
        ), true);
    } finally {
        globalThis.toastr = previousToastr;
    }

    assert.deepEqual([...state.targetIds], ['finding:finding-7']);
    assert.equal(state.status, 'idle');
    assert.equal(ui.pendingSemanticWorkflowTargetId, 'finding:finding-7');
    assert.equal(ui.ruleViewMode, 'ai');
    assert.equal(invalidationCount, 1);
    assert.equal(renderCount, 1);
    assert.equal(prepareCount, 0);
    assert.equal(inspectCount, 0);
});

test('AI profile changes preserve the prepared single-finding workflow', () => {
    const ui = Object.create(DevToolsWindow.prototype);
    ui.analysisRevision = 3;
    ui.semanticWorkflowFindingKey = 'review-key-7';
    ui.pendingSemanticWorkflowTargetId = null;
    ui.semanticInspectionState = {
        snapshotId: 'snapshot-7',
        analysisRevision: 3,
        targetIds: new Set(['finding:finding-7']),
        sequence: 1,
        controller: null,
    };
    ui.selectedSnapshot = () => ({ id: 'snapshot-7' });
    ui.cancelSemanticProviderEvaluation = () => {};
    ui.cancelSemanticInspection = () => {};
    ui.closeSemanticConsent = () => {};
    ui.refreshSemanticInspectorHost = () => {};
    ui.clearSemanticInspectorCache = () => {};

    ui.resetSemanticInspectionForSettingsChange({
        semanticInspectorEnabled: true,
    });

    assert.equal(ui.semanticInspectionState.snapshotId, 'snapshot-7');
    assert.deepEqual(
        [...ui.semanticInspectionState.targetIds],
        ['finding:finding-7'],
    );
    assert.equal(ui.semanticWorkflowFindingKey, 'review-key-7');
    assert.equal(ui.pendingSemanticWorkflowTargetId, 'finding:finding-7');

    ui.resetSemanticInspectionForSettingsChange({
        semanticInspectorEnabled: false,
    });
    assert.equal(ui.semanticWorkflowFindingKey, null);
    assert.equal(ui.pendingSemanticWorkflowTargetId, null);
    assert.deepEqual([...ui.semanticInspectionState.targetIds], []);
});

test('a stale explorer callback cannot focus evidence in another snapshot', () => {
    const ui = Object.create(DevToolsWindow.prototype);
    let activeTab = 'rules';
    let selectedSnapshotId = 'snapshot-1';
    let scheduled = null;
    const focused = [];
    ui.ruleWorkflowSequence = 0;
    ui.analysisRevision = 4;
    ui.ruleWorkflowOpenFindingKeys = new Set();
    ui.ruleWorkflowReturn = null;
    ui.tutorialIsActive = () => false;
    ui.setSelectedSnapshotId = (id) => {
        selectedSnapshotId = id;
    };
    ui.selectTab = (id) => {
        activeTab = id;
    };
    ui.activeTabId = () => activeTab;
    ui.selectedSnapshot = () => ({ id: selectedSnapshotId });
    ui.scheduleExplorerFocus = (callback) => {
        scheduled = callback;
    };
    ui.focusRuleSources = (...args) => focused.push(args);
    ui.focusRuleEvidence = (...args) => focused.push(args);

    ui.openExplorerForFinding(
        { id: 'snapshot-1' },
        { id: 'finding-1', sourceIds: ['source-1'], finalRanges: [] },
        'sources',
        evidenceRecord({ sourceId: 'source-1' }),
    );
    selectedSnapshotId = 'snapshot-2';
    scheduled();

    assert.equal(focused.length, 0);
    assert.equal(ui.ruleWorkflowReturn.snapshotId, 'snapshot-1');

    selectedSnapshotId = 'snapshot-1';
    ui.openExplorerForFinding(
        { id: 'snapshot-1' },
        { id: 'finding-1', sourceIds: ['source-1'], finalRanges: [] },
        'sources',
        evidenceRecord({ sourceId: 'source-1' }),
    );
    ui.analysisRevision += 1;
    scheduled();
    assert.equal(focused.length, 0);
});

test('finding workflow UI keeps evidence, return, immediate review, and AI consent boundaries explicit', async () => {
    const [ui, css, i18n] = await Promise.all([
        readFile(UI_URL, 'utf8'),
        readFile(STYLE_URL, 'utf8'),
        readFile(I18N_URL, 'utf8'),
    ]);
    const evidence = sourceBlock(
        ui,
        '\n    renderFindingEvidenceWorkflow(',
        '\n    prepareSemanticWorkflowForFinding(',
    );
    const semanticPreparation = sourceBlock(
        ui,
        '\n    prepareSemanticWorkflowForFinding(',
        '\n    renderFindingNextAction(',
    );
    const review = sourceBlock(
        ui,
        '\n    renderFindingReviewControls(',
        '\n    renderReviewedFindings(',
    );
    const explorerReturn = sourceBlock(
        ui,
        '\n    renderRuleWorkflowReturnBanner(',
        '\n    renderExplorer(',
    );
    const explorerNavigation = sourceBlock(
        ui,
        '\n    openExplorerForFinding(',
        '\n    highlightLocalSourceEvidence(',
    );
    const localEvidence = sourceBlock(
        ui,
        '\n    highlightLocalSourceEvidence(',
        '\n    focusRuleSources(',
    );

    assert.match(evidence, /findingWorkflowEvidence\(finding, instructionModel\)/u);
    assert.match(evidence, /fallbackEvidenceCount/u);
    assert.match(evidence, /review\.workflow\.evidenceUnavailable/u);
    assert.match(evidence, /st-devtools-finding-evidence-grid/u);
    assert.match(evidence, /openExplorerForFinding\([\s\S]*?'sources'/u);
    assert.match(explorerReturn, /review\.workflow\.returnAction/u);
    assert.match(explorerReturn, /this\.selectTab\('rules'\)/u);
    assert.match(explorerReturn, /this\.scheduleRuleFindingFocus\(\s*route\.findingKey/u);
    assert.match(explorerNavigation, /ruleWorkflowReturn\?\.sequence !== workflowSequence/u);
    assert.match(explorerNavigation, /this\.selectedSnapshot\(\)\?\.id !== snapshot\.id/u);
    assert.match(explorerNavigation, /focusRuleSources\(sourceIds, finalRanges, evidence\)/u);
    assert.match(localEvidence, /workflowRange\(localRange\)/u);
    assert.match(localEvidence, /st-devtools-rule-evidence-mark rule-focus/u);
    assert.match(localEvidence, /text\.slice\(range\.start, range\.end\)/u);

    assert.match(review, /for \(const decision of \['valid', 'false-positive'\]\)/u);
    assert.match(review, /setAttribute\(\s*'aria-pressed'/u);
    assert.match(review, /this\.updateFindingDecision\(snapshot, finding, decision\)/u);
    assert.match(review, /review\.workflow\.advancedActions/u);

    assert.match(semanticPreparation, /state\.targetIds\.clear\(\)/u);
    assert.match(semanticPreparation, /state\.targetIds\.add\(targetId\)/u);
    assert.match(semanticPreparation, /this\.pendingSemanticWorkflowTargetId = targetId/u);
    assert.match(semanticPreparation, /this\.ruleViewMode = 'ai'/u);
    assert.doesNotMatch(
        semanticPreparation,
        /semanticInspector\.(?:prepare|inspect)|startSemanticInspection/u,
    );
    assert.match(i18n, /'review\.workflow\.evidenceTitle':/u);
    assert.match(i18n, /'review\.workflow\.evidenceSingleTitle':/u);
    assert.match(i18n, /'review\.workflow\.evidenceUnavailable':/u);
    assert.match(i18n, /'review\.workflow\.aiUnavailableNoEvidence':/u);
    assert.match(i18n, /'review\.workflow\.returnAction':/u);
    assert.match(i18n, /'review\.workflow\.aiPrepared':/u);

    const mobileGrid = sourceBlock(
        css,
        '\n.st-devtools-finding-evidence-grid {',
        '\n.st-devtools-finding-evidence-card {',
    );
    assert.match(mobileGrid, /grid-template-columns:\s*minmax\(0, 1fr\)/u);
    assert.match(
        css,
        /@container \(min-width: 620px\) \{[\s\S]*?\.st-devtools-finding-evidence-grid \{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/u,
    );
    assert.match(
        css,
        /\.st-devtools-finding-evidence-card > strong \{[\s\S]*?overflow-wrap:\s*anywhere/u,
    );
    assert.match(
        css,
        /\.st-devtools-finding-evidence-card pre \{[\s\S]*?white-space:\s*pre-wrap;[\s\S]*?overflow-wrap:\s*anywhere/u,
    );
});
