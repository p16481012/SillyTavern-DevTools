import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { growthChartDomain } from '../src/ui.js';

test('growth chart expands small changes and returns to a zero baseline for large gaps', () => {
    const focused = growthChartDomain([1_600, 1_610, 1_605, 1_615]);
    assert.equal(focused.focused, true);
    assert.ok(focused.minimum > 0);
    assert.ok(focused.maximum > focused.rawMaximum);

    const absolute = growthChartDomain([200, 2_000]);
    assert.equal(absolute.focused, false);
    assert.equal(absolute.minimum, 0);

    const constant = growthChartDomain([1_000, 1_000]);
    assert.equal(constant.focused, false);
    assert.equal(constant.minimum, 0);
});

test('v0.12.3 UI contracts preserve AI work across tabs and expose compact controls', async () => {
    const [ui, css, i18n] = await Promise.all([
        readFile(new URL('../src/ui.js', import.meta.url), 'utf8'),
        readFile(new URL('../style.css', import.meta.url), 'utf8'),
        readFile(new URL('../src/i18n.js', import.meta.url), 'utf8'),
    ]);
    const render = ui.slice(
        ui.indexOf('    render() {'),
        ui.indexOf('    renderEmpty()', ui.indexOf('    render() {')),
    );
    const provenance = ui.slice(
        ui.indexOf('renderProvenanceDetails(source)'),
        ui.indexOf('renderExplorerOverview(snapshot)'),
    );
    const focus = ui.slice(
        ui.indexOf('focusRuleEvidence(finalRanges'),
        ui.indexOf('renderTimeline()', ui.indexOf('focusRuleEvidence(finalRanges')),
    );
    const timeline = ui.slice(
        ui.indexOf('    renderTimeline()'),
        ui.indexOf('    renderStorageOverview()'),
    );
    const growth = ui.slice(
        ui.indexOf('    renderGrowthChart('),
        ui.indexOf('    renderFieldChanges('),
    );

    assert.doesNotMatch(render, /invalidateAnalysisState\(\)/);
    assert.match(provenance, /source\.type !== 'final'/);
    assert.match(provenance, /fa-crosshairs/);
    assert.doesNotMatch(provenance, /text: t\('action\.jumpToFinal'\)/);
    assert.match(focus, /ensureSourceCardMounted\(finalSource\.id\)/);
    assert.match(timeline, /setSelectedSnapshotId\(snapshot\.id\)/);
    assert.match(growth, /setSelectedSnapshotId\(snapshot\.id\)/);
    assert.match(ui, /st-devtools-overview-provider/);
    assert.match(ui, /st-devtools-overview-model-name/);
    assert.match(ui, /classList\.add\('fa-spin'\)/);
    assert.match(ui, /refreshed \? 'fa-check' : 'fa-triangle-exclamation'/);
    assert.match(ui, /setTimeout\(resolve, 2_000\)/);
    assert.match(css, /st-devtools-help-tooltip[\s\S]*align-self: center/);
    assert.match(css, /input\[type='checkbox'\][\s\S]*::after/);
    assert.doesNotMatch(ui, /buildPricingSettingsEditor|st-devtools-pricing-/);
    assert.doesNotMatch(css, /st-devtools-pricing-/);
    assert.doesNotMatch(i18n, /'settings\.pricing|'semantic\.cost/);
    assert.match(ui, /LEGACY_PRICING_OVERRIDES_KEY/);
});
