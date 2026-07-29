import { DevToolsWindow } from '../src/ui.js';
import { serializeTimelineDiagnostics } from '../src/diagnostics.js';

function createSnapshot(id, timestamp, totalTokens, additions = {}) {
    const finalText = '# 1 SYSTEM\n항상 한국어로 답하세요.\n사용자 민수에게 친절하게 답하세요.\n\n# 2 USER\n[이미지 입력 1]\n이 이미지를 설명해줘';
    return {
        schemaVersion: 4,
        extensionVersion: '0.7.0',
        id,
        timestamp,
        chatId: additions.chatId ?? 'sandbox',
        messageCount: 2,
        api: 'openai',
        model: 'gpt-4o',
        preset: 'sandbox',
        promptType: 'chat-completion',
        generationType: 'normal',
        payload: [
            { role: 'system', content: '항상 한국어로 답하세요.' },
            {
                role: 'user',
                content: [
                    {
                        type: 'image_url',
                        image_url: { url: '[미디어 데이터 생략됨]' },
                        width: 1024,
                        height: 1024,
                        detail: 'high',
                    },
                    { type: 'text', text: '이 이미지를 설명해줘' },
                ],
            },
        ],
        finalText,
        capture: {
            eventName: 'CHAT_COMPLETION_SETTINGS_READY',
            stage: 'backend-request-ready',
            fallback: false,
            correlationMethod: additions.correlationMethod ?? 'fifo',
            correlationId: additions.correlationId ?? null,
        },
        request: {
            body: {
                model: 'gpt-4o',
                chat_completion_source: 'openai',
                messages: [],
                tools: [],
            },
            settings: {
                model: 'gpt-4o',
                chat_completion_source: 'openai',
                temperature: 0.7,
            },
            bodyKeys: ['model', 'messages', 'tools'],
            redactedPaths: ['api_key'],
            omittedMediaPaths: ['messages[1].content[0].image_url.url'],
        },
        sources: [
            {
                id: 'system:0',
                type: 'system',
                label: 'System',
                content: '항상 한국어로 답하세요.',
                color: '#8b5cf6',
                attribution: 'exact',
                included: true,
                tokenCount: 7,
                metadata: {},
                ranges: [{
                    start: finalText.indexOf('항상 한국어로 답하세요.'),
                    end: finalText.indexOf('항상 한국어로 답하세요.') + '항상 한국어로 답하세요.'.length,
                }],
                provenance: { method: 'exact', confidence: 1 },
            },
            {
                id: 'extension:1',
                type: 'extension',
                label: '사용자 응답 템플릿',
                content: '사용자 {{name}}에게 친절하게 답하세요.',
                color: '#14b8a6',
                attribution: 'template',
                included: true,
                tokenCount: 10,
                metadata: {},
                ranges: [{
                    start: finalText.indexOf('사용자 민수에게 친절하게 답하세요.'),
                    end: finalText.indexOf('사용자 민수에게 친절하게 답하세요.')
                        + '사용자 민수에게 친절하게 답하세요.'.length,
                }],
                provenance: { method: 'macro-template', confidence: 0.84 },
            },
            {
                id: 'tool_schema:2',
                type: 'tool_schema',
                label: 'Tool schema weather',
                labelKey: 'source.toolSchema',
                content: '{"type":"function","function":{"name":"weather"}}',
                color: '#0f766e',
                attribution: 'derived',
                included: true,
                tokenCount: 12,
                metadata: { name: 'weather' },
                ranges: [],
                provenance: { method: 'derived', confidence: null },
            },
            {
                id: 'multimodal:3',
                type: 'multimodal',
                label: 'Multimodal image',
                labelKey: 'source.multimodal.image',
                content: '[이미지 입력 2]',
                color: '#0369a1',
                attribution: 'normalized',
                included: true,
                tokenCount: 5,
                metadata: {
                    type: 'image',
                    tokenEstimate: {
                        provider: 'openai',
                        type: 'image',
                        tokens: 765,
                        kind: 'estimate',
                        method: 'openai-tile-512',
                    },
                },
                ranges: [{
                    start: finalText.indexOf('[이미지 입력 1]'),
                    end: finalText.indexOf('[이미지 입력 1]') + '[이미지 입력 1]'.length,
                }],
                provenance: { method: 'normalized', confidence: 0.95 },
            },
            {
                id: 'final:4',
                type: 'final',
                label: 'Final Prompt',
                labelKey: 'source.finalPrompt',
                content: finalText,
                color: '#eab308',
                attribution: 'exact',
                included: true,
                tokenCount: totalTokens,
                metadata: {},
                ranges: [{ start: 0, end: finalText.length }],
                provenance: { method: 'exact', confidence: 1 },
            },
        ],
        lorebookEntries: additions.lorebookEntries ?? [],
        stats: {
            totalTokens,
            maxContext: 4096,
            maxOutput: 512,
            usableContext: 3584,
            contextUsage: totalTokens / 3584,
            remainingContext: 3584 - totalTokens,
            structured: {
                toolSchemas: 1,
                toolCalls: 0,
                toolResults: 0,
                multimodalParts: 1,
                multimodalEstimatedTokens: 765,
                multimodalEstimateCoverage: 1,
            },
        },
    };
}

let timeline = [
    createSnapshot('sandbox-1', Date.now() - 120000, 120),
    createSnapshot('sandbox-2', Date.now() - 60000, 168, {
        lorebookEntries: [{ uid: 1, world: 'Sandbox', content: '활성 로어' }],
    }),
    createSnapshot('sandbox-3', Date.now(), 214, {
        correlationMethod: 'explicit-id',
        correlationId: 'sandbox-request',
    }),
];
const otherTimeline = [
    createSnapshot('other-1', Date.now() - 30000, 96, { chatId: 'other-private-chat' }),
];

const capture = new EventTarget();
capture.retrySnapshot = async (snapshot) => {
    capture.dispatchEvent(new CustomEvent('snapshot', { detail: structuredClone(snapshot) }));
    return snapshot;
};
const store = {
    async getTimeline() {
        return timeline;
    },
    async deleteSnapshot(_chatId, snapshotId) {
        const previousLength = timeline.length;
        timeline = timeline.filter((snapshot) => snapshot.id !== snapshotId);
        return timeline.length !== previousLength;
    },
    async clearTimeline() {
        timeline = [];
    },
    async getAllTimelines() {
        return [
            { chatId: 'sandbox', timeline },
            { chatId: 'other-private-chat', timeline: otherTimeline },
        ];
    },
};
const context = {
    getCurrentChatId: () => 'sandbox',
    chatId: 'sandbox',
};
const devTools = new DevToolsWindow({
    getContext: () => context,
    store,
    capture,
    version: '0.7.0',
});

document.getElementById('sandbox-launcher').addEventListener('click', () => devTools.open());
document.getElementById('sandbox-storage-error').addEventListener('click', () => {
    capture.dispatchEvent(new CustomEvent('capture-error', {
        detail: {
            operation: 'addSnapshot',
            snapshot: timeline.at(-1),
            error: new Error('샌드박스 IndexedDB 쓰기 실패'),
        },
    }));
});
document.getElementById('sandbox-import-valid').addEventListener('click', async () => {
    const file = new File(
        [serializeTimelineDiagnostics(timeline, 'json')],
        'sandbox-diagnostics.json',
        { type: 'application/json' },
    );
    await devTools.importDiagnosticFile(file);
});
document.getElementById('sandbox-import-invalid').addEventListener('click', async () => {
    const report = JSON.parse(serializeTimelineDiagnostics(timeline, 'json'));
    report.snapshots[0].content = '가져오면 안 되는 프롬프트';
    const file = new File(
        [JSON.stringify(report)],
        'unsafe-diagnostics.json',
        { type: 'application/json' },
    );
    await devTools.importDiagnosticFile(file);
});
globalThis.devToolsSandbox = devTools;
