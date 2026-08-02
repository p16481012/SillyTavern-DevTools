import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('v0.13.0 semantic results use readable source names and expose busy state', async () => {
    const [ui, css] = await Promise.all([
        readFile(new URL('../src/ui.js', import.meta.url), 'utf8'),
        readFile(new URL('../style.css', import.meta.url), 'utf8'),
    ]);
    const resultsStart = ui.indexOf('    renderSemanticSuggestions(');
    const resultsEnd = ui.indexOf(
        '    renderSemanticInspector(',
        resultsStart,
    );
    const results = ui.slice(resultsStart, resultsEnd);
    const inspectorStart = resultsEnd;
    const inspectorEnd = ui.indexOf(
        '    renderSemanticInspectorDisclosure(',
        inspectorStart,
    );
    const inspector = ui.slice(inspectorStart, inspectorEnd);

    assert.match(results, /sourceLabels = new Map/);
    assert.match(results, /sourceDisplayLabel\(source\)/);
    assert.match(results, /sourceLabels\.get\(item\?\.sourceId\)/);
    assert.doesNotMatch(
        results,
        /source:\s*item\?\.sourceId\s*\?\?/,
    );
    assert.match(
        inspector,
        /announcement\.setAttribute\('role', 'status'\)/,
    );
    assert.doesNotMatch(
        inspector,
        /dynamic\.setAttribute\('role', 'status'\)/,
    );
    assert.match(inspector, /t\('semantic\.complete'/);
    assert.match(
        inspector,
        /section\.setAttribute\('aria-busy', String\(busy\)\)/,
    );
    assert.match(
        inspector,
        /this\.renderSemanticSuggestions\(state\.result, snapshot\)/,
    );
    assert.match(css, /\.st-devtools-semantic-error-diagnostic/);
    assert.match(css, /font-family: ui-monospace/);
});
