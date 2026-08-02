import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    evaluateSemanticSuggestionCorpus,
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

test('semantic evaluation corpus is explicitly synthetic and contains no obvious secrets', () => {
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
    assert.equal(first.complete, true);
    assert.equal(first.passed, true);
    assert.deepEqual(first.metrics, {
        usefulnessRate: 1,
        falsePositiveRate: 0,
        evidenceAccuracy: 1,
    });
    assert.deepEqual(first.counts, {
        expectedIssues: 3,
        suggestions: 3,
        matchedIssues: 3,
        falsePositives: 0,
        expectedEvidence: 6,
        evidence: 6,
        correctEvidence: 6,
        missingResults: 0,
    });
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
    assert.equal(report.metrics.usefulnessRate, 2 / 3);
    assert.equal(report.metrics.falsePositiveRate, 1 / 3);
    assert.equal(report.metrics.evidenceAccuracy, 1 / 3);
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
    assert.equal(report.counts.matchedIssues, 2);
    assert.equal(report.counts.falsePositives, 1);
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
