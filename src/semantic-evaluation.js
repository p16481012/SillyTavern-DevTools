export const SEMANTIC_EVALUATION_CORPUS_KIND = (
    'st-devtools-semantic-evaluation-corpus'
);
export const SEMANTIC_EVALUATION_CORPUS_VERSION = 1;

export const SEMANTIC_EVALUATION_DEFAULT_THRESHOLDS = Object.freeze({
    minimumUsefulnessRate: 0.8,
    maximumFalsePositiveRate: 0.1,
    minimumEvidenceAccuracy: 0.8,
});

const SEMANTIC_EVALUATION_THRESHOLD_KEYS = Object.freeze(
    Object.keys(SEMANTIC_EVALUATION_DEFAULT_THRESHOLDS),
);

export const SEMANTIC_EVALUATION_LIMITS = Object.freeze({
    cases: 64,
    expectedIssuesPerCase: 32,
    suggestionsPerCase: 32,
    idsPerRecord: 256,
    evidencePerRecord: 64,
    totalExpectedIssues: 1_024,
    totalSuggestions: 1_024,
    totalEvidence: 8_192,
});

const MINIMUM_EVIDENCE_INTERSECTION_OVER_UNION = 0.5;

export class SemanticEvaluationError extends Error {
    constructor(reason) {
        super(`SEMANTIC_EVALUATION_INVALID: ${reason}`);
        this.name = 'SemanticEvaluationError';
        this.code = 'SEMANTIC_EVALUATION_INVALID';
        this.reason = reason;
    }
}

function fail(reason) {
    throw new SemanticEvaluationError(reason);
}

function isRecord(value) {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const child of Object.values(value)) deepFreeze(child);
    }
    return value;
}

function finiteRate(value, key) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
        fail(`invalid-${key}`);
    }
    return value;
}

function stringList(value, reason, { allowEmpty = false } = {}) {
    if (
        !Array.isArray(value)
        || (!allowEmpty && value.length === 0)
        || value.length > SEMANTIC_EVALUATION_LIMITS.idsPerRecord
    ) {
        fail(reason);
    }
    const result = value.map((item) => {
        if (typeof item !== 'string' || item.length === 0 || item.length > 256) fail(reason);
        return item;
    });
    if (new Set(result).size !== result.length) fail(reason);
    return result;
}

function evidenceList(value, reason, { allowEmpty = false } = {}) {
    if (
        !Array.isArray(value)
        || (!allowEmpty && value.length === 0)
        || value.length > SEMANTIC_EVALUATION_LIMITS.evidencePerRecord
    ) {
        fail(reason);
    }
    return value.map((entry) => {
        if (
            !isRecord(entry)
            || typeof entry.sourceId !== 'string'
            || entry.sourceId.length === 0
            || entry.sourceId.length > 256
            || !Number.isSafeInteger(entry.start)
            || !Number.isSafeInteger(entry.end)
            || entry.start < 0
            || entry.end <= entry.start
        ) {
            fail(reason);
        }
        return {
            sourceId: entry.sourceId,
            start: entry.start,
            end: entry.end,
        };
    });
}

function normalizeExpectedIssue(value, caseId) {
    if (
        !isRecord(value)
        || typeof value.id !== 'string'
        || value.id.length === 0
        || value.id.length > 128
    ) {
        fail(`invalid-expected-issue:${caseId}`);
    }
    return {
        id: value.id,
        targetIds: stringList(
            value.targetIds,
            `invalid-expected-targets:${caseId}:${value.id}`,
        ),
        categories: stringList(
            value.categories,
            `invalid-expected-categories:${caseId}:${value.id}`,
        ),
        sourceIds: stringList(
            value.sourceIds,
            `invalid-expected-sources:${caseId}:${value.id}`,
        ),
        evidence: evidenceList(
            value.evidence,
            `invalid-expected-evidence:${caseId}:${value.id}`,
        ),
    };
}

function normalizeCorpus(corpus) {
    if (
        !isRecord(corpus)
        || corpus.kind !== SEMANTIC_EVALUATION_CORPUS_KIND
        || corpus.version !== SEMANTIC_EVALUATION_CORPUS_VERSION
        || corpus.provenance !== 'purpose-written-synthetic'
    ) {
        fail('unsupported-corpus');
    }
    if (
        !isRecord(corpus.privacy)
        || corpus.privacy.synthetic !== true
        || corpus.privacy.containsUserContent !== false
        || corpus.privacy.containsSecrets !== false
    ) {
        fail('unsafe-corpus-provenance');
    }
    if (
        !Array.isArray(corpus.cases)
        || corpus.cases.length === 0
        || corpus.cases.length > SEMANTIC_EVALUATION_LIMITS.cases
    ) {
        fail('invalid-cases');
    }
    if (
        corpus.thresholds !== undefined
        && !isRecord(corpus.thresholds)
    ) {
        fail('invalid-thresholds');
    }
    const providedThresholds = corpus.thresholds ?? {};
    if (
        Object.keys(providedThresholds).some(
            (key) => !SEMANTIC_EVALUATION_THRESHOLD_KEYS.includes(key),
        )
    ) {
        fail('unknown-threshold-field');
    }
    const thresholds = {
        minimumUsefulnessRate: providedThresholds.minimumUsefulnessRate
            ?? SEMANTIC_EVALUATION_DEFAULT_THRESHOLDS.minimumUsefulnessRate,
        maximumFalsePositiveRate: providedThresholds.maximumFalsePositiveRate
            ?? SEMANTIC_EVALUATION_DEFAULT_THRESHOLDS.maximumFalsePositiveRate,
        minimumEvidenceAccuracy: providedThresholds.minimumEvidenceAccuracy
            ?? SEMANTIC_EVALUATION_DEFAULT_THRESHOLDS.minimumEvidenceAccuracy,
    };
    finiteRate(thresholds.minimumUsefulnessRate, 'minimum-usefulness-rate');
    finiteRate(thresholds.maximumFalsePositiveRate, 'maximum-false-positive-rate');
    finiteRate(thresholds.minimumEvidenceAccuracy, 'minimum-evidence-accuracy');

    const caseIds = new Set();
    let totalExpectedIssues = 0;
    let totalExpectedEvidence = 0;
    const cases = corpus.cases.map((entry) => {
        if (
            !isRecord(entry)
            || typeof entry.id !== 'string'
            || entry.id.length === 0
            || entry.id.length > 128
            || caseIds.has(entry.id)
            || !Array.isArray(entry.expectedIssues)
            || entry.expectedIssues.length
                > SEMANTIC_EVALUATION_LIMITS.expectedIssuesPerCase
        ) {
            fail('invalid-case');
        }
        caseIds.add(entry.id);
        const expectedIssues = entry.expectedIssues.map((issue) => (
            normalizeExpectedIssue(issue, entry.id)
        ));
        if (new Set(expectedIssues.map(({ id }) => id)).size !== expectedIssues.length) {
            fail(`duplicate-expected-issue:${entry.id}`);
        }
        totalExpectedIssues += expectedIssues.length;
        totalExpectedEvidence += expectedIssues.reduce(
            (total, issue) => total + issue.evidence.length,
            0,
        );
        if (
            totalExpectedIssues > SEMANTIC_EVALUATION_LIMITS.totalExpectedIssues
            || totalExpectedEvidence > SEMANTIC_EVALUATION_LIMITS.totalEvidence
        ) {
            fail('corpus-too-large');
        }
        return { id: entry.id, expectedIssues };
    });
    return { thresholds, cases, caseIds };
}

function* resultEntries(resultsByCase, maximumEntries) {
    if (resultsByCase instanceof Map) {
        let size;
        try {
            size = Object.getOwnPropertyDescriptor(Map.prototype, 'size')
                .get.call(resultsByCase);
        } catch {
            fail('invalid-results');
        }
        if (size > maximumEntries) fail('too-many-results');
        yield* Map.prototype.entries.call(resultsByCase);
        return;
    }
    if (!isRecord(resultsByCase)) fail('invalid-results');
    let count = 0;
    for (const caseId in resultsByCase) {
        let descriptor;
        try {
            descriptor = Object.getOwnPropertyDescriptor(resultsByCase, caseId);
        } catch {
            fail('invalid-results');
        }
        if (!descriptor) continue;
        if (!descriptor.enumerable || !('value' in descriptor)) {
            fail('invalid-results');
        }
        count += 1;
        if (count > maximumEntries) fail('too-many-results');
        yield [caseId, descriptor.value];
    }
}

function normalizeSuggestion(value, caseId, index) {
    if (!isRecord(value)) fail(`invalid-suggestion:${caseId}:${index}`);
    return {
        targetIds: stringList(
            value.targetIds,
            `invalid-suggestion-targets:${caseId}:${index}`,
        ),
        category: typeof value.category === 'string'
            && value.category.length > 0
            && value.category.length <= 256
            ? value.category
            : fail(`invalid-suggestion-category:${caseId}:${index}`),
        sourceIds: stringList(
            value.sourceIds,
            `invalid-suggestion-sources:${caseId}:${index}`,
        ),
        evidence: evidenceList(
            value.evidence,
            `invalid-suggestion-evidence:${caseId}:${index}`,
        ),
    };
}

function normalizeResults(resultsByCase, knownCaseIds) {
    const results = new Map();
    let totalSuggestions = 0;
    let totalEvidence = 0;
    for (const [caseId, value] of resultEntries(
        resultsByCase,
        knownCaseIds.size + 1,
    )) {
        if (
            typeof caseId !== 'string'
            || caseId.length === 0
            || caseId.length > 128
            || !knownCaseIds.has(caseId)
            || results.has(caseId)
        ) {
            fail('unknown-or-duplicate-result');
        }
        const suggestions = Array.isArray(value)
            ? value
            : (isRecord(value) ? value.suggestions : null);
        if (
            !Array.isArray(suggestions)
            || suggestions.length > SEMANTIC_EVALUATION_LIMITS.suggestionsPerCase
        ) {
            fail(`invalid-result:${caseId}`);
        }
        const normalizedSuggestions = suggestions.map((suggestion, index) => (
            normalizeSuggestion(suggestion, caseId, index)
        ));
        totalSuggestions += normalizedSuggestions.length;
        totalEvidence += normalizedSuggestions.reduce(
            (total, suggestion) => total + suggestion.evidence.length,
            0,
        );
        if (
            totalSuggestions > SEMANTIC_EVALUATION_LIMITS.totalSuggestions
            || totalEvidence > SEMANTIC_EVALUATION_LIMITS.totalEvidence
        ) {
            fail('results-too-large');
        }
        results.set(caseId, normalizedSuggestions);
    }
    return results;
}

function hasSameMembers(actual, expected) {
    if (actual.length !== expected.length) return false;
    const actualSet = new Set(actual);
    return expected.every((item) => actualSet.has(item));
}

function suggestionMatchesIssue(suggestion, issue) {
    return issue.categories.includes(suggestion.category)
        && hasSameMembers(suggestion.targetIds, issue.targetIds)
        && hasSameMembers(suggestion.sourceIds, issue.sourceIds);
}

function evidenceMatches(actual, expected) {
    if (actual.sourceId !== expected.sourceId) return false;
    const intersection = Math.max(
        0,
        Math.min(actual.end, expected.end) - Math.max(actual.start, expected.start),
    );
    const union = Math.max(actual.end, expected.end) - Math.min(actual.start, expected.start);
    return union > 0
        && intersection / union >= MINIMUM_EVIDENCE_INTERSECTION_OVER_UNION;
}

function maximumPairCount(left, right, predicate) {
    const rightMatches = new Array(right.length).fill(-1);
    const visit = (leftIndex, seen) => {
        for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
            if (seen.has(rightIndex) || !predicate(left[leftIndex], right[rightIndex])) continue;
            seen.add(rightIndex);
            if (
                rightMatches[rightIndex] < 0
                || visit(rightMatches[rightIndex], seen)
            ) {
                rightMatches[rightIndex] = leftIndex;
                return true;
            }
        }
        return false;
    };
    let count = 0;
    for (let index = 0; index < left.length; index += 1) {
        if (visit(index, new Set())) count += 1;
    }
    return { count, rightMatches };
}

function evaluateCase(entry, suggestions, missing) {
    const expectedIssues = entry.expectedIssues;
    const issueMatches = maximumPairCount(
        suggestions,
        expectedIssues,
        suggestionMatchesIssue,
    );
    let correctEvidenceCount = 0;
    for (let issueIndex = 0; issueIndex < expectedIssues.length; issueIndex += 1) {
        const suggestionIndex = issueMatches.rightMatches[issueIndex];
        if (suggestionIndex < 0) continue;
        correctEvidenceCount += maximumPairCount(
            suggestions[suggestionIndex].evidence,
            expectedIssues[issueIndex].evidence,
            evidenceMatches,
        ).count;
    }
    const expectedEvidenceCount = expectedIssues.reduce(
        (total, issue) => total + issue.evidence.length,
        0,
    );
    const evidenceCount = suggestions.reduce(
        (total, suggestion) => total + suggestion.evidence.length,
        0,
    );
    const falsePositiveCount = suggestions.length - issueMatches.count;
    const usefulnessRate = expectedIssues.length === 0
        ? 1
        : issueMatches.count / expectedIssues.length;
    const falsePositiveRate = suggestions.length === 0
        ? 0
        : falsePositiveCount / suggestions.length;
    const evidenceAccuracy = Math.max(expectedEvidenceCount, evidenceCount) === 0
        ? 1
        : correctEvidenceCount / Math.max(expectedEvidenceCount, evidenceCount);
    return {
        id: entry.id,
        missing,
        expectedIssueCount: expectedIssues.length,
        suggestionCount: suggestions.length,
        matchedIssueCount: issueMatches.count,
        falsePositiveCount,
        expectedEvidenceCount,
        evidenceCount,
        correctEvidenceCount,
        usefulnessRate,
        falsePositiveRate,
        evidenceAccuracy,
    };
}

export function evaluateSemanticSuggestionCorpus(corpus, resultsByCase) {
    const normalized = normalizeCorpus(corpus);
    const results = normalizeResults(resultsByCase, normalized.caseIds);
    const cases = normalized.cases.map((entry) => evaluateCase(
        entry,
        results.get(entry.id) ?? [],
        !results.has(entry.id),
    ));
    const counts = cases.reduce((total, entry) => ({
        expectedIssues: total.expectedIssues + entry.expectedIssueCount,
        suggestions: total.suggestions + entry.suggestionCount,
        matchedIssues: total.matchedIssues + entry.matchedIssueCount,
        falsePositives: total.falsePositives + entry.falsePositiveCount,
        expectedEvidence: total.expectedEvidence + entry.expectedEvidenceCount,
        evidence: total.evidence + entry.evidenceCount,
        correctEvidence: total.correctEvidence + entry.correctEvidenceCount,
        missingResults: total.missingResults + (entry.missing ? 1 : 0),
    }), {
        expectedIssues: 0,
        suggestions: 0,
        matchedIssues: 0,
        falsePositives: 0,
        expectedEvidence: 0,
        evidence: 0,
        correctEvidence: 0,
        missingResults: 0,
    });
    const metrics = {
        usefulnessRate: counts.expectedIssues === 0
            ? 1
            : counts.matchedIssues / counts.expectedIssues,
        falsePositiveRate: counts.suggestions === 0
            ? 0
            : counts.falsePositives / counts.suggestions,
        evidenceAccuracy: Math.max(counts.expectedEvidence, counts.evidence) === 0
            ? 1
            : counts.correctEvidence / Math.max(
                counts.expectedEvidence,
                counts.evidence,
            ),
    };
    const failures = [];
    if (counts.missingResults > 0) failures.push('missing-results');
    if (metrics.usefulnessRate < normalized.thresholds.minimumUsefulnessRate) {
        failures.push('usefulness-below-threshold');
    }
    if (metrics.falsePositiveRate > normalized.thresholds.maximumFalsePositiveRate) {
        failures.push('false-positive-rate-above-threshold');
    }
    if (metrics.evidenceAccuracy < normalized.thresholds.minimumEvidenceAccuracy) {
        failures.push('evidence-accuracy-below-threshold');
    }
    return deepFreeze({
        kind: 'st-devtools-semantic-evaluation-report',
        version: SEMANTIC_EVALUATION_CORPUS_VERSION,
        complete: counts.missingResults === 0,
        passed: failures.length === 0,
        thresholds: { ...normalized.thresholds },
        metrics,
        counts,
        failures,
        cases,
    });
}
