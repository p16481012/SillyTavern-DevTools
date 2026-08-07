import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Rule Inspector V3 UI stays collapsed and exposes evidence metadata', async () => {
    const ui = await readFile(new URL('../src/ui.js', import.meta.url), 'utf8');
    const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
    const i18n = await readFile(new URL('../src/i18n.js', import.meta.url), 'utf8');

    assert.match(ui, /renderInstructionModel\(model\)/);
    assert.match(ui, /this\.instructionModelOpen = false/);
    assert.match(ui, /this\.instructionAtomsOpen = false/);
    assert.match(ui, /attachLazyDetailsContent\(atoms, \(\) => \{/);
    assert.match(ui, /visibleAtoms = \(model\?\.atoms \?\? \[\]\)\.slice\(0, 100\)/);
    assert.match(ui, /rules\.v3\.atomTargetAction/);
    assert.match(ui, /rules\.v3\.atomParticipant/);
    assert.match(ui, /rules\.participant\.\$\{atom\.participantScope\}/);
    assert.match(ui, /rules\.v3\.atomLocation/);
    assert.match(ui, /rules\.v3\.atomEvidence/);
    assert.match(ui, /clusterById = new Map/);
    assert.match(ui, /model\?\.compatibilityRelations\?\.length/);
    assert.match(ui, /st-devtools-instruction-compatibilities/);
    assert.match(ui, /st-devtools-instruction-compatibility/);
    assert.match(ui, /rules\.v3\.compatibilitySources/);
    assert.match(ui, /relation\.applicabilityKind/);
    assert.match(css, /\.st-devtools-instruction-model/);
    assert.match(css, /\.st-devtools-instruction-atom-evidence > pre/);
    assert.match(css, /overflow-wrap:\s*break-word/);
    assert.match(css, /\.st-devtools-instruction-count\.is-compatible/);
    assert.match(css, /\.st-devtools-compatible-count/);
    assert.match(css, /\.st-devtools-instruction-compatibilities\s*\{/);
    assert.match(css, /\.st-devtools-instruction-compatibility\s*\{/);
    assert.match(css, /\.st-devtools-instruction-compatibility > p[\s\S]*overflow-wrap:\s*anywhere/);
    assert.match(css, /@container \(min-width:\s*620px\)[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    assert.match(i18n, /'rules\.determination\.confirmed':\s*'확정'/);
    assert.match(i18n, /'rules\.determination\.candidate':\s*'후보'/);
    assert.match(i18n, /'rules\.determination\.insufficient-evidence':\s*'근거 부족'/);
    assert.match(i18n, /'rules\.v3\.compatibilityTitle':/);
    assert.match(i18n, /'rules\.v3\.applicability\.mutually-exclusive':/);
    assert.match(i18n, /'rules\.v3\.applicability\.exception-specialization':/);
    for (const category of ['tone', 'identity', 'safety', 'memory']) {
        assert.match(i18n, new RegExp(`'rules\\.setting\\.${category}':`, 'u'));
        assert.match(i18n, new RegExp(`'rules\\.v3\\.${category}\\.message':`, 'u'));
        assert.match(i18n, new RegExp(`'rules\\.${category}\\.title':`, 'u'));
    }
    for (const key of [
        'rules.target.conversation-memory',
        'rules.action.set-tone',
        'rules.action.disclose',
        'rules.action.refuse',
        'rules.action.use',
        'rules.action.ignore',
        'rules.action.retain',
        'rules.action.forget',
        'rules.scope.style',
        'rules.scope.safety',
        'rules.scope.memory',
        'rules.participant.assistant-response',
        'rules.participant.character-profile',
        'rules.participant.user-profile',
        'rules.participant.shared-context',
        'rules.participant.unknown',
        'rules.property.response.tone.warmth',
        'rules.property.response.tone.formality',
        'rules.property.response.tone.respect',
        'rules.property.assistant.identity.exclusive',
        'rules.property.response.safety.secret-disclosure',
        'rules.property.response.safety.harmful-detail',
        'rules.property.memory.history-use',
        'rules.property.memory.sensitive-retention',
    ]) {
        assert.equal(i18n.includes(`'${key}':`), true, `${key} translation missing`);
    }
    assert.match(i18n, /'rules\.v3\.atomParticipant':/);
    assert.match(i18n, /'comparison\.categoriesHint':[\s\S]*tone[\s\S]*identity[\s\S]*safety[\s\S]*memory/);

    const comparisonStart = ui.indexOf('renderComparisonAnalysis(snapshot, comparison = {})');
    const comparisonEnd = ui.indexOf('\n    renderInstructionModel(model)', comparisonStart);
    const comparisonUi = ui.slice(comparisonStart, comparisonEnd);
    assert.match(comparisonUi, /suppressedComparisonCount/);
    assert.match(comparisonUi, /attachLazyDetailsContent\(details, \(\) => \{/);
    assert.match(comparisonUi, /comparison\.suppressedTruncated/);
});
