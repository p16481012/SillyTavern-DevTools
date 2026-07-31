import assert from 'node:assert/strict';
import test from 'node:test';

import {
    AnalysisCache,
    createAnalysisCacheKey,
} from '../src/analysis-cache.js';

test('analysis cache keys contain only bounded digest metadata', () => {
    const snapshotDigest = 'a'.repeat(64);
    const configurationDigest = `config:v1:${'b'.repeat(16)}`;
    const key = createAnalysisCacheKey({
        kind: 'rules',
        snapshotDigest,
        configurationDigest,
        revision: 7,
    });
    assert.equal(
        key,
        `analysis:v1:rules:${snapshotDigest}:config-v1-${'b'.repeat(16)}:default:7`,
    );
    assert.match(createAnalysisCacheKey({
        kind: 'diff',
        snapshotDigest: 'config:v1:0123456789abcdef',
        configurationDigest: 'fedcba9876543210',
    }), /^analysis:v1:diff:/u);
    assert.equal(createAnalysisCacheKey({
        kind: 'rules',
        snapshotDigest: 'ignore-previous-instructions',
        configurationDigest: 'private-prompt-text',
    }), null);
    assert.equal(createAnalysisCacheKey({
        kind: 'private-prompt-text',
        snapshotDigest,
        configurationDigest,
    }), null);
    assert.equal(createAnalysisCacheKey({
        kind: 'rules',
        snapshotDigest,
        configurationDigest,
        variant: 'private-prompt-text',
    }), null);
});

test('analysis cache is memory-only, revision-aware, and LRU bounded', () => {
    let now = 1_000;
    const keys = ['a', 'b', 'c'].map(
        (snapshotDigest) => createAnalysisCacheKey({
            kind: 'rules',
            snapshotDigest: snapshotDigest.repeat(64),
            configurationDigest: 'd'.repeat(64),
            revision: 1,
        }),
    );
    const cache = new AnalysisCache({
        maxEntries: 2,
        maxBytes: 10_000,
        ttlMs: 1_000,
        now: () => now,
    });
    cache.set(keys[0], { value: 1 }, { revision: 1 });
    cache.set(keys[1], { value: 2 }, { revision: 1 });
    assert.deepEqual(cache.get(keys[0], { revision: 1 }), { value: 1 });
    cache.set(keys[2], { value: 3 }, { revision: 1 });
    assert.equal(cache.get(keys[1], { revision: 1 }), undefined);
    assert.deepEqual(cache.get(keys[0], { revision: 1 }), { value: 1 });
    assert.equal(cache.get(keys[0], { revision: 2 }), undefined);
    assert.equal(cache.status().storage, 'memory-only');
    assert.equal('persist' in cache, false);

    now += 2_000;
    assert.equal(cache.size, 0);
    assert.equal(cache.estimatedBytes, 0);
});

test('oversized or unserializable cache values are rejected safely', () => {
    const cache = new AnalysisCache({ maxBytes: 1024 });
    const key = createAnalysisCacheKey({
        kind: 'rules',
        snapshotDigest: 'a'.repeat(64),
        configurationDigest: 'b'.repeat(64),
    });
    assert.equal(cache.set('raw prompt text', { unsafe: true }), false);
    assert.equal(cache.set(key, 'x'.repeat(2_000)), false);
    assert.equal(
        cache.set(key, 'x'.repeat(2_000), { estimatedBytes: 1 }),
        false,
    );
    assert.equal(cache.set(key, undefined, { estimatedBytes: 1 }), false);
    const circular = {};
    circular.self = circular;
    assert.equal(cache.set(key, circular), false);
    assert.equal(cache.size, 0);
});

test('cache revisions must match their structured key and time never rewinds', () => {
    let now = 1_000;
    const key = createAnalysisCacheKey({
        kind: 'diff',
        snapshotDigest: 'a'.repeat(64),
        configurationDigest: 'b'.repeat(64),
        revision: 4,
    });
    const cache = new AnalysisCache({
        ttlMs: 100,
        now: () => now,
    });
    assert.equal(cache.set(key, { value: 4 }, { revision: 3 }), false);
    assert.equal(cache.set(key, { value: 4 }), true);
    assert.deepEqual(cache.get(key), { value: 4 });
    assert.equal(cache.get(key, { revision: 3 }), undefined);

    now = 900;
    assert.deepEqual(cache.get(key, { revision: 4 }), { value: 4 });
    now = 1_101;
    assert.equal(cache.get(key, { revision: 4 }), undefined);
    assert.equal(cache.estimatedBytes, 0);
});
