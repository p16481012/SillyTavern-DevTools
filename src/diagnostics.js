import { analyzeSnapshot, DEFAULT_RULE_SETTINGS } from './rules.js';

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
    const structured = snapshot.stats?.structured ?? {};
    return {
        id: snapshot.id,
        timestamp: snapshot.timestamp,
        api: snapshot.api ?? 'unknown',
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
            hasCorrelationId: Boolean(snapshot.capture?.correlationId),
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
    };
    const tokenValues = [];
    let fallbackCaptures = 0;
    let correlatedCaptures = 0;
    let redactedFields = 0;
    let omittedMedia = 0;
    let ruleFindings = 0;

    for (const snapshot of snapshots) {
        increment(apiCounts, snapshot.api);
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
        if (Number.isFinite(snapshot.tokens.prompt)) tokenValues.push(snapshot.tokens.prompt);
        if (Number.isFinite(snapshot.rules.total)) ruleFindings += snapshot.rules.total;
        for (const key of Object.keys(ruleSeverityCounts)) {
            ruleSeverityCounts[key] += snapshot.rules.severity[key] ?? 0;
        }
    }

    const firstToken = tokenValues[0] ?? null;
    const lastToken = tokenValues.at(-1) ?? null;
    return {
        reportVersion: 1,
        generatedAt,
        scope: 'current-chat-timeline',
        privacy: {
            promptContentIncluded: false,
            requestBodyIncluded: false,
            correlationIdValuesIncluded: false,
        },
        summary: {
            snapshotCount: snapshots.length,
            firstTimestamp: snapshots[0]?.timestamp ?? null,
            lastTimestamp: snapshots.at(-1)?.timestamp ?? null,
            apiCounts,
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

export function serializeTimelineDiagnostics(timeline, format = 'json', options = {}) {
    const report = buildTimelineDiagnostics(timeline, options);
    if (format === 'json') {
        return JSON.stringify(report, null, 2);
    }

    const summary = report.summary;
    const snapshotRows = report.snapshots.map((snapshot) => (
        `| ${new Date(snapshot.timestamp).toISOString()} | ${snapshot.api} | ${snapshot.model ?? '미확인'} | ` +
        `${snapshot.tokens.prompt ?? '미확인'} | ${snapshot.capture.stage ?? '미확인'} | ` +
        `${snapshot.capture.correlationMethod ?? '미확인'} | ${snapshot.rules.total ?? '실패'} |`
    ));
    return [
        '# ST DevTools 타임라인 진단 보고서',
        '',
        `- 생성 시각: ${new Date(report.generatedAt).toISOString()}`,
        `- 범위: 현재 채팅 타임라인 ${summary.snapshotCount}개`,
        '- 개인정보 보호: 프롬프트 내용·요청 본문·요청 식별자 값은 포함하지 않음',
        `- API: ${formatCounts(summary.apiCounts)}`,
        `- 캡처 경계: ${formatCounts(summary.captureStageCounts)}`,
        `- 연결 방식: ${formatCounts(summary.correlationMethodCounts)}`,
        `- 대체 캡처: ${summary.fallbackCaptures}`,
        `- 민감 필드 제거: ${summary.redactedFields}`,
        `- 미디어 데이터 생략: ${summary.omittedMedia}`,
        `- 구조화 입력: tool schema ${summary.structuredTotals.toolSchemas} · tool call ${summary.structuredTotals.toolCalls} · tool result ${summary.structuredTotals.toolResults} · multimodal ${summary.structuredTotals.multimodalParts}`,
        `- 토큰: 최소 ${summary.tokens.minimum ?? '미확인'} · 최대 ${summary.tokens.maximum ?? '미확인'} · 평균 ${summary.tokens.average ?? '미확인'} · 첫→마지막 변화 ${summary.tokens.delta ?? '미확인'}`,
        `- 규칙 결과: ${summary.ruleFindings}개 (${formatCounts(summary.ruleSeverityCounts)})`,
        '',
        '## 스냅샷',
        '',
        '| 시각 | API | 모델 | 토큰 | 캡처 경계 | 연결 방식 | 규칙 |',
        '| --- | --- | --- | ---: | --- | --- | ---: |',
        ...snapshotRows,
        '',
    ].join('\n');
}
