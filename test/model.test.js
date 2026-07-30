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
    snapshotProvider,
} from '../src/model.js';
import { providerDisplayLabel } from '../src/i18n.js';

test('snapshot provider prefers the captured Chat Completion source', () => {
    const legacySnapshot = {
        api: 'openai',
        promptType: 'chat-completion',
        request: {
            settings: {
                chat_completion_source: 'makersuite',
                provider: ['Google', 'Anthropic'],
            },
        },
    };

    assert.equal(snapshotProvider(legacySnapshot), 'makersuite');
    assert.equal(providerDisplayLabel(snapshotProvider(legacySnapshot)), 'Google AI Studio');
    assert.equal(snapshotProvider({
        ...legacySnapshot,
        provider: 'openrouter',
    }), 'makersuite');
});

test('snapshot provider keeps non-chat APIs and legacy fallbacks accurate', () => {
    assert.equal(snapshotProvider({
        api: 'kobold',
        promptType: 'text-completion',
        request: { settings: { provider: 'openai' } },
    }), 'kobold');
    assert.equal(snapshotProvider({
        api: 'openai',
        promptType: 'chat-completion',
    }), 'openai');
    assert.equal(snapshotProvider({
        api: 'textgenerationwebui',
        provider: 'openrouter',
        promptType: 'text-completion',
    }), 'openrouter');
    assert.equal(snapshotProvider({
        api: 'textgenerationwebui',
        provider: 'ooba',
        promptType: 'text-completion',
    }), 'textgenerationwebui');
    assert.equal(snapshotProvider({
        api: 'textgenerationwebui',
        provider: 'unknown',
        promptType: 'text-completion',
    }), 'textgenerationwebui');
    assert.equal(snapshotProvider({
        api: 'unknown',
        provider: 'openrouter',
        promptType: 'text-completion',
    }), 'openrouter');
    assert.equal(snapshotProvider({
        api: 'unknown',
        provider: 'ooba',
        promptType: 'text-completion',
    }), 'textgenerationwebui');
    assert.equal(providerDisplayLabel('private-router'), 'private-router');
    assert.equal(providerDisplayLabel('unknown'), '알 수 없음');
});

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

test('configured prompt sources preserve stable metadata separately from payload inclusion', () => {
    const sources = buildSources({
        character: {},
        personaDescription: '',
        authorsNote: '',
        extensionPrompts: {},
        configuredPrompts: [{
            identifier: 'language-korean',
            name: 'Output language | Korean',
            content: 'Always answer in Korean.',
            enabled: true,
            role: 'system',
            injection_position: 'relative',
            injection_depth: 4,
        }, {
            identifier: 'not-sent',
            name: 'Configured but omitted',
            content: 'This configured prompt was not sent.',
            enabled: true,
            role: 'system',
        }],
    }, [{ role: 'system', content: 'Always answer in Korean.' }], []);

    const included = sources.find(
        (source) => source.metadata?.identifier === 'language-korean',
    );
    assert.equal(included.configuredEnabled, true);
    assert.equal(included.included, true);
    assert.equal(included.attribution, 'exact');
    assert.equal(included.provenance.method, 'configured-payload-exact');
    assert.deepEqual(included.provenance.messageIndexes, [0]);
    assert.deepEqual(included.metadata, {
        sourceKind: 'configuredPrompt',
        identifier: 'language-korean',
        name: 'Output language | Korean',
        role: 'system',
        enabled: true,
        configuredEnabled: true,
        promptOrder: 0,
        promptOrderSource: 'captured-array',
        position: 'relative',
        depth: 4,
    });

    const omitted = sources.find((source) => source.metadata?.identifier === 'not-sent');
    assert.equal(omitted.configuredEnabled, true);
    assert.equal(omitted.included, false);
    assert.equal(omitted.attribution, 'unmatched');
    assert.equal(omitted.provenance.method, 'configured-payload-unmatched');
});

test('disabled configured prompts cannot claim an identical active prompt payload', () => {
    const sources = buildSources({
        character: {},
        personaDescription: '',
        authorsNote: '',
        extensionPrompts: {},
        configuredPrompts: [{
            identifier: 'disabled-copy',
            name: 'Disabled copy',
            content: 'Shared configured instruction.',
            enabled: false,
            role: 'system',
        }, {
            identifier: 'active-copy',
            name: 'Active copy',
            content: 'Shared configured instruction.',
            enabled: true,
            role: 'system',
        }],
    }, [{ role: 'system', content: 'Shared configured instruction.' }], []);

    const disabled = sources.find(
        (source) => source.metadata?.identifier === 'disabled-copy',
    );
    const active = sources.find(
        (source) => source.metadata?.identifier === 'active-copy',
    );
    assert.equal(disabled.configuredEnabled, false);
    assert.equal(disabled.included, false);
    assert.equal(disabled.attribution, 'unmatched');
    assert.deepEqual(disabled.ranges, []);
    assert.equal(disabled.provenance.method, 'configured-disabled');
    assert.equal(active.configuredEnabled, true);
    assert.equal(active.included, true);
    assert.equal(active.attribution, 'exact');
    assert.ok(active.ranges.length > 0);
    assert.equal(
        sources.some((source) => source.metadata?.sourceKind === 'requestMessage'),
        false,
    );
});

test('configured prompt matching is role-scoped and preserves unknown request system text', () => {
    const payload = [
        { role: 'system', name: 'provider', content: 'Provider-injected safety rule.' },
        { role: 'user', content: 'System-only configured text.' },
    ];
    const sources = buildSources({
        character: {},
        personaDescription: '',
        authorsNote: '',
        extensionPrompts: {},
        configuredPrompts: [{
            identifier: 'disabled-provider-copy',
            name: 'Disabled provider copy',
            content: 'Provider-injected safety rule.',
            enabled: false,
            role: 'system',
        }, {
            identifier: 'wrong-role',
            name: 'System-only',
            content: 'System-only configured text.',
            enabled: true,
            role: 'system',
        }],
    }, payload, []);

    const disabled = sources.find(
        (source) => source.metadata?.identifier === 'disabled-provider-copy',
    );
    const wrongRole = sources.find(
        (source) => source.metadata?.identifier === 'wrong-role',
    );
    const requestSystem = sources.find(
        (source) => source.metadata?.sourceKind === 'requestMessage',
    );
    assert.equal(disabled.included, false);
    assert.equal(wrongRole.included, false);
    assert.equal(requestSystem.type, 'system');
    assert.equal(requestSystem.included, true);
    assert.equal(requestSystem.content, 'Provider-injected safety rule.');
    assert.equal(requestSystem.metadata.messageIndex, 0);
    assert.equal(requestSystem.metadata.name, 'provider');
    assert.equal(requestSystem.provenance.method, 'request-payload');
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
