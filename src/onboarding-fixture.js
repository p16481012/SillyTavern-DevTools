const FIXTURE_SCHEMA_VERSION = 7;

function deepFreeze(value, seen = new WeakSet()) {
    if (value === null || typeof value !== 'object' || seen.has(value)) {
        return value;
    }

    seen.add(value);
    for (const key of Reflect.ownKeys(value)) {
        deepFreeze(value[key], seen);
    }
    return Object.freeze(value);
}

const SOURCE_TEXT = {
    main: [
        'Main Prompt',
        '모든 응답은 한국어로 자연스럽게 작성하세요. JSON 형식으로 응답하세요.',
        '핵심 조건과 예외를 구분하고 사용자의 요청을 우선하세요.',
    ].join('\n'),
    character: [
        '캐릭터 설정',
        '차분하고 친절한 안내자입니다. 모르는 내용은 추측하지 않고 확인이 필요하다고 말합니다.',
    ].join('\n'),
    persona: [
        '사용자 설정',
        '간결한 설명과 바로 실행할 수 있는 예시를 선호합니다.',
    ].join('\n'),
    outputV1: '출력 규칙\nJSON 형식으로 응답하세요. 최대 3문장으로 작성하세요.',
    outputV2: '출력 규칙\nJSON 형식으로 응답하세요. 핵심 내용을 먼저 제시하고 최대 3문장으로 작성하세요.',
    outputV3: '출력 규칙\nXML 형식으로 응답하세요. 핵심 내용을 먼저 제시하고 최대 5문장으로 작성하세요.',
    summary: '대화 요약\n이전 요청에서는 결과를 짧게 요약하고 확인할 항목을 함께 제시했습니다.',
    emotion: '표현 지침\n차분하고 명확한 말투를 유지하되 중요한 경고는 눈에 띄게 구분하세요.',
    disabledLanguage: '출력 언어 | 일본어\n모든 응답을 일본어로 작성하세요.',
};

const SOURCE_DEFINITIONS = {
    main: {
        id: 'tutorial:source:main',
        type: 'utility',
        label: 'Main Prompt',
        metadata: {
            sourceKind: 'configuredPrompt',
            identifier: 'tutorial:main',
            promptOrder: 0,
            role: 'system',
        },
    },
    output: {
        id: 'tutorial:source:output',
        type: 'utility',
        label: '출력 규칙',
        metadata: {
            sourceKind: 'configuredPrompt',
            identifier: 'tutorial:output',
            promptOrder: 1,
            role: 'system',
        },
    },
    character: {
        id: 'tutorial:source:character',
        type: 'character',
        label: '캐릭터 설정',
        metadata: {
            sourceKind: 'character',
            field: 'description',
            promptOrder: 2,
            role: 'system',
        },
    },
    persona: {
        id: 'tutorial:source:persona',
        type: 'persona',
        label: '사용자 설정',
        metadata: {
            sourceKind: 'persona',
            field: 'persona',
            promptOrder: 3,
            role: 'system',
        },
    },
    summary: {
        id: 'tutorial:source:summary',
        type: 'utility',
        label: '대화 요약',
        metadata: {
            sourceKind: 'configuredPrompt',
            identifier: 'tutorial:summary',
            promptOrder: 4,
            role: 'system',
        },
    },
    emotion: {
        id: 'tutorial:source:emotion',
        type: 'utility',
        label: '표현 지침',
        metadata: {
            sourceKind: 'configuredPrompt',
            identifier: 'tutorial:emotion',
            promptOrder: 4,
            role: 'system',
        },
    },
    disabledLanguage: {
        id: 'tutorial:source:disabled-language',
        type: 'utility',
        label: '출력 언어 | 일본어 (꺼짐)',
        metadata: {
            sourceKind: 'configuredPrompt',
            identifier: 'tutorial:disabled-language',
            promptOrder: 5,
            role: 'system',
        },
    },
};

const SNAPSHOT_SPECS = [
    {
        totalTokens: 920,
        sources: [
            ['main', SOURCE_TEXT.main, 500],
            ['output', SOURCE_TEXT.outputV1, 100],
            ['character', SOURCE_TEXT.character, 220],
            ['persona', SOURCE_TEXT.persona, 100],
        ],
    },
    {
        totalTokens: 1080,
        sources: [
            ['main', SOURCE_TEXT.main, 500],
            ['output', SOURCE_TEXT.outputV2, 180],
            ['character', SOURCE_TEXT.character, 220],
            ['persona', SOURCE_TEXT.persona, 100],
            ['summary', SOURCE_TEXT.summary, 80],
        ],
    },
    {
        totalTokens: 1248,
        sources: [
            ['main', SOURCE_TEXT.main, 500],
            ['output', SOURCE_TEXT.outputV3, 220],
            ['character', SOURCE_TEXT.character, 220],
            ['persona', SOURCE_TEXT.persona, 100],
            ['emotion', SOURCE_TEXT.emotion, 208],
        ],
    },
];

function buildSnapshot(spec, index) {
    const snapshotNumber = index + 1;
    const timestamp = Date.UTC(2026, 7, 3, 0, index, 0);
    const payload = spec.sources.map(([, content]) => ({
        role: 'system',
        content,
    }));
    const finalText = payload.map(({ content }) => content).join('\n\n');
    let cursor = 0;

    const sources = spec.sources.map(([sourceKey, content, tokenCount], sourceIndex) => {
        const definition = SOURCE_DEFINITIONS[sourceKey];
        const start = cursor;
        const end = start + content.length;
        cursor = end + (sourceIndex < spec.sources.length - 1 ? 2 : 0);
        const range = { start, end };

        return {
            ...definition,
            content,
            tokenCount,
            attribution: 'exact',
            included: true,
            enabled: true,
            configuredEnabled: true,
            ranges: [range],
            provenance: {
                method: 'configured-payload-exact',
                confidence: 1,
                availability: 'available',
                locations: [{
                    jsonPointer: `/payload/${sourceIndex}/content`,
                    messageIndex: sourceIndex,
                    role: 'system',
                    valueRange: { start: 0, end: content.length },
                    finalRange: range,
                }],
                locationCount: 1,
                locationsTruncated: false,
            },
        };
    });

    sources.push({
        ...SOURCE_DEFINITIONS.disabledLanguage,
        content: SOURCE_TEXT.disabledLanguage,
        tokenCount: 0,
        attribution: 'exact',
        included: false,
        enabled: false,
        configuredEnabled: false,
        ranges: [],
        provenance: {
            method: 'configured-disabled',
            confidence: 1,
            availability: 'available',
            locations: [],
            locationCount: 0,
            locationsTruncated: false,
        },
    });

    sources.push({
        id: `tutorial:source:final:${snapshotNumber}`,
        type: 'final',
        label: '최종 프롬프트',
        content: finalText,
        tokenCount: spec.totalTokens,
        attribution: 'exact',
        included: true,
        ranges: [{ start: 0, end: finalText.length }],
        provenance: {
            method: 'request-payload-exact',
            confidence: 1,
            availability: 'available',
            locations: [{
                jsonPointer: '/finalText',
                valueRange: { start: 0, end: finalText.length },
                finalRange: { start: 0, end: finalText.length },
            }],
            locationCount: 1,
            locationsTruncated: false,
        },
    });

    const maxContext = 8192;
    const maxOutput = 512;
    const usableContext = maxContext - maxOutput;
    const requestId = `tutorial:request:${snapshotNumber}`;

    return {
        schemaVersion: FIXTURE_SCHEMA_VERSION,
        extensionVersion: '0.16.2',
        id: `tutorial:snapshot:${snapshotNumber}`,
        tutorialLabel: `연습 요청 ${snapshotNumber}`,
        timestamp,
        chatId: 'tutorial:chat',
        requestId,
        api: 'openai',
        provider: 'vertexai',
        model: 'gemini-3.1-pro-preview',
        promptType: 'chat-completion',
        generationType: 'normal',
        preset: 'tutorial-preset',
        eventName: 'CHAT_COMPLETION_SETTINGS_READY',
        stage: 'backend-request-ready',
        requestBodyAvailable: true,
        fallback: false,
        clientBackendRequestCaptured: true,
        serverTransformationsIncluded: false,
        correlationId: null,
        hadCorrelationId: false,
        correlationMethod: 'fifo',
        requestStatus: 'captured',
        generationStatus: 'ended',
        statusEvent: 'GENERATION_ENDED',
        statusUpdatedAt: timestamp + 1500,
        providerTrace: {
            api: 'openai',
            promptType: 'chat-completion',
            generationType: 'normal',
            selectedSource: {
                value: 'vertexai',
                status: 'captured',
                pointer: '/request/body/chat_completion_source',
            },
        },
        payload,
        request: {
            id: requestId,
            body: {
                model: 'gemini-3.1-pro-preview',
                chat_completion_source: 'vertexai',
                messages: payload,
                tools: [],
            },
            settings: {
                model: 'gemini-3.1-pro-preview',
                chat_completion_source: 'vertexai',
                temperature: 0.7,
            },
            bodyKeys: ['model', 'chat_completion_source', 'messages', 'tools'],
            redactedPaths: [],
            omittedMediaPaths: [],
            correlationId: null,
            hadCorrelationId: false,
        },
        finalText,
        sources,
        lorebookEntries: [],
        usage: {
            source: 'local-estimate',
            inputTokens: spec.totalTokens,
            outputTokens: null,
            totalTokens: spec.totalTokens,
            estimated: true,
        },
        stats: {
            totalTokens: spec.totalTokens,
            maxContext,
            maxOutput,
            usableContext,
            contextUsage: spec.totalTokens / usableContext,
            remainingContext: usableContext - spec.totalTokens,
            structured: {
                sourceAnalysis: 'complete',
                toolSchemas: 0,
                toolCalls: 0,
                toolResults: 0,
                multimodalParts: 0,
                multimodalEstimatedTokens: 0,
                multimodalEstimateCoverage: null,
            },
        },
        privacy: {
            schemaVersion: 1,
            mode: 'full',
            digestAlgorithm: 'SHA-256',
            rawPromptContentIncluded: true,
            rawChatIdIncluded: true,
            rawRequestIdIncluded: true,
            originalSchemaVersion: FIXTURE_SCHEMA_VERSION,
        },
    };
}

export const ONBOARDING_FIXTURE_VERSION = 1;
export const ONBOARDING_FIXTURE_SNAPSHOTS = deepFreeze(
    SNAPSHOT_SPECS.map(buildSnapshot),
);
export const ONBOARDING_INITIAL_SNAPSHOTS = deepFreeze(
    ONBOARDING_FIXTURE_SNAPSHOTS.slice(0, 2),
);
export const ONBOARDING_CAPTURE_SNAPSHOT = ONBOARDING_FIXTURE_SNAPSHOTS[2];
export const ONBOARDING_FIXTURE = deepFreeze({
    version: ONBOARDING_FIXTURE_VERSION,
    snapshots: ONBOARDING_FIXTURE_SNAPSHOTS,
    initialSnapshots: ONBOARDING_INITIAL_SNAPSHOTS,
    captureSnapshot: ONBOARDING_CAPTURE_SNAPSHOT,
});

export function createOnboardingSession({ checkpoint = 'full' } = {}) {
    const prepared = checkpoint !== 'full';
    const selectedIndex = ['prompt', 'diff', 'search'].includes(checkpoint)
        ? 1
        : prepared
            ? 2
            : 1;
    const timeline = prepared
        ? [...ONBOARDING_FIXTURE_SNAPSHOTS]
        : [...ONBOARDING_INITIAL_SNAPSHOTS];
    return {
        fixtureVersion: ONBOARDING_FIXTURE_VERSION,
        tabId: 'explorer',
        timeline,
        availableTimeline: [...ONBOARDING_FIXTURE_SNAPSHOTS],
        selectedId: ONBOARDING_FIXTURE_SNAPSHOTS[selectedIndex].id,
        openSourceIds: new Set(),
        explorerIncludedOnly: false,
        completedActions: new Set(),
        skippedActions: new Set(),
        captureState: prepared ? 'saved' : 'waiting',
        capturePhase: prepared ? 'complete' : 'awaiting-practice',
        timelineSnapshotsOpen: false,
        growthPinnedId: ONBOARDING_FIXTURE_SNAPSHOTS[selectedIndex].id,
        liveDataChanged: false,
        latestLiveCaptureStatus: null,
        active: true,
    };
}
