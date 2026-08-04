import { DevToolsWindow } from '../src/ui.js';
import { CaptureController } from '../src/capture.js';
import { SnapshotStore } from '../src/storage.js';
import { serializeTimelineDiagnostics } from '../src/diagnostics.js';
import { createProfileContext } from '../src/profile-context.js';
import { createCaptureBoundary, createRequestRecord } from '../src/request.js';
import { transformSnapshotPrivacy } from '../src/snapshot-privacy.js';
import {
    createSnapshotArchive,
    executeSnapshotArchiveImport,
    prepareSnapshotArchiveImport,
} from '../src/snapshot-archive.js';
import {
    DEFAULT_UI_PREFERENCES,
    UI_PREFERENCES_KEY,
} from '../src/preferences.js';
import {
    SemanticInspector,
    SemanticInspectorMemoryCache,
} from '../src/semantic-inspector.js';
import { SemanticProviderEvaluationHarness } from '../src/semantic-provider-evaluation-harness.js';
import { ONBOARDING_STEPS } from '../src/onboarding.js';

const fixtureParameters = new URLSearchParams(globalThis.location?.search ?? '');

function fixtureCount(name, minimum, maximum) {
    if (!fixtureParameters.has(name)) return null;
    const value = Number(fixtureParameters.get(name));
    if (!Number.isFinite(value)) return minimum;
    return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

const requestedFixtureSize = fixtureCount('fixtureSize', 3, 5_000);
const requestedSourceCount = fixtureCount('sourceCount', 2, 5_000);
const requestedPanelWidth = fixtureCount('panelWidth', 280, 1_200);
const requestedPanelHeight = fixtureCount('panelHeight', 360, 900);

function createSnapshot(id, timestamp, totalTokens, additions = {}) {
    const provider = additions.provider ?? additions.chatCompletionSource ?? 'openai';
    const model = additions.model ?? 'gpt-4o';
    const outputTokens = additions.outputTokens ?? 96;
    const koreanInstruction = additions.koreanInstruction ?? '반드시 한국어로 답변하세요.';
    const japaneseInstruction = 'Always respond in Japanese.';
    const englishInstruction = 'Always respond in English.';
    const addedInstruction = additions.addedInstruction ?? null;
    const omittedInstruction = additions.omittedInstruction
        ?? '노출 수위와 묘사 강도를 조절합니다.';
    const disabledInstruction = additions.disabledInstruction
        ?? '비활성 상태라 이번 요청에는 포함되지 않습니다.';
    const assistantPrefill = additions.assistantPrefill ?? '답변 초안:';
    const profileStructure = '프로필 구성은 이름, 나이, 외모, 성격, 취향과 비선호 순서로 작성합니다.';
    const characterProfile = `${profileStructure}\n캐릭터 이름은 리아입니다.`;
    const personaProfile = `${profileStructure}\n사용자 이름은 민수입니다.`;
    const finalText = [
        '# 1 SYSTEM',
        koreanInstruction,
        japaneseInstruction,
        englishInstruction,
        ...(addedInstruction ? [addedInstruction] : []),
        characterProfile,
        personaProfile,
        '시스템 안전 지시를 따르세요.',
        '사용자 민수에게 친절하게 답하세요.',
        '',
        '# 2 USER',
        '[이미지 입력 1]',
        '이 이미지를 설명해줘',
        '',
        '# 3 ASSISTANT',
        assistantPrefill,
    ].join('\n');
    return {
        schemaVersion: 7,
        extensionVersion: '0.15.5',
        privacy: {
            schemaVersion: 1,
            mode: 'full',
            digestAlgorithm: 'SHA-256',
            rawPromptContentIncluded: true,
            rawChatIdIncluded: true,
            rawRequestIdIncluded: true,
            originalSchemaVersion: 7,
        },
        id,
        timestamp,
        chatId: additions.chatId ?? 'sandbox',
        messageCount: 3,
        api: additions.api ?? 'openai',
        ...(additions.omitProvider ? {} : { provider }),
        model,
        preset: 'sandbox',
        profileContext: createProfileContext({
            chatId: additions.chatId ?? 'sandbox',
            preset: { id: 'sandbox-preset', name: '샌드박스 프리셋' },
            character: { avatar: 'sandbox-character.png', name: '샌드박스 캐릭터' },
            characterId: 1,
        }),
        promptType: 'chat-completion',
        generationType: 'normal',
        providerTrace: {
            transport: {
                api: additions.api ?? 'openai',
                promptType: 'chat-completion',
                generationType: 'normal',
            },
            selectedSource: {
                value: provider,
                status: additions.providerTraceStatus
                    ?? (additions.omitProvider ? 'context-fallback' : 'captured'),
                evidencePointer: additions.omitProvider
                    ? null
                    : '/request/body/chat_completion_source',
            },
            upstreamProvider: {
                value: null,
                status: 'unknown',
                evidencePointer: null,
            },
        },
        payload: [
            {
                role: 'system',
                content: [
                    koreanInstruction,
                    japaneseInstruction,
                    englishInstruction,
                    ...(addedInstruction ? [addedInstruction] : []),
                    characterProfile,
                    personaProfile,
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
            {
                role: 'assistant',
                content: assistantPrefill,
            },
        ],
        finalText,
        capture: {
            eventName: 'CHAT_COMPLETION_SETTINGS_READY',
            stage: 'backend-request-ready',
            fallback: false,
            correlationMethod: additions.correlationMethod ?? 'fifo',
            correlationId: null,
            hadCorrelationId: Boolean(additions.correlationId),
            requestStatus: additions.requestStatus ?? 'captured',
            generationStatus: additions.generationStatus ?? 'ended',
            statusEvent: additions.statusEvent ?? 'GENERATION_ENDED',
            statusUpdatedAt: timestamp + 1500,
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
            correlationId: null,
            hadCorrelationId: Boolean(additions.correlationId),
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
                    promptOrder: additions.languagePromptOrder ?? 0,
                    promptOrderSource: 'prompt-manager',
                    role: additions.languageRole ?? 'system',
                    depth: additions.languageDepth ?? 0,
                    position: additions.languagePosition ?? 'relative',
                },
                ranges: [{
                    start: finalText.indexOf(koreanInstruction),
                    end: finalText.indexOf(koreanInstruction) + koreanInstruction.length,
                }],
                provenance: {
                    method: 'configured-payload-exact',
                    confidence: 1,
                    availability: 'available',
                    locations: [{
                        jsonPointer: '/payload/0/content',
                        messageIndex: 0,
                        role: 'system',
                        valueRange: {
                            start: 0,
                            end: koreanInstruction.length,
                        },
                        finalRange: {
                            start: finalText.indexOf(koreanInstruction),
                            end: finalText.indexOf(koreanInstruction)
                                + koreanInstruction.length,
                        },
                    }],
                    locationCount: 1,
                    locationsTruncated: false,
                },
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
            {
                id: 'character:profile',
                type: 'character',
                label: '캐릭터 설명',
                labelKey: 'source.characterDescription',
                content: characterProfile,
                color: '#0f766e',
                attribution: 'exact',
                included: true,
                tokenCount: 18,
                metadata: { field: 'description' },
                ranges: [{
                    start: finalText.indexOf(characterProfile),
                    end: finalText.indexOf(characterProfile) + characterProfile.length,
                }],
                provenance: { method: 'request-payload', confidence: 1 },
            },
            {
                id: 'persona:profile',
                type: 'persona',
                label: '사용자 페르소나',
                labelKey: 'source.persona',
                content: personaProfile,
                color: '#0e7490',
                attribution: 'exact',
                included: true,
                tokenCount: 18,
                metadata: {},
                ranges: [{
                    start: finalText.indexOf(personaProfile),
                    end: finalText.indexOf(personaProfile) + personaProfile.length,
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
                provenance: {
                    method: 'macro-template',
                    confidence: 0.84,
                    availability: 'available',
                    locations: [{
                        jsonPointer: '/payload/0/content',
                        messageIndex: 0,
                        role: 'system',
                        valueRange: null,
                        finalRange: {
                            start: finalText.indexOf('사용자 민수에게 친절하게 답하세요.'),
                            end: finalText.indexOf('사용자 민수에게 친절하게 답하세요.')
                                + '사용자 민수에게 친절하게 답하세요.'.length,
                        },
                    }],
                    locationCount: 52,
                    locationsTruncated: true,
                },
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
                provenance: {
                    method: 'derived',
                    confidence: null,
                    availability: 'available',
                    locations: [{
                        jsonPointer: '/request/body/tools/0',
                        messageIndex: null,
                        role: null,
                        valueRange: null,
                        finalRange: null,
                    }],
                    locationCount: 1,
                    locationsTruncated: false,
                },
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
                provenance: {
                    method: 'unmatched',
                    confidence: null,
                    availability: 'legacy-unavailable',
                    locations: [],
                    locationCount: 0,
                    locationsTruncated: false,
                },
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
                id: 'assistant_prefill:4',
                type: 'assistant_prefill',
                label: 'Assistant Prefill / Last Assistant Message',
                labelKey: 'source.assistantPrefill',
                content: assistantPrefill,
                color: '#0284c7',
                attribution: 'exact',
                included: true,
                tokenCount: 4,
                metadata: {
                    prefillStatus: additions.prefillStatus ?? 'inferred',
                    inferred: (additions.prefillStatus ?? 'inferred') !== 'confirmed',
                    messageIndex: 2,
                    role: 'assistant',
                },
                ranges: [{
                    start: finalText.lastIndexOf(assistantPrefill),
                    end: finalText.lastIndexOf(assistantPrefill) + assistantPrefill.length,
                }],
                provenance: {
                    method: 'request-payload',
                    confidence: additions.prefillStatus === 'confirmed' ? 1 : 0.65,
                    availability: 'available',
                    locations: [{
                        jsonPointer: '/payload/2/content',
                        messageIndex: 2,
                        role: 'assistant',
                        valueRange: { start: 0, end: assistantPrefill.length },
                        finalRange: {
                            start: finalText.lastIndexOf(assistantPrefill),
                            end: finalText.lastIndexOf(assistantPrefill)
                                + assistantPrefill.length,
                        },
                    }],
                    locationCount: 1,
                    locationsTruncated: false,
                },
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
        usage: {
            status: 'local-estimate',
            inputTokens: totalTokens,
            outputTokens,
            cachedInputTokens: null,
            totalTokens: totalTokens + outputTokens,
            sourceEvent: 'message-received',
            correlatedAt: timestamp,
            cost: {
                status: 'unavailable',
                amount: null,
                currency: null,
                priceSource: null,
                priceAsOf: null,
            },
        },
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

function createCompactStressSnapshot(index, total) {
    const timestamp = Date.UTC(2026, 6, 31, 0, 0, 0) + (index * 1_000);
    const provider = ['openai', 'claude', 'makersuite'][index % 3];
    const content = `성능 fixture ${index + 1}/${total}. 한국어로 간결하게 답변하세요.`;
    return {
        schemaVersion: 6,
        extensionVersion: '0.10.0',
        id: `stress-snapshot-${String(index + 1).padStart(4, '0')}`,
        timestamp,
        chatId: 'sandbox',
        api: provider,
        provider,
        model: `stress-model-${(index % 7) + 1}`,
        preset: 'sandbox-stress',
        promptType: 'chat-completion',
        generationType: 'normal',
        finalText: content,
        payload: [{ role: 'system', content }],
        request: {
            body: { model: `stress-model-${(index % 7) + 1}` },
            settings: {},
            bodyKeys: ['model'],
            redactedPaths: [],
            omittedMediaPaths: [],
        },
        sources: [
            {
                id: `stress-source-${index}`,
                type: 'utility',
                label: `성능 규칙 ${index + 1}`,
                content,
                attribution: 'exact',
                included: true,
                configuredEnabled: true,
                tokenCount: 12,
                metadata: {
                    sourceKind: 'configuredPrompt',
                    identifier: `stress-${index}`,
                    name: `성능 규칙 ${index + 1}`,
                    enabled: true,
                    configuredEnabled: true,
                    promptOrder: 0,
                    promptOrderSource: 'fixture',
                    role: 'system',
                },
                ranges: [{ start: 0, end: content.length }],
                provenance: {
                    method: 'configured-payload-exact',
                    confidence: 1,
                },
            },
            {
                id: `stress-final-${index}`,
                type: 'final',
                label: 'Final Prompt',
                labelKey: 'source.finalPrompt',
                content,
                attribution: 'exact',
                included: true,
                tokenCount: 12,
                metadata: {},
                ranges: [{ start: 0, end: content.length }],
                provenance: { method: 'exact', confidence: 1 },
            },
        ],
        lorebookEntries: index % 17 === 0
            ? [{
                uid: index,
                world: 'Stress',
                comment: `성능 로어 ${index + 1}`,
                key: [`stress-${index}`],
                position: 'before',
                content: `결정적 로어 fixture ${index + 1}.`,
            }]
            : [],
        stats: {
            totalTokens: 80 + (index % 600),
            maxContext: 8_192,
            maxOutput: 512,
            usableContext: 7_680,
            contextUsage: (80 + (index % 600)) / 7_680,
            remainingContext: 7_600 - (index % 600),
            structured: {},
        },
    };
}

function applyStressSources(snapshot, count) {
    const sourceCount = Math.max(2, count);
    const promptSources = [];
    const finalParts = [];
    let offset = 0;
    for (let index = 0; index < sourceCount - 1; index += 1) {
        const content = `성능 그룹 | 옵션 ${String(index + 1).padStart(4, '0')}. 결정적 검색어 fixture-${index}.`;
        const start = offset;
        const end = start + content.length;
        finalParts.push(content);
        promptSources.push({
            id: `stress:source:${index}`,
            type: 'utility',
            label: `성능 그룹 | 옵션 ${index + 1}`,
            content,
            attribution: 'exact',
            included: true,
            configuredEnabled: true,
            tokenCount: 10 + (index % 5),
            metadata: {
                sourceKind: 'configuredPrompt',
                identifier: `stress-option-${index}`,
                name: `성능 그룹 | 옵션 ${index + 1}`,
                enabled: true,
                configuredEnabled: true,
                promptOrder: index,
                promptOrderSource: 'fixture',
                role: 'system',
            },
            ranges: [{ start, end }],
            provenance: {
                method: 'configured-payload-exact',
                confidence: 1,
            },
        });
        offset = end + 1;
    }
    const finalText = finalParts.join('\n');
    snapshot.finalText = finalText;
    snapshot.payload = [{ role: 'system', content: finalText }];
    snapshot.sources = [
        ...promptSources,
        {
            id: 'stress:final',
            type: 'final',
            label: 'Final Prompt',
            labelKey: 'source.finalPrompt',
            content: finalText,
            attribution: 'exact',
            included: true,
            tokenCount: promptSources.reduce(
                (total, source) => total + source.tokenCount,
                0,
            ),
            metadata: {},
            ranges: [{ start: 0, end: finalText.length }],
            provenance: { method: 'exact', confidence: 1 },
        },
    ];
    snapshot.stats.totalTokens = snapshot.sources.at(-1).tokenCount;
    if (snapshot.usage?.status === 'local-estimate') {
        snapshot.usage.inputTokens = snapshot.stats.totalTokens;
        snapshot.usage.totalTokens = (
            snapshot.stats.totalTokens
            + (Number(snapshot.usage.outputTokens) || 0)
        );
    }
    snapshot.stats.contextUsage = Math.min(
        1,
        snapshot.stats.totalTokens / snapshot.stats.usableContext,
    );
    snapshot.stats.remainingContext = Math.max(
        0,
        snapshot.stats.usableContext - snapshot.stats.totalTokens,
    );
    return snapshot;
}

const sandboxNow = Date.UTC(2026, 6, 31, 12, 0, 0);
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
        prefillStatus: 'inferred',
        lorebookEntries: [
            {
                uid: 1,
                world: 'Sandbox',
                comment: '계절 배경',
                key: ['여름'],
                position: 'before',
                content: '배경은 한여름입니다.',
            },
            {
                uid: 2,
                world: 'Sandbox',
                comment: '말투 지침',
                key: ['말투'],
                position: 'after',
                content: '차분한 말투를 사용합니다.',
            },
        ],
    }),
    createSnapshot('sandbox-12', sandboxNow, 214, {
        provider: 'claude',
        model: 'claude-sonnet-4',
        prefillStatus: 'confirmed',
        providerTraceStatus: 'captured',
        correlationMethod: 'explicit-id',
        correlationId: 'sandbox-request',
        koreanInstruction: '반드시 자연스러운 한국어로 답변하세요.',
        languageRole: 'developer',
        languageDepth: 4,
        languagePosition: 'in-chat',
        languagePromptOrder: 7,
        addedInstruction: '답변은 300자 이내로 작성하세요.',
        omittedInstruction: '이 미포함 프롬프트 변경은 소스 비교에 나오면 안 됩니다.',
        disabledInstruction: '이 비활성 프롬프트 변경도 소스 비교에 나오면 안 됩니다.',
        lorebookEntries: [
            {
                uid: 2,
                world: 'Sandbox',
                comment: '말투 지침',
                key: ['말투'],
                position: 'after',
                content: '차분한 말투를 사용합니다.',
            },
            {
                uid: 1,
                world: 'Sandbox',
                comment: '계절 배경',
                key: ['겨울', '눈'],
                position: 'after',
                content: '배경은 눈 내리는 한겨울입니다.',
            },
        ],
    }),
);
const redactedFixture = await transformSnapshotPrivacy(
    createSnapshot('privacy-redacted-source', sandboxNow + 1000, 144, {
        chatId: 'sandbox',
        model: 'sandbox-redacted',
    }),
    { mode: 'redacted' },
);
const metadataFixture = await transformSnapshotPrivacy(
    createSnapshot('privacy-metadata-source', sandboxNow + 2000, 88, {
        chatId: 'sandbox',
        model: 'sandbox-metadata',
    }),
    { mode: 'metadata' },
);
for (const fixture of [redactedFixture, metadataFixture]) {
    Object.defineProperty(fixture, 'storageChatId', {
        value: 'sandbox',
        enumerable: false,
    });
}
if (requestedFixtureSize != null) {
    timeline = Array.from(
        { length: requestedFixtureSize },
        (_, index) => createCompactStressSnapshot(index, requestedFixtureSize),
    );
    timeline.splice(-2, 2, redactedFixture, metadataFixture);
} else {
    timeline.push(redactedFixture, metadataFixture);
}
if (requestedSourceCount != null) {
    const fullFixture = timeline.find(
        (snapshot) => (snapshot.privacy?.mode ?? 'full') === 'full',
    );
    if (fullFixture) applyStressSources(fullFixture, requestedSourceCount);
}
let otherTimeline = [
    createSnapshot('other-1', sandboxNow - 30000, 96, { chatId: 'other-private-chat' }),
];
let temporaryStorage = false;
let summaryNeedsRebuild = false;
let darkTheme = false;
let timelinePageReadCount = 0;
let corruptRecordCount = 2;
let storageRevision = 0;
let integrityFixture = {
    missingRecords: 1,
    corruptRecords: 1,
    validOrphans: 1,
    invalidIndexes: 1,
    duplicateLegacyContainers: 1,
    conflictingLegacyContainers: 1,
};
let exclusiveImportTail = Promise.resolve();

function cloneSandboxSnapshot(snapshot, partitionChatId) {
    const clone = structuredClone(snapshot);
    const storageChatId = snapshot?.storageChatId ?? partitionChatId;
    if (typeof storageChatId === 'string' && storageChatId) {
        Object.defineProperty(clone, 'storageChatId', {
            value: storageChatId,
            enumerable: false,
        });
    }
    return clone;
}

function cloneSandboxTimeline(items, partitionChatId) {
    return items.map((snapshot) => cloneSandboxSnapshot(snapshot, partitionChatId));
}

function sandboxStoredTimelines() {
    return [
        { chatId: 'sandbox', timeline: cloneSandboxTimeline(timeline, 'sandbox') },
        {
            chatId: 'other-private-chat',
            timeline: cloneSandboxTimeline(otherTimeline, 'other-private-chat'),
        },
    ].filter(({ timeline: items }) => items.length > 0);
}

function sandboxAddSnapshot(snapshot, { partitionChatId = null } = {}) {
    const chatId = partitionChatId
        ?? snapshot.storageChatId
        ?? snapshot.chatId
        ?? 'sandbox';
    const target = chatId === 'other-private-chat' ? otherTimeline : timeline;
    const next = [
        ...target.filter((item) => item.id !== snapshot.id),
        cloneSandboxSnapshot(snapshot, chatId),
    ].sort((left, right) => left.timestamp - right.timestamp);
    if (chatId === 'other-private-chat') otherTimeline = next;
    else timeline = next;
    storageRevision += 1;
    return snapshot;
}

function sandboxClearAll() {
    const result = {
        chatCount: Number(timeline.length > 0) + Number(otherTimeline.length > 0),
        snapshotCount: timeline.length + otherTimeline.length,
    };
    timeline = [];
    otherTimeline = [];
    corruptRecordCount = 0;
    storageRevision += 1;
    return result;
}

async function runSandboxExclusiveImport(owner, operation) {
    const previous = exclusiveImportTail;
    let release;
    exclusiveImportTail = new Promise((resolve) => {
        release = resolve;
    });
    await previous;
    const backup = {
        timeline: cloneSandboxTimeline(timeline, 'sandbox'),
        otherTimeline: cloneSandboxTimeline(otherTimeline, 'other-private-chat'),
        corruptRecordCount,
        storageRevision,
        integrityFixture: structuredClone(integrityFixture),
        maxSnapshotsPerChat: owner.maxSnapshotsPerChat,
    };
    try {
        return await operation({
            getAllStoredTimelines: async () => sandboxStoredTimelines(),
            addSnapshot: async (snapshot, options) => sandboxAddSnapshot(snapshot, options),
            clearAll: async () => sandboxClearAll(),
        });
    } catch (error) {
        timeline = backup.timeline;
        otherTimeline = backup.otherTimeline;
        corruptRecordCount = backup.corruptRecordCount;
        storageRevision = backup.storageRevision;
        integrityFixture = backup.integrityFixture;
        owner.maxSnapshotsPerChat = backup.maxSnapshotsPerChat;
        throw error;
    } finally {
        release();
    }
}

const capture = new EventTarget();
capture.retrySnapshot = async (snapshot) => {
    capture.dispatchEvent(new CustomEvent('capture-status', {
        detail: {
            state: 'saved',
            promptType: snapshot?.promptType,
            stage: snapshot?.capture?.stage,
            at: Date.now(),
        },
    }));
    capture.dispatchEvent(new CustomEvent('snapshot', { detail: structuredClone(snapshot) }));
    return snapshot;
};
const store = {
    maxSnapshotsPerChat: 100,
    setMaxSnapshotsPerChat(limit) {
        this.maxSnapshotsPerChat = Math.max(1, Math.trunc(Number(limit) || 100));
        return this.maxSnapshotsPerChat;
    },
    async getRetentionPrunePreview(limit) {
        const normalizedLimit = Math.max(1, Math.trunc(Number(limit) || 100));
        const removed = [timeline, otherTimeline].flatMap((items) => (
            items.slice(0, Math.max(0, items.length - normalizedLimit))
        ));
        return {
            limit: normalizedLimit,
            affectedChatCount: [timeline, otherTimeline]
                .filter((items) => items.length > normalizedLimit).length,
            snapshotCount: removed.length,
            approximateBytes: new TextEncoder().encode(JSON.stringify(removed)).length,
            revision: storageRevision,
        };
    },
    async applyRetentionLimit(limit, { expectedRevision = null } = {}) {
        if (
            Number.isFinite(expectedRevision)
            && expectedRevision !== storageRevision
        ) {
            throw Object.assign(new Error('retention-preview-stale'), {
                code: 'retention-preview-stale',
            });
        }
        const preview = await this.getRetentionPrunePreview(limit);
        timeline = timeline.slice(-preview.limit);
        otherTimeline = otherTimeline.slice(-preview.limit);
        this.maxSnapshotsPerChat = preview.limit;
        storageRevision += 1;
        return preview;
    },
    async getRetentionPolicyPreview(policy) {
        const count = Math.max(
            1,
            Math.trunc(Number(policy?.maxSnapshotsPerChat) || 30),
        );
        const selected = [];
        for (const items of [timeline, otherTimeline]) {
            selected.push(...items.slice(0, Math.max(0, items.length - count)));
        }
        const unique = [...new Map(selected.map((snapshot) => [
            `${snapshot.storageChatId ?? snapshot.chatId}:${snapshot.id}`,
            snapshot,
        ])).values()];
        const bytes = new TextEncoder().encode(JSON.stringify(unique)).length;
        return {
            revision: storageRevision,
            policy: {
                maxSnapshotsPerChat: count,
                maxAgeDays: Math.max(0, Math.trunc(Number(policy?.maxAgeDays) || 0)),
                maxTotalBytes: Math.max(0, Math.trunc(Number(policy?.maxTotalBytes) || 0)),
            },
            affectedChats: unique.length > 0 ? 1 : 0,
            affectedChatCount: unique.length > 0 ? 1 : 0,
            deleteCount: unique.length,
            snapshotCount: unique.length,
            deleteBytes: bytes,
            approximateBytes: bytes,
            overBudget: false,
            targets: unique.slice(0, 25).map((snapshot) => ({
                id: snapshot.id,
                chatId: snapshot.storageChatId ?? snapshot.chatId,
            })),
            targetsTruncated: unique.length > 25,
            integrity: {
                healthy: Object.values(integrityFixture).every((value) => value === 0),
                counts: { ...integrityFixture },
            },
        };
    },
    async applyRetentionPolicy(policy, { expectedRevision = null } = {}) {
        if (expectedRevision !== storageRevision) {
            throw Object.assign(new Error('retention-preview-stale'), {
                code: 'retention-preview-stale',
            });
        }
        const preview = await this.getRetentionPolicyPreview(policy);
        const ids = new Set(preview.targets.map(({ id }) => id));
        timeline = timeline.filter((snapshot) => !ids.has(snapshot.id));
        otherTimeline = otherTimeline.filter((snapshot) => !ids.has(snapshot.id));
        this.maxSnapshotsPerChat = preview.policy.maxSnapshotsPerChat;
        storageRevision += 1;
        return {
            ...preview,
            deletedCount: preview.deleteCount,
            deletedBytes: preview.deleteBytes,
        };
    },
    getStatus() {
        return temporaryStorage
            ? {
                type: 'memory',
                persistent: false,
                fallbackReason: 'sandbox-toggle',
            }
            : {
                type: 'indexeddb',
                persistent: true,
                driver: 'asyncStorage',
                fallbackReason: null,
            };
    },
    async getTimeline(_chatId, { limit = 100 } = {}) {
        return timeline.slice(-limit);
    },
    async getTimelinePage(_chatId, { limit = 100 } = {}) {
        timelinePageReadCount += 1;
        document.body.dataset.timelinePageReads = String(timelinePageReadCount);
        const snapshots = timeline.slice(-limit);
        return {
            snapshots,
            totalCount: timeline.length,
            loadedCount: snapshots.length,
            limit,
            corruptCount: corruptRecordCount,
            corruptEntries: corruptRecordCount > 0
                ? [
                    { id: 'sandbox-corrupt-a', errorCode: 'invalid-schema' },
                    { id: 'sandbox-corrupt-b', errorCode: 'invalid-provenance' },
                ].slice(0, corruptRecordCount)
                : [],
        };
    },
    async deleteSnapshot(_chatId, snapshotId) {
        const previousLength = timeline.length;
        timeline = timeline.filter((snapshot) => snapshot.id !== snapshotId);
        if (timeline.length !== previousLength) storageRevision += 1;
        return timeline.length !== previousLength;
    },
    async deleteSnapshots(_chatId, snapshotIds) {
        const ids = new Set(snapshotIds);
        const previousLength = timeline.length;
        timeline = timeline.filter((snapshot) => !ids.has(snapshot.id));
        if (timeline.length !== previousLength) storageRevision += 1;
        return previousLength - timeline.length;
    },
    async clearTimeline() {
        timeline = [];
        corruptRecordCount = 0;
        storageRevision += 1;
    },
    async clearAll() {
        await exclusiveImportTail;
        return sandboxClearAll();
    },
    async addSnapshot(snapshot, options = {}) {
        await exclusiveImportTail;
        return sandboxAddSnapshot(snapshot, options);
    },
    async getAllTimelines() {
        await exclusiveImportTail;
        return sandboxStoredTimelines();
    },
    async getAllStoredTimelines() {
        await exclusiveImportTail;
        return sandboxStoredTimelines();
    },
    async runExclusiveImport(operation) {
        return runSandboxExclusiveImport(this, operation);
    },
    async getStorageQuotaStatus() {
        return {
            available: true,
            scope: 'browser-origin',
            scopeLabel: '브라우저 오리진 전체',
            usage: 24 * 1024 * 1024,
            quota: 512 * 1024 * 1024,
            reason: null,
        };
    },
    async inspectStorageIntegrity() {
        const indexRepairNeeded = integrityFixture.invalidIndexes > 0;
        const summaryRepairNeeded = (
            integrityFixture.missingRecords > 0
            || integrityFixture.validOrphans > 0
            || integrityFixture.duplicateLegacyContainers > 0
        );
        return {
            revision: storageRevision,
            healthy: Object.values(integrityFixture).every((value) => value === 0),
            repairNeeded: Object.values(integrityFixture).some((value) => value !== 0),
            indexRepairNeeded,
            summaryRepairNeeded,
            counts: {
                ...integrityFixture,
                total: Object.values(integrityFixture).reduce(
                    (total, value) => total + value,
                    0,
                ),
            },
            issues: [],
            issuesTruncated: false,
            targets: [],
            targetsTruncated: false,
            plannedSummary: {
                chatCount: 2,
                snapshotCount: timeline.length + otherTimeline.length,
                approximateBytes: 0,
            },
        };
    },
    async repairStorageIntegrity({ expectedRevision } = {}) {
        if (expectedRevision !== storageRevision) {
            throw Object.assign(new Error('integrity-preview-stale'), {
                code: 'integrity-preview-stale',
            });
        }
        integrityFixture = {
            missingRecords: 0,
            corruptRecords: integrityFixture.corruptRecords,
            validOrphans: 0,
            invalidIndexes: 0,
            duplicateLegacyContainers: 0,
            conflictingLegacyContainers: integrityFixture.conflictingLegacyContainers,
        };
        storageRevision += 1;
        return {
            ...(await this.inspectStorageIntegrity()),
            repaired: true,
        };
    },
    async getStorageSummary() {
        const timelines = await this.getAllTimelines();
        if (summaryNeedsRebuild) {
            return {
                ...this.getStatus(),
                complete: false,
                rebuilding: false,
                chatCount: timelines.length,
                snapshotCount: null,
                approximateBytes: null,
                maxSnapshotsPerChat: this.maxSnapshotsPerChat,
            };
        }
        return {
            ...this.getStatus(),
            complete: true,
            rebuilding: false,
            chatCount: timelines.length,
            snapshotCount: timelines.reduce((count, item) => count + item.timeline.length, 0),
            approximateBytes: new TextEncoder().encode(JSON.stringify(timelines)).length,
            maxSnapshotsPerChat: this.maxSnapshotsPerChat,
        };
    },
    async rebuildStorageSummary() {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        summaryNeedsRebuild = false;
        return this.getStorageSummary();
    },
};
const context = {
    getCurrentChatId: () => 'sandbox',
    chatId: 'sandbox',
};
let semanticFixtureMode = 'success';
const semanticFixtureStats = {
    prepareCount: 0,
    inspectCount: 0,
    adapterGenerateCount: 0,
    abortCount: 0,
    networkCallCount: 0,
    validatedResultCount: 0,
};
function semanticFixtureDelay(milliseconds, signal) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const cleanup = () => signal?.removeEventListener('abort', onAbort);
        const finish = () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve();
        };
        const timer = setTimeout(finish, milliseconds);
        const onAbort = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            cleanup();
            semanticFixtureStats.abortCount += 1;
            reject(Object.assign(new Error('sandbox semantic abort'), {
                code: 'SEMANTIC_ABORTED',
            }));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) onAbort();
    });
}
function semanticRequestFromPrompt(prompt) {
    const marker = 'INPUT_JSON:\n';
    const markerIndex = prompt.indexOf(marker);
    if (markerIndex < 0) {
        throw Object.assign(new Error('sandbox semantic prompt marker missing'), {
            code: 'SEMANTIC_INVALID_RESPONSE',
        });
    }
    return JSON.parse(prompt.slice(markerIndex + marker.length));
}
const sandboxSemanticAdapter = {
    connectionProfiles() {
        return {
            status: 'available',
            profiles: [{
                id: 'sandbox-profile-fast',
                name: '빠른 검사 프로필',
                provider: 'claude',
                model: 'claude-sonnet-4',
                completionType: 'chat-completion',
            }, {
                id: 'sandbox-profile-careful',
                name: '정밀 검사 프로필',
                provider: 'openrouter',
                model: 'sandbox-semantic-model',
                completionType: 'chat-completion',
            }],
        };
    },
    identity() {
        return {
            status: 'available',
            provider: 'claude',
            model: 'claude-sonnet-4',
            routeKind: 'current',
            connectionProfileId: null,
        };
    },
    async generate({ prompt, signal }) {
        semanticFixtureStats.adapterGenerateCount += 1;
        document.body.dataset.semanticAdapterGenerateCount = String(
            semanticFixtureStats.adapterGenerateCount,
        );
        document.body.dataset.semanticNetworkCallCount = '0';
        await semanticFixtureDelay(
            semanticFixtureMode === 'slow' ? 10_000 : 350,
            signal,
        );
        if (semanticFixtureMode === 'error') {
            throw Object.assign(new Error('sandbox semantic provider error'), {
                code: 'SEMANTIC_RATE_LIMITED',
                reason: 'provider-rate-limited',
            });
        }
        const request = semanticRequestFromPrompt(prompt);
        const target = request.targets[0];
        return JSON.stringify({
            version: 1,
            suggestions: [{
                targetIds: [target.targetId],
                category: 'conflict',
                severity: 'info',
                title: '선택 항목의 의미 관계 검토 제안',
                summary: '선택한 정적 검사 대상을 의미 수준에서 다시 검토했습니다.',
                rationale: '전송 미리보기에 표시된 원문과 정적 분석 관계만 근거로 사용했습니다.',
                confidence: 0.93,
                sourceIds: request.sources.map(({ id }) => id),
                atomIds: request.atoms.map(({ id }) => id),
                relationIds: request.relations.map(({ id }) => id),
                evidence: request.sources.map((source) => {
                    const quote = source.content.slice(
                        0,
                        Math.min(32, source.content.length),
                    );
                    return {
                        sourceId: source.id,
                        start: 0,
                        end: quote.length,
                        quote,
                    };
                }),
            }],
        });
    },
};
const sandboxSemanticCache = new SemanticInspectorMemoryCache();
class SandboxSemanticInspector extends SemanticInspector {
    async prepare(options) {
        semanticFixtureStats.prepareCount += 1;
        const prepared = await super.prepare(options);
        document.body.dataset.semanticState = 'preview-ready';
        document.body.dataset.semanticPrepareCount = String(
            semanticFixtureStats.prepareCount,
        );
        document.body.dataset.semanticRequestDigest = prepared.requestDigest;
        return prepared;
    }

    async inspect(prepared, { signal }) {
        semanticFixtureStats.inspectCount += 1;
        document.body.dataset.semanticState = 'running';
        document.body.dataset.semanticInspectCount = String(
            semanticFixtureStats.inspectCount,
        );
        try {
            const result = await super.inspect(prepared, { signal });
            semanticFixtureStats.validatedResultCount += 1;
            document.body.dataset.semanticState = 'complete';
            delete document.body.dataset.semanticErrorCode;
            delete document.body.dataset.semanticErrorReason;
            document.body.dataset.semanticValidatedResultCount = String(
                semanticFixtureStats.validatedResultCount,
            );
            return result;
        } catch (error) {
            document.body.dataset.semanticState = error?.code === 'SEMANTIC_ABORTED'
                ? 'cancelled'
                : 'error';
            document.body.dataset.semanticErrorCode = String(error?.code ?? '');
            document.body.dataset.semanticErrorReason = String(error?.reason ?? '');
            throw error;
        }
    }
}
const sandboxSemanticInspector = new SandboxSemanticInspector({
    adapter: sandboxSemanticAdapter,
    cache: sandboxSemanticCache,
});
const sandboxSemanticEvaluationHarness = new SemanticProviderEvaluationHarness({
    inspector: sandboxSemanticInspector,
});
localStorage.setItem(UI_PREFERENCES_KEY, JSON.stringify({
    ...DEFAULT_UI_PREFERENCES,
    semanticInspectorEnabled: true,
    ...(requestedFixtureSize == null ? {} : {
        timelineRetentionLimit: requestedFixtureSize,
        timelineReadLimit: requestedFixtureSize,
    }),
}));
const devTools = new DevToolsWindow({
    getContext: () => context,
    store,
    capture,
    version: '0.15.5',
    semanticInspector: sandboxSemanticInspector,
    semanticEvaluationHarness: sandboxSemanticEvaluationHarness,
    onboardingAutoStart: false,
});

function applyRequestedPanelGeometry() {
    if (!devTools.window || (requestedPanelWidth == null && requestedPanelHeight == null)) return;

    if (requestedPanelWidth != null) {
        devTools.window.style.width = `${requestedPanelWidth}px`;
        devTools.window.style.minWidth = '0';
    }
    if (requestedPanelHeight != null) {
        devTools.window.style.height = `${requestedPanelHeight}px`;
    }

    const panelWidth = requestedPanelWidth ?? devTools.window.getBoundingClientRect().width;
    devTools.window.style.left = `${Math.max(0, Math.round((window.innerWidth - panelWidth) / 2))}px`;
    devTools.window.style.top = '8px';
    devTools.window.style.transform = 'none';
}
document.body.dataset.fixtureSchema = '7';
document.body.dataset.fixtureSize = String(timeline.length);
document.body.dataset.sourceCount = String(
    timeline.find((snapshot) => (snapshot.privacy?.mode ?? 'full') === 'full')
        ?.sources?.length ?? 0,
);
document.body.dataset.stressFixture = String(
    requestedFixtureSize != null || requestedSourceCount != null,
);
document.body.dataset.semanticCore = String(
    sandboxSemanticInspector instanceof SemanticInspector,
);
document.body.dataset.semanticNetworkCallCount = '0';
document.body.dataset.fixtureFeatures = [
    'provider-trace',
    'provenance-available',
    'provenance-legacy-unavailable',
    'provenance-truncated',
    'prefill-confirmed',
    'prefill-inferred',
    'metadata-diff',
    'lore-changed',
    'corrupt-warning',
    'usage-local-estimate',
    'semantic-consent-preview',
    'semantic-result',
    'semantic-error',
    'semantic-cancel',
    'semantic-no-provider-call',
    'semantic-profile-selection',
    'growth-focused',
    'privacy-redacted',
    'privacy-metadata',
    'retention-policy',
    'storage-integrity',
    'storage-quota',
    'archive-transfer',
    'diagnostic-compare',
    'performance-stress',
    'retro-theme-conflict-toggle',
].join(',');

function setRetroThemeConflict(enabled) {
    const active = Boolean(enabled);
    const toggle = document.getElementById('sandbox-retro-theme-toggle');
    document.body.classList?.toggle?.('sandbox-retro-theme', active);
    if (document.body.dataset) {
        document.body.dataset.retroThemeConflict = active ? 'on' : 'off';
    }
    toggle?.setAttribute?.('aria-pressed', String(active));
    if (toggle) {
        toggle.textContent = `레트로 테마 충돌: ${active ? '켜짐' : '꺼짐'}`;
    }
    return active;
}

const retroThemeToggle = document.getElementById('sandbox-retro-theme-toggle');
setRetroThemeConflict(Boolean(
    document.body.classList?.contains?.('sandbox-retro-theme'),
));
retroThemeToggle?.addEventListener?.('click', () => {
    setRetroThemeConflict(!document.body.classList?.contains?.('sandbox-retro-theme'));
});

document.getElementById('sandbox-launcher').addEventListener('click', async () => {
    await devTools.open();
    applyRequestedPanelGeometry();
});
document.getElementById('sandbox-onboarding')?.addEventListener('click', async () => {
    await devTools.open();
    applyRequestedPanelGeometry();
    devTools.startOnboarding({ invitation: true, force: true });
});
document.getElementById('sandbox-storage-error').addEventListener('click', () => {
    capture.dispatchEvent(new CustomEvent('capture-status', {
        detail: {
            state: 'failed',
            promptType: timeline.at(-1)?.promptType,
            stage: timeline.at(-1)?.capture?.stage,
            at: Date.now(),
        },
    }));
    capture.dispatchEvent(new CustomEvent('capture-error', {
        detail: {
            operation: 'addSnapshot',
            snapshot: timeline.at(-1),
            error: new Error('샌드박스 IndexedDB 쓰기 실패'),
        },
    }));
});
document.getElementById('sandbox-storage-mode').addEventListener('click', async () => {
    temporaryStorage = !temporaryStorage;
    await devTools.refresh();
});
document.getElementById('sandbox-summary-mode').addEventListener('click', async () => {
    summaryNeedsRebuild = true;
    await devTools.refreshStorageSummary();
});
document.getElementById('sandbox-theme').addEventListener('click', () => {
    darkTheme = !darkTheme;
    document.body.style.setProperty(
        '--SmartThemeBodyColor',
        darkTheme ? '#eef2f7' : '#172033',
    );
    document.body.style.background = darkTheme ? '#10151f' : '#eef2f7';
    document.body.style.color = darkTheme ? '#eef2f7' : '#172033';
    devTools.syncOpaqueTheme();
});
async function setFocusedGrowthFixture() {
    const focusedTokens = [
        1_600, 1_604, 1_598, 1_609, 1_605,
        1_612, 1_608, 1_615, 1_611, 1_618,
    ];
    const baseTimestamp = Date.UTC(2026, 6, 31, 13, 0, 0);
    timeline = focusedTokens.map((totalTokens, index) => createSnapshot(
        `growth-focused-${index + 1}`,
        baseTimestamp + index * 60_000,
        totalTokens,
        { model: 'growth-focused-model' },
    ));
    corruptRecordCount = 0;
    storageRevision += 1;
    document.body.dataset.growthFixture = 'focused';
    await devTools.open();
    devTools.selectTab('timeline');
}
document.getElementById('sandbox-growth-focused')?.addEventListener(
    'click',
    () => void setFocusedGrowthFixture(),
);
async function setSemanticFixtureMode(mode) {
    semanticFixtureMode = mode;
    sandboxSemanticCache.clear();
    document.body.dataset.semanticFixtureMode = mode;
    document.body.dataset.semanticState = 'idle';
    delete document.body.dataset.semanticErrorCode;
    delete document.body.dataset.semanticErrorReason;
    selectPrivacyFixture('full');
    devTools.resetSemanticInspectionState(devTools.selectedSnapshot()?.id);
    await devTools.open();
    devTools.selectTab('rules');
    return mode;
}
document.getElementById('sandbox-semantic-success')?.addEventListener(
    'click',
    () => void setSemanticFixtureMode('success'),
);
document.getElementById('sandbox-semantic-error')?.addEventListener(
    'click',
    () => void setSemanticFixtureMode('error'),
);
document.getElementById('sandbox-semantic-slow')?.addEventListener(
    'click',
    () => void setSemanticFixtureMode('slow'),
);
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

async function runArchiveImportSmokeTest() {
    const incoming = createSnapshot(
        'sandbox-archive-import',
        sandboxNow + 3000,
        132,
        {
            chatId: 'sandbox',
            provider: 'openrouter',
            model: 'sandbox-archive-model',
        },
    );
    const archive = await createSnapshotArchive({
        timelines: [{ chatId: 'sandbox', timeline: [incoming] }],
        mode: 'full',
        exportedAt: sandboxNow + 4000,
        extensionVersion: '0.15.5',
    });
    const plan = await prepareSnapshotArchiveImport(
        archive,
        await store.getAllStoredTimelines(),
        { strategy: 'merge', conflictPolicy: 'skip' },
    );
    const result = await executeSnapshotArchiveImport(store, plan);
    document.body.dataset.archiveImportResult = result.code;
    document.body.dataset.archiveImportVerified = String(result.verified);
    return result;
}

async function runArchiveRollbackSmokeTest() {
    const before = JSON.stringify(await store.getAllStoredTimelines());
    try {
        await store.runExclusiveImport(async (facade) => {
            await facade.clearAll();
            await facade.addSnapshot(createSnapshot(
                'sandbox-rollback-probe',
                sandboxNow + 5000,
                32,
                { chatId: 'sandbox' },
            ), { partitionChatId: 'sandbox' });
            throw Object.assign(new Error('sandbox-rollback-probe'), {
                code: 'sandbox-rollback-probe',
            });
        });
    } catch (error) {
        if (error?.code !== 'sandbox-rollback-probe') throw error;
    }
    const restored = JSON.stringify(await store.getAllStoredTimelines()) === before;
    document.body.dataset.archiveRollbackRestored = String(restored);
    return restored;
}

async function runHungTokenizerCaptureSmokeTest() {
    const statuses = [];
    const smokeStore = new SnapshotStore({
        namespace: 'sandbox-capture-first',
        maxSnapshotsPerChat: 10,
    });
    const controller = new CaptureController({
        getContext: () => ({
            getTokenCountAsync: () => new Promise(() => {}),
        }),
        store: smokeStore,
        version: '0.15.5',
        tokenCounterWaitMs: 25,
        storageWaitMs: 1_000,
    });
    controller.addEventListener('capture-status', ({ detail }) => {
        statuses.push(detail.state);
    });
    controller.dispatchCaptureStatus('processing', {
        promptType: 'chat-completion',
        stage: 'backend-request-ready',
    });
    const request = createRequestRecord({
        messages: [{
            role: 'user',
            content: 'capture undefined regression',
            name: undefined,
        }],
        logit_bias: undefined,
        n: undefined,
        reasoning_effort: undefined,
        verbosity: undefined,
    });
    const persistedSnapshot = await controller.persistCapture({
        contextState: {
            chatId: 'sandbox-hung-tokenizer',
            messageCount: 1,
            mainApi: 'openai',
            model: 'sandbox-model',
            maxContext: 4_096,
            maxOutput: 512,
            chatCompletionSettings: { prompts: [], prompt_order: [] },
            extensionPrompts: {},
            chat: [],
        },
        payload: request.body.messages,
        promptType: 'chat-completion',
        generationType: 'normal',
        activatedLore: [],
        capture: createCaptureBoundary({
            eventName: 'CHAT_COMPLETION_SETTINGS_READY',
            stage: 'backend-request-ready',
            requestBodyAvailable: false,
            fallback: true,
        }),
        request,
    });
    const storedSnapshot = await smokeStore.getSnapshot(
        'sandbox-hung-tokenizer',
        persistedSnapshot.id,
    );
    const result = {
        saved: Boolean(storedSnapshot),
        verified: storedSnapshot?.id === persistedSnapshot.id,
        undefinedNormalized:
            storedSnapshot?.payload?.[0]?.name === null
            && storedSnapshot?.request?.body?.logit_bias === null
            && storedSnapshot?.request?.body?.n === null
            && storedSnapshot?.request?.body?.reasoning_effort === null
            && storedSnapshot?.request?.body?.verbosity === null,
        states: statuses,
        totalTokens: storedSnapshot?.stats?.totalTokens ?? null,
        sourceAnalysis: storedSnapshot?.stats?.structured?.sourceAnalysis ?? null,
    };
    document.body.dataset.hungTokenizerCapture = JSON.stringify(result);
    return result;
}

document.getElementById('sandbox-capture-timeout')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = '캡처 대기 회귀 검사 중';
    try {
        const result = await runHungTokenizerCaptureSmokeTest();
        button.textContent = result.saved
            && result.verified
            && result.undefinedNormalized
            && result.states.at(-1) === 'saved'
            ? '캡처 대기 회귀 통과'
            : '캡처 대기 회귀 실패';
    } catch {
        button.textContent = '캡처 대기 회귀 실패';
    } finally {
        button.disabled = false;
    }
});

document.getElementById('sandbox-archive-import-valid')?.addEventListener('click', async () => {
    await runArchiveImportSmokeTest();
});

function selectPrivacyFixture(mode) {
    const fixture = mode === 'full'
        ? timeline.find((snapshot) => (snapshot.privacy?.mode ?? 'full') === 'full')
        : timeline.find((snapshot) => snapshot.privacy?.mode === mode);
    if (!fixture) return false;
    devTools.selectedId = fixture.id;
    devTools.render();
    return true;
}
document.getElementById('sandbox-select-full')?.addEventListener('click', () => {
    selectPrivacyFixture('full');
});
document.getElementById('sandbox-select-redacted')?.addEventListener('click', () => {
    selectPrivacyFixture('redacted');
});
document.getElementById('sandbox-select-metadata')?.addEventListener('click', () => {
    selectPrivacyFixture('metadata');
});

const SANDBOX_LAST_TAB_KEY = 'st-devtools:last-tab';
let onboardingIsolationBaseline = null;

function sandboxProviderCallCounters() {
    return Object.freeze({
        networkCallCount: semanticFixtureStats.networkCallCount,
        adapterGenerateCount: semanticFixtureStats.adapterGenerateCount,
        prepareCount: semanticFixtureStats.prepareCount,
        inspectCount: semanticFixtureStats.inspectCount,
        validatedResultCount: semanticFixtureStats.validatedResultCount,
    });
}

function sandboxLastTab() {
    try {
        return localStorage.getItem(SANDBOX_LAST_TAB_KEY);
    } catch {
        return null;
    }
}

function sandboxIsolationSnapshot() {
    return Object.freeze({
        liveTimelineIds: Object.freeze(
            devTools.timeline.map((snapshot) => snapshot.id),
        ),
        storeTimelineIds: Object.freeze(timeline.map((snapshot) => snapshot.id)),
        selectedId: devTools.selectedId,
        lastTab: sandboxLastTab(),
        storeSnapshotCount: timeline.length + otherTimeline.length,
        storageRevision,
        timelinePageReadCount,
        providerCalls: sandboxProviderCallCounters(),
    });
}

function equalStringLists(left = [], right = []) {
    return left.length === right.length
        && left.every((value, index) => value === right[index]);
}

function sandboxOnboardingStatus() {
    const step = devTools.currentOnboardingStep();
    const session = devTools.onboardingSession;
    const groupSteps = step
        ? ONBOARDING_STEPS.filter(({ group }) => group === step.group)
        : [];
    const targetMatches = step?.target
        ? [...(devTools.window?.querySelectorAll(step.target) ?? [])]
        : [];
    const target = targetMatches[0] ?? null;
    const primaryRegionStates = devTools.primaryRegions.map((region) => ({
        inert: Boolean(region.inert),
        ariaHidden: region.getAttribute?.('aria-hidden') === 'true',
    }));
    const guideVisible = Boolean(
        devTools.onboardingGuide
        && !devTools.onboardingGuide.hidden
    );
    const guidePanelVisible = Boolean(
        guideVisible
        && devTools.onboardingGuidePanel
        && !devTools.onboardingGuidePanel.hidden
    );
    const spotlightVisible = Boolean(
        guideVisible
        && devTools.onboardingSpotlight
        && !devTools.onboardingSpotlight.hidden
    );
    const practiceDockVisible = Boolean(
        guideVisible
        && devTools.onboardingPracticeDock
        && !devTools.onboardingPracticeDock.hidden
    );
    return {
        phase: devTools.onboardingPhase,
        stepStage: devTools.onboardingStepStage,
        stepId: step?.id ?? null,
        group: step?.group ?? null,
        index: devTools.tutorialIsActive() ? devTools.onboardingStepIndex : null,
        total: ONBOARDING_STEPS.length,
        groupIndex: step
            ? groupSteps.findIndex(({ id }) => id === step.id)
            : null,
        groupTotal: groupSteps.length || null,
        complete: Boolean(devTools.tutorialIsActive() && devTools.onboardingStepComplete),
        target: step?.target ?? null,
        targetState: {
            found: Boolean(target),
            count: targetMatches.length,
            inGuide: Boolean(target && devTools.onboardingGuide?.contains(target)),
            describedByTask: target?.getAttribute?.('aria-describedby')
                === (devTools.onboardingStepStage === 'practice'
                    ? 'st-devtools-onboarding-practice-copy'
                    : 'st-devtools-onboarding-guide-body'),
        },
        guide: {
            mounted: Boolean(devTools.onboardingGuide?.isConnected),
            visible: guideVisible,
            panelVisible: guidePanelVisible,
            group: devTools.onboardingGuide?.dataset?.group ?? null,
            step: devTools.onboardingGuide?.dataset?.step ?? null,
            stage: devTools.onboardingGuide?.dataset?.stage ?? null,
        },
        guideVisible: guideVisible,
        guidePanelVisible: guidePanelVisible,
        primaryRegionsInert: primaryRegionStates.length > 0
            && primaryRegionStates.every(({ inert, ariaHidden }) => inert && ariaHidden),
        primaryRegionStates,
        spotlightVisible: spotlightVisible,
        practiceDockVisible: practiceDockVisible,
        invitationVisible: Boolean(
            devTools.onboardingInvitationOverlay
            && !devTools.onboardingInvitationOverlay.hidden
        ),
        tab: devTools.activeTabId(),
        selectedId: devTools.activeSelectedId(),
        timelineCount: devTools.activeTimeline().length,
        captureState: session?.captureState ?? devTools.captureStatus?.state ?? null,
    };
}

function sandboxOnboardingIsolationStatus() {
    const before = onboardingIsolationBaseline;
    const after = sandboxIsolationSnapshot();
    if (!before) {
        return {
            before: null,
            after,
            checks: null,
            isolated: null,
        };
    }
    const checks = {
        liveTimeline: equalStringLists(before.liveTimelineIds, after.liveTimelineIds),
        storeTimeline: equalStringLists(before.storeTimelineIds, after.storeTimelineIds),
        selectedId: before.selectedId === after.selectedId,
        lastTab: before.lastTab === after.lastTab,
        storeSnapshotCount: before.storeSnapshotCount === after.storeSnapshotCount,
        storageRevision: before.storageRevision === after.storageRevision,
        providerCalls: JSON.stringify(before.providerCalls) === JSON.stringify(after.providerCalls),
    };
    return {
        before,
        after,
        checks,
        isolated: Object.values(checks).every(Boolean),
    };
}

async function waitForSandboxOnboardingAction(stepId, attempts = 125) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (
            devTools.currentOnboardingStep()?.id === stepId
            && devTools.onboardingStepComplete
        ) return true;
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return false;
}

function dispatchSandboxClick(target) {
    if (typeof target?.click === 'function') {
        target.click();
        return;
    }
    target?.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: globalThis,
    }));
}

async function performSandboxOnboardingAction() {
    const step = devTools.currentOnboardingStep();
    const interaction = step?.interaction;
    if (!step || !interaction) {
        return {
            performed: false,
            reason: step ? 'no-interaction' : 'no-active-step',
            status: sandboxOnboardingStatus(),
        };
    }

    const scope = interaction.event === 'panel'
        ? devTools.onboardingPracticeDock
        : devTools.window;
    const target = scope?.querySelector(interaction.selector) ?? null;
    if (!target) {
        return {
            performed: false,
            reason: 'target-unavailable',
            stepId: step.id,
            selector: interaction.selector,
            status: sandboxOnboardingStatus(),
        };
    }

    if (interaction.event === 'click' || interaction.event === 'panel') {
        dispatchSandboxClick(target);
    } else if (interaction.event === 'change' || interaction.event === 'input') {
        if (interaction.value !== undefined) target.value = String(interaction.value);
        target.dispatchEvent(new Event(interaction.event, {
            bubbles: true,
            cancelable: true,
        }));
    } else if (interaction.event === 'toggle') {
        if (!('open' in target)) {
            return {
                performed: false,
                reason: 'target-not-toggleable',
                stepId: step.id,
                selector: interaction.selector,
                status: sandboxOnboardingStatus(),
            };
        }
        target.open = interaction.state === 'open';
        target.dispatchEvent(new Event('toggle', { bubbles: true }));
    } else {
        return {
            performed: false,
            reason: 'unsupported-interaction',
            stepId: step.id,
            event: interaction.event,
            status: sandboxOnboardingStatus(),
        };
    }

    const performed = await waitForSandboxOnboardingAction(step.id);
    return {
        performed,
        reason: performed ? null : 'action-timeout',
        stepId: step.id,
        event: interaction.event,
        selector: interaction.selector,
        status: sandboxOnboardingStatus(),
    };
}

const sandboxOnboardingHook = Object.freeze({
    async startPractice() {
        if (devTools.onboardingIsOpen()) {
            devTools.closeOnboarding({ persist: null, restoreFocus: false });
        }
        await devTools.open();
        applyRequestedPanelGeometry();
        onboardingIsolationBaseline = sandboxIsolationSnapshot();
        const started = devTools.startOnboarding({ invitation: false, force: true });
        return {
            started,
            status: sandboxOnboardingStatus(),
            isolation: sandboxOnboardingIsolationStatus(),
        };
    },
    next() {
        const advanced = devTools.nextOnboardingStep();
        return { advanced, status: sandboxOnboardingStatus() };
    },
    enterPractice() {
        const entered = devTools.onboardingStepStage === 'briefing'
            && devTools.nextOnboardingStep();
        return { entered: Boolean(entered), status: sandboxOnboardingStatus() };
    },
    acknowledge() {
        const acknowledged = devTools.completePassiveOnboardingStep();
        return { acknowledged, status: sandboxOnboardingStatus() };
    },
    back() {
        const moved = devTools.previousOnboardingStep();
        return { moved, status: sandboxOnboardingStatus() };
    },
    skipStep() {
        const skipped = devTools.skipOnboardingStep();
        return { skipped, status: sandboxOnboardingStatus() };
    },
    exit() {
        const closed = devTools.closeOnboarding({ persist: null, restoreFocus: false });
        return {
            closed,
            status: sandboxOnboardingStatus(),
            isolation: sandboxOnboardingIsolationStatus(),
        };
    },
    status: sandboxOnboardingStatus,
    performCurrentAction: performSandboxOnboardingAction,
    isolationStatus: sandboxOnboardingIsolationStatus,
});

const sandboxApi = {
    selectPrivacyFixture,
    setRetroThemeConflict,
    setSemanticFixtureMode,
    onboarding: sandboxOnboardingHook,
    semantic: {
        inspector: sandboxSemanticInspector,
        adapter: sandboxSemanticAdapter,
        stats: semanticFixtureStats,
        mode: () => semanticFixtureMode,
        cacheStatus: () => sandboxSemanticInspector.cacheStatus(),
    },
    runArchiveImportSmokeTest,
    runArchiveRollbackSmokeTest,
    runHungTokenizerCaptureSmokeTest,
    performance: {
        fixtureSize: timeline.length,
        sourceCount: Number(document.body.dataset.sourceCount),
    },
    renderPrivacyTabs(mode) {
        if (!selectPrivacyFixture(mode)) return [];
        const results = [];
        for (const tab of ['explorer', 'timeline', 'diff', 'rules', 'search']) {
            devTools.selectTab(tab);
            results.push({
                tab,
                text: devTools.content?.textContent ?? '',
            });
        }
        return results;
    },
};
globalThis.devToolsSandboxFixtures = sandboxApi;
globalThis.__ST_DEVTOOLS_SANDBOX__ = sandboxApi;
globalThis.devToolsSandbox = devTools;
