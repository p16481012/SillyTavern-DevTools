import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    evaluateSemanticSuggestionCorpus,
    SEMANTIC_EVALUATION_CORPUS_VERSION,
    SEMANTIC_EVALUATION_LIMITS,
    SemanticEvaluationError,
} from '../src/semantic-evaluation.js';
import { validateSemanticResponse } from '../src/semantic-inspector.js';

const corpus = JSON.parse(readFileSync(
    new URL('./fixtures/semantic-evaluation-corpus.json', import.meta.url),
    'utf8',
));

function prepared(entry) {
    return {
        kind: 'semantic-inspection-prepared',
        version: 1,
        requestDigest: entry.requestDigest,
        request: entry.request,
    };
}

function validateReference(entry, response = entry.referenceResponse) {
    return validateSemanticResponse(JSON.stringify(response), prepared(entry));
}

function referenceResults() {
    return Object.fromEntries(corpus.cases.map((entry) => [
        entry.id,
        validateReference(entry),
    ]));
}

function responseClone(caseId) {
    const entry = corpus.cases.find(({ id }) => id === caseId);
    assert.ok(entry, caseId);
    return {
        entry,
        response: structuredClone(entry.referenceResponse),
    };
}

function falsePositiveResult(entry) {
    const targetId = entry.request.targets[0].targetId;
    const source = entry.request.sources[0];
    return validateReference(entry, {
        version: 1,
        suggestions: [{
            targetIds: [targetId],
            category: 'other',
            severity: 'info',
            title: 'Synthetic false positive',
            summary: 'This compatible control was incorrectly reported.',
            rationale: 'The cited source does not establish a conflict.',
            confidence: 0.4,
            sourceIds: [source.id],
            atomIds: [],
            relationIds: [],
            evidence: [{
                sourceId: source.id,
                start: 0,
                end: source.content.length,
                quote: source.content,
            }],
        }],
    });
}

test('semantic evaluation corpus is explicitly synthetic and contains no obvious secrets', () => {
    assert.equal(corpus.version, SEMANTIC_EVALUATION_CORPUS_VERSION);
    assert.equal(corpus.version, 2);
    assert.equal(corpus.provenance, 'purpose-written-synthetic');
    assert.deepEqual(corpus.privacy, {
        synthetic: true,
        containsUserContent: false,
        containsSecrets: false,
    });
    assert.equal(corpus.cases.length >= 5, true);

    const evaluationText = corpus.cases.flatMap((entry) => [
        ...entry.request.sources.map(({ content }) => content),
        ...entry.referenceResponse.suggestions.flatMap((suggestion) => [
            suggestion.title,
            suggestion.summary,
            suggestion.rationale,
            ...suggestion.evidence.map(({ quote }) => quote),
        ]),
    ]).join('\n');
    assert.doesNotMatch(evaluationText, /sk-(?:live|proj)-[a-z0-9]/iu);
    assert.doesNotMatch(evaluationText, /-----BEGIN [A-Z ]+ PRIVATE KEY-----/u);
    assert.doesNotMatch(evaluationText, /bearer\s+[a-z0-9._-]+/iu);
    assert.doesNotMatch(evaluationText, /https?:\/\//iu);
    assert.doesNotMatch(evaluationText, /[\w.+-]+@[\w.-]+\.[a-z]{2,}/iu);
    assert.doesNotMatch(evaluationText, /(?:\d{1,3}\.){3}\d{1,3}/u);
    for (const entry of corpus.cases) {
        assert.match(entry.id, /^[a-z][a-z0-9-]+$/u);
        assert.equal('chatId' in entry.request, false);
        assert.equal('payload' in entry.request, false);
    }
});

test('validated reference suggestions pass deterministic usefulness, false-positive, and evidence gates', () => {
    const first = evaluateSemanticSuggestionCorpus(corpus, referenceResults());
    const second = evaluateSemanticSuggestionCorpus(corpus, referenceResults());

    assert.deepEqual(first, second);
    assert.equal(first.version, SEMANTIC_EVALUATION_CORPUS_VERSION);
    assert.equal(first.complete, true);
    assert.equal(first.passed, true);
    assert.deepEqual(first.metrics, {
        usefulnessRate: 1,
        falsePositiveRate: 0,
        evidenceAccuracy: 1,
    });
    assert.deepEqual(first.counts, {
        expectedIssues: 9,
        suggestions: 9,
        matchedIssues: 9,
        falsePositives: 0,
        expectedEvidence: 18,
        evidence: 18,
        correctEvidence: 18,
        missingResults: 0,
    });
    assert.equal(first.releaseGates.configuredCount, 6);
    assert.equal(first.releaseGates.passedCount, 6);
    assert.equal(first.releaseGates.failedCount, 0);
    assert.deepEqual(first.releaseGates.failures, []);
    assert.equal(first.releaseGates.axes.every(({ passed }) => passed), true);
    assert.deepEqual(first.failures, []);
    assert.equal(Object.isFrozen(first), true);
    assert.equal(Object.isFrozen(first.cases), true);
});

test('regression report fails each quality gate for missed, spurious, and irrelevant suggestions', () => {
    const results = referenceResults();

    const language = responseClone('language-conflict');
    language.response.suggestions[0].evidence = [{
        sourceId: 'source:language-a',
        start: 0,
        end: 1,
        quote: '한',
    }];
    results[language.entry.id] = validateReference(language.entry, language.response);

    results['detail-ambiguity'] = { suggestions: [] };
    results['priority-collision'] = { suggestions: [] };

    const compatible = responseClone('compatible-style');
    compatible.response.suggestions.push({
        targetIds: ['cluster:eval-style'],
        category: 'other',
        severity: 'info',
        title: 'A conflict that is not present',
        summary: 'These compatible style rules were incorrectly reported.',
        rationale: 'The evidence does not establish an incompatibility.',
        confidence: 0.4,
        sourceIds: ['source:style-a'],
        atomIds: [],
        relationIds: [],
        evidence: [{
            sourceId: 'source:style-a',
            start: 0,
            end: 19,
            quote: 'Use clear headings.',
        }],
    });
    results[compatible.entry.id] = validateReference(compatible.entry, compatible.response);

    const report = evaluateSemanticSuggestionCorpus(corpus, results);

    assert.equal(report.complete, true);
    assert.equal(report.passed, false);
    assert.equal(report.metrics.usefulnessRate, 7 / 9);
    assert.equal(report.metrics.falsePositiveRate, 1 / 8);
    assert.equal(report.metrics.evidenceAccuracy, 2 / 3);
    assert.deepEqual(report.failures, [
        'usefulness-below-threshold',
        'false-positive-rate-above-threshold',
        'evidence-accuracy-below-threshold',
    ]);
});

test('missing cases cannot pass and unsafe or unknown corpus inputs fail closed', () => {
    const incomplete = referenceResults();
    delete incomplete['alternative-language-options'];
    const report = evaluateSemanticSuggestionCorpus(corpus, incomplete);
    assert.equal(report.complete, false);
    assert.equal(report.passed, false);
    assert.equal(report.counts.missingResults, 1);
    assert.equal(report.failures.includes('missing-results'), true);

    const unsafe = structuredClone(corpus);
    unsafe.privacy.containsUserContent = true;
    assert.throws(
        () => evaluateSemanticSuggestionCorpus(unsafe, referenceResults()),
        (error) => error instanceof SemanticEvaluationError
            && error.reason === 'unsafe-corpus-provenance',
    );
    assert.throws(
        () => evaluateSemanticSuggestionCorpus(corpus, {
            ...referenceResults(),
            unknown: { suggestions: [] },
        }),
        (error) => error instanceof SemanticEvaluationError
            && error.reason === 'unknown-or-duplicate-result',
    );
});

test('over-broad target or source attribution is not counted as a correct issue', () => {
    const results = referenceResults();
    const language = responseClone('language-conflict');
    language.response.suggestions[0].sourceIds.push('source:language-context');
    results[language.entry.id] = validateReference(language.entry, language.response);

    const report = evaluateSemanticSuggestionCorpus(corpus, results);

    assert.equal(report.passed, false);
    assert.equal(report.counts.matchedIssues, 8);
    assert.equal(report.counts.falsePositives, 1);
});

test('condition, exception, tone, identity, safety, and memory each have positive and negative controls', () => {
    const pairs = [
        ['conditional-same-branch-conflict', 'conditional-branches-compatible'],
        ['exception-scope-conflict', 'exception-narrows-default-compatible'],
        ['tone-polarity-conflict', 'tone-traits-compatible'],
        ['assistant-role-conflict', 'participant-roles-compatible'],
        ['safety-disclosure-conflict', 'safety-redaction-compatible'],
        ['memory-history-conflict', 'memory-scopes-compatible'],
    ];

    const expandedCases = [];
    assert.deepEqual(
        corpus.releaseGates.map(({ axis, positiveCaseId, negativeCaseId }) => (
            [axis, positiveCaseId, negativeCaseId]
        )),
        [
            ['condition', ...pairs[0]],
            ['exception', ...pairs[1]],
            ['tone', ...pairs[2]],
            ['identity', ...pairs[3]],
            ['safety', ...pairs[4]],
            ['memory', ...pairs[5]],
        ],
    );
    const hasKoreanSource = (entry) => entry.request.sources.some(
        ({ content }) => /\p{Script=Hangul}/u.test(content),
    );
    for (const [positiveId, negativeId] of pairs) {
        const positive = corpus.cases.find(({ id }) => id === positiveId);
        const negative = corpus.cases.find(({ id }) => id === negativeId);
        assert.ok(positive, positiveId);
        assert.ok(negative, negativeId);
        assert.equal(positive.expectedIssues.length, 1, positiveId);
        assert.deepEqual(positive.expectedIssues[0].categories, ['conflict'], positiveId);
        assert.equal(positive.referenceResponse.suggestions.length, 1, positiveId);
        assert.equal(negative.expectedIssues.length, 0, negativeId);
        assert.equal(negative.referenceResponse.suggestions.length, 0, negativeId);
        assert.notEqual(hasKoreanSource(positive), hasKoreanSource(negative), positiveId);
        expandedCases.push(positive, negative);
    }
    assert.equal(expandedCases.filter(hasKoreanSource).length, 6);
    assert.equal(expandedCases.filter((entry) => !hasKoreanSource(entry)).length, 6);
});

test('each gated positive case must exact-match even when aggregate rates still pass', () => {
    for (const gate of corpus.releaseGates) {
        const results = referenceResults();
        results[gate.positiveCaseId] = { suggestions: [] };

        const report = evaluateSemanticSuggestionCorpus(corpus, results);

        assert.equal(report.metrics.usefulnessRate >= corpus.thresholds.minimumUsefulnessRate, true);
        assert.equal(report.metrics.evidenceAccuracy >= corpus.thresholds.minimumEvidenceAccuracy, true);
        assert.equal(report.metrics.falsePositiveRate, 0);
        assert.equal(report.passed, false, gate.axis);
        assert.deepEqual(
            report.failures,
            [`release-gate-positive-not-exact:${gate.axis}`],
            gate.axis,
        );
        const axis = report.releaseGates.axes.find(({ axis: name }) => name === gate.axis);
        assert.equal(axis.positive.exactIssueMatch, false, gate.axis);
        assert.equal(axis.positive.completeEvidenceMatch, false, gate.axis);
        assert.equal(axis.negative.noSuggestions, true, gate.axis);
    }
});

test('each gated positive case requires every evidence pair even when aggregate accuracy passes', () => {
    for (const gate of corpus.releaseGates) {
        const results = referenceResults();
        const positive = responseClone(gate.positiveCaseId);
        const firstEvidence = positive.response.suggestions[0].evidence[0];
        const source = positive.entry.request.sources.find(
            ({ id }) => id === firstEvidence.sourceId,
        );
        firstEvidence.start = 0;
        firstEvidence.end = 1;
        firstEvidence.quote = source.content.slice(0, 1);
        results[gate.positiveCaseId] = validateReference(
            positive.entry,
            positive.response,
        );

        const report = evaluateSemanticSuggestionCorpus(corpus, results);

        assert.equal(report.metrics.evidenceAccuracy >= corpus.thresholds.minimumEvidenceAccuracy, true);
        assert.equal(report.passed, false, gate.axis);
        assert.deepEqual(
            report.failures,
            [`release-gate-positive-evidence-not-complete:${gate.axis}`],
            gate.axis,
        );
        const axis = report.releaseGates.axes.find(({ axis: name }) => name === gate.axis);
        assert.equal(axis.positive.exactIssueMatch, true, gate.axis);
        assert.equal(axis.positive.completeEvidenceMatch, false, gate.axis);
        assert.equal(axis.positive.correctEvidenceCount, 1, gate.axis);
    }
});

test('each gated negative control must return no suggestions independent of aggregate threshold', () => {
    const relaxedCorpus = structuredClone(corpus);
    relaxedCorpus.thresholds.maximumFalsePositiveRate = 0.2;
    for (const gate of corpus.releaseGates) {
        const results = referenceResults();
        const negative = corpus.cases.find(({ id }) => id === gate.negativeCaseId);
        results[gate.negativeCaseId] = falsePositiveResult(negative);

        const report = evaluateSemanticSuggestionCorpus(relaxedCorpus, results);

        assert.equal(
            report.metrics.falsePositiveRate
                <= relaxedCorpus.thresholds.maximumFalsePositiveRate,
            true,
        );
        assert.equal(report.metrics.usefulnessRate, 1);
        assert.equal(report.metrics.evidenceAccuracy >= corpus.thresholds.minimumEvidenceAccuracy, true);
        assert.equal(report.passed, false, gate.axis);
        assert.deepEqual(
            report.failures,
            [`release-gate-negative-not-empty:${gate.axis}`],
            gate.axis,
        );
        const axis = report.releaseGates.axes.find(({ axis: name }) => name === gate.axis);
        assert.equal(axis.positive.exactIssueMatch, true, gate.axis);
        assert.equal(axis.positive.completeEvidenceMatch, true, gate.axis);
        assert.equal(axis.negative.noSuggestions, false, gate.axis);
    }
});

test('v2 requires release gates while legacy v1 stays explicit and compatible', () => {
    const legacyCorpus = structuredClone(corpus);
    legacyCorpus.version = 1;
    delete legacyCorpus.releaseGates;
    const legacyResults = referenceResults();
    legacyResults['conditional-same-branch-conflict'] = { suggestions: [] };
    const legacyReport = evaluateSemanticSuggestionCorpus(legacyCorpus, legacyResults);
    assert.equal(legacyReport.passed, true);
    assert.deepEqual(legacyReport.releaseGates, {
        configuredCount: 0,
        passedCount: 0,
        failedCount: 0,
        failures: [],
        axes: [],
    });

    const legacyWithReleaseGates = structuredClone(corpus);
    legacyWithReleaseGates.version = 1;
    assert.throws(
        () => evaluateSemanticSuggestionCorpus(legacyWithReleaseGates, referenceResults()),
        (error) => error instanceof SemanticEvaluationError
            && error.reason === 'release-gates-require-v2',
    );

    const v2WithoutReleaseGates = structuredClone(corpus);
    delete v2WithoutReleaseGates.releaseGates;
    assert.throws(
        () => evaluateSemanticSuggestionCorpus(v2WithoutReleaseGates, referenceResults()),
        (error) => error instanceof SemanticEvaluationError
            && error.reason === 'missing-release-gates',
    );

    const unknownCase = structuredClone(corpus);
    unknownCase.releaseGates[0].positiveCaseId = 'missing-case';
    assert.throws(
        () => evaluateSemanticSuggestionCorpus(unknownCase, referenceResults()),
        (error) => error instanceof SemanticEvaluationError
            && error.reason === 'unknown-release-gate-case:condition',
    );

    const reversedPolarity = structuredClone(corpus);
    reversedPolarity.releaseGates[0].positiveCaseId = 'conditional-branches-compatible';
    reversedPolarity.releaseGates[0].negativeCaseId = 'conditional-same-branch-conflict';
    assert.throws(
        () => evaluateSemanticSuggestionCorpus(reversedPolarity, referenceResults()),
        (error) => error instanceof SemanticEvaluationError
            && error.reason === 'invalid-release-gate-positive:condition',
    );

    const duplicateAxis = structuredClone(corpus);
    duplicateAxis.releaseGates[1].axis = 'condition';
    assert.throws(
        () => evaluateSemanticSuggestionCorpus(duplicateAxis, referenceResults()),
        (error) => error instanceof SemanticEvaluationError
            && error.reason === 'duplicate-release-gate-axis:condition',
    );
});

test('issue pairing maximizes evidence matches when classification fields are identical', () => {
    const pairingCorpus = {
        kind: corpus.kind,
        version: 1,
        provenance: corpus.provenance,
        privacy: { ...corpus.privacy },
        thresholds: {
            minimumUsefulnessRate: 1,
            maximumFalsePositiveRate: 0,
            minimumEvidenceAccuracy: 1,
        },
        cases: [{
            id: 'evidence-pairing',
            expectedIssues: [
                {
                    id: 'issue:first',
                    targetIds: ['target:shared'],
                    categories: ['conflict'],
                    sourceIds: ['source:shared'],
                    evidence: [{ sourceId: 'source:shared', start: 0, end: 10 }],
                },
                {
                    id: 'issue:second',
                    targetIds: ['target:shared'],
                    categories: ['conflict'],
                    sourceIds: ['source:shared'],
                    evidence: [{ sourceId: 'source:shared', start: 20, end: 30 }],
                },
            ],
        }],
    };
    const pairingResults = {
        'evidence-pairing': {
            suggestions: [
                {
                    targetIds: ['target:shared'],
                    category: 'conflict',
                    sourceIds: ['source:shared'],
                    evidence: [{ sourceId: 'source:shared', start: 0, end: 10 }],
                },
                {
                    targetIds: ['target:shared'],
                    category: 'conflict',
                    sourceIds: ['source:shared'],
                    evidence: [{ sourceId: 'source:shared', start: 20, end: 30 }],
                },
            ],
        },
    };

    const report = evaluateSemanticSuggestionCorpus(pairingCorpus, pairingResults);

    assert.equal(report.passed, true);
    assert.equal(report.counts.matchedIssues, 2);
    assert.equal(report.counts.correctEvidence, 2);
    assert.equal(report.metrics.evidenceAccuracy, 1);
});

test('reference evidence uses exact source slices and mirrors expected ranges', () => {
    for (const entry of corpus.cases) {
        const sources = new Map(entry.request.sources.map((source) => [source.id, source]));
        const referenceEvidence = entry.referenceResponse.suggestions.flatMap(
            (suggestion) => suggestion.evidence,
        );
        const expectedEvidence = entry.expectedIssues.flatMap((issue) => issue.evidence);

        for (const evidence of referenceEvidence) {
            const source = sources.get(evidence.sourceId);
            assert.ok(source, `${entry.id}:${evidence.sourceId}`);
            assert.equal(
                source.content.slice(evidence.start, evidence.end),
                evidence.quote,
                `${entry.id}:${evidence.sourceId}`,
            );
        }
        assert.deepEqual(
            referenceEvidence.map(({ sourceId, start, end }) => ({ sourceId, start, end })),
            expectedEvidence,
            entry.id,
        );
    }
});

test('evaluation corpus and result work stay bounded before matching', () => {
    const wrongProvenance = structuredClone(corpus);
    wrongProvenance.provenance = 'unknown-source';
    assert.throws(
        () => evaluateSemanticSuggestionCorpus(wrongProvenance, {}),
        (error) => error instanceof SemanticEvaluationError
            && error.reason === 'unsupported-corpus',
    );

    const unknownThreshold = structuredClone(corpus);
    unknownThreshold.thresholds.privatePrompt = 'must-not-return';
    assert.throws(
        () => evaluateSemanticSuggestionCorpus(unknownThreshold, referenceResults()),
        (error) => error instanceof SemanticEvaluationError
            && error.reason === 'unknown-threshold-field',
    );

    const oversizedExpectedId = structuredClone(corpus);
    oversizedExpectedId.cases[0].expectedIssues[0].id = 'x'.repeat(129);
    assert.throws(
        () => evaluateSemanticSuggestionCorpus(oversizedExpectedId, {}),
        (error) => error instanceof SemanticEvaluationError
            && error.reason.startsWith('invalid-expected-issue:'),
    );

    const oversizedSourceId = structuredClone(corpus);
    oversizedSourceId.cases[0].expectedIssues[0].evidence[0].sourceId = 'x'.repeat(257);
    assert.throws(
        () => evaluateSemanticSuggestionCorpus(oversizedSourceId, {}),
        (error) => error instanceof SemanticEvaluationError
            && error.reason.startsWith('invalid-expected-evidence:'),
    );

    const oversizedCategory = referenceResults();
    oversizedCategory['language-conflict'] = structuredClone(
        oversizedCategory['language-conflict'],
    );
    oversizedCategory['language-conflict'].suggestions[0].category = 'x'.repeat(257);
    assert.throws(
        () => evaluateSemanticSuggestionCorpus(corpus, oversizedCategory),
        (error) => error instanceof SemanticEvaluationError
            && error.reason.startsWith('invalid-suggestion-category:'),
    );

    const oversizedResultMap = new Map(Array.from(
        { length: SEMANTIC_EVALUATION_LIMITS.cases + 1 },
        (_, index) => [`case-${index}`, { suggestions: [] }],
    ));
    assert.throws(
        () => evaluateSemanticSuggestionCorpus(corpus, oversizedResultMap),
        (error) => error instanceof SemanticEvaluationError
            && error.reason === 'too-many-results',
    );

    const oversizedCases = structuredClone(corpus);
    oversizedCases.cases = Array.from(
        { length: SEMANTIC_EVALUATION_LIMITS.cases + 1 },
        (_, index) => ({ id: `case-${index}`, expectedIssues: [] }),
    );
    assert.throws(
        () => evaluateSemanticSuggestionCorpus(oversizedCases, {}),
        (error) => error instanceof SemanticEvaluationError
            && error.reason === 'invalid-cases',
    );

    const tooManySuggestions = referenceResults();
    const referenceSuggestion = tooManySuggestions['language-conflict'].suggestions[0];
    tooManySuggestions['language-conflict'] = {
        suggestions: Array.from(
            { length: SEMANTIC_EVALUATION_LIMITS.suggestionsPerCase + 1 },
            () => structuredClone(referenceSuggestion),
        ),
    };
    assert.throws(
        () => evaluateSemanticSuggestionCorpus(corpus, tooManySuggestions),
        (error) => error instanceof SemanticEvaluationError
            && error.reason === 'invalid-result:language-conflict',
    );

    const tooMuchEvidence = referenceResults();
    const oversizedEvidenceSuggestion = structuredClone(
        tooMuchEvidence['language-conflict'].suggestions[0],
    );
    oversizedEvidenceSuggestion.evidence = Array.from(
        { length: SEMANTIC_EVALUATION_LIMITS.evidencePerRecord + 1 },
        () => ({ sourceId: 'source:language-a', start: 0, end: 1 }),
    );
    tooMuchEvidence['language-conflict'] = {
        suggestions: [oversizedEvidenceSuggestion],
    };
    assert.throws(
        () => evaluateSemanticSuggestionCorpus(corpus, tooMuchEvidence),
        (error) => error instanceof SemanticEvaluationError
            && error.reason === 'invalid-suggestion-evidence:language-conflict:0',
    );
});
