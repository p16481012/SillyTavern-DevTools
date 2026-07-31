import assert from 'node:assert/strict';
import test from 'node:test';

import {
    AnalysisCache,
    createAnalysisCacheKey,
} from '../src/analysis-cache.js';
import {
    AnalysisRuntime,
    AnalysisRuntimeError,
} from '../src/analysis-runtime.js';

function snapshot(id, content = 'Reply in Korean.') {
    return {
        id,
        finalText: content,
        sources: [{
            id: 'source:1',
            type: 'utility',
            label: 'Rule',
            content,
            included: true,
            configuredEnabled: true,
            ranges: [{ start: 0, end: content.length }],
            tokenCount: 5,
            metadata: {},
        }],
        lorebookEntries: [],
        stats: { totalTokens: 5 },
    };
}

class FakeWorker {
    static instances = [];

    constructor(url, options) {
        this.url = url;
        this.options = options;
        this.listeners = new Map();
        this.terminated = false;
        FakeWorker.instances.push(this);
    }

    addEventListener(type, callback) {
        this.listeners.set(type, callback);
    }

    removeEventListener(type, callback) {
        if (this.listeners.get(type) === callback) this.listeners.delete(type);
    }

    postMessage(message) {
        const messageHandler = this.listeners.get('message');
        queueMicrotask(() => {
            messageHandler?.({
                data: {
                    ok: true,
                    requestId: message.requestId,
                    revision: message.revision,
                    result: [{ sourceId: 'source:1' }],
                },
            });
        });
    }

    terminate() {
        this.terminated = true;
    }
}

class SilentWorker extends FakeWorker {
    postMessage() {}
}

class ThrowingWorker extends FakeWorker {
    postMessage() {
        throw new Error('clone failed');
    }
}

test('analysis workers use the browser module contract and always terminate', async () => {
    FakeWorker.instances = [];
    const runtime = new AnalysisRuntime({ WorkerClass: FakeWorker });
    const response = await runtime.run('search', {
        snapshot: snapshot('one'),
        query: 'Korean',
        options: {},
    }, { revision: 3 });
    const worker = FakeWorker.instances.at(-1);
    assert.equal(response.source, 'worker');
    assert.deepEqual(response.result, [{ sourceId: 'source:1' }]);
    assert.equal(worker.url instanceof URL, true);
    assert.match(worker.url.pathname, /analysis-worker\.js$/u);
    assert.deepEqual(worker.options, {
        type: 'module',
        name: 'st-devtools-analysis-search',
    });
    assert.equal(worker.terminated, true);
});

test('analysis timeout, cancellation, and serialization errors terminate workers', async () => {
    const timeoutRuntime = new AnalysisRuntime({
        WorkerClass: SilentWorker,
        timeoutMs: 100,
    });
    await assert.rejects(
        timeoutRuntime.run('search', {
            snapshot: snapshot('timeout'),
            query: 'x',
        }),
        (error) => (
            error instanceof AnalysisRuntimeError
            && error.code === 'analysis-timeout'
        ),
    );
    assert.equal(FakeWorker.instances.at(-1).terminated, true);

    const controller = new AbortController();
    const cancelled = timeoutRuntime.run('search', {
        snapshot: snapshot('cancelled'),
        query: 'x',
    }, { signal: controller.signal });
    controller.abort();
    await assert.rejects(cancelled, { code: 'analysis-cancelled' });
    assert.equal(FakeWorker.instances.at(-1).terminated, true);

    const throwingRuntime = new AnalysisRuntime({ WorkerClass: ThrowingWorker });
    await assert.rejects(
        throwingRuntime.run('search', {
            snapshot: snapshot('clone'),
            query: 'x',
        }),
        { code: 'analysis-worker-failed' },
    );
    assert.equal(FakeWorker.instances.at(-1).terminated, true);
});

test('worker setup and malformed message failures terminate immediately', async () => {
    class ListenerFailureWorker extends FakeWorker {
        addEventListener() {
            throw new Error('listener setup failed');
        }
    }
    await assert.rejects(
        new AnalysisRuntime({ WorkerClass: ListenerFailureWorker }).run(
            'search',
            { snapshot: snapshot('listener'), query: 'x' },
        ),
        { code: 'analysis-worker-failed' },
    );
    assert.equal(FakeWorker.instances.at(-1).terminated, true);

    class MalformedMessageWorker extends FakeWorker {
        postMessage() {
            const messageHandler = this.listeners.get('message');
            queueMicrotask(() => messageHandler?.({
                get data() {
                    throw new Error('malformed message');
                },
            }));
        }
    }
    await assert.rejects(
        new AnalysisRuntime({ WorkerClass: MalformedMessageWorker }).run(
            'search',
            { snapshot: snapshot('message'), query: 'x' },
        ),
        { code: 'analysis-worker-failed' },
    );
    assert.equal(FakeWorker.instances.at(-1).terminated, true);
});

test('stale worker results are rejected and never cached', async () => {
    let revision = 1;
    class RevisionWorker extends FakeWorker {
        postMessage(message) {
            revision = 2;
            super.postMessage(message);
        }
    }
    const cache = new AnalysisCache();
    const cacheKey = createAnalysisCacheKey({
        kind: 'search',
        snapshotDigest: 'a'.repeat(64),
        configurationDigest: 'b'.repeat(64),
        revision: 1,
    });
    const runtime = new AnalysisRuntime({
        WorkerClass: RevisionWorker,
        cache,
        revisionProvider: () => revision,
    });
    await assert.rejects(
        runtime.run('search', {
            snapshot: snapshot('stale'),
            query: 'x',
        }, {
            cacheKey,
            revision: 1,
        }),
        { code: 'analysis-stale' },
    );
    assert.equal(cache.size, 0);
    assert.equal(FakeWorker.instances.at(-1).terminated, true);
});

test('a stale explicit revision cannot return a cached result', async () => {
    FakeWorker.instances = [];
    const cache = new AnalysisCache();
    const cacheKey = createAnalysisCacheKey({
        kind: 'search',
        snapshotDigest: 'a'.repeat(64),
        configurationDigest: 'b'.repeat(64),
        revision: 1,
    });
    cache.set(cacheKey, [{ stale: true }], { revision: 1 });
    const runtime = new AnalysisRuntime({
        WorkerClass: FakeWorker,
        cache,
        revisionProvider: () => 2,
    });
    await assert.rejects(
        runtime.run('search', {
            snapshot: snapshot('cached-stale'),
            query: 'x',
        }, {
            cacheKey,
            revision: 1,
        }),
        { code: 'analysis-stale' },
    );
    assert.equal(FakeWorker.instances.length, 0);
});

test('bounded local fallback runs search, diff, and rule analysis', async () => {
    const runtime = new AnalysisRuntime({ WorkerClass: null });
    const search = await runtime.run('search', {
        snapshot: snapshot('search'),
        query: 'Korean',
        options: {},
    });
    assert.equal(search.source, 'local');
    assert.equal(search.result.length, 1);

    const diff = await runtime.run('diff', {
        baseSnapshot: snapshot('base', 'Reply in Korean.'),
        compareSnapshot: snapshot('compare', 'Reply in English.'),
    });
    assert.equal(Array.isArray(diff.result.sources), true);
    assert.equal(typeof diff.result.lore, 'object');

    const rules = await runtime.run('rules', {
        snapshot: snapshot('rules'),
    });
    assert.equal(Array.isArray(rules.result.findings), true);
    assert.equal(typeof rules.result.instructions, 'object');
    assert.equal(typeof rules.result.comparison, 'object');
});

test('local fallback rejects aggregate prompt data before blocking the main thread', async () => {
    const largeSnapshot = snapshot('too-large', 'small final text');
    largeSnapshot.sources[0].content = 'x'.repeat(500_001);
    await assert.rejects(
        new AnalysisRuntime({ WorkerClass: null }).run('rules', {
            snapshot: largeSnapshot,
        }),
        { code: 'analysis-input-too-large' },
    );
});
