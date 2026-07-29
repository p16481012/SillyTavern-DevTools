import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildSources,
    createSnapshotId,
    findExactRanges,
    findNormalizedRanges,
    findTemplateRanges,
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
    assert.deepEqual(
        sources.find((source) => source.label === 'Character Description')?.ranges,
        [{ start: 11, end: 37 }],
    );
    assert.equal(sources.find((source) => source.label === 'Chat History')?.attribution, 'derived');
    assert.equal(sources.at(-1).type, 'final');
});

test('findExactRanges records every non-overlapping source occurrence', () => {
    assert.deepEqual(findExactRanges('alpha beta alpha', 'alpha'), [
        { start: 0, end: 5 },
        { start: 11, end: 16 },
    ]);
});

test('normalized provenance maps conservative whitespace and case transformations', () => {
    assert.deepEqual(
        findNormalizedRanges('Prefix HELLO,\n   World suffix', 'hello, world'),
        [{ start: 7, end: 22 }],
    );
    assert.deepEqual(findNormalizedRanges('short', 'SHORT'), []);
});

test('macro template provenance maps substituted candidates with bounded confidence', () => {
    const template = '이름: {{user}}, 오늘의 임무: {{mission}}. 끝까지 수행하세요.';
    const finalText = '앞부분\n이름: 민수, 오늘의 임무: 문을 열기. 끝까지 수행하세요.\n뒷부분';
    const match = findTemplateRanges(finalText, template);
    assert.equal(match.method, 'macro-template');
    assert.equal(match.ranges.length, 1);
    assert.ok(match.confidence >= 0.55 && match.confidence <= 0.92);
    assert.equal(
        finalText.slice(match.ranges[0].start, match.ranges[0].end),
        '이름: 민수, 오늘의 임무: 문을 열기. 끝까지 수행하세요.',
    );

    const sources = buildSources({
        character: { data: { description: template } },
        personaDescription: '',
        authorsNote: '',
        extensionPrompts: {},
        configuredPrompts: [],
    }, [{ role: 'system', content: finalText }], []);
    const description = sources.find(
        (source) => source.labelKey === 'source.characterDescription',
    );
    assert.equal(description.attribution, 'template');
    assert.equal(description.provenance.method, 'macro-template');
    assert.equal(description.included, true);
});

test('buildSources separates tool calls, results, schemas, and multimodal parts', () => {
    const payload = [
        {
            role: 'assistant',
            content: '',
            tool_calls: [{
                id: 'call-1',
                type: 'function',
                function: { name: 'weather', arguments: '{"city":"Seoul"}' },
            }],
        },
        { role: 'tool', tool_call_id: 'call-1', content: '{"temperature":30}' },
        {
            role: 'user',
            content: [
                { type: 'text', text: '이 이미지를 설명해줘' },
                { type: 'image_url', image_url: { url: '[미디어 데이터 생략됨]' } },
            ],
        },
    ];
    const sources = buildSources({
        character: {},
        personaDescription: '',
        authorsNote: '',
        extensionPrompts: {},
        configuredPrompts: [],
    }, payload, [], {
        tools: [{
            type: 'function',
            function: { name: 'weather', parameters: { type: 'object' } },
        }],
    });

    assert.equal(sources.filter((source) => source.type === 'tool_schema').length, 1);
    assert.equal(sources.filter((source) => source.type === 'tool_call').length, 1);
    assert.equal(sources.filter((source) => source.type === 'tool_result').length, 1);
    assert.equal(sources.filter((source) => source.type === 'multimodal').length, 1);
    assert.match(sources.at(-1).content, /TOOL CALLS/);
    assert.match(sources.at(-1).content, /\[이미지 입력 2\]/);
});

test('buildSources attaches provider-specific multimodal token estimates', () => {
    const payload = [{
        role: 'user',
        content: [{
            type: 'image_url',
            image_url: { url: '[미디어 데이터 생략됨]' },
            width: 1024,
            height: 1024,
            detail: 'high',
        }],
    }];
    const sources = buildSources({
        character: {},
        personaDescription: '',
        authorsNote: '',
        extensionPrompts: {},
        configuredPrompts: [],
    }, payload, [], {
        settings: { provider: 'openai', model: 'gpt-4o' },
        body: { model: 'gpt-4o' },
    });
    const image = sources.find((source) => source.type === 'multimodal');
    assert.equal(image.metadata.tokenEstimate.tokens, 765);
    assert.equal(image.metadata.tokenEstimate.method, 'openai-tile-512');
});

test('buildSources includes processed character prompt fields', () => {
    const payload = [{ role: 'system', content: 'System card\nExample dialogue\nDepth instruction' }];
    const sources = buildSources({
        character: {},
        characterFields: {
            systemPrompt: 'System card',
            exampleDialogue: 'Example dialogue',
            depthPrompt: 'Depth instruction',
        },
        personaDescription: '',
        authorsNote: '',
        extensionPrompts: {},
        configuredPrompts: [],
    }, payload, []);

    assert.equal(sources.find((source) => source.labelKey === 'source.characterSystemPrompt')?.attribution, 'exact');
    assert.equal(sources.find((source) => source.labelKey === 'source.characterExamples')?.attribution, 'exact');
    assert.equal(sources.find((source) => source.labelKey === 'source.characterDepthPrompt')?.attribution, 'exact');
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
