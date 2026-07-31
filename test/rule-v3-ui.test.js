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
    assert.match(css, /\.st-devtools-instruction-model/);
    assert.match(css, /\.st-devtools-instruction-atom-evidence > pre/);
    assert.match(css, /overflow-wrap:\s*break-word/);
    assert.match(i18n, /'rules\.determination\.confirmed':\s*'확정'/);
    assert.match(i18n, /'rules\.determination\.candidate':\s*'후보'/);
    assert.match(i18n, /'rules\.determination\.insufficient-evidence':\s*'근거 부족'/);
});
