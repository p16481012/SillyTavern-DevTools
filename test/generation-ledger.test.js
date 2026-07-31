import assert from 'node:assert/strict';
import test from 'node:test';
import { GenerationLedger } from '../src/generation-ledger.js';

test('explicit public ids claim the matching prompt out of arrival order', () => {
    const ledger = new GenerationLedger();
    ledger.openPrompt({
        promptType: 'chat-completion',
        publicId: 'request-a',
        value: 'A',
    });
    ledger.openPrompt({
        promptType: 'chat-completion',
        publicId: 'request-b',
        value: 'B',
    });

    const second = ledger.claimRequest({
        promptType: 'chat-completion',
        publicId: 'request-b',
        requestIdentity: {},
    });
    const first = ledger.claimRequest({
        promptType: 'chat-completion',
        publicId: 'request-a',
        requestIdentity: {},
    });

    assert.equal(second.status, 'matched');
    assert.equal(second.method, 'explicit-id');
    assert.equal(second.value, 'B');
    assert.equal(first.value, 'A');
    assert.equal(JSON.stringify(second).includes('request-b'), false);
});

test('id-less request bodies use bounded type-specific FIFO without consuming explicit prompts', () => {
    const ledger = new GenerationLedger({ maxPendingPerType: 2 });
    ledger.openPrompt({ promptType: 'chat-completion', value: 'old-overflow' });
    ledger.openPrompt({ promptType: 'chat-completion', publicId: 'exact', value: 'exact' });
    ledger.openPrompt({ promptType: 'chat-completion', value: 'fifo' });
    ledger.openPrompt({ promptType: 'text-completion', value: 'text' });

    const chat = ledger.claimRequest({ promptType: 'chat-completion', requestIdentity: {} });
    const text = ledger.claimRequest({ promptType: 'text-completion', requestIdentity: {} });
    const missing = ledger.claimRequest({
        promptType: 'chat-completion',
        publicId: 'not-exact',
        requestIdentity: {},
    });

    assert.equal(chat.value, 'fifo');
    assert.equal(chat.method, 'fifo');
    assert.equal(text.value, 'text');
    assert.equal(missing.status, 'unmatched');
    assert.equal(missing.reason, 'public-id-not-found');
});

test('same-id collisions fail closed instead of selecting either prompt', () => {
    const ledger = new GenerationLedger();
    ledger.openPrompt({
        promptType: 'chat-completion',
        publicId: 'collision',
        value: 'first',
    });
    ledger.openPrompt({
        promptType: 'chat-completion',
        publicId: 'collision',
        value: 'second',
    });

    const result = ledger.claimRequest({
        promptType: 'chat-completion',
        publicId: 'collision',
        requestIdentity: {},
    });

    assert.equal(result.status, 'ambiguous');
    assert.equal(result.reason, 'ambiguous-public-id');
    assert.equal(JSON.stringify(result).includes('collision'), false);
});

test('duplicate request objects and ids cannot consume a later prompt', () => {
    const ledger = new GenerationLedger();
    const identity = {};
    ledger.openPrompt({ promptType: 'text-completion', value: 'first' });
    const first = ledger.claimRequest({
        promptType: 'text-completion',
        requestIdentity: identity,
    });
    ledger.settlePrompt(first.promptHandle);
    ledger.openPrompt({ promptType: 'text-completion', value: 'second' });

    const duplicate = ledger.claimRequest({
        promptType: 'text-completion',
        requestIdentity: identity,
    });
    assert.equal(duplicate.status, 'duplicate');
    assert.equal(duplicate.reason, 'duplicate-request-object');
});

test('response usage waits for an exact terminal public-id session', () => {
    const ledger = new GenerationLedger();
    const before = ledger.recordUsage({ totalTokens: 12 }, {
        publicId: 'usage-before',
        eventName: 'provider-usage',
    });
    assert.equal(before.status, 'pending');

    const sessionHandle = ledger.beginGeneration({ publicId: 'usage-before' });
    assert.equal(ledger.getUsageRecords(sessionHandle).length, 0);
    ledger.completeGeneration({
        publicId: 'usage-before',
        status: 'ended',
        statusEvent: 'GENERATION_ENDED',
    });
    assert.deepEqual(
        ledger.getUsageRecords(sessionHandle).map(({ usage }) => usage.totalTokens),
        [12],
    );

    const after = ledger.recordUsage({ totalTokens: 13 }, {
        publicId: 'usage-before',
    });
    assert.equal(after.status, 'linked');
    assert.deepEqual(
        ledger.getUsageRecords(sessionHandle).map(({ usage }) => usage.totalTokens),
        [12, 13],
    );
});

test('usage without an id or with an ambiguous id remains separately unlinked', () => {
    const ledger = new GenerationLedger();
    ledger.beginGeneration({ publicId: 'duplicate' });
    ledger.beginGeneration({ publicId: 'duplicate' });

    assert.equal(ledger.recordUsage({ totalTokens: 1 }).status, 'unlinked');
    assert.equal(ledger.recordUsage({ totalTokens: 2 }, { publicId: 'duplicate' }).status, 'unlinked');
    assert.deepEqual(
        ledger.drainUnlinkedUsage().map(({ reason, hasPublicId }) => [reason, hasPublicId]),
        [
            ['missing-public-id', false],
            ['ambiguous-public-id', true],
        ],
    );
});

test('local usage uses only an explicit handle or a single active session', () => {
    const ledger = new GenerationLedger();
    const only = ledger.beginGeneration();
    const inferred = ledger.recordLocalUsage({ totalTokens: 3 }, {
        eventName: 'MESSAGE_RECEIVED',
    });
    assert.equal(inferred.status, 'linked');
    assert.equal(inferred.record.correlationMethod, 'single-active-session');
    assert.equal(inferred.record.hasPublicId, false);

    const second = ledger.beginGeneration();
    const ambiguous = ledger.recordLocalUsage({ totalTokens: 4 });
    assert.equal(ambiguous.status, 'unlinked');
    assert.equal(ambiguous.reason, 'ambiguous-active-session');

    const exact = ledger.recordLocalUsage({ totalTokens: 5 }, {
        sessionHandle: second,
    });
    assert.equal(exact.status, 'linked');
    assert.equal(exact.record.correlationMethod, 'session-handle');
    assert.deepEqual(
        ledger.getUsageRecords(only).map(({ usage }) => usage.totalTokens),
        [3],
    );
    assert.deepEqual(
        ledger.getUsageRecords(second).map(({ usage }) => usage.totalTokens),
        [5],
    );
});

test('local usage never falls back from an invalid handle to an active session', () => {
    const ledger = new GenerationLedger();
    ledger.beginGeneration();
    const result = ledger.recordLocalUsage({ totalTokens: 7 }, {
        sessionHandle: Object.freeze({}),
    });

    assert.equal(result.status, 'unlinked');
    assert.equal(result.reason, 'invalid-session-handle');
});

test('local usage filters concurrent active sessions by bounded exact generation type', () => {
    const ledger = new GenerationLedger();
    const normal = ledger.beginGeneration({ generationType: 'normal' });
    const regenerate = ledger.beginGeneration({ generationType: 'regenerate' });
    const linked = ledger.recordLocalUsage({ totalTokens: 8 }, {
        generationType: 'normal',
    });

    assert.equal(linked.status, 'linked');
    assert.deepEqual(
        ledger.getUsageRecords(normal).map(({ usage }) => usage.totalTokens),
        [8],
    );
    assert.deepEqual(ledger.getUsageRecords(regenerate), []);

    const missing = ledger.recordLocalUsage({ totalTokens: 9 }, {
        generationType: 'impersonate',
    });
    assert.equal(missing.status, 'unlinked');
    assert.equal(missing.reason, 'generation-type-session-not-found');
});

test('unknown and oversized generation types never bypass active-session ambiguity', () => {
    const ledger = new GenerationLedger();
    ledger.beginGeneration({ generationType: 'x'.repeat(65) });
    ledger.beginGeneration({ generationType: 'unknown' });

    const result = ledger.recordLocalUsage({ totalTokens: 1 }, {
        generationType: 'x'.repeat(65),
    });
    assert.equal(result.status, 'unlinked');
    assert.equal(result.reason, 'ambiguous-active-session');
});

test('generation type correlation uses exact strings without trimming or case folding', () => {
    const ledger = new GenerationLedger();
    ledger.beginGeneration({ generationType: ' normal ' });

    const result = ledger.recordLocalUsage({ totalTokens: 1 }, {
        generationType: 'normal',
    });
    assert.equal(result.status, 'unlinked');
    assert.equal(result.reason, 'generation-type-session-not-found');
});

test('overlapping unlabelled generations do not share lore or lifecycle events', () => {
    const ledger = new GenerationLedger();
    const first = ledger.beginGeneration({ generationType: 'normal' });
    const second = ledger.beginGeneration({ generationType: 'regenerate' });
    const lore = ledger.recordLore([{ uid: 1 }]);
    const stopped = ledger.completeGeneration({
        status: 'stopped',
        statusEvent: 'GENERATION_STOPPED',
    });

    assert.equal(lore.status, 'unlinked');
    assert.equal(stopped.status, 'ambiguous');
    assert.equal(ledger.getSessionView(first).status, 'started');
    assert.equal(ledger.getSessionView(second).status, 'started');
    assert.equal(ledger.drainUnlinkedLore().length, 1);
});

test('public ids isolate nested lore and reverse-order completion', () => {
    const ledger = new GenerationLedger();
    const first = ledger.beginGeneration({ publicId: 'first', generationType: 'normal' });
    const second = ledger.beginGeneration({ publicId: 'second', generationType: 'regenerate' });
    ledger.recordLore([{ uid: 1 }], { publicId: 'first' });
    ledger.recordLore([{ uid: 2 }], { publicId: 'second' });

    const promptTwo = ledger.openPrompt({
        promptType: 'chat-completion',
        publicId: 'second',
        value: 'two',
    });
    const promptOne = ledger.openPrompt({
        promptType: 'chat-completion',
        publicId: 'first',
        value: 'one',
    });
    ledger.completeGeneration({
        publicId: 'second',
        status: 'ended',
        statusEvent: 'GENERATION_ENDED',
    });
    ledger.completeGeneration({
        publicId: 'first',
        status: 'stopped',
        statusEvent: 'GENERATION_STOPPED',
    });

    assert.equal(promptTwo.activatedLore[0].uid, 2);
    assert.equal(promptOne.activatedLore[0].uid, 1);
    assert.equal(ledger.getSessionView(first).status, 'stopped');
    assert.equal(ledger.getSessionView(second).status, 'ended');
});

test('timeouts close only stale sessions and keep handles opaque', () => {
    let now = 0;
    const ledger = new GenerationLedger({
        now: () => now,
        sessionTimeoutMs: 10,
    });
    const stale = ledger.beginGeneration({ publicId: 'raw-secret-id' });
    now = 5;
    const fresh = ledger.beginGeneration();
    now = 11;
    const expired = ledger.expire();

    assert.equal(expired.length, 1);
    assert.equal(ledger.getSessionView(stale).status, 'timeout');
    assert.equal(ledger.getSessionView(fresh).status, 'started');
    assert.equal(JSON.stringify(ledger.getSessionView(stale)).includes('raw-secret-id'), false);
    assert.deepEqual(Object.keys(stale), []);
});

test('session capacity evicts inactive oldest entries but never active sessions', () => {
    let now = 0;
    const ledger = new GenerationLedger({
        now: () => now,
        maxSessions: 2,
        sessionTimeoutMs: 1_000,
    });
    const first = ledger.beginGeneration({ publicId: 'first' });
    now = 1;
    const second = ledger.beginGeneration({ publicId: 'second' });
    now = 2;
    const overflow = ledger.beginGeneration({ publicId: 'third' });

    assert.equal(ledger.getSessionView(first).status, 'started');
    assert.equal(ledger.getSessionView(second).status, 'started');
    assert.equal(ledger.getSessionView(overflow).status, 'overflow');
    assert.equal(ledger.getSessionView(overflow).overflow, true);

    ledger.completeGeneration({
        publicId: 'first',
        status: 'ended',
        statusEvent: 'GENERATION_ENDED',
    });
    now = 3;
    const replacement = ledger.beginGeneration({ publicId: 'first' });
    assert.equal(ledger.getSessionView(replacement).publicIdCollision, false);
    assert.equal(ledger.getSessionView(second).status, 'started');
});

test('stale inactive cleanup permits later public-id reuse without permanent collision', () => {
    let now = 0;
    const ledger = new GenerationLedger({
        now: () => now,
        sessionTimeoutMs: 10,
    });
    ledger.beginGeneration({ publicId: 'reused' });
    ledger.completeGeneration({
        publicId: 'reused',
        status: 'ended',
        statusEvent: 'GENERATION_ENDED',
    });
    now = 11;
    const reused = ledger.beginGeneration({ publicId: 'reused' });

    assert.equal(ledger.getSessionView(reused).publicIdCollision, false);
    assert.equal(ledger.getSessionView(reused).status, 'started');
});

test('public-id buffers are bounded and overflow records lose raw identifiers', () => {
    const ledger = new GenerationLedger({
        maxBufferedPublicIds: 2,
        maxUnlinkedRecords: 4,
    });
    ledger.recordUsage({ totalTokens: 1 }, { publicId: 'buffer-one' });
    ledger.recordUsage({ totalTokens: 2 }, { publicId: 'buffer-two' });
    ledger.recordUsage({ totalTokens: 3 }, { publicId: 'buffer-three' });
    const overflow = ledger.drainUnlinkedUsage();

    assert.equal(overflow.length, 1);
    assert.equal(overflow[0].reason, 'buffer-overflow');
    assert.equal(overflow[0].usage.totalTokens, 1);
    assert.equal(JSON.stringify(overflow).includes('buffer-one'), false);
});
