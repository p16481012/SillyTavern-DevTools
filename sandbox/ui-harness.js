import { DevToolsWindow } from '../src/ui.js';
import { serializeTimelineDiagnostics } from '../src/diagnostics.js';

function createSnapshot(id, timestamp, totalTokens, additions = {}) {
    const provider = additions.provider ?? additions.chatCompletionSource ?? 'openai';
    const model = additions.model ?? 'gpt-4o';
    const koreanInstruction = additions.koreanInstruction ?? '반드시 한국어로 답변하세요.';
    const japaneseInstruction = 'Always respond in Japanese.';
    const englishInstruction = 'Always respond in English.';
    const addedInstruction = additions.addedInstruction ?? null;
    const omittedInstruction = additions.omittedInstruction
        ?? '노출 수위와 묘사 강도를 조절합니다.';
    const disabledInstruction = additions.disabledInstruction
        ?? '비활성 상태라 이번 요청에는 포함되지 않습니다.';
    const finalText = [
        '# 1 SYSTEM',
        koreanInstruction,
        japaneseInstruction,
        englishInstruction,
        ...(addedInstruction ? [addedInstruction] : []),
        '시스템 안전 지시를 따르세요.',
        '사용자 민수에게 친절하게 답하세요.',
        '',
        '# 2 USER',
        '[이미지 입력 1]',
        '이 이미지를 설명해줘',
    ].join('\n');
    return {
        schemaVersion: 4,
        extensionVersion: '0.8.4',
        id,
        timestamp,
        chatId: additions.chatId ?? 'sandbox',
        messageCount: 2,
        api: additions.api ?? 'openai',
        ...(additions.omitProvider ? {} : { provider }),
        model,
        preset: 'sandbox',
        promptType: 'chat-completion',
        generationType: 'normal',
        payload: [
            {
                role: 'system',
                content: [
                    koreanInstruction,
                    japaneseInstruction,
                    englishInstruction,
                    ...(addedInstruction ? [addedInstruction] : []),
                ].join('\n'),
            },
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
                model,
                chat_completion_source: provider,
                messages: [],
                tools: [],
            },
            settings: {
                model,
                chat_completion_source: provider,
                temperature: 0.7,
            },
            bodyKeys: ['model', 'messages', 'tools'],
            redactedPaths: ['api_key'],
            omittedMediaPaths: ['messages[1].content[0].image_url.url'],
        },
        sources: [
            {
                id: 'utility:language-korean',
                type: 'utility',
                label: '출력언어 | 한국어',
                content: koreanInstruction,
                color: '#2563eb',
                attribution: 'exact',
                included: true,
                configuredEnabled: true,
                tokenCount: 8,
                metadata: {
                    sourceKind: 'configuredPrompt',
                    identifier: 'language-korean',
                    name: '출력언어 | 한국어',
                    enabled: true,
                    configuredEnabled: true,
                    promptOrder: 0,
                    promptOrderSource: 'prompt-manager',
                    role: 'system',
                },
                ranges: [{
                    start: finalText.indexOf(koreanInstruction),
                    end: finalText.indexOf(koreanInstruction) + koreanInstruction.length,
                }],
                provenance: { method: 'configured-payload-exact', confidence: 1 },
            },
            {
                id: 'utility:language-japanese',
                type: 'utility',
                label: '출력언어 | 일본어',
                content: japaneseInstruction,
                color: '#7c3aed',
                attribution: 'exact',
                included: true,
                configuredEnabled: true,
                tokenCount: 8,
                metadata: {
                    sourceKind: 'configuredPrompt',
                    identifier: 'language-japanese',
                    name: '출력언어 | 일본어',
                    enabled: true,
                    configuredEnabled: true,
                    promptOrder: 1,
                    promptOrderSource: 'prompt-manager',
                    role: 'system',
                },
                ranges: [{
                    start: finalText.indexOf(japaneseInstruction),
                    end: finalText.indexOf(japaneseInstruction) + japaneseInstruction.length,
                }],
                provenance: { method: 'configured-payload-exact', confidence: 1 },
            },
            {
                id: 'utility:language-english',
                type: 'utility',
                label: '출력언어 | 영어',
                content: englishInstruction,
                color: '#db2777',
                attribution: 'exact',
                included: true,
                configuredEnabled: true,
                tokenCount: 8,
                metadata: {
                    sourceKind: 'configuredPrompt',
                    identifier: 'language-english',
                    name: '출력언어 | 영어',
                    enabled: true,
                    configuredEnabled: true,
                    promptOrder: 2,
                    promptOrderSource: 'prompt-manager',
                    role: 'system',
                },
                ranges: [{
                    start: finalText.indexOf(englishInstruction),
                    end: finalText.indexOf(englishInstruction) + englishInstruction.length,
                }],
                provenance: { method: 'configured-payload-exact', confidence: 1 },
            },
            {
                id: 'system:0',
                type: 'system',
                label: 'System',
                content: '시스템 안전 지시를 따르세요.',
                color: '#8b5cf6',
                attribution: 'exact',
                included: true,
                tokenCount: 7,
                metadata: { sourceKind: 'requestMessage' },
                ranges: [{
                    start: finalText.indexOf('시스템 안전 지시를 따르세요.'),
                    end: finalText.indexOf('시스템 안전 지시를 따르세요.')
                        + '시스템 안전 지시를 따르세요.'.length,
                }],
                provenance: { method: 'request-payload', confidence: 1 },
            },
            ...(addedInstruction ? [{
                id: 'utility:output-length',
                type: 'utility',
                label: 'Custom | 출력 길이',
                content: addedInstruction,
                color: '#d97706',
                attribution: 'exact',
                included: true,
                configuredEnabled: true,
                tokenCount: 9,
                metadata: {
                    sourceKind: 'configuredPrompt',
                    identifier: 'output-length',
                    name: 'Custom | 출력 길이',
                    enabled: true,
                    configuredEnabled: true,
                    promptOrder: 3,
                    promptOrderSource: 'prompt-manager',
                    role: 'system',
                },
                ranges: [{
                    start: finalText.indexOf(addedInstruction),
                    end: finalText.indexOf(addedInstruction) + addedInstruction.length,
                }],
                provenance: { method: 'configured-payload-exact', confidence: 1 },
            }] : []),
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
                id: 'utility:unmatched',
                type: 'utility',
                label: 'Sub | NSFW (묘사 중심)',
                content: omittedInstruction,
                color: '#b45309',
                attribution: 'unmatched',
                included: false,
                configuredEnabled: true,
                tokenCount: 455,
                metadata: {
                    sourceKind: 'configuredPrompt',
                    identifier: 'nsfw-description',
                    name: 'Sub | NSFW (묘사 중심)',
                    enabled: true,
                    configuredEnabled: true,
                    promptOrder: 4,
                    promptOrderSource: 'prompt-manager',
                    role: 'system',
                },
                ranges: [],
                provenance: { method: 'unmatched', confidence: null },
            },
            {
                id: 'utility:unmatched-cot',
                type: 'utility',
                label: 'CoT | 오리지널',
                content: '내부 추론 단계를 강화합니다.',
                color: '#7c2d12',
                attribution: 'unmatched',
                included: false,
                configuredEnabled: true,
                tokenCount: 736,
                metadata: {
                    sourceKind: 'configuredPrompt',
                    identifier: 'cot-original',
                    name: 'CoT | 오리지널',
                    enabled: true,
                    configuredEnabled: true,
                    promptOrder: 5,
                    promptOrderSource: 'prompt-manager',
                    role: 'system',
                },
                ranges: [],
                provenance: { method: 'unmatched', confidence: null },
            },
            {
                id: 'utility:disabled-large',
                type: 'utility',
                label: '비활성 대형 프롬프트',
                content: disabledInstruction,
                color: '#64748b',
                attribution: 'unmatched',
                included: false,
                configuredEnabled: false,
                tokenCount: 9000,
                metadata: {
                    sourceKind: 'configuredPrompt',
                    identifier: 'disabled-large',
                    name: '비활성 대형 프롬프트',
                    enabled: false,
                    configuredEnabled: false,
                    promptOrder: 6,
                    promptOrderSource: 'prompt-manager',
                    role: 'system',
                },
                ranges: [],
                provenance: { method: 'configured-disabled', confidence: null },
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

const sandboxNow = Date.now();
const historicalProviders = [
    ['openai', 'gpt-4o'],
    ['claude', 'claude-sonnet-4'],
    ['makersuite', 'gemini-2.5-pro'],
    ['openrouter', 'gemini-3.1-pro-preview'],
    ['custom', 'private-model'],
    ['mistralai', 'mistral-large'],
    ['cohere', 'command-r-plus'],
    ['perplexity', 'sonar-pro'],
    ['groq', 'llama-3.3-70b'],
];
let timeline = historicalProviders.map(([provider, model], index) => createSnapshot(
    `sandbox-${index + 1}`,
    sandboxNow - ((12 - index) * 60000),
    84 + (index * 9),
    {
        provider,
        model,
        omitProvider: index < 4,
    },
));
timeline.push(
    createSnapshot('sandbox-10', sandboxNow - 120000, 120, {
        provider: 'openrouter',
        model: 'gemini-3.1-pro-preview',
    }),
    createSnapshot('sandbox-11', sandboxNow - 60000, 168, {
        provider: 'makersuite',
        model: 'gemini-2.5-pro',
        lorebookEntries: [{ uid: 1, world: 'Sandbox', content: '활성 로어' }],
    }),
    createSnapshot('sandbox-12', sandboxNow, 214, {
        provider: 'claude',
        model: 'claude-sonnet-4',
        correlationMethod: 'explicit-id',
        correlationId: 'sandbox-request',
        koreanInstruction: '반드시 자연스러운 한국어로 답변하세요.',
        addedInstruction: '답변은 300자 이내로 작성하세요.',
        omittedInstruction: '이 미포함 프롬프트 변경은 소스 비교에 나오면 안 됩니다.',
        disabledInstruction: '이 비활성 프롬프트 변경도 소스 비교에 나오면 안 됩니다.',
    }),
);
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
    version: '0.8.4',
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
