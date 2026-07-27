import { DevToolsWindow } from '../src/ui.js';

function createSnapshot(id, timestamp, totalTokens, additions = {}) {
    const finalText = '# 1 SYSTEM\n항상 한국어로 답하세요.\n\n# 2 USER\n[이미지 입력 2]\n이 이미지를 설명해줘';
    return {
        schemaVersion: 3,
        extensionVersion: '0.6.0',
        id,
        timestamp,
        chatId: 'sandbox',
        messageCount: 2,
        api: 'openai',
        model: 'sandbox-model',
        preset: 'sandbox',
        promptType: 'chat-completion',
        generationType: 'normal',
        payload: [
            { role: 'system', content: '항상 한국어로 답하세요.' },
            {
                role: 'user',
                content: [
                    { type: 'image_url', image_url: { url: '[미디어 데이터 생략됨]' } },
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
            body: { model: 'sandbox-model', messages: [], tools: [] },
            settings: { model: 'sandbox-model', temperature: 0.7 },
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
                ranges: [{ start: 11, end: 24 }],
            },
            {
                id: 'tool_schema:1',
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
            },
            {
                id: 'multimodal:2',
                type: 'multimodal',
                label: 'Multimodal image',
                labelKey: 'source.multimodal.image',
                content: '[이미지 입력 2]',
                color: '#0369a1',
                attribution: 'normalized',
                included: true,
                tokenCount: 5,
                metadata: { type: 'image' },
                ranges: [{ start: 36, end: 46 }],
            },
            {
                id: 'final:3',
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

const capture = new EventTarget();
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
};
const context = {
    getCurrentChatId: () => 'sandbox',
    chatId: 'sandbox',
};
const devTools = new DevToolsWindow({
    getContext: () => context,
    store,
    capture,
    version: '0.6.0',
});

document.getElementById('sandbox-launcher').addEventListener('click', () => devTools.open());
globalThis.devToolsSandbox = devTools;
