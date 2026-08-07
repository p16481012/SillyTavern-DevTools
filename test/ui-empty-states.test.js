import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { emptyStateModel } from '../src/ui.js';

test('every primary tab has a distinct empty-state contract', () => {
    const models = [
        'explorer',
        'timeline',
        'diff',
        'rules',
        'search',
    ].map((tabId) => emptyStateModel(tabId, 0, 0));

    assert.equal(new Set(models.map(({ titleKey }) => titleKey)).size, 5);
    assert.equal(new Set(models.map(({ descriptionKey }) => descriptionKey)).size, 5);
    assert.equal(models.find(({ tabId }) => tabId === 'explorer').showQuickStart, true);
    assert.equal(
        models.filter(({ showQuickStart }) => showQuickStart).length,
        1,
    );
    assert.equal(
        models.find(({ tabId }) => tabId === 'diff').progressValue,
        0,
    );
});

test('comparison empty state separates missing captures from a low read limit', () => {
    const zero = emptyStateModel('diff', 0, 0);
    assert.equal(zero.titleKey, 'empty.diff.title.zero');
    assert.equal(zero.progressValue, 0);
    assert.equal(zero.needsMoreLoaded, false);
    assert.equal(zero.backLabelKey, 'action.returnToChat');

    const one = emptyStateModel('diff', 1, 1);
    assert.equal(one.titleKey, 'empty.diff.title.one');
    assert.equal(one.progressValue, 1);
    assert.equal(one.needsMoreLoaded, false);
    assert.equal(one.backLabelKey, 'empty.diff.sendAnother');

    const loadMore = emptyStateModel('diff', 1, 8);
    assert.equal(loadMore.titleKey, 'empty.diff.title.load');
    assert.equal(loadMore.descriptionKey, 'empty.diff.description.load');
    assert.equal(loadMore.loadedCount, 1);
    assert.equal(loadMore.storedCount, 8);
    assert.equal(loadMore.progressValue, 1);
    assert.equal(loadMore.needsMoreLoaded, true);
    assert.equal(loadMore.backLabelKey, 'action.returnToChat');
});

test('empty-state scrollbar styling keeps scrolling while hiding only its visual rail', async () => {
    const style = await readFile(new URL('../style.css', import.meta.url), 'utf8');
    const ui = await readFile(new URL('../src/ui.js', import.meta.url), 'utf8');
    const baseStart = style.indexOf('.st-devtools-content {');
    const baseEnd = style.indexOf('/* v0.16.11', baseStart);
    const base = style.slice(baseStart, baseEnd);
    const emptyStart = style.indexOf('.st-devtools-content.is-empty-state {');
    const emptyEnd = style.indexOf('.st-devtools-screen-header {', emptyStart);
    const empty = style.slice(emptyStart, emptyEnd);

    assert.match(base, /overflow-y:\s*auto/u);
    assert.doesNotMatch(base, /overflow-y:\s*hidden/u);
    assert.match(empty, /scrollbar-width:\s*none !important/u);
    assert.match(empty, /::-webkit-scrollbar[\s\S]*?display:\s*none !important/u);
    assert.doesNotMatch(empty, /overflow:\s*hidden|overflow-y:\s*hidden/u);
    assert.match(
        style,
        /\.st-devtools-empty \{[\s\S]*?box-sizing:\s*border-box;[\s\S]*?min-width:\s*0;/u,
    );
    assert.match(ui, /classList\?\.remove\('is-empty-state'\)/u);
    assert.match(
        ui,
        /if \(!snapshot && activeTab !== 'timeline'\) \{[\s\S]*?classList\?\.add\('is-empty-state'\)/u,
    );
    assert.match(
        ui,
        /privacyMode !== 'full'[\s\S]*?classList\?\.toggle\([\s\S]*?'is-empty-state'[\s\S]*?activeTab === 'timeline'[\s\S]*?activeTab === 'diff'/u,
    );
});

test('low read-limit action opens settings at the relevant control', async () => {
    const ui = await readFile(new URL('../src/ui.js', import.meta.url), 'utf8');

    assert.match(
        ui,
        /openSettings\(\{ targetId = '' \} = \{\}\)[\s\S]*?querySelector\(`#\$\{targetId\}`\)[\s\S]*?scrollIntoView/u,
    );
    assert.match(
        ui,
        /empty\.diff\.openSettings[\s\S]*?openSettings\(\{[\s\S]*?targetId: 'st-devtools-settings-timeline-limit'/u,
    );
});
