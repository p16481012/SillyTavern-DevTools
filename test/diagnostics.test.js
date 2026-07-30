import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildAllTimelineDiagnostics,
    buildTimelineDiagnostics,
    parseTimelineDiagnostics,
    serializeAllTimelineDiagnostics,
    serializeTimelineDiagnostics,
} from '../src/diagnostics.js';

function snapshot(id, timestamp, totalTokens) {
    return {
        schemaVersion: 4,
        extensionVersion: '0.7.0',
        id,
        timestamp,
        api: 'openai',
        provider: 'openrouter',
        model: 'test-model',
        promptType: 'chat-completion',
        generationType: 'normal',
        finalText: `private prompt ${id}`,
        payload: [{ role: 'user', content: `private prompt ${id}` }],
        capture: {
            eventName: 'CHAT_COMPLETION_SETTINGS_READY',
            stage: 'backend-request-ready',
            fallback: false,
            correlationMethod: 'fifo',
            correlationId: `secret-request-${id}`,
        },
        request: {
            bodyKeys: ['messages', 'model'],
            redactedPaths: ['api_key'],
            omittedMediaPaths: [],
            body: { messages: [{ role: 'user', content: `private prompt ${id}` }] },
        },
        stats: {
            totalTokens,
            contextUsage: totalTokens / 1000,
            structured: {
                toolSchemas: 1,
                toolCalls: 0,
                toolResults: 0,
                multimodalParts: 0,
            },
        },
        sources: [{
            id: 'final',
            type: 'final',
            content: `private prompt ${id}`,
            attribution: 'exact',
            ranges: [{ start: 0, end: 10 }],
        }],
    };
}

test('timeline diagnostics summarize every snapshot without prompt or request contents', () => {
    const timeline = [snapshot('a', 1, 100), snapshot('b', 2, 160)];
    const report = buildTimelineDiagnostics(timeline, { generatedAt: 3 });
    assert.equal(report.summary.snapshotCount, 2);
    assert.equal(report.summary.tokens.delta, 60);
    assert.equal(report.summary.structuredTotals.toolSchemas, 2);
    assert.deepEqual(report.summary.providerCounts, { openrouter: 2 });
    assert.equal(report.snapshots[0].provider, 'openrouter');
    assert.equal(report.privacy.promptContentIncluded, false);
    assert.equal(report.privacy.chatIdValuesIncluded, false);

    for (const format of ['json', 'markdown']) {
        const output = serializeTimelineDiagnostics(timeline, format, { generatedAt: 3 });
        assert.equal(output.includes('private prompt'), false);
        assert.equal(output.includes('secret-request'), false);
        assert.match(output, /test-model/);
        assert.match(output, /openrouter|OpenRouter/);
    }
    assert.match(serializeTimelineDiagnostics(timeline, 'markdown'), /생성 제공자: OpenRouter 2/);
});

test('all-chat diagnostics use anonymous chat references and metadata only', () => {
    const chatTimelines = [
        { chatId: 'private-chat-a', timeline: [snapshot('a', 1, 100)] },
        { chatId: 'private-chat-b', timeline: [snapshot('b', 2, 160)] },
    ];
    const report = buildAllTimelineDiagnostics(chatTimelines, { generatedAt: 3 });

    assert.equal(report.scope, 'all-chat-timelines');
    assert.equal(report.summary.chatCount, 2);
    assert.deepEqual(report.chats.map(({ chatRef }) => chatRef), ['chat-1', 'chat-2']);
    assert.deepEqual(report.snapshots.map(({ chatRef }) => chatRef), ['chat-1', 'chat-2']);

    for (const format of ['json', 'markdown']) {
        const output = serializeAllTimelineDiagnostics(
            chatTimelines,
            format,
            { generatedAt: 3 },
        );
        assert.equal(output.includes('private-chat'), false);
        assert.equal(output.includes('private prompt'), false);
        assert.equal(output.includes('secret-request'), false);
    }
});

test('diagnostic import accepts generated reports and legacy report v1 metadata', () => {
    const report = buildTimelineDiagnostics([snapshot('a', 1, 100)], { generatedAt: 3 });
    assert.equal(parseTimelineDiagnostics(JSON.stringify(report)).summary.snapshotCount, 1);

    const legacy = structuredClone(report);
    legacy.reportVersion = 1;
    delete legacy.privacy.chatIdValuesIncluded;
    assert.equal(parseTimelineDiagnostics(JSON.stringify(legacy)).reportVersion, 1);
});

test('diagnostic import rejects private fields, unsafe privacy flags, and mismatched counts', () => {
    const report = buildTimelineDiagnostics([snapshot('a', 1, 100)], { generatedAt: 3 });

    const privateField = structuredClone(report);
    privateField.snapshots[0].content = 'private';
    assert.throws(
        () => parseTimelineDiagnostics(JSON.stringify(privateField)),
        /허용되지 않는 내용 필드/,
    );

    const chatId = structuredClone(report);
    chatId.snapshots[0].chatId = 'private-chat';
    assert.throws(
        () => parseTimelineDiagnostics(JSON.stringify(chatId)),
        /허용되지 않는 내용 필드/,
    );

    const unsafePrivacy = structuredClone(report);
    unsafePrivacy.privacy.promptContentIncluded = true;
    assert.throws(
        () => parseTimelineDiagnostics(JSON.stringify(unsafePrivacy)),
        /프롬프트 내용/,
    );

    const mismatch = structuredClone(report);
    mismatch.summary.snapshotCount = 99;
    assert.throws(
        () => parseTimelineDiagnostics(JSON.stringify(mismatch)),
        /스냅샷 수/,
    );
    assert.throws(
        () => parseTimelineDiagnostics(JSON.stringify(report), { maxBytes: 10 }),
        /5MB/,
    );
});
