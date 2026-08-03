import { evaluateSemanticSuggestionCorpus } from './semantic-evaluation.js';
import { SEMANTIC_INSPECTOR_LIMITS } from './semantic-inspector.js';
import { createOfficialSemanticProviderEvaluationSuite } from './semantic-provider-evaluation-corpus.js';

export const SEMANTIC_PROVIDER_EVALUATION_HARNESS_VERSION = 1;

export const SEMANTIC_PROVIDER_EVALUATION_LIMITS = Object.freeze({
    repetitionsMin: 1,
    repetitionsMax: 3,
    callsMax: 48,
});

const ACTIVE_STATUSES = new Set([
    'ready',
    'preparing',
    'awaiting-consent',
    'running',
]);

const ACTIVE_SESSIONS_BY_INSPECTOR = new WeakMap();

const TERMINAL_STATUSES = new Set([
    'complete',
    'cancelled',
    'failed',
]);

export class SemanticProviderEvaluationHarnessError extends Error {
    constructor(reason) {
        super(`SEMANTIC_EVALUATION_HARNESS_INVALID: ${reason}`);
        this.name = 'SemanticProviderEvaluationHarnessError';
        this.code = 'SEMANTIC_EVALUATION_HARNESS_INVALID';
        this.reason = reason;
    }
}

function fail(reason) {
    throw new SemanticProviderEvaluationHarnessError(reason);
}

function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const child of Object.values(value)) deepFreeze(child);
    }
    return value;
}

function boundedInteger(value, minimum, maximum, reason) {
    const parsed = typeof value === 'string' && /^\d+$/u.test(value)
        ? Number(value)
        : value;
    if (
        !Number.isSafeInteger(parsed)
        || parsed < minimum
        || parsed > maximum
    ) {
        fail(reason);
    }
    return parsed;
}

function publicIdentity(identity) {
    return identity
        ? {
            status: identity.status,
            provider: identity.provider,
            model: identity.model,
            routeKind: identity.routeKind,
        }
        : null;
}

function sameIdentity(left, right) {
    return left?.status === right?.status
        && left?.provider === right?.provider
        && left?.model === right?.model
        && left?.routeKind === right?.routeKind
        && left?.connectionProfileId === right?.connectionProfileId;
}

function stableFailure(error) {
    const rawCode = String(error?.code ?? '');
    const rawReason = String(error?.reason ?? '');
    const code = /^SEMANTIC_[A-Z_]{1,64}$/u.test(rawCode)
        ? rawCode
        : 'SEMANTIC_PROVIDER_ERROR';
    const reason = /^[a-z0-9-]{1,80}$/u.test(rawReason)
        ? rawReason
        : 'evaluation-failed';
    return { code, reason };
}

function projectResult(result) {
    if (result?.cached !== false || !Array.isArray(result?.suggestions)) {
        fail(result?.cached === true ? 'evaluation-cache-hit' : 'invalid-evaluation-result');
    }
    if (result.suggestions.some((suggestion) => (
        suggestion.evidence.some(({ realigned }) => realigned === true)
    ))) {
        fail('evaluation-evidence-realigned');
    }
    return {
        suggestions: result.suggestions.map((suggestion) => ({
            targetIds: [...suggestion.targetIds],
            category: suggestion.category,
            sourceIds: [...suggestion.sourceIds],
            atomIds: [...suggestion.atomIds],
            relationIds: [...suggestion.relationIds],
            evidence: suggestion.evidence.map(({ sourceId, start, end }) => ({
                sourceId,
                start,
                end,
            })),
        })),
    };
}

function sameIdSet(actual, expected) {
    if (!Array.isArray(actual) || !Array.isArray(expected)) return false;
    const left = [...new Set(actual)].sort();
    const right = [...new Set(expected)].sort();
    return left.length === right.length
        && left.every((value, index) => value === right[index]);
}

function verifyPreparedStructure(prepared, gate) {
    const request = prepared?.request;
    if (
        !request
        || !sameIdSet(request.targets?.map(({ targetId }) => targetId), gate.targetIds)
        || !sameIdSet(request.sources?.map(({ id }) => id), gate.sourceIds)
        || !sameIdSet(request.atoms?.map(({ id }) => id), gate.atomIds)
        || !sameIdSet(request.relations?.map(({ id }) => id), gate.relationIds)
    ) {
        fail('evaluation-structure-drift');
    }
}

function verifyProviderStructure(projected, entry, corpusCase) {
    const gate = entry.structuralGate;
    if (
        !corpusCase?.expectedIssues?.length
        || (gate.atomIds.length === 0 && gate.relationIds.length === 0)
    ) {
        return;
    }
    const attributed = projected.suggestions.some((suggestion) => (
        gate.targetIds.some((targetId) => suggestion.targetIds.includes(targetId))
        && gate.atomIds.every((atomId) => suggestion.atomIds.includes(atomId))
        && gate.relationIds.every((relationId) => (
            suggestion.relationIds.includes(relationId)
        ))
    ));
    if (!attributed) fail('evaluation-structure-attribution-missing');
}

function aggregateReports(reports, repetitions) {
    const rates = (key) => reports.map((report) => report.metrics[key]);
    const minimum = (values) => Math.min(...values);
    const maximum = (values) => Math.max(...values);
    const smokePassed = reports.every((report) => report.passed);
    const qualityEligible = repetitions === 3;
    return {
        passed: qualityEligible && smokePassed,
        smokePassed,
        qualityEligible,
        scope: 'single-provider-model-route',
        complete: reports.every((report) => report.complete),
        repetitionCount: reports.length,
        worstMetrics: {
            usefulnessRate: minimum(rates('usefulnessRate')),
            falsePositiveRate: maximum(rates('falsePositiveRate')),
            evidenceAccuracy: minimum(rates('evidenceAccuracy')),
        },
        failedRepetitions: reports
            .map((report, index) => ({ report, repetition: index + 1 }))
            .filter(({ report }) => !report.passed)
            .map(({ repetition }) => repetition),
    };
}

function publicSuiteManifest(suite) {
    const pathCoverage = {
        structuredRelation: 0,
        structuredAtomBridge: 0,
        sourceBridge: 0,
    };
    for (const entry of suite.cases) {
        if (entry.pathKind === 'structured-relation') {
            pathCoverage.structuredRelation += 1;
        } else if (entry.pathKind === 'structured-atom-bridge') {
            pathCoverage.structuredAtomBridge += 1;
        } else {
            pathCoverage.sourceBridge += 1;
        }
    }
    return deepFreeze({
        ...suite.manifest,
        caseIds: [...suite.manifest.caseIds],
        pathCoverage,
    });
}

class SemanticProviderEvaluationSession {
    #inspector;

    #suite;

    #responseTokenCap;

    #repetitions;

    #requiredRouteKind;

    #status = 'ready';

    #cursor = 0;

    #consentedCalls = 0;

    #sendAttempts = 0;

    #evaluatedCalls = 0;

    #structuralChecksPassed = 0;

    #baselineIdentity = null;

    #controller = null;

    #results;

    #reports = null;

    #failure = null;

    #lastCase = null;

    #onTerminal;

    #providerSettling = false;

    #releasePromise = Promise.resolve();

    constructor({
        inspector,
        responseTokenCap,
        repetitions,
        requiredRouteKind,
        onTerminal,
    }) {
        this.#inspector = inspector;
        this.#suite = createOfficialSemanticProviderEvaluationSuite();
        this.#responseTokenCap = responseTokenCap;
        this.#repetitions = repetitions;
        this.#requiredRouteKind = requiredRouteKind;
        this.#results = Array.from({ length: repetitions }, () => new Map());
        this.#onTerminal = onTerminal;
        if (this.totalCalls > SEMANTIC_PROVIDER_EVALUATION_LIMITS.callsMax) {
            fail('too-many-provider-calls');
        }
    }

    get totalCalls() {
        return this.#suite.cases.length * this.#repetitions;
    }

    get active() {
        return ACTIVE_STATUSES.has(this.#status);
    }

    #casePosition() {
        if (this.#cursor >= this.totalCalls) return null;
        const caseIndex = this.#cursor % this.#suite.cases.length;
        const repetition = Math.floor(this.#cursor / this.#suite.cases.length) + 1;
        return {
            entry: this.#suite.cases[caseIndex],
            caseIndex,
            repetition,
        };
    }

    #pathCoverage() {
        const result = {
            structuredRelation: 0,
            structuredAtomBridge: 0,
            sourceBridge: 0,
        };
        for (const entry of this.#suite.cases) {
            if (entry.pathKind === 'structured-relation') result.structuredRelation += 1;
            else if (entry.pathKind === 'structured-atom-bridge') {
                result.structuredAtomBridge += 1;
            } else result.sourceBridge += 1;
        }
        return result;
    }

    status() {
        const position = this.#casePosition();
        const reports = this.#reports
            ? this.#reports.map((report, index) => ({
                repetition: index + 1,
                passed: report.passed,
                complete: report.complete,
                metrics: { ...report.metrics },
                counts: { ...report.counts },
                releaseGates: {
                    configuredCount: report.releaseGates.configuredCount,
                    passedCount: report.releaseGates.passedCount,
                    failedCount: report.releaseGates.failedCount,
                    failures: [...report.releaseGates.failures],
                },
                failures: [...report.failures],
            }))
            : null;
        return deepFreeze({
            kind: 'st-devtools-semantic-provider-evaluation-status',
            version: SEMANTIC_PROVIDER_EVALUATION_HARNESS_VERSION,
            status: this.#status,
            completedCalls: this.#evaluatedCalls,
            consentedCalls: this.#consentedCalls,
            sendAttempts: this.#sendAttempts,
            evaluatedCalls: this.#evaluatedCalls,
            totalCalls: this.totalCalls,
            repetitions: this.#repetitions,
            responseTokenCap: this.#responseTokenCap,
            maximumResponseTokens: this.totalCalls * this.#responseTokenCap,
            nextCase: position
                ? {
                    id: position.entry.id,
                    pathKind: position.entry.pathKind,
                    repetition: position.repetition,
                    position: this.#cursor + 1,
                }
                : null,
            lastCase: this.#lastCase ? { ...this.#lastCase } : null,
            identity: publicIdentity(this.#baselineIdentity),
            pathCoverage: this.#pathCoverage(),
            manifest: { ...this.#suite.manifest, caseIds: [...this.#suite.manifest.caseIds] },
            structuralChecksPassed: this.#structuralChecksPassed,
            structuralTransportPassed: Boolean(
                this.#reports && this.#structuralChecksPassed === this.totalCalls
            ),
            failure: this.#failure ? { ...this.#failure } : null,
            reports,
            aggregate: reports
                ? aggregateReports(this.#reports, this.#repetitions)
                : null,
            providerSettling: this.#providerSettling,
            persistsRawPrompt: false,
            persistsRawResponse: false,
            persistsEvidenceQuotes: false,
        });
    }

    #finish(status) {
        this.#status = status;
        this.#controller = null;
        this.#providerSettling = true;
        let waitForIdle;
        try {
            waitForIdle = this.#inspector.whenProviderIdle?.() ?? Promise.resolve();
        } catch {
            waitForIdle = Promise.resolve();
        }
        this.#releasePromise = Promise.resolve(waitForIdle)
            .catch(() => undefined)
            .then(() => {
                this.#providerSettling = false;
                this.#onTerminal?.(this);
            });
    }

    whenReleased() {
        return this.#releasePromise.then(() => this.status());
    }

    #clearEphemeralResults() {
        for (const result of this.#results) result.clear();
    }

    cancel() {
        if (TERMINAL_STATUSES.has(this.#status)) return this.status();
        this.#controller?.abort();
        this.#clearEphemeralResults();
        try {
            this.#inspector.clearCache();
        } catch {
            // Cancellation remains terminal even when an optional cache rejects cleanup.
        }
        this.#lastCase = null;
        this.#finish('cancelled');
        return this.status();
    }

    async runNext({ requestConsent, signal = null } = {}) {
        if (this.#status !== 'ready') fail('session-not-ready');
        if (typeof requestConsent !== 'function') fail('consent-handler-required');
        if (signal != null && !(signal instanceof AbortSignal)) {
            fail('invalid-abort-signal');
        }
        if (signal?.aborted) {
            this.cancel();
            return this.status();
        }
        const position = this.#casePosition();
        if (!position) fail('session-has-no-next-case');
        const controller = new AbortController();
        this.#controller = controller;
        const onExternalAbort = () => controller.abort();
        signal?.addEventListener('abort', onExternalAbort, { once: true });
        let prepared = null;
        try {
            this.#status = 'preparing';
            prepared = await this.#inspector.prepare({
                ...position.entry.preparation,
                responseTokenCap: this.#responseTokenCap,
                userPrompt: '',
                assistantPrefill: '',
            });
            verifyPreparedStructure(prepared, position.entry.structuralGate);
            this.#structuralChecksPassed += 1;
            if (controller.signal.aborted) {
                this.cancel();
                return this.status();
            }
            const identity = prepared?.preview?.providerIdentity;
            if (identity?.status !== 'available') {
                fail('provider-identity-not-available');
            }
            if (
                this.#requiredRouteKind
                && identity.routeKind !== this.#requiredRouteKind
            ) {
                fail('provider-route-changed');
            }
            if (!this.#baselineIdentity) this.#baselineIdentity = identity;
            else if (!sameIdentity(this.#baselineIdentity, identity)) {
                fail('provider-identity-changed');
            }
            this.#status = 'awaiting-consent';
            const approved = await requestConsent({
                caseId: position.entry.id,
                pathKind: position.entry.pathKind,
                repetition: position.repetition,
                position: this.#cursor + 1,
                totalCalls: this.totalCalls,
                requestDigest: prepared.requestDigest,
                preview: prepared.preview,
            });
            if (controller.signal.aborted) {
                this.cancel();
                return this.status();
            }
            if (approved !== true) {
                this.#clearEphemeralResults();
                this.#lastCase = {
                    id: position.entry.id,
                    repetition: position.repetition,
                    status: 'consent-declined',
                };
                this.#finish('cancelled');
                return this.status();
            }
            this.#consentedCalls += 1;
            if (this.#inspector.clearCache() !== true) {
                fail('cache-clear-failed');
            }
            this.#status = 'running';
            this.#sendAttempts += 1;
            const result = await this.#inspector.inspect(prepared, {
                signal: controller.signal,
            });
            if (controller.signal.aborted) {
                this.cancel();
                return this.status();
            }
            const currentIdentity = this.#inspector.readIdentity?.();
            if (currentIdentity && !sameIdentity(identity, currentIdentity)) {
                fail('provider-identity-changed');
            }
            const projected = projectResult(result);
            verifyProviderStructure(
                projected,
                position.entry,
                this.#suite.corpus.cases[position.caseIndex],
            );
            this.#results[position.repetition - 1].set(
                position.entry.id,
                projected,
            );
            this.#lastCase = {
                id: position.entry.id,
                repetition: position.repetition,
                status: 'complete',
                suggestionCount: projected.suggestions.length,
            };
            this.#cursor += 1;
            this.#evaluatedCalls += 1;
            if (this.#inspector.clearCache() !== true) {
                fail('cache-clear-failed');
            }
            if (this.#cursor === this.totalCalls) {
                this.#reports = this.#results.map((results) => (
                    evaluateSemanticSuggestionCorpus(this.#suite.corpus, results)
                ));
                this.#clearEphemeralResults();
                this.#finish('complete');
            } else {
                this.#status = 'ready';
                this.#controller = null;
            }
            return this.status();
        } catch (error) {
            if (controller.signal.aborted) {
                this.cancel();
                return this.status();
            }
            this.#failure = stableFailure(error);
            this.#clearEphemeralResults();
            try {
                this.#inspector.clearCache();
            } catch {
                // A stable bounded failure is returned below.
            }
            this.#finish('failed');
            return this.status();
        } finally {
            prepared = null;
            signal?.removeEventListener('abort', onExternalAbort);
        }
    }
}

export class SemanticProviderEvaluationHarness {
    #inspector;

    #manifest;

    constructor({ inspector } = {}) {
        if (
            !inspector
            || typeof inspector.prepare !== 'function'
            || typeof inspector.inspect !== 'function'
            || typeof inspector.clearCache !== 'function'
        ) {
            fail('inspector-unavailable');
        }
        this.#inspector = inspector;
        this.#manifest = publicSuiteManifest(
            createOfficialSemanticProviderEvaluationSuite(),
        );
    }

    manifest() {
        return this.#manifest;
    }

    createSession({
        repetitions = 1,
        responseTokenCap = 1_024,
        requiredRouteKind = null,
    } = {}) {
        if (ACTIVE_SESSIONS_BY_INSPECTOR.has(this.#inspector)) {
            fail('evaluation-already-active');
        }
        const normalizedRepetitions = boundedInteger(
            repetitions,
            SEMANTIC_PROVIDER_EVALUATION_LIMITS.repetitionsMin,
            SEMANTIC_PROVIDER_EVALUATION_LIMITS.repetitionsMax,
            'invalid-repetitions',
        );
        const normalizedCap = boundedInteger(
            responseTokenCap,
            SEMANTIC_INSPECTOR_LIMITS.responseTokenCapMin,
            SEMANTIC_INSPECTOR_LIMITS.responseTokenCapMax,
            'invalid-response-token-cap',
        );
        if (requiredRouteKind != null && !['current', 'profile'].includes(requiredRouteKind)) {
            fail('invalid-required-route');
        }
        let session = null;
        session = new SemanticProviderEvaluationSession({
            inspector: this.#inspector,
            repetitions: normalizedRepetitions,
            responseTokenCap: normalizedCap,
            requiredRouteKind,
            onTerminal: (completed) => {
                if (ACTIVE_SESSIONS_BY_INSPECTOR.get(this.#inspector) === completed) {
                    ACTIVE_SESSIONS_BY_INSPECTOR.delete(this.#inspector);
                }
            },
        });
        ACTIVE_SESSIONS_BY_INSPECTOR.set(this.#inspector, session);
        return session;
    }

    activeStatus() {
        return ACTIVE_SESSIONS_BY_INSPECTOR.get(this.#inspector)?.status() ?? null;
    }
}
