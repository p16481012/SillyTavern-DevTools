import assert from 'node:assert/strict';
import test from 'node:test';
import { searchSnapshotSafely } from '../src/search-runtime.js';

const snapshot = {
    sources: [{
        id: 'source',
        type: 'system',
        label: 'Source',
        content: 'Alpha beta ALPHA',
    }],
};

test('safe search runtime keeps literal search available without a worker', async () => {
    const matches = await searchSnapshotSafely(snapshot, 'alpha', {
        caseSensitive: false,
    }, {
        WorkerClass: null,
    });
    assert.equal(matches.length, 2);
});

test('regex search resolves worker results and always terminates the worker', async () => {
    let terminated = false;
    let postedSnapshot = null;
    class SuccessfulWorker {
        handlers = new Map();

        addEventListener(name, handler) {
            this.handlers.set(name, handler);
        }

        postMessage(payload) {
            postedSnapshot = payload.snapshot;
            queueMicrotask(() => this.handlers.get('message')?.({
                data: {
                    ok: true,
                    matches: [{ sourceId: 'source', index: 0 }],
                },
            }));
        }

        terminate() {
            terminated = true;
        }
    }

    const matches = await searchSnapshotSafely(snapshot, 'alpha', { regex: true }, {
        WorkerClass: SuccessfulWorker,
    });
    assert.deepEqual(matches, [{ sourceId: 'source', index: 0 }]);
    assert.deepEqual(postedSnapshot, { sources: snapshot.sources });
    assert.equal(terminated, true);
});

test('regex worker timeout terminates the worker and reports a stable code', async () => {
    let terminated = false;
    class HangingWorker {
        addEventListener() {}

        postMessage() {}

        terminate() {
            terminated = true;
        }
    }

    await assert.rejects(
        () => searchSnapshotSafely(snapshot, 'alpha', { regex: true }, {
            WorkerClass: HangingWorker,
            timeoutMs: 100,
        }),
        (error) => error.code === 'regex-timeout',
    );
    assert.equal(terminated, true);
});

test('aborting a regex search terminates its worker', async () => {
    let terminated = false;
    class HangingWorker {
        addEventListener() {}

        postMessage() {}

        terminate() {
            terminated = true;
        }
    }
    const controller = new AbortController();
    const promise = searchSnapshotSafely(snapshot, 'alpha', { regex: true }, {
        WorkerClass: HangingWorker,
        signal: controller.signal,
    });
    controller.abort();
    await assert.rejects(promise, (error) => error.code === 'search-cancelled');
    assert.equal(terminated, true);
});

test('worker serialization failures reject safely and terminate immediately', async () => {
    let terminated = false;
    class ThrowingWorker {
        addEventListener() {}

        postMessage() {
            throw new Error('DataCloneError');
        }

        terminate() {
            terminated = true;
        }
    }

    await assert.rejects(
        () => searchSnapshotSafely(snapshot, 'alpha', { regex: true }, {
            WorkerClass: ThrowingWorker,
        }),
        (error) => error.code === 'search-worker-failed',
    );
    assert.equal(terminated, true);
});
