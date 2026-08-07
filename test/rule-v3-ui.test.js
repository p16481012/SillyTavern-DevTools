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

    const comparisonStart = ui.indexOf('renderComparisonAnalysis(snapshot, comparison = {})');
    const comparisonEnd = ui.indexOf('\n    renderInstructionModel(model)', comparisonStart);
    const comparisonUi = ui.slice(comparisonStart, comparisonEnd);
    assert.match(comparisonUi, /suppressedComparisonCount/);
    assert.match(comparisonUi, /attachLazyDetailsContent\(details, \(\) => \{/);
    assert.match(comparisonUi, /comparison\.suppressedTruncated/);
});
