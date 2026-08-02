import assert from 'node:assert/strict';
import test from 'node:test';
import {
    SEMANTIC_INSPECTOR_LIMITS,
    SemanticInspector,
    SemanticInspectorError,
    SemanticInspectorMemoryCache,
    prepareSemanticInspection,
    validateSemanticResponse,
} from '../src/semantic-inspector.js';

function fixture() {
    const english = {
        id: 'source:english',
        type: 'system',
        label: 'English rule',
        content: 'Always answer in English.',
        included: true,
        configuredEnabled: true,
        ranges: [{ start: 0, end: 25 }],
        comparisonPolicy: {
            mode: 'normal',
            group: 'Language',
            option: 'English',
            categories: ['language'],
            origin: 'manual',
            profileId: 'global',
            profileScope: 'global',
        },
    };
    const korean = {
        id: 'source:korean',
        type: 'extension',
        label: 'Korean rule',
        content: 'Always answer in Korean.',
        included: true,
        configuredEnabled: true,
        ranges: [{ start: 26, end: 50 }],
    };
    const disabled = {
        id: 'source:disabled',
        type: 'system',
        label: 'Disabled',
        content: 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789',
        included: true,
        configuredEnabled: false,
        ranges: [],
    };
    const alternative = {
        id: 'source:alternative',
        type: 'system',
        label: 'Alternative excluded',
        content: 'Always answer in Japanese.',
        included: true,
        configuredEnabled: true,
        alternativeExcluded: true,
        ranges: [],
    };
    const unrelated = {
        id: 'source:unrelated',
        type: 'system',
        label: 'Unrelated',
        content: 'Return Markdown.',
        included: true,
        configuredEnabled: true,
        ranges: [],
    };
    const atomEnglish = {
        id: 'atom:english',
        sourceId: english.id,
        category: 'language',
        target: 'response',
        action: 'set',
        property: 'response.language',
        value: 'en',
        polarity: 'require',
        scope: 'output',
        condition: '',
        exception: '',
        priority: 'high',
        status: 'confirmed',
        localRange: { start: 0, end: english.content.length },
        finalRanges: english.ranges,
    };
    const atomKorean = {
        ...atomEnglish,
        id: 'atom:korean',
        sourceId: korean.id,
        value: 'ko',
        localRange: { start: 0, end: korean.content.length },
        finalRanges: korean.ranges,
    };
    const relation = {
        id: 'relation:language:one',
        category: 'language',
        kind: 'alternative-values',
        status: 'confirmed',
        atomIds: [atomEnglish.id, atomKorean.id],
        sourceIds: [english.id, korean.id],
        finalRanges: [...english.ranges, ...korean.ranges],
        conditions: [],
        exceptions: [],
    };
    const cluster = {
        id: 'cluster:language:one',
        category: 'language',
        status: 'confirmed',
        relationIds: [relation.id],
        atomIds: [atomEnglish.id, atomKorean.id],
        sourceIds: [english.id, korean.id],
        finalRanges: relation.finalRanges,
    };
    const finding = {
        id: 'language-conflict',
        ruleId: 'language',
        severity: 'critical',
        title: 'Language conflict',
        sourceIds: [english.id, korean.id],
        atomIds: [atomEnglish.id, atomKorean.id],
        relationId: relation.id,
        clusterId: cluster.id,
        finalRanges: relation.finalRanges,
    };
    return {
        snapshot: {
            chatId: 'must-never-leave',
            request: { body: { api_key: 'must-never-leave' } },
            payload: [{ role: 'system', content: 'must-never-leave' }],
            chat: ['must-never-leave'],
            sources: [english, korean, disabled, alternative, unrelated],
        },
        analysis: {
            findings: [finding],
            instructions: {
                atoms: [atomEnglish, atomKorean],
                relations: [relation],
                clusters: [cluster],
                capabilities: [
                    { sourceId: english.id, active: true },
                    { sourceId: korean.id, active: true },
                    { sourceId: disabled.id, active: false },
                    { sourceId: alternative.id, active: false },
                    { sourceId: unrelated.id, active: true },
                ],
            },
            comparison: {
                skippedSources: [
                    { sourceId: disabled.id, reason: 'configured-disabled' },
                    { sourceId: alternative.id, reason: 'alternative-excluded' },
                ],
                groups: [],
            },
        },
        ids: {
            finding: 'finding:language-conflict',
            cluster: 'cluster:cluster:language:one',
            english: english.id,
            korean: korean.id,
            disabled: disabled.id,
            relation: relation.id,
            atomEnglish: atomEnglish.id,
        },
    };
}

function pricing() {
    return {
        version: 1,
        entries: [{
            provider: 'openrouter',
            model: 'example/model',
            currency: 'USD',
            inputPerMillion: 2,
            outputPerMillion: 8,
            cachedInputPerMillion: null,
            priceAsOf: '2026-07-31',
        }],
    };
}

function validResponse(prepared, overrides = {}) {
    const source = prepared.request.sources[0];
    const atomIds = prepared.request.atoms.map(({ id }) => id);
    const relationIds = prepared.request.relations.map(({ id }) => id);
    const suggestion = {
        targetIds: [prepared.request.targets[0].targetId],
        category: 'conflict',
        severity: 'warning',
        title: 'Conflicting language directives',
        summary: 'The selected directives request different output languages.',
        rationale: 'Both active instructions apply to the same response.',
        confidence: 0.9,
        sourceIds: prepared.request.sources.map(({ id }) => id),
        atomIds,
        relationIds,
        evidence: [{
            sourceId: source.id,
            start: 0,
            end: 6,
            quote: source.content.slice(0, 6),
        }],
        ...overrides,
    };
    return JSON.stringify({ version: 1, suggestions: [suggestion] });
}

class FakeAdapter {
    constructor() {
        this.calls = [];
        this.providerIdentity = {
            status: 'available',
            provider: 'openrouter',
            model: 'example/model',
        };
        this.response = null;
    }

    identity() {
        return { ...this.providerIdentity };
    }

    async generate(options) {
        this.calls.push(options);
        return typeof this.response === 'function'
            ? this.response(options)
            : this.response;
    }
}

test('prepare sends only selected active closure and exposes an exact consent preview', async () => {
    const data = fixture();
    const adapter = new FakeAdapter();
    const inspector = new SemanticInspector({
        adapter,
        estimateTokens: async () => 1_000,
    });
    const prepared = await inspector.prepare({
        snapshot: data.snapshot,
        analysis: data.analysis,
        targetIds: [data.ids.finding],
        provider: 'wrong-snapshot-provider',
        model: 'wrong-snapshot-model',
        responseTokenCap: 512,
        pricingOverrides: pricing(),
        userPrompt: '말투 충돌을 우선 검사하세요.',
        assistantPrefill: '{"version":1,',
    });

    assert.deepEqual(
        prepared.request.sources.map(({ id }) => id),
        [data.ids.english, data.ids.korean],
    );
    assert.deepEqual(
        prepared.preview.includedSources.map(({ id, content }) => [id, content]),
        prepared.request.sources.map(({ id, content }) => [id, content]),
    );
    assert.equal(prepared.preview.provider, 'openrouter');
    assert.equal(prepared.preview.model, 'example/model');
    assert.equal(prepared.preview.inputTokenEstimate, 1_000);
    assert.equal(prepared.preview.responseTokenCap, 512);
    assert.match(prepared.systemPrompt, /말투 충돌을 우선 검사하세요/u);
    assert.equal(prepared.preview.userPrompt, '말투 충돌을 우선 검사하세요.');
    assert.equal(prepared.preview.assistantPrefill, '{"version":1,');
    assert.equal(prepared.assistantPrefill, '{"version":1,');
    assert.equal(prepared.preview.cost.priceSource, 'user-override');
    assert.equal(prepared.preview.cost.amount, 0.006096);
    assert.equal(
        prepared.preview.excludedSources.find(({ id }) => id === data.ids.disabled)?.reason,
        'disabled',
    );
    assert.equal(
        prepared.preview.excludedSources.find(({ id }) => (
            id === 'source:alternative'
        ))?.reason,
        'alternative-excluded',
    );
    assert.equal(
        prepared.preview.excludedSources.find(({ id }) => (
            id === 'source:unrelated'
        ))?.reason,
        'not-required',
    );
    assert.doesNotMatch(prepared.prompt, /must-never-leave|sk-proj-/u);
    assert.equal('chatId' in prepared.request, false);
    assert.equal('request' in prepared.request, false);
    assert.equal('payload' in prepared.request, false);
    assert.equal(Object.isFrozen(prepared), true);
});

test('cluster target syntax resolves only an actually existing local cluster', async () => {
    const data = fixture();
    const prepared = await prepareSemanticInspection({
        snapshot: data.snapshot,
        analysis: data.analysis,
        targetIds: [data.ids.cluster],
        provider: 'openrouter',
        model: 'example/model',
    });
    assert.equal(prepared.request.targets[0].kind, 'cluster');
    await assert.rejects(
        prepareSemanticInspection({
            snapshot: data.snapshot,
            analysis: data.analysis,
            targetIds: ['cluster:not-real'],
            provider: 'openrouter',
            model: 'example/model',
        }),
        (error) => error instanceof SemanticInspectorError
            && error.code === 'SEMANTIC_INVALID_INPUT',
    );
});

test('inspect calls the injected adapter contract and keeps AI suggestions separate', async () => {
    const data = fixture();
    const adapter = new FakeAdapter();
    const cache = new SemanticInspectorMemoryCache();
    const inspector = new SemanticInspector({ adapter, cache });
    const prepared = await inspector.prepare({
        snapshot: data.snapshot,
        analysis: data.analysis,
        targetIds: [data.ids.finding],
    });
    adapter.response = () => validResponse(prepared);
    const controller = new AbortController();
    const result = await inspector.inspect(prepared, { signal: controller.signal });

    assert.equal(adapter.calls.length, 1);
    assert.deepEqual(Object.keys(adapter.calls[0]).sort(), [
        'jsonSchema',
        'prefill',
        'prompt',
        'responseTokenCap',
        'signal',
        'systemPrompt',
    ]);
    assert.equal(result.kind, 'ai-semantic-suggestions');
    assert.equal(result.cached, false);
    assert.equal(result.suggestions[0].origin, 'ai');
    assert.equal(result.suggestions[0].id.startsWith('ai-suggestion:'), true);
    assert.equal(result.suggestions[0].evidence[0].quote, 'Always');

    const cached = await inspector.inspect(prepared);
    assert.equal(cached.cached, true);
    assert.equal(cached.suggestions[0].evidence[0].quote, 'Always');
    assert.equal(adapter.calls.length, 1);
    assert.deepEqual(inspector.cacheStatus(), {
        storage: 'memory-only',
        entryCount: 1,
        estimatedBytes: inspector.cacheStatus().estimatedBytes,
        maxEntries: 16,
        maxBytes: 1024 * 1024,
        ttlMs: 15 * 60 * 1000,
        storesRawPrompt: false,
        storesRawResponse: false,
        storesEvidenceQuotes: false,
    });
    const serializedCache = JSON.stringify(cache.get(prepared.requestDigest));
    assert.doesNotMatch(serializedCache, /Always answer|"quote"/u);

    assert.equal(inspector.clearCache(), true);
    assert.equal(inspector.cacheStatus().entryCount, 0);
    assert.equal(inspector.cacheStatus().estimatedBytes, 0);
});

test('clearCache remains optional for a compatible injected cache', () => {
    const inspector = new SemanticInspector({
        adapter: new FakeAdapter(),
        cache: {
            get() {
                return undefined;
            },
            set() {
                return false;
            },
        },
    });

    assert.equal(inspector.clearCache(), false);
});

test('one unknown, extra, or mismatched response field rejects the whole response', async () => {
    const data = fixture();
    const prepared = await prepareSemanticInspection({
        snapshot: data.snapshot,
        analysis: data.analysis,
        targetIds: [data.ids.finding],
        provider: 'openrouter',
        model: 'example/model',
    });
    const invalid = [
        validResponse(prepared, { sourceIds: ['unknown-source'] }),
        validResponse(prepared, { atomIds: ['unknown-atom'] }),
        validResponse(prepared, { relationIds: ['unknown-relation'] }),
        validResponse(prepared, {
            evidence: [{
                sourceId: data.ids.english,
                start: 0,
                end: 6,
                quote: 'Wrong!',
            }],
        }),
        `\`\`\`json\n${validResponse(prepared)}\n\`\`\``,
        '{"version":1,"\\u0076ersion":1,"suggestions":[]}',
    ];
    const extra = JSON.parse(validResponse(prepared));
    extra.suggestions[0].unexpected = true;
    invalid.push(JSON.stringify(extra));

    for (const response of invalid) {
        assert.throws(
            () => validateSemanticResponse(response, prepared),
            (error) => error instanceof SemanticInspectorError
                && error.code === 'SEMANTIC_INVALID_RESPONSE',
        );
    }
});

test('evidence offsets are safely realigned only when the exact quote exists', async () => {
    const data = fixture();
    const prepared = await prepareSemanticInspection({
        snapshot: data.snapshot,
        analysis: data.analysis,
        targetIds: [data.ids.finding],
        provider: 'openrouter',
        model: 'example/model',
    });
    const response = JSON.parse(validResponse(prepared));
    response.suggestions[0].evidence[0].start = 999;
    response.suggestions[0].evidence[0].end = 1_005;

    const result = validateSemanticResponse(JSON.stringify(response), prepared);

    assert.equal(result.suggestions[0].evidence[0].start, 0);
    assert.equal(result.suggestions[0].evidence[0].end, 6);
    assert.equal(result.suggestions[0].evidence[0].quote, 'Always');
});

test('selected inactive source and over-limit input fail closed without truncation', async () => {
    const data = fixture();
    const disabledFinding = {
        id: 'disabled-finding',
        title: 'Disabled',
        sourceIds: [data.ids.disabled],
        atomIds: [],
        finalRanges: [],
    };
    data.analysis.findings.push(disabledFinding);
    await assert.rejects(
        prepareSemanticInspection({
            snapshot: data.snapshot,
            analysis: data.analysis,
            targetIds: ['finding:disabled-finding'],
            provider: 'openrouter',
            model: 'example/model',
        }),
        (error) => error.code === 'SEMANTIC_INVALID_INPUT',
    );

    const large = fixture();
    large.snapshot.sources[0].content = 'x'.repeat(
        SEMANTIC_INSPECTOR_LIMITS.sourceBytes + 1,
    );
    await assert.rejects(
        prepareSemanticInspection({
            snapshot: large.snapshot,
            analysis: large.analysis,
            targetIds: [large.ids.finding],
            provider: 'openrouter',
            model: 'example/model',
        }),
        (error) => error.code === 'SEMANTIC_INVALID_INPUT'
            && error.reason === 'source-too-large',
    );
});

test('a required secret-bearing source is rejected instead of changing evidence offsets', async () => {
    const data = fixture();
    data.snapshot.sources[0].content = 'Use sk-proj-abcdefghijklmnopqrstuvwxyz0123456789 now.';
    data.analysis.instructions.atoms[0].localRange = {
        start: 0,
        end: data.snapshot.sources[0].content.length,
    };
    await assert.rejects(
        prepareSemanticInspection({
            snapshot: data.snapshot,
            analysis: data.analysis,
            targetIds: [data.ids.finding],
            provider: 'openrouter',
            model: 'example/model',
        }),
        (error) => (
            error instanceof SemanticInspectorError
            && error.code === 'SEMANTIC_INVALID_INPUT'
            && error.reason === 'sensitive-required-source'
            && error.message === 'SEMANTIC_INVALID_INPUT'
        ),
    );
});

test('partial provider identity is previewed but never invents a model or price', async () => {
    const data = fixture();
    const adapter = new FakeAdapter();
    adapter.providerIdentity = {
        status: 'partial',
        provider: 'openrouter',
        model: null,
    };
    const inspector = new SemanticInspector({ adapter });
    const prepared = await inspector.prepare({
        snapshot: data.snapshot,
        analysis: data.analysis,
        targetIds: [data.ids.finding],
        pricingOverrides: pricing(),
    });
    assert.equal(prepared.preview.provider, 'openrouter');
    assert.equal(prepared.preview.model, null);
    assert.equal(prepared.preview.cost.status, 'unavailable');
});

test('preview pricing requires one exact user override and never selects a currency', async () => {
    const data = fixture();
    const mismatch = pricing();
    mismatch.entries[0].model = 'example/other-model';
    const mismatchPrepared = await prepareSemanticInspection({
        snapshot: data.snapshot,
        analysis: data.analysis,
        targetIds: [data.ids.finding],
        provider: 'openrouter',
        model: 'example/model',
        pricingOverrides: mismatch,
    }, {
        estimateTokens: async () => 1_000,
    });
    assert.equal(mismatchPrepared.preview.cost.status, 'unavailable');

    const ambiguous = pricing();
    ambiguous.entries.push({
        ...ambiguous.entries[0],
        currency: 'KRW',
    });
    const ambiguousPrepared = await prepareSemanticInspection({
        snapshot: data.snapshot,
        analysis: data.analysis,
        targetIds: [data.ids.finding],
        provider: 'openrouter',
        model: 'example/model',
        pricingOverrides: ambiguous,
    }, {
        estimateTokens: async () => 1_000,
    });
    assert.equal(ambiguousPrepared.preview.cost.status, 'unavailable');
});

test('v7 redacted and metadata snapshots fail closed while legacy full input remains explicit', async () => {
    for (const mode of ['redacted', 'metadata']) {
        const data = fixture();
        data.snapshot.schemaVersion = 7;
        data.snapshot.privacy = { mode };
        await assert.rejects(
            prepareSemanticInspection({
                snapshot: data.snapshot,
                analysis: data.analysis,
                targetIds: [data.ids.finding],
                provider: 'openrouter',
                model: 'example/model',
            }),
            (error) => error.code === 'SEMANTIC_INVALID_INPUT'
                && error.reason === 'non-full-snapshot',
        );
    }

    const legacy = fixture();
    const prepared = await prepareSemanticInspection({
        snapshot: legacy.snapshot,
        analysis: legacy.analysis,
        targetIds: [legacy.ids.finding],
        provider: 'openrouter',
        model: 'example/model',
    });
    assert.equal(prepared.preview.includedSources.length, 2);

    const fullV7 = fixture();
    fullV7.snapshot.schemaVersion = 7;
    fullV7.snapshot.privacy = { mode: 'full' };
    const fullPrepared = await prepareSemanticInspection({
        snapshot: fullV7.snapshot,
        analysis: fullV7.analysis,
        targetIds: [fullV7.ids.finding],
        provider: 'openrouter',
        model: 'example/model',
    });
    assert.equal(fullPrepared.preview.includedSources.length, 2);
});

test('identity changes and aborts require a fresh UI decision without stored consent', async () => {
    const data = fixture();
    const adapter = new FakeAdapter();
    const inspector = new SemanticInspector({ adapter });
    const prepared = await inspector.prepare({
        snapshot: data.snapshot,
        analysis: data.analysis,
        targetIds: [data.ids.finding],
    });
    adapter.providerIdentity.model = 'different/model';
    await assert.rejects(
        inspector.inspect(prepared),
        (error) => error.code === 'SEMANTIC_INVALID_INPUT'
            && error.reason === 'provider-identity-changed',
    );
    adapter.providerIdentity.model = 'example/model';
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
        inspector.inspect(prepared, { signal: controller.signal }),
        (error) => error.code === 'SEMANTIC_ABORTED',
    );
    assert.equal('consent' in inspector, false);
});

test('profile route identity binds consent and cache digests to one opaque profile', async () => {
    const data = fixture();
    const adapter = new FakeAdapter();
    adapter.providerIdentity = {
        status: 'available',
        provider: 'openrouter',
        model: 'example/model',
        routeKind: 'profile',
        connectionProfileId: 'profile-a',
    };
    const inspector = new SemanticInspector({ adapter });
    const input = {
        snapshot: data.snapshot,
        analysis: data.analysis,
        targetIds: [data.ids.finding],
    };
    const profileA = await inspector.prepare(input);

    assert.equal(profileA.preview.providerIdentity.routeKind, 'profile');
    assert.equal(
        profileA.preview.providerIdentity.connectionProfileId,
        'profile-a',
    );
    assert.doesNotMatch(profileA.prompt, /profile-a/u);

    adapter.providerIdentity.connectionProfileId = 'profile-b';
    const profileB = await inspector.prepare(input);
    assert.notEqual(profileA.requestDigest, profileB.requestDigest);

    adapter.providerIdentity = {
        status: 'available',
        provider: 'openrouter',
        model: 'example/model',
        routeKind: 'current',
        connectionProfileId: null,
    };
    await assert.rejects(
        inspector.inspect(profileA),
        (error) => error.code === 'SEMANTIC_INVALID_INPUT'
            && error.reason === 'provider-identity-changed',
    );
    assert.equal(adapter.calls.length, 0);
});

test('adapter failures are bounded and never expose provider error text', async () => {
    const data = fixture();
    const adapter = new FakeAdapter();
    const inspector = new SemanticInspector({ adapter });
    const prepared = await inspector.prepare({
        snapshot: data.snapshot,
        analysis: data.analysis,
        targetIds: [data.ids.finding],
    });
    adapter.generate = async () => {
        throw new Error('secret provider response body');
    };
    await assert.rejects(
        inspector.inspect(prepared),
        (error) => (
            error instanceof SemanticInspectorError
            && error.code === 'SEMANTIC_PROVIDER_ERROR'
            && error.message === 'SEMANTIC_PROVIDER_ERROR'
            && !JSON.stringify(error).includes('secret provider')
        ),
    );
});

test('provider compatibility codes and fixed reasons cross the inspector boundary', async () => {
    const data = fixture();
    const cases = [
        ['SEMANTIC_AUTHENTICATION_ERROR', 'provider-authentication'],
        ['SEMANTIC_RATE_LIMITED', 'provider-rate-limited'],
        ['SEMANTIC_NETWORK_ERROR', 'provider-network'],
        ['SEMANTIC_PROVIDER_UNAVAILABLE', 'provider-unavailable'],
    ];

    for (const [code, reason] of cases) {
        const adapter = new FakeAdapter();
        const inspector = new SemanticInspector({ adapter });
        const prepared = await inspector.prepare({
            snapshot: data.snapshot,
            analysis: data.analysis,
            targetIds: [data.ids.finding],
        });
        adapter.generate = async () => {
            throw Object.assign(new Error('private provider body'), {
                code,
                reason,
            });
        };
        await assert.rejects(
            inspector.inspect(prepared),
            (value) => (
                value instanceof SemanticInspectorError
                && value.code === code
                && value.reason === reason
                && value.message === code
                && !JSON.stringify(value).includes('private provider')
            ),
        );
    }
});

test('an injected adapter cannot promote an arbitrary reason into UI state', async () => {
    const data = fixture();
    const adapter = new FakeAdapter();
    const inspector = new SemanticInspector({ adapter });
    const prepared = await inspector.prepare({
        snapshot: data.snapshot,
        analysis: data.analysis,
        targetIds: [data.ids.finding],
    });
    adapter.generate = async () => {
        throw Object.assign(new Error('private provider body'), {
            code: 'SEMANTIC_PROVIDER_ERROR',
            reason: 'private-provider-token',
        });
    };
    await assert.rejects(
        inspector.inspect(prepared),
        (value) => (
            value.code === 'SEMANTIC_PROVIDER_ERROR'
            && value.reason === null
        ),
    );
});

test('connection profile discovery is exposed as an optional UI-safe capability', () => {
    const profileList = Object.freeze({
        status: 'available',
        profiles: Object.freeze([Object.freeze({
            id: 'profile-id',
            name: 'Profile',
            provider: 'openrouter',
            model: 'model',
            completionType: 'chat-completion',
        })]),
    });
    const withProfiles = new SemanticInspector({
        adapter: {
            generate: async () => '{}',
            connectionProfiles: () => profileList,
        },
    });
    assert.equal(withProfiles.connectionProfiles(), profileList);

    const withoutProfiles = new SemanticInspector({
        adapter: { generate: async () => '{}' },
    });
    assert.deepEqual(withoutProfiles.connectionProfiles(), {
        status: 'unavailable',
        profiles: [],
    });
});
