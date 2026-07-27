import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildTimelineDiagnostics,
    serializeTimelineDiagnostics,
} from '../src/diagnostics.js';

function snapshot(id, timestamp, totalTokens) {
    return {
        schemaVersion: 3,
        extensionVersion: '0.6.0',
        id,
        timestamp,
        api: 'openai',
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
    assert.equal(report.privacy.promptContentIncluded, false);

    for (const format of ['json', 'markdown']) {
        const output = serializeTimelineDiagnostics(timeline, format, { generatedAt: 3 });
        assert.equal(output.includes('private prompt'), false);
        assert.equal(output.includes('secret-request'), false);
        assert.match(output, /test-model/);
    }
});
