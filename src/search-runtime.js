import { searchSnapshot } from './model.js';

export const SEARCH_DEBOUNCE_MS = 180;
export const SEARCH_TIMEOUT_MS = 800;

export class SearchRuntimeError extends Error {
    constructor(code) {
        super(code);
        this.name = 'SearchRuntimeError';
        this.code = code;
    }
}

export function searchSnapshotSafely(
    snapshot,
    query,
    options = {},
    {
        signal = null,
        timeoutMs = SEARCH_TIMEOUT_MS,
        WorkerClass = globalThis.Worker,
    } = {},
) {
    if (!options.regex) {
        return Promise.resolve(searchSnapshot(snapshot, query, options));
    }

    if (typeof WorkerClass !== 'function') {
        if (typeof document === 'undefined') {
            return Promise.resolve(searchSnapshot(snapshot, query, options));
        }
        return Promise.reject(new SearchRuntimeError('regex-worker-unavailable'));
    }

    return new Promise((resolve, reject) => {
        let worker;
        let settled = false;
        let timeoutId = null;
        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            if (timeoutId != null) clearTimeout(timeoutId);
            signal?.removeEventListener('abort', abort);
            worker?.terminate();
            callback(value);
        };
        const abort = () => finish(reject, new SearchRuntimeError('search-cancelled'));

        try {
            worker = new WorkerClass(
                new URL('./search-worker.js', import.meta.url),
                { type: 'module', name: 'st-devtools-regex-search' },
            );
        } catch {
            finish(reject, new SearchRuntimeError('regex-worker-unavailable'));
            return;
        }

        worker.addEventListener('message', (event) => {
            const data = event.data ?? {};
            if (data.ok) {
                finish(resolve, data.matches ?? []);
            } else {
                finish(reject, new SearchRuntimeError(data.code || 'search-failed'));
            }
        }, { once: true });
        worker.addEventListener('error', () => {
            finish(reject, new SearchRuntimeError('search-worker-failed'));
        }, { once: true });

        if (signal?.aborted) {
            abort();
            return;
        }
        signal?.addEventListener('abort', abort, { once: true });
        timeoutId = setTimeout(() => {
            finish(reject, new SearchRuntimeError('regex-timeout'));
        }, Math.max(100, Number(timeoutMs) || SEARCH_TIMEOUT_MS));
        try {
            worker.postMessage({
                snapshot: {
                    sources: Array.isArray(snapshot?.sources) ? snapshot.sources : [],
                },
                query,
                options,
            });
        } catch {
            finish(reject, new SearchRuntimeError('search-worker-failed'));
        }
    });
}
