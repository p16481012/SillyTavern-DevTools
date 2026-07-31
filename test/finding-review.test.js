import assert from 'node:assert/strict';
import test from 'node:test';
import {
    FINDING_REVIEW_DOCUMENT_VERSION,
    applyFindingReviews,
    findingKey,
    normalizeFindingReviewDocument,
    resolveFindingReview,
    reviewScopeKey,
    setFindingDecision,
    setFindingIgnore,
    sourceFingerprint,
    suppressionKey,
} from '../src/finding-review.js';

function source(identifier, overrides = {}) {
    return {
        id: `capture:${identifier}`,
        type: 'utility',
        label: `Prompt ${identifier}`,
        content: `Instruction ${identifier}`,
        ranges: [{ start: 10, end: 20 }],
        metadata: {
            sourceKind: 'configuredPrompt',
            identifier,
            name: `Prompt ${identifier}`,
        },
        ...overrides,
    };
}

function finding(overrides = {}) {
    return {
        ruleId: 'language',
        id: 'language-conflict',
        method: 'instruction-atoms-v3',
        determination: 'conflict',
        evidence: '한국어로 답하세요. English only.',
        sourceIds: ['capture:ko', 'capture:en'],
        ...overrides,
    };
}

test('source fingerprints prefer identifiers and ignore capture order and offsets', () => {
    const first = source('language-ko');
    const moved = source('language-ko', {
        id: 'utility:999',
        label: 'Renamed display label',
        content: 'Edited prompt content',
        ranges: [{ start: 5000, end: 5100 }],
        metadata: {
            sourceKind: 'configuredPrompt',
            identifier: 'language-ko',
            name: 'Renamed display label',
            captureIndex: 999,
        },
    });
    assert.equal(sourceFingerprint(first), sourceFingerprint(moved));
    assert.doesNotMatch(sourceFingerprint(first), /language-ko/u);
});

test('persisted review keys use locale-independent Unicode case folding', () => {
    const localeSensitiveSource = {
        id: 'source:locale',
        type: 'utility',
        label: 'I İ',
        content: 'I İ',
        metadata: {
            sourceKind: 'configuredPrompt',
            identifier: 'I İ',
        },
    };
    const localeSensitiveFinding = {
        ruleId: 'I',
        id: 'I:İ',
        method: 'I',
        sourceIds: [localeSensitiveSource.id],
        evidence: 'I İ',
        suppressionSignature: 'I İ',
    };

    assert.equal(
        sourceFingerprint(localeSensitiveSource),
        'source:id:021fa38895bf904e',
    );
    assert.equal(
        findingKey(localeSensitiveFinding, [localeSensitiveSource]),
        'finding:v1:8bf02d212fe0138a',
    );
    assert.equal(
        suppressionKey(localeSensitiveFinding, [localeSensitiveSource]),
        'suppression:v1:1e962feab1c02523',
    );
});

test('fallback source fingerprints are order and offset independent', () => {
    const first = {
        id: 'source:0',
        type: 'character',
        label: 'Character Description',
        content: 'Stable description',
        ranges: [{ start: 1, end: 19 }],
        metadata: { sourceKind: 'character', captureIndex: 0 },
    };
    const moved = {
        ...first,
        id: 'source:88',
        ranges: [{ start: 900, end: 918 }],
        metadata: { sourceKind: 'character', captureIndex: 88 },
    };
    assert.equal(sourceFingerprint(first), sourceFingerprint(moved));
});

test('fallback suppression identities preserve numeric source position and depth', () => {
    const fallbackSource = (id, position, depth, ranges) => ({
        id,
        type: 'extension',
        label: 'Same label',
        content: 'Same instruction',
        position,
        depth,
        ranges,
        metadata: { sourceKind: 'extension' },
    });
    const atZero = fallbackSource(
        'source:zero',
        0,
        0,
        [{ start: 1, end: 5 }],
    );
    const movedAtZero = fallbackSource(
        'source:moved',
        0,
        0,
        [{ start: 900, end: 904 }],
    );
    const atOne = fallbackSource(
        'source:one',
        1,
        1,
        [{ start: 1, end: 5 }],
    );
    const baseFinding = finding({ sourceIds: [atZero.id] });

    assert.equal(
        suppressionKey(baseFinding, [atZero]),
        suppressionKey(
            { ...baseFinding, sourceIds: [movedAtZero.id] },
            [movedAtZero],
        ),
    );
    assert.notEqual(
        suppressionKey(baseFinding, [atZero]),
        suppressionKey(
            { ...baseFinding, sourceIds: [atOne.id] },
            [atOne],
        ),
    );
});

test('finding keys are source-order independent and never expose evidence', () => {
    const sources = [source('ko'), source('en')];
    const original = finding();
    const reordered = finding({ sourceIds: [...original.sourceIds].reverse() });

    assert.equal(findingKey(original, sources), findingKey(reordered, sources));
    assert.equal(suppressionKey(original, sources), suppressionKey(reordered, sources));
    assert.doesNotMatch(findingKey(original, sources), /한국어|English/u);
    assert.doesNotMatch(suppressionKey(original, sources), /한국어|English/u);

    const changed = finding({ evidence: 'Different raw evidence' });
    assert.notEqual(findingKey(original, sources), findingKey(changed, sources));
    assert.equal(suppressionKey(original, sources), suppressionKey(changed, sources));
});

test('suppression signatures keep distinct non-semantic findings isolated', () => {
    const sources = [source('ko'), source('en')];
    const first = finding({
        ruleId: 'duplicate',
        id: 'duplicate:0',
        evidence: 'First duplicated sentence.',
        suppressionSignature: 'first duplicated sentence',
    });
    const second = finding({
        ruleId: 'duplicate',
        id: 'duplicate:1',
        evidence: 'Second duplicated sentence.',
        suppressionSignature: 'second duplicated sentence',
    });

    assert.notEqual(
        suppressionKey(first, sources),
        suppressionKey(second, sources),
    );

    const document = setFindingIgnore({}, first, sources, {
        scope: 'global',
    });
    const result = applyFindingReviews([first, second], sources, document);
    assert.deepEqual(
        result.hidden.map(({ id }) => id),
        ['duplicate:0'],
    );
    assert.deepEqual(
        result.visible.map(({ id }) => id),
        ['duplicate:1'],
    );
});

test('semantic finding keys ignore translated messages and range changes', () => {
    const sources = [source('ko'), source('en')];
    const semanticRecords = [{
        category: 'language',
        target: 'response',
        property: 'response.language',
        value: 'korean',
        polarity: 'require',
        condition: null,
        exception: null,
    }, {
        category: 'language',
        target: 'response',
        property: 'response.language',
        value: 'english',
        polarity: 'require',
        condition: null,
        exception: null,
    }];
    const original = finding({
        relationKind: 'incompatible-value',
        semanticRecords,
        message: '첫 번째 번역',
        evidenceRecords: [{ start: 1, end: 2 }],
    });
    const translated = {
        ...original,
        id: 'language-conflict:temporary-order-suffix',
        message: 'Changed localized wording',
        evidence: 'Moved raw text',
        evidenceRecords: [{ start: 900, end: 950 }],
    };
    assert.equal(findingKey(original, sources), findingKey(translated, sources));
    assert.equal(suppressionKey(original, sources), suppressionKey(translated, sources));

    const changedMeaning = {
        ...translated,
        semanticRecords: semanticRecords.map((record, index) => (
            index === 1 ? { ...record, value: 'japanese' } : record
        )),
    };
    assert.notEqual(findingKey(original, sources), findingKey(changedMeaning, sources));
});

test('scoped ignores distinguish semantic conditions and exceptions', () => {
    const sources = [source('ko'), source('en')];
    const base = finding({
        relationKind: 'incompatible-value',
        semanticRecords: [{
            category: 'language',
            target: 'response',
            action: 'set',
            property: 'response.language',
            value: 'korean',
            polarity: 'require',
            scope: 'output',
            condition: 'when the user writes in Korean',
            exception: null,
            priority: 'normal',
            status: 'confirmed',
        }],
    });
    const otherCondition = {
        ...base,
        semanticRecords: [{
            ...base.semanticRecords[0],
            condition: 'always',
        }],
    };
    const withException = {
        ...base,
        semanticRecords: [{
            ...base.semanticRecords[0],
            exception: 'unless the user requests English',
        }],
    };

    assert.notEqual(
        suppressionKey(base, sources),
        suppressionKey(otherCondition, sources),
    );
    assert.notEqual(
        suppressionKey(base, sources),
        suppressionKey(withException, sources),
    );
});

test('normalization accepts aliases, deduplicates, caps audit, and drops raw fields', () => {
    const sources = [source('ko'), source('en')];
    const exactKey = findingKey(finding(), sources);
    const broadKey = suppressionKey(finding(), sources);
    const audit = Array.from({ length: 305 }, (_, index) => ({
        at: new Date(2026, 0, 1, 0, 0, index).toISOString(),
        action: 'decision.valid',
        targetKey: exactKey,
        evidence: `raw prompt ${index}`,
        message: `raw evidence ${index}`,
    }));
    const normalized = normalizeFindingReviewDocument({
        version: 99,
        exactDecisions: [
            { findingKey: exactKey, decision: 'false-positive' },
            { findingKey: exactKey, decision: 'valid' },
        ],
        scopedIgnores: [{
            suppressionKey: broadKey,
            scope: 'preset',
            scopeKey: 'My Preset',
            label: 'Preset label',
        }],
        audit,
    });

    assert.equal(normalized.version, FINDING_REVIEW_DOCUMENT_VERSION);
    assert.deepEqual(normalized.decisions, [{
        findingKey: exactKey,
        decision: 'valid',
        updatedAt: null,
    }]);
    assert.equal(normalized.ignores[0].scopeKey, reviewScopeKey('preset', 'My Preset'));
    assert.equal(normalized.audit.length, 300);
    assert.equal('evidence' in normalized.audit[0], false);
    assert.equal('message' in normalized.audit[0], false);
});

test('normalization rejects prototype-polluting documents and oversized JSON', () => {
    const polluted = JSON.parse(
        '{"decisions":[],"__proto__":{"polluted":"yes"}}',
    );
    const normalized = normalizeFindingReviewDocument(polluted);
    assert.deepEqual(normalized, {
        version: FINDING_REVIEW_DOCUMENT_VERSION,
        decisions: [],
        ignores: [],
        audit: [],
    });
    assert.equal({}.polluted, undefined);

    const oversized = JSON.stringify({ padding: 'x'.repeat(1_048_577) });
    assert.deepEqual(normalizeFindingReviewDocument(oversized), normalized);
});

test('scope resolution follows global, preset, character, then chat precedence', () => {
    const sources = [source('ko'), source('en')];
    const target = finding();
    const broadKey = suppressionKey(target, sources);
    const document = {
        ignores: [
            { suppressionKey: broadKey, scope: 'global' },
            { suppressionKey: broadKey, scope: 'preset', scopeKey: 'Preset A' },
            { suppressionKey: broadKey, scope: 'character', scopeKey: 'Alice' },
            { suppressionKey: broadKey, scope: 'chat', scopeKey: 'Chat 42' },
        ],
    };
    const context = {
        presetName: 'Preset A',
        characterName: 'Alice',
        chatId: 'Chat 42',
    };
    const resolved = resolveFindingReview(target, sources, document, context);
    assert.equal(resolved.ignored, true);
    assert.equal(resolved.ignoreScope, 'chat');

    const otherChat = resolveFindingReview(target, sources, document, {
        presetName: 'Preset A',
        characterName: 'Alice',
        chatId: 'Other chat',
    });
    assert.equal(otherChat.ignoreScope, 'character');
});

test('an exact valid decision overrides an applicable broader ignore', () => {
    const sources = [source('ko'), source('en')];
    const target = finding();
    const document = {
        decisions: [{
            findingKey: findingKey(target, sources),
            decision: 'valid',
        }],
        ignores: [{
            suppressionKey: suppressionKey(target, sources),
            scope: 'global',
        }],
    };
    const result = resolveFindingReview(target, sources, document);
    assert.equal(result.decision, 'valid');
    assert.equal(result.ignored, false);
    assert.equal(result.hidden, false);
});

test('apply classifies hide-once entries without persisting or mutating inputs', () => {
    const sources = [source('ko'), source('en')];
    const first = finding();
    const second = finding({
        ruleId: 'format',
        id: 'format-conflict',
        evidence: 'JSON only. Markdown only.',
    });
    const document = { decisions: [], ignores: [], audit: [] };
    const originalDocument = structuredClone(document);
    const hiddenOnce = new Set([findingKey(first, sources)]);

    const result = applyFindingReviews(
        [first, second],
        sources,
        document,
        {},
        hiddenOnce,
    );

    assert.equal(result.counts.total, 2);
    assert.equal(result.counts.hidden, 1);
    assert.equal(result.hidden[0].review.hiddenOnce, true);
    assert.equal(result.visible[0].ruleId, 'format');
    assert.deepEqual(document, originalDocument);
    assert.equal(hiddenOnce.size, 1);
    assert.equal('review' in first, false);
});

test('review mutation helpers replace decisions and scope ignores with bounded audit', () => {
    const sources = [source('ko'), source('en')];
    const target = finding();
    const reviewed = setFindingDecision({}, target, sources, 'false-positive', {
        at: '2026-01-02T03:04:05.000Z',
    });
    assert.equal(reviewed.decisions[0].decision, 'false-positive');
    assert.equal(reviewed.audit[0].action, 'decision.false-positive');

    const ignored = setFindingIgnore(reviewed, target, sources, {
        scope: 'chat',
        scopeKey: 'scope-v1:chat-key',
        label: '현재 채팅',
        at: '2026-01-02T03:05:05.000Z',
    });
    assert.equal(ignored.ignores[0].scope, 'chat');
    assert.equal(ignored.audit.at(-1).action, 'ignore.add');
    assert.equal(JSON.stringify(ignored).includes('한국어로 답하세요'), false);

    const cleared = setFindingDecision(ignored, target, sources, null);
    assert.equal(cleared.decisions.length, 0);
    assert.equal(cleared.audit.at(-1).action, 'decision.clear');
});
