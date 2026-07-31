import { analyzeSnapshot, DEFAULT_RULE_SETTINGS } from './rules.js';
import { providerDisplayLabel } from './i18n.js';
import { snapshotProvider } from './model.js';

function increment(target, key) {
    const normalized = String(key ?? 'unknown');
    target[normalized] = (target[normalized] ?? 0) + 1;
}

function rounded(value, digits = 2) {
    if (!Number.isFinite(value)) return null;
    return Number(value.toFixed(digits));
}

function ruleSummary(snapshot) {
    try {
        const findings = analyzeSnapshot(snapshot, DEFAULT_RULE_SETTINGS);
        const severity = { critical: 0, warning: 0, info: 0 };
        const rules = {};
        for (const finding of findings) {
            increment(severity, finding.severity);
            increment(rules, finding.ruleId);
        }
        return { total: findings.length, severity, rules };
    } catch {
        return { total: null, severity: {}, rules: {}, failed: true };
    }
}

function snapshotDiagnostic(snapshot) {
    const sourceTypes = {};
    for (const source of snapshot.sources ?? []) {
        increment(sourceTypes, source.type);
    }
    const multimodalEstimatedParts = (snapshot.sources ?? []).filter((source) => (
        source.type === 'multimodal'
        && Number.isFinite(source.metadata?.tokenEstimate?.tokens)
    )).length;
    const structured = snapshot.stats?.structured ?? {};
    return {
        id: snapshot.id,
        timestamp: snapshot.timestamp,
        api: snapshot.api ?? 'unknown',
        provider: snapshotProvider(snapshot),
        model: snapshot.model ?? null,
        promptType: snapshot.promptType ?? 'unknown',
        generationType: snapshot.generationType ?? 'unknown',
        schemaVersion: snapshot.schemaVersion ?? null,
        extensionVersion: snapshot.extensionVersion ?? null,
        capture: {
            eventName: snapshot.capture?.eventName ?? null,
            stage: snapshot.capture?.stage ?? null,
            fallback: Boolean(snapshot.capture?.fallback),
            correlationMethod: snapshot.capture?.correlationMethod ?? null,
            hasCorrelationId: Boolean(
                snapshot.capture?.hadCorrelationId
                ?? snapshot.capture?.correlationId,
            ),
            requestStatus: snapshot.capture?.requestStatus ?? null,
            generationStatus: snapshot.capture?.generationStatus ?? null,
            statusEvent: snapshot.capture?.statusEvent ?? null,
        },
        request: {
            bodyKeys: snapshot.request?.bodyKeys ?? [],
            redactedFieldCount: snapshot.request?.redactedPaths?.length ?? 0,
            omittedMediaCount: snapshot.request?.omittedMediaPaths?.length ?? 0,
        },
        tokens: {
            prompt: snapshot.stats?.totalTokens ?? null,
            maxContext: snapshot.stats?.maxContext ?? null,
            maxOutput: snapshot.stats?.maxOutput ?? null,
            contextUsage: rounded(snapshot.stats?.contextUsage),
            remainingContext: snapshot.stats?.remainingContext ?? null,
        },
        structured: {
            toolSchemas: structured.toolSchemas ?? 0,
            toolCalls: structured.toolCalls ?? 0,
            toolResults: structured.toolResults ?? 0,
            multimodalParts: structured.multimodalParts ?? 0,
            multimodalEstimatedTokens: structured.multimodalEstimatedTokens ?? 0,
            multimodalEstimatedParts,
            multimodalEstimateCoverage: rounded(structured.multimodalEstimateCoverage),
        },
        sourceTypes,
        rules: ruleSummary(snapshot),
    };
}

export function buildTimelineDiagnostics(timeline, { generatedAt = Date.now() } = {}) {
    const snapshots = [...(timeline ?? [])]
        .filter((snapshot) => snapshot && typeof snapshot === 'object')
        .sort((left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0))
        .map(snapshotDiagnostic);
    const apiCounts = {};
    const providerCounts = {};
    const modelCounts = {};
    const promptTypeCounts = {};
    const generationTypeCounts = {};
    const captureStageCounts = {};
    const correlationMethodCounts = {};
    const sourceTypeCounts = {};
    const ruleSeverityCounts = { critical: 0, warning: 0, info: 0 };
    const structuredTotals = {
        toolSchemas: 0,
        toolCalls: 0,
        toolResults: 0,
        multimodalParts: 0,
        multimodalEstimatedTokens: 0,
    };
    let multimodalEstimateParts = 0;
    const tokenValues = [];
    let fallbackCaptures = 0;
    let correlatedCaptures = 0;
    let redactedFields = 0;
    let omittedMedia = 0;
    let ruleFindings = 0;

    for (const snapshot of snapshots) {
        increment(apiCounts, snapshot.api);
        increment(providerCounts, snapshot.provider);
        increment(modelCounts, snapshot.model ?? 'unknown');
        increment(promptTypeCounts, snapshot.promptType);
        increment(generationTypeCounts, snapshot.generationType);
        increment(captureStageCounts, snapshot.capture.stage ?? 'unknown');
        increment(correlationMethodCounts, snapshot.capture.correlationMethod ?? 'unknown');
        if (snapshot.capture.fallback) fallbackCaptures += 1;
        if (snapshot.capture.hasCorrelationId) correlatedCaptures += 1;
        redactedFields += snapshot.request.redactedFieldCount;
        omittedMedia += snapshot.request.omittedMediaCount;
        for (const [type, count] of Object.entries(snapshot.sourceTypes)) {
            sourceTypeCounts[type] = (sourceTypeCounts[type] ?? 0) + count;
        }
        for (const key of Object.keys(structuredTotals)) {
            structuredTotals[key] += snapshot.structured[key] ?? 0;
        }
        multimodalEstimateParts += snapshot.structured.multimodalEstimatedParts ?? 0;
        if (Number.isFinite(snapshot.tokens.prompt)) tokenValues.push(snapshot.tokens.prompt);
        if (Number.isFinite(snapshot.rules.total)) ruleFindings += snapshot.rules.total;
        for (const key of Object.keys(ruleSeverityCounts)) {
            ruleSeverityCounts[key] += snapshot.rules.severity[key] ?? 0;
        }
    }

    const firstToken = tokenValues[0] ?? null;
    const lastToken = tokenValues.at(-1) ?? null;
    return {
        reportVersion: 2,
        generatedAt,
        scope: 'current-chat-timeline',
        privacy: {
            promptContentIncluded: false,
            requestBodyIncluded: false,
            correlationIdValuesIncluded: false,
            chatIdValuesIncluded: false,
        },
        summary: {
            snapshotCount: snapshots.length,
            firstTimestamp: snapshots[0]?.timestamp ?? null,
            lastTimestamp: snapshots.at(-1)?.timestamp ?? null,
            apiCounts,
            providerCounts,
            modelCounts,
            promptTypeCounts,
            generationTypeCounts,
            captureStageCounts,
            correlationMethodCounts,
            fallbackCaptures,
            correlatedCaptures,
            redactedFields,
            omittedMedia,
            sourceTypeCounts,
            structuredTotals,
            multimodalEstimateCoverage: structuredTotals.multimodalParts
                ? rounded(multimodalEstimateParts / structuredTotals.multimodalParts)
                : null,
            ruleFindings,
            ruleSeverityCounts,
            tokens: {
                minimum: tokenValues.length ? Math.min(...tokenValues) : null,
                maximum: tokenValues.length ? Math.max(...tokenValues) : null,
                average: tokenValues.length
                    ? rounded(tokenValues.reduce((sum, value) => sum + value, 0) / tokenValues.length)
                    : null,
                first: firstToken,
                last: lastToken,
                delta: firstToken == null || lastToken == null ? null : lastToken - firstToken,
            },
        },
        snapshots,
    };
}

function formatCounts(counts) {
    const entries = Object.entries(counts ?? {});
    return entries.length
        ? entries.map(([key, value]) => `${key} ${value}`).join(' · ')
        : '없음';
}

function formatProviderCounts(counts) {
    const entries = Object.entries(counts ?? {});
    return entries.length
        ? entries.map(([key, value]) => `${providerDisplayLabel(key)} ${value}`).join(' · ')
        : '없음';
}

export function serializeTimelineDiagnostics(timeline, format = 'json', options = {}) {
    const report = buildTimelineDiagnostics(timeline, options);
    if (format === 'json') {
        return JSON.stringify(report, null, 2);
    }

    const summary = report.summary;
    const snapshotRows = report.snapshots.map((snapshot) => (
        `| ${new Date(snapshot.timestamp).toISOString()} | ${snapshot.api} | ${providerDisplayLabel(snapshot.provider)} | ${snapshot.model ?? '미확인'} | ` +
        `${snapshot.tokens.prompt ?? '미확인'} | ${snapshot.capture.stage ?? '미확인'} | ` +
        `${snapshot.capture.correlationMethod ?? '미확인'} | ${snapshot.rules.total ?? '실패'} |`
    ));
    return [
        '# ST DevTools 타임라인 진단 보고서',
        '',
        `- 생성 시각: ${new Date(report.generatedAt).toISOString()}`,
        `- 범위: 현재 채팅 타임라인 ${summary.snapshotCount}개`,
        '- 개인정보 보호: 프롬프트 내용·요청 본문·요청 식별자 값은 포함하지 않음',
        `- API 경로: ${formatCounts(summary.apiCounts)}`,
        `- 생성 제공자: ${formatProviderCounts(summary.providerCounts)}`,
        `- 캡처 경계: ${formatCounts(summary.captureStageCounts)}`,
        `- 연결 방식: ${formatCounts(summary.correlationMethodCounts)}`,
        `- 대체 캡처: ${summary.fallbackCaptures}`,
        `- 민감 필드 제거: ${summary.redactedFields}`,
        `- 미디어 데이터 생략: ${summary.omittedMedia}`,
        `- 구조화 입력: tool schema ${summary.structuredTotals.toolSchemas} · tool call ${summary.structuredTotals.toolCalls} · tool result ${summary.structuredTotals.toolResults} · multimodal ${summary.structuredTotals.multimodalParts}`,
        `- 멀티모달 토큰 추정: 합계 ${summary.structuredTotals.multimodalEstimatedTokens} · 산출 가능 비율 ${summary.multimodalEstimateCoverage == null ? '미확인' : `${rounded(summary.multimodalEstimateCoverage * 100, 1)}%`}`,
        `- 토큰: 최소 ${summary.tokens.minimum ?? '미확인'} · 최대 ${summary.tokens.maximum ?? '미확인'} · 평균 ${summary.tokens.average ?? '미확인'} · 첫→마지막 변화 ${summary.tokens.delta ?? '미확인'}`,
        `- 규칙 결과: ${summary.ruleFindings}개 (${formatCounts(summary.ruleSeverityCounts)})`,
        '',
        '## 스냅샷',
        '',
        '| 시각 | API 경로 | 생성 제공자 | 모델 | 토큰 | 캡처 경계 | 연결 방식 | 규칙 |',
        '| --- | --- | --- | --- | ---: | --- | --- | ---: |',
        ...snapshotRows,
        '',
    ].join('\n');
}

export function buildAllTimelineDiagnostics(chatTimelines, { generatedAt = Date.now() } = {}) {
    const groups = (chatTimelines ?? [])
        .filter((group) => Array.isArray(group?.timeline) && group.timeline.length > 0);
    const reports = groups.map((group, index) => {
        const report = buildTimelineDiagnostics(group.timeline, { generatedAt });
        return {
            chatRef: `chat-${index + 1}`,
            report,
        };
    });
    const combined = buildTimelineDiagnostics(
        groups.flatMap((group) => group.timeline),
        { generatedAt },
    );
    combined.scope = 'all-chat-timelines';
    combined.summary.chatCount = reports.length;
    combined.chats = reports.map(({ chatRef, report }) => ({
        chatRef,
        snapshotCount: report.summary.snapshotCount,
        firstTimestamp: report.summary.firstTimestamp,
        lastTimestamp: report.summary.lastTimestamp,
        apiCounts: report.summary.apiCounts,
        providerCounts: report.summary.providerCounts,
        modelCounts: report.summary.modelCounts,
        fallbackCaptures: report.summary.fallbackCaptures,
        tokens: report.summary.tokens,
    }));
    combined.snapshots = reports.flatMap(({ chatRef, report }) => (
        report.snapshots.map((snapshot) => ({ ...snapshot, chatRef }))
    ));
    return combined;
}

export function serializeAllTimelineDiagnostics(chatTimelines, format = 'json', options = {}) {
    const report = buildAllTimelineDiagnostics(chatTimelines, options);
    if (format === 'json') return JSON.stringify(report, null, 2);

    const summary = report.summary;
    const chatRows = report.chats.map((chat) => (
        `| ${chat.chatRef} | ${chat.snapshotCount} | ` +
        `${chat.firstTimestamp ? new Date(chat.firstTimestamp).toISOString() : '미확인'} | ` +
        `${chat.lastTimestamp ? new Date(chat.lastTimestamp).toISOString() : '미확인'} | ` +
        `${chat.tokens.minimum ?? '미확인'} | ${chat.tokens.maximum ?? '미확인'} |`
    ));
    const snapshotRows = report.snapshots.map((snapshot) => (
        `| ${snapshot.chatRef} | ${new Date(snapshot.timestamp).toISOString()} | ` +
        `${snapshot.api} | ${providerDisplayLabel(snapshot.provider)} | ${snapshot.model ?? '미확인'} | ${snapshot.tokens.prompt ?? '미확인'} | ` +
        `${snapshot.capture.stage ?? '미확인'} | ${snapshot.rules.total ?? '실패'} |`
    ));
    return [
        '# ST DevTools 전체 채팅 진단 보고서',
        '',
        `- 생성 시각: ${new Date(report.generatedAt).toISOString()}`,
        `- 범위: 채팅 ${summary.chatCount}개 · 스냅샷 ${summary.snapshotCount}개`,
        '- 개인정보 보호: 채팅 ID·프롬프트 내용·요청 본문·요청 식별자 값은 포함하지 않음',
        `- API 경로: ${formatCounts(summary.apiCounts)}`,
        `- 생성 제공자: ${formatProviderCounts(summary.providerCounts)}`,
        `- 캡처 경계: ${formatCounts(summary.captureStageCounts)}`,
        `- 대체 캡처: ${summary.fallbackCaptures}`,
        `- 토큰: 최소 ${summary.tokens.minimum ?? '미확인'} · 최대 ${summary.tokens.maximum ?? '미확인'} · 평균 ${summary.tokens.average ?? '미확인'}`,
        `- 멀티모달 토큰 추정: 합계 ${summary.structuredTotals.multimodalEstimatedTokens} · 산출 가능 비율 ${summary.multimodalEstimateCoverage == null ? '미확인' : `${rounded(summary.multimodalEstimateCoverage * 100, 1)}%`}`,
        '',
        '## 채팅별 요약',
        '',
        '| 익명 채팅 | 스냅샷 | 시작 | 종료 | 최소 토큰 | 최대 토큰 |',
        '| --- | ---: | --- | --- | ---: | ---: |',
        ...chatRows,
        '',
        '## 스냅샷',
        '',
        '| 익명 채팅 | 시각 | API 경로 | 생성 제공자 | 모델 | 토큰 | 캡처 경계 | 규칙 |',
        '| --- | --- | --- | --- | --- | ---: | --- | ---: |',
        ...snapshotRows,
        '',
    ].join('\n');
}

const FORBIDDEN_IMPORT_KEYS = new Set([
    'body',
    'chatId',
    'content',
    'correlationId',
    'finalText',
    'payload',
    'prompt',
    'requestBody',
]);
const ALLOWED_REPORT_SCOPES = new Set([
    'current-chat-timeline',
    'all-chat-timelines',
]);
const SAFE_COUNT_MAP_KEYS = new Set([
    'apiCounts',
    'captureStageCounts',
    'correlationMethodCounts',
    'generationTypeCounts',
    'modelCounts',
    'promptTypeCounts',
    'providerCounts',
    'rules',
    'ruleSeverityCounts',
    'sourceTypes',
    'sourceTypeCounts',
]);

function assertDiagnosticReport(condition, message) {
    if (!condition) throw new Error(message);
}

function scanImportedValue(value, state, depth = 0, parentKey = null) {
    assertDiagnosticReport(depth <= 12, '진단 보고서의 중첩 깊이가 너무 큽니다.');
    state.nodes += 1;
    assertDiagnosticReport(state.nodes <= 100_000, '진단 보고서의 항목 수가 너무 많습니다.');
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
        const allowedPromptMetric = key === 'prompt'
            && parentKey === 'tokens'
            && (child == null || Number.isFinite(child));
        const allowedCountKey = SAFE_COUNT_MAP_KEYS.has(parentKey)
            && Number.isFinite(child);
        assertDiagnosticReport(
            !FORBIDDEN_IMPORT_KEYS.has(key) || allowedPromptMetric || allowedCountKey,
            `진단 보고서에 허용되지 않는 내용 필드가 있습니다: ${key}`,
        );
        scanImportedValue(child, state, depth + 1, key);
    }
}

export function validateTimelineDiagnostics(report) {
    assertDiagnosticReport(report && typeof report === 'object' && !Array.isArray(report), 'JSON 객체가 아닙니다.');
    assertDiagnosticReport([1, 2].includes(report.reportVersion), '지원하지 않는 진단 보고서 버전입니다.');
    assertDiagnosticReport(ALLOWED_REPORT_SCOPES.has(report.scope), '지원하지 않는 진단 범위입니다.');
    assertDiagnosticReport(Number.isFinite(report.generatedAt), '생성 시각이 올바르지 않습니다.');
    assertDiagnosticReport(report.privacy?.promptContentIncluded === false, '프롬프트 내용이 포함된 보고서는 가져올 수 없습니다.');
    assertDiagnosticReport(report.privacy?.requestBodyIncluded === false, '요청 본문이 포함된 보고서는 가져올 수 없습니다.');
    assertDiagnosticReport(report.privacy?.correlationIdValuesIncluded === false, '요청 식별자 값이 포함된 보고서는 가져올 수 없습니다.');
    if (report.reportVersion >= 2) {
        assertDiagnosticReport(report.privacy?.chatIdValuesIncluded === false, '채팅 식별자 값이 포함된 보고서는 가져올 수 없습니다.');
    }
    assertDiagnosticReport(Array.isArray(report.snapshots), '스냅샷 목록이 없습니다.');
    assertDiagnosticReport(report.snapshots.length <= 10_000, '스냅샷이 10,000개를 초과합니다.');
    assertDiagnosticReport(
        Number.isInteger(report.summary?.snapshotCount)
        && report.summary.snapshotCount === report.snapshots.length,
        '요약의 스냅샷 수가 실제 목록과 다릅니다.',
    );
    if (report.scope === 'all-chat-timelines') {
        assertDiagnosticReport(Array.isArray(report.chats), '채팅별 요약이 없습니다.');
        assertDiagnosticReport(report.chats.length <= 1_000, '채팅이 1,000개를 초과합니다.');
        assertDiagnosticReport(
            Number.isInteger(report.summary?.chatCount)
            && report.summary.chatCount === report.chats.length,
            '요약의 채팅 수가 실제 목록과 다릅니다.',
        );
    }
    scanImportedValue(report, { nodes: 0 });
    return report;
}

export function parseTimelineDiagnostics(text, { maxBytes = 5_000_000 } = {}) {
    const input = String(text ?? '');
    assertDiagnosticReport(new TextEncoder().encode(input).length <= maxBytes, '진단 파일이 5MB를 초과합니다.');
    let parsed;
    try {
        parsed = JSON.parse(input);
    } catch {
        throw new Error('올바른 JSON 진단 보고서가 아닙니다.');
    }
    return validateTimelineDiagnostics(parsed);
}
