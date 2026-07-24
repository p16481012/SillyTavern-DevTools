import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildSources,
    createSnapshotId,
    flattenPrompt,
    searchSnapshot,
    serializeSnapshot,
} from '../src/model.js';

test('flattenPrompt preserves chat message order and roles', () => {
    const flattened = flattenPrompt([
        { role: 'system', content: 'Rules' },
        { role: 'user', content: 'Hello' },
    ]);
    assert.match(flattened, /# 1 SYSTEM\nRules/);
    assert.match(flattened, /# 2 USER\nHello/);
    assert.ok(flattened.indexOf('Rules') < flattened.indexOf('Hello'));
});

test('buildSources marks exact source content without altering the payload', () => {
    const payload = [
        { role: 'system', content: 'Character description here' },
        { role: 'user', content: 'Hello' },
    ];
    const before = structuredClone(payload);
    const sources = buildSources({
        character: { data: { description: 'Character description here' } },
        personaDescription: '',
        authorsNote: '',
        extensionPrompts: {},
        configuredPrompts: [],
    }, payload, []);

    assert.deepEqual(payload, before);
    assert.equal(sources.find((source) => source.label === 'Character Description')?.attribution, 'exact');
    assert.equal(sources.find((source) => source.label === 'Chat History')?.attribution, 'derived');
    assert.equal(sources.at(-1).type, 'final');
});

test('snapshot ids are stable for identical inputs at the same timestamp', () => {
    const payload = [{ role: 'user', content: 'same' }];
    assert.equal(createSnapshotId(1234, payload), createSnapshotId(1234, payload));
});

test('searchSnapshot supports literal and regex searches', () => {
    const snapshot = {
        sources: [{ id: 'a', label: 'A', content: 'Alpha beta ALPHA' }],
    };
    assert.equal(searchSnapshot(snapshot, 'alpha').length, 2);
    assert.equal(searchSnapshot(snapshot, '^Alpha', { regex: true }).length, 1);
    assert.throws(() => searchSnapshot(snapshot, '[', { regex: true }));
});

test('serializeSnapshot emits JSON, text, and Markdown', () => {
    const snapshot = {
        id: 'id',
        timestamp: 0,
        api: 'openai',
        model: 'model',
        stats: { totalTokens: 10 },
        sources: [{
            label: 'Final Prompt',
            type: 'final',
            tokenCount: 10,
            attribution: 'exact',
            content: 'hello',
        }],
    };
    assert.equal(JSON.parse(serializeSnapshot(snapshot, 'json')).id, 'id');
    assert.match(serializeSnapshot(snapshot, 'txt'), /최종 프롬프트/);
    assert.match(serializeSnapshot(snapshot, 'markdown'), /# ST DevTools 스냅샷/);
});
