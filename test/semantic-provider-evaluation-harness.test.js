import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { SemanticInspector } from '../src/semantic-inspector.js';
import { createOfficialSemanticProviderEvaluationSuite } from '../src/semantic-provider-evaluation-corpus.js';
import {
    SEMANTIC_PROVIDER_EVALUATION_LIMITS,
    SemanticProviderEvaluationHarness,
    SemanticProviderEvaluationHarnessError,
} from '../src/semantic-provider-evaluation-harness.js';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

class EvaluationAdapter {
    constructor(responses, identity = {}) {
        this.responses = responses;
        this.calls = 0;
        this.activeCalls = 0;
        this.maximumActiveCalls = 0;
        this.currentIdentity = {
            status: 'available',
            provider: 'synthetic-provider',
            model: 'synthetic-model',
            routeKind: 'profile',
            connectionProfileId: 'opaque-profile-id-must-not-escape',
            ...identity,
        };
    }

    identity() {
        return { ...this.currentIdentity };
    }

    async generate() {
        const index = this.calls;
        this.calls += 1;
        this.activeCalls += 1;
        this.maximumActiveCalls = Math.max(
            this.maximumActiveCalls,
            this.activeCalls,
        );
        try {
            const response = this.responses[index];
            if (response instanceof Error) throw response;
            return JSON.stringify(response);
        } finally {
            this.activeCalls -= 1;
        }
    }
}

function referenceResponses(repetitions = 1) {
    const suite = createOfficialSemanticProviderEvaluationSuite();
    return Array.from({ length: repetitions }, () => (
        suite.corpus.cases.map(({ referenceResponse }) => referenceResponse)
    )).flat();
}

async function runSession(session, consent = async () => true) {
    while (session.status().status === 'ready') {
        await session.runNext({ requestConsent: consent });
    }
    return session.status();
}

test('official provider corpus is frozen, synthetic-only, bounded, and product-path annotated', () => {
    const suite = createOfficialSemanticProviderEvaluationSuite();
    assert.equal(Object.isFrozen(suite), true);
    assert.equal(Object.isFrozen(suite.corpus), true);
    assert.equal(suite.corpus.cases.length, 16);
    assert.deepEqual(suite.corpus.privacy, {
        synthetic: true,
        containsUserContent: false,
        containsSecrets: false,
    });
    assert.equal(
        suite.cases.some(({ pathKind }) => pathKind === 'structured-relation'),
        true,
    );
    assert.equal(
        suite.cases.some(({ pathKind }) => pathKind === 'structured-atom-bridge'),
        true,
    );
    assert.equal(
        suite.cases.some(({ pathKind }) => pathKind === 'source-bridge'),
        true,
    );
    assert.equal(
        suite.cases.some(({ pathKind }) => [
            'structured-atom',
            'source-closure-bridge',
        ].includes(pathKind)),
        false,
    );
    assert.equal(
        suite.cases.every(({ preparation }) => (
            preparation.snapshot.privacy.mode === 'full'
            && preparation.snapshot.sources.every(({ included }) => included === true)
        )),
        true,
    );
});

test('official suite publishes a stable versioned SHA-256 manifest', () => {
    const suite = createOfficialSemanticProviderEvaluationSuite();
    assert.deepEqual(suite.manifest, {
        schemaVersion: 1,
        corpusKind: suite.corpus.kind,
        corpusVersion: suite.corpus.version,
        caseCount: 16,
        caseIds: suite.cases.map(({ id }) => id),
        digestAlgorithm: 'SHA-256',
        digest: '902ac3947f9587e5d765a7932e5bd98b381ab554654faec79a1db600ec73fb66',
    });
    assert.equal(
        createHash('sha256').update(suite.canonicalManifest).digest('hex'),
        suite.manifest.digest,
    );
    const canonical = JSON.parse(suite.canonicalManifest);
    assert.equal(canonical.schemaVersion, 1);
    assert.equal(canonical.corpus.version, suite.corpus.version);
    assert.equal(canonical.cases.length, suite.manifest.caseCount);
});

test('runtime provider corpus keeps canonical case, source, and issue boundaries while resolving product targets', async () => {
    const canonical = JSON.parse(await readFile(
        new URL('./fixtures/semantic-evaluation-corpus.json', import.meta.url),
        'utf8',
    ));
    const suite = createOfficialSemanticProviderEvaluationSuite();
    assert.equal(suite.corpus.kind, canonical.kind);
    assert.equal(suite.corpus.version, canonical.version);
    assert.deepEqual(suite.corpus.privacy, canonical.privacy);
    assert.deepEqual(suite.corpus.thresholds, canonical.thresholds);
    assert.deepEqual(suite.corpus.releaseGates, canonical.releaseGates);
    assert.deepEqual(
        suite.cases.map(({ id }) => id),
        canonical.cases.map(({ id }) => id),
    );

    const canonicalById = new Map(canonical.cases.map((entry) => [entry.id, entry]));
    const runtimeCorpusById = new Map(
        suite.corpus.cases.map((entry) => [entry.id, entry]),
    );
    for (const entry of suite.cases) {
        const expected = canonicalById.get(entry.id);
        const actual = runtimeCorpusById.get(entry.id);
        assert.ok(expected);
        assert.ok(actual);
        assert.deepEqual(
            entry.preparation.snapshot.sources.map(({ id, content }) => ({ id, content })),
            expected.request.sources.map(({ id, content }) => ({ id, content })),
        );
        assert.deepEqual(
            actual.expectedIssues.map(({ targetIds: _targetIds, ...issue }) => issue),
            expected.expectedIssues.map(({ targetIds: _targetIds, ...issue }) => issue),
        );
        assert.deepEqual(
            actual.expectedIssues.map(({ targetIds }) => targetIds),
            actual.expectedIssues.map(() => entry.preparation.targetIds),
        );
        assert.equal(
            entry.preparation.targetIds[0].split(':', 1)[0],
            expected.request.targets[0].targetId.split(':', 1)[0],
        );
    }

    const language = suite.cases.find(({ id }) => id === 'language-conflict');
    const exception = suite.cases.find(
        ({ id }) => id === 'exception-narrows-default-compatible',
    );
    assert.deepEqual(language.preparation.targetIds, ['finding:language-conflict']);
    assert.match(exception.preparation.targetIds[0], /^cluster:cluster:language:/u);
    assert.equal(language.structuralGate.targetOrigin, 'product-analysis');
    assert.equal(exception.structuralGate.targetOrigin, 'product-analysis');
});

test('official suite structural gates exactly match the prepared product closure', async () => {
    const suite = createOfficialSemanticProviderEvaluationSuite();
    const corpusById = new Map(suite.corpus.cases.map((entry) => [entry.id, entry]));
    const adapter = new EvaluationAdapter([]);
    const inspector = new SemanticInspector({ adapter });
    const sorted = (values) => [...values].sort();

    for (const entry of suite.cases) {
        const prepared = await inspector.prepare({
            ...entry.preparation,
            responseTokenCap: 256,
        });
        const gate = entry.structuralGate;
        const corpusCase = corpusById.get(entry.id);
        assert.deepEqual(
            prepared.request.targets.map(({ targetId }) => targetId),
            gate.targetIds,
            `${entry.id}: target closure drifted`,
        );
        assert.deepEqual(
            sorted(prepared.request.sources.map(({ id }) => id)),
            sorted(gate.sourceIds),
            `${entry.id}: source closure drifted`,
        );
        assert.deepEqual(
            sorted(prepared.request.atoms.map(({ id }) => id)),
            sorted(gate.atomIds),
            `${entry.id}: atom closure drifted`,
        );
        assert.deepEqual(
            sorted(prepared.request.relations.map(({ id }) => id)),
            sorted(gate.relationIds),
            `${entry.id}: relation closure drifted`,
        );
        assert.deepEqual(
            sorted(corpusCase.request.atoms.map(({ id }) => id)),
            sorted(gate.atomIds),
        );
        assert.deepEqual(
            sorted(corpusCase.request.relations.map(({ id }) => id)),
            sorted(gate.relationIds),
        );

        if (entry.pathKind === 'structured-relation') {
            assert.equal(gate.targetOrigin, 'product-analysis');
            assert.ok(gate.relationIds.length > 0);
            assert.ok(gate.atomIds.length > 0);
            const [kind, ...idParts] = gate.targetIds[0].split(':');
            const id = idParts.join(':');
            const productTarget = kind === 'finding'
                ? entry.preparation.analysis.findings.find((record) => record.id === id)
                : entry.preparation.analysis.instructions.clusters.find(
                    (record) => record.id === id,
                );
            assert.ok(productTarget, `${entry.id}: product target was replaced by a bridge`);
            assert.notEqual(productTarget.ruleId, 'semantic-evaluation');
            assert.notEqual(productTarget.category, 'semantic-evaluation');
        } else if (entry.pathKind === 'structured-atom-bridge') {
            assert.equal(gate.targetOrigin, 'evaluation-bridge');
            assert.equal(gate.relationIds.length, 0);
            assert.ok(gate.atomIds.length > 0);
        } else {
            assert.equal(entry.pathKind, 'source-bridge');
            assert.equal(gate.targetOrigin, 'evaluation-bridge');
            assert.deepEqual(gate.relationIds, []);
            assert.deepEqual(gate.atomIds, []);
        }
    }
    assert.equal(adapter.calls, 0);
});

test('synthetic source and reference text contains no credential, URL, email, or IP material', () => {
    const suite = createOfficialSemanticProviderEvaluationSuite();
    const corpusById = new Map(suite.corpus.cases.map((entry) => [entry.id, entry]));
    const patterns = new Map([
        ['credential-token', /(?:AKIA|ASIA)[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/u],
        ['credential-assignment', /(?:api[_ -]?key|access[_ -]?token|password|secret)\s*[:=]\s*[^\s]+/iu],
        ['url', /(?:https?|ftp):\/\/|www\./iu],
        ['email', /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu],
        ['ipv4', /(?:^|[^\d])(?:\d{1,3}\.){3}\d{1,3}(?:$|[^\d])/u],
        ['ipv6', /(?:^|[^A-F0-9:])(?:[A-F0-9]{1,4}:){2,7}[A-F0-9]{1,4}(?:$|[^A-F0-9:])/iu],
    ]);

    for (const entry of suite.cases) {
        const corpusCase = corpusById.get(entry.id);
        const texts = [
            ...entry.preparation.snapshot.sources.map(({ content }) => content),
            ...corpusCase.referenceResponse.suggestions.flatMap((suggestion) => [
                suggestion.title,
                suggestion.summary,
                suggestion.rationale,
                ...suggestion.evidence.map(({ quote }) => quote),
            ]),
        ];
        for (const value of texts) {
            for (const [name, pattern] of patterns) {
                assert.equal(pattern.test(value), false, `${entry.id}: ${name}`);
            }
        }
    }
});

test('each approved case makes one fresh serial provider call and returns aggregate-only output', async () => {
    const adapter = new EvaluationAdapter(referenceResponses());
    const inspector = new SemanticInspector({ adapter });
    const harness = new SemanticProviderEvaluationHarness({ inspector });
    const session = harness.createSession({
        repetitions: 1,
        responseTokenCap: 512,
        requiredRouteKind: 'profile',
    });
    const approvals = [];
    const result = await runSession(session, async (request) => {
        approvals.push({
            caseId: request.caseId,
            requestDigest: request.requestDigest,
            checked: false,
        });
        approvals.at(-1).checked = true;
        return true;
    });

    assert.equal(result.status, 'complete');
    assert.equal(result.completedCalls, 16);
    assert.equal(result.totalCalls, 16);
    assert.equal(result.aggregate.passed, false);
    assert.equal(result.aggregate.smokePassed, true);
    assert.equal(result.aggregate.qualityEligible, false);
    assert.equal(result.aggregate.complete, true);
    assert.equal(approvals.length, 16);
    assert.equal(adapter.calls, 16);
    assert.equal(adapter.maximumActiveCalls, 1);
    assert.equal(result.persistsRawPrompt, false);
    assert.equal(result.persistsRawResponse, false);
    assert.equal(result.persistsEvidenceQuotes, false);
    const serialized = JSON.stringify(result);
    for (const forbidden of [
        '한국어로만 답변하세요',
        'Synthetic evaluation issue',
        'purpose-written synthetic case',
        'opaque-profile-id-must-not-escape',
        'quote',
        'rationale',
    ]) {
        assert.equal(serialized.includes(forbidden), false, forbidden);
    }
});

test('three repetitions bypass memory cache and make an independently consented call every time', async () => {
    const adapter = new EvaluationAdapter(referenceResponses(3));
    const inspector = new SemanticInspector({ adapter });
    const harness = new SemanticProviderEvaluationHarness({ inspector });
    const session = harness.createSession({ repetitions: 3 });
    let approvals = 0;
    const result = await runSession(session, async () => {
        approvals += 1;
        return true;
    });

    assert.equal(result.status, 'complete');
    assert.equal(result.totalCalls, SEMANTIC_PROVIDER_EVALUATION_LIMITS.callsMax);
    assert.equal(result.reports.length, 3);
    assert.equal(result.aggregate.repetitionCount, 3);
    assert.equal(result.aggregate.passed, true);
    assert.equal(result.aggregate.qualityEligible, true);
    assert.equal(approvals, 48);
    assert.equal(adapter.calls, 48);
});

test('declining a preview is terminal and never contacts the provider', async () => {
    const adapter = new EvaluationAdapter(referenceResponses());
    const inspector = new SemanticInspector({ adapter });
    const harness = new SemanticProviderEvaluationHarness({ inspector });
    const session = harness.createSession();

    const result = await session.runNext({ requestConsent: async () => false });

    assert.equal(result.status, 'cancelled');
    assert.equal(result.completedCalls, 0);
    assert.equal(result.consentedCalls, 0);
    assert.equal(result.sendAttempts, 0);
    assert.equal(result.lastCase.status, 'consent-declined');
    assert.equal(adapter.calls, 0);
    await session.whenReleased();
    assert.equal(harness.activeStatus(), null);
});

test('identity drift after consent fails closed without retry or fallback', async () => {
    const adapter = new EvaluationAdapter(referenceResponses());
    const inspector = new SemanticInspector({ adapter });
    const harness = new SemanticProviderEvaluationHarness({ inspector });
    const session = harness.createSession({ requiredRouteKind: 'profile' });

    const result = await session.runNext({
        requestConsent: async () => {
            adapter.currentIdentity.model = 'changed-after-preview';
            return true;
        },
    });

    assert.equal(result.status, 'failed');
    assert.equal(result.failure.code, 'SEMANTIC_INVALID_INPUT');
    assert.equal(result.failure.reason, 'provider-identity-changed');
    assert.equal(adapter.calls, 0);
});

test('a stale selected profile that resolves to current route is rejected before provider use', async () => {
    const adapter = new EvaluationAdapter(referenceResponses(), {
        routeKind: 'current',
        connectionProfileId: null,
    });
    const inspector = new SemanticInspector({ adapter });
    const harness = new SemanticProviderEvaluationHarness({ inspector });
    const session = harness.createSession({ requiredRouteKind: 'profile' });
    let consentCount = 0;

    const result = await session.runNext({
        requestConsent: async () => {
            consentCount += 1;
            return true;
        },
    });

    assert.equal(result.status, 'failed');
    assert.equal(result.failure.reason, 'provider-route-changed');
    assert.equal(consentCount, 0);
    assert.equal(adapter.calls, 0);
});

test('invalid provider output stops the session once and exposes only a stable failure', async () => {
    const adapter = new EvaluationAdapter([{ invalid: 'response' }]);
    const inspector = new SemanticInspector({ adapter });
    const harness = new SemanticProviderEvaluationHarness({ inspector });
    const session = harness.createSession();

    const result = await session.runNext({ requestConsent: async () => true });

    assert.equal(result.status, 'failed');
    assert.equal(result.completedCalls, 0);
    assert.equal(result.consentedCalls, 1);
    assert.equal(result.sendAttempts, 1);
    assert.equal(result.failure.code, 'SEMANTIC_INVALID_RESPONSE');
    assert.match(result.failure.reason, /^[a-z0-9-]{1,80}$/u);
    assert.equal(adapter.calls, 1);
    assert.equal(JSON.stringify(result).includes('invalid'), false);
});

test('provider evidence that required offset realignment cannot pass the official gate', async () => {
    const response = structuredClone(referenceResponses()[0]);
    response.suggestions[0].evidence[0].start = 999;
    response.suggestions[0].evidence[0].end = 1_010;
    const adapter = new EvaluationAdapter([response]);
    const inspector = new SemanticInspector({ adapter });
    const harness = new SemanticProviderEvaluationHarness({ inspector });
    const session = harness.createSession();

    const result = await session.runNext({ requestConsent: async () => true });

    assert.equal(result.status, 'failed');
    assert.equal(result.failure.reason, 'evaluation-evidence-realigned');
    assert.equal(adapter.calls, 1);
});

test('a positive structured case must attribute the product atom and relation ids', async () => {
    const response = structuredClone(referenceResponses()[0]);
    response.suggestions[0].atomIds = [];
    response.suggestions[0].relationIds = [];
    const adapter = new EvaluationAdapter([response]);
    const inspector = new SemanticInspector({ adapter });
    const harness = new SemanticProviderEvaluationHarness({ inspector });
    const session = harness.createSession();

    const result = await session.runNext({ requestConsent: async () => true });

    assert.equal(result.status, 'failed');
    assert.equal(
        result.failure.reason,
        'evaluation-structure-attribution-missing',
    );
    assert.equal(result.structuralChecksPassed, 1);
    assert.equal(adapter.calls, 1);
});

test('a terminal session keeps its inspector lease until the provider is idle', async () => {
    const idle = deferred();
    const adapter = new EvaluationAdapter([{ invalid: 'response' }]);
    const inspector = new SemanticInspector({ adapter });
    inspector.whenProviderIdle = () => idle.promise;
    const harness = new SemanticProviderEvaluationHarness({ inspector });
    const session = harness.createSession();

    const result = await session.runNext({ requestConsent: async () => true });
    assert.equal(result.status, 'failed');
    assert.equal(result.providerSettling, true);
    assert.throws(
        () => new SemanticProviderEvaluationHarness({ inspector }).createSession(),
        (error) => error instanceof SemanticProviderEvaluationHarnessError
            && error.reason === 'evaluation-already-active',
    );

    idle.resolve({ privateProviderResult: 'must not be returned' });
    const released = await session.whenReleased();
    assert.equal(released.providerSettling, false);
    assert.doesNotThrow(
        () => new SemanticProviderEvaluationHarness({ inspector }).createSession(),
    );
});

test('session bounds and an inspector-wide one-session mutex fail closed', async () => {
    const adapter = new EvaluationAdapter(referenceResponses());
    const inspector = new SemanticInspector({ adapter });
    const harness = new SemanticProviderEvaluationHarness({ inspector });
    const session = harness.createSession();

    assert.throws(
        () => harness.createSession(),
        (error) => error instanceof SemanticProviderEvaluationHarnessError
            && error.reason === 'evaluation-already-active',
    );
    const secondHarness = new SemanticProviderEvaluationHarness({ inspector });
    assert.throws(
        () => secondHarness.createSession(),
        (error) => error instanceof SemanticProviderEvaluationHarnessError
            && error.reason === 'evaluation-already-active',
    );
    session.cancel();
    assert.throws(
        () => secondHarness.createSession(),
        (error) => error instanceof SemanticProviderEvaluationHarnessError
            && error.reason === 'evaluation-already-active',
    );
    await session.whenReleased();
    const replacement = harness.createSession({ repetitions: 3 });
    replacement.cancel();
    await replacement.whenReleased();
    assert.throws(
        () => secondHarness.createSession({ repetitions: 4 }),
        (error) => error instanceof SemanticProviderEvaluationHarnessError
            && error.reason === 'invalid-repetitions',
    );
    assert.throws(
        () => secondHarness.createSession({ responseTokenCap: 63 }),
        (error) => error instanceof SemanticProviderEvaluationHarnessError
            && error.reason === 'invalid-response-token-cap',
    );
});
