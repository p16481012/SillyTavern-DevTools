import {
    SEARCH_QUERY_MAX_LENGTH,
    searchSnapshot,
} from './model.js';
import {
    compareLoreEntries,
    compareSnapshotSources,
} from './pipeline-analysis.js';
import {
    analyzeSnapshotDetailed,
    DEFAULT_RULE_SETTINGS,
} from './rules.js';

export const ANALYSIS_KINDS = Object.freeze(['search', 'diff', 'rules']);
export const DEFAULT_ANALYSIS_TIMEOUT_MS = 2_000;

const MAX_ANALYSIS_SOURCES = 5_000;
const MAX_ANALYSIS_TEXT_LENGTH = 2_000_000;
const MAX_ANALYSIS_LORE_ENTRIES = 10_000;
const MAX_ANALYSIS_NODES = 100_000;
const MAX_ANALYSIS_STRING_LENGTH = 4_000_000;
const MAX_ANALYSIS_DEPTH = 32;
const LOCAL_MAX_ANALYSIS_SOURCES = 1_000;
const LOCAL_MAX_ANALYSIS_NODES = 25_000;
const LOCAL_MAX_ANALYSIS_STRING_LENGTH = 500_000;

export class AnalysisRuntimeError extends Error {
    constructor(code, message = code) {
        super(message);
        this.name = 'AnalysisRuntimeError';
        this.code = code;
    }
}

function inputMetrics(input) {
    const seen = new WeakSet();
    const pending = [{ value: input, depth: 0 }];
    let nodes = 0;
    let stringLength = 0;

    while (pending.length > 0) {
        const { value, depth } = pending.pop();
        if (typeof value === 'string') {
            stringLength += value.length;
            if (stringLength > MAX_ANALYSIS_STRING_LENGTH) {
                throw new AnalysisRuntimeError('analysis-input-too-large');
            }
            continue;
        }
        if (
            typeof value === 'function'
            || typeof value === 'symbol'
            || typeof value === 'bigint'
        ) {
            throw new AnalysisRuntimeError('analysis-input-invalid');
        }
        if (!value || typeof value !== 'object') continue;
        if (seen.has(value)) continue;
        seen.add(value);
        nodes += 1;
        if (nodes > MAX_ANALYSIS_NODES || depth > MAX_ANALYSIS_DEPTH) {
            throw new AnalysisRuntimeError('analysis-input-too-large');
        }

        let entries;
        try {
            const prototype = Object.getPrototypeOf(value);
            if (
                !Array.isArray(value)
                && prototype !== Object.prototype
                && prototype !== null
            ) {
                throw new AnalysisRuntimeError('analysis-input-invalid');
            }
            entries = Object.entries(value);
        } catch (error) {
            if (error instanceof AnalysisRuntimeError) throw error;
            throw new AnalysisRuntimeError('analysis-input-invalid');
        }
        if (Array.isArray(value) && value.length > MAX_ANALYSIS_NODES) {
            throw new AnalysisRuntimeError('analysis-input-too-large');
        }
        for (const [key, child] of entries) {
            stringLength += key.length;
            if (stringLength > MAX_ANALYSIS_STRING_LENGTH) {
                throw new AnalysisRuntimeError('analysis-input-too-large');
            }
            pending.push({ value: child, depth: depth + 1 });
        }
    }

    return { nodes, stringLength };
}

function assertSnapshotShape(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        throw new AnalysisRuntimeError('analysis-snapshot-invalid');
    }
    if (snapshot.sources != null && !Array.isArray(snapshot.sources)) {
        throw new AnalysisRuntimeError('analysis-snapshot-invalid');
    }
    if (
        snapshot.lorebookEntries != null
        && !Array.isArray(snapshot.lorebookEntries)
    ) {
        throw new AnalysisRuntimeError('analysis-snapshot-invalid');
    }
    if ((snapshot.sources?.length ?? 0) > MAX_ANALYSIS_SOURCES) {
        throw new AnalysisRuntimeError('analysis-input-too-large');
    }
    if (
        (snapshot.lorebookEntries?.length ?? 0) > MAX_ANALYSIS_LORE_ENTRIES
        || (typeof snapshot.finalText === 'string'
            && snapshot.finalText.length > MAX_ANALYSIS_TEXT_LENGTH)
    ) {
        throw new AnalysisRuntimeError('analysis-input-too-large');
    }
}

function assertAnalysisInput(kind, input) {
    if (!ANALYSIS_KINDS.includes(kind)) {
        throw new AnalysisRuntimeError('analysis-kind-unsupported');
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new AnalysisRuntimeError('analysis-input-invalid');
    }
    const snapshots = kind === 'diff'
        ? [input.baseSnapshot, input.compareSnapshot]
        : [input.snapshot];
    for (const snapshot of snapshots) {
        assertSnapshotShape(snapshot);
    }
    if (kind === 'search') {
        let query;
        try {
            query = String(input.query ?? '');
        } catch {
            throw new AnalysisRuntimeError('analysis-input-invalid');
        }
        if (query.length > SEARCH_QUERY_MAX_LENGTH) {
            throw new AnalysisRuntimeError('analysis-input-too-large');
        }
    }
    return inputMetrics(input);
}

function assertLocalInputBounds(input, metrics) {
    const snapshots = input.baseSnapshot || input.compareSnapshot
        ? [input.baseSnapshot, input.compareSnapshot]
        : [input.snapshot];
    if (
        snapshots.some(
            (snapshot) => (snapshot?.sources?.length ?? 0) > LOCAL_MAX_ANALYSIS_SOURCES,
        )
        || metrics.nodes > LOCAL_MAX_ANALYSIS_NODES
        || metrics.stringLength > LOCAL_MAX_ANALYSIS_STRING_LENGTH
    ) {
        throw new AnalysisRuntimeError('analysis-input-too-large');
    }
}

export function runAnalysisTask(kind, input) {
    assertAnalysisInput(kind, input);
    if (kind === 'search') {
        return searchSnapshot(
            input.snapshot,
            String(input.query ?? ''),
            input.options ?? {},
        );
    }
    if (kind === 'diff') {
        return {
            sources: compareSnapshotSources(
                input.baseSnapshot,
                input.compareSnapshot,
            ),
            lore: compareLoreEntries(
                input.baseSnapshot?.lorebookEntries ?? [],
                input.compareSnapshot?.lorebookEntries ?? [],
            ),
        };
    }
    return analyzeSnapshotDetailed(
        input.snapshot,
        input.ruleSettings ?? DEFAULT_RULE_SETTINGS,
        input.comparisonSettings,
    );
}

function boundedTimeout(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number)
        ? Math.min(30_000, Math.max(100, Math.trunc(number)))
        : fallback;
}

export class AnalysisRuntime {
    constructor({
        WorkerClass = globalThis.Worker,
        workerUrl = new URL('./analysis-worker.js', import.meta.url),
        timeoutMs = DEFAULT_ANALYSIS_TIMEOUT_MS,
        cache = null,
        revisionProvider = null,
    } = {}) {
        this.WorkerClass = WorkerClass;
        this.workerUrl = workerUrl;
        this.timeoutMs = boundedTimeout(timeoutMs, DEFAULT_ANALYSIS_TIMEOUT_MS);
        this.cache = cache;
        this.revisionProvider = revisionProvider;
        this.requestSequence = 0;
    }

    currentRevision(fallback = 0) {
        let value = fallback;
        try {
            value = typeof this.revisionProvider === 'function'
                ? this.revisionProvider()
                : fallback;
        } catch {
            value = fallback;
        }
        return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
    }

    async run(kind, input, {
        signal = null,
        timeoutMs = this.timeoutMs,
        cacheKey = null,
        revision = this.currentRevision(0),
    } = {}) {
        const metrics = assertAnalysisInput(kind, input);
        if (signal?.aborted) {
            throw new AnalysisRuntimeError('analysis-cancelled');
        }
        if (this.currentRevision(revision) !== revision) {
            throw new AnalysisRuntimeError('analysis-stale');
        }
        const useWorker = typeof this.WorkerClass === 'function';
        if (!useWorker) assertLocalInputBounds(input, metrics);

        const cached = cacheKey
            ? this.cache?.get(cacheKey, { revision })
            : undefined;
        if (cached !== undefined) {
            return {
                result: cached,
                source: 'cache',
                requestId: null,
                revision,
            };
        }

        const requestId = ++this.requestSequence;
        const result = useWorker
            ? await this.runWorker(kind, input, {
                signal,
                timeoutMs,
                requestId,
                revision,
            })
            : await this.runLocal(kind, input, {
                signal,
                timeoutMs,
                requestId,
                revision,
            });
        if (this.currentRevision(revision) !== revision) {
            throw new AnalysisRuntimeError('analysis-stale');
        }
        if (cacheKey) this.cache?.set(cacheKey, result, { revision });
        return {
            result,
            source: useWorker ? 'worker' : 'local',
            requestId,
            revision,
        };
    }

    runWorker(kind, input, {
        signal,
        timeoutMs,
        requestId,
        revision,
    }) {
        return new Promise((resolve, reject) => {
            let worker;
            let settled = false;
            let timer = null;
            let messageHandler = null;
            let errorHandler = null;
            let messageErrorHandler = null;
            const finish = (callback, value) => {
                if (settled) return;
                settled = true;
                if (timer != null) clearTimeout(timer);
                try {
                    signal?.removeEventListener('abort', abort);
                } catch {
                    // A malformed signal must not prevent worker termination.
                }
                try {
                    if (messageHandler) {
                        worker?.removeEventListener?.('message', messageHandler);
                    }
                    if (errorHandler) {
                        worker?.removeEventListener?.('error', errorHandler);
                    }
                    if (messageErrorHandler) {
                        worker?.removeEventListener?.(
                            'messageerror',
                            messageErrorHandler,
                        );
                    }
                } catch {
                    // Listener cleanup is best effort on a terminating worker.
                }
                try {
                    worker?.terminate();
                } catch {
                    // Worker cleanup is best effort after a terminal result.
                }
                callback(value);
            };
            const abort = () => finish(
                reject,
                new AnalysisRuntimeError('analysis-cancelled'),
            );

            try {
                worker = new this.WorkerClass(this.workerUrl, {
                    type: 'module',
                    name: `st-devtools-analysis-${kind}`,
                });
            } catch {
                finish(
                    reject,
                    new AnalysisRuntimeError('analysis-worker-unavailable'),
                );
                return;
            }

            messageHandler = (event) => {
                try {
                    const data = event.data ?? {};
                    if (
                        data.requestId !== requestId
                        || data.revision !== revision
                    ) {
                        finish(
                            reject,
                            new AnalysisRuntimeError('analysis-stale'),
                        );
                        return;
                    }
                    if (data.ok === true) {
                        finish(resolve, data.result);
                    } else {
                        finish(
                            reject,
                            new AnalysisRuntimeError(
                                data.code || 'analysis-worker-failed',
                            ),
                        );
                    }
                } catch {
                    finish(
                        reject,
                        new AnalysisRuntimeError('analysis-worker-failed'),
                    );
                }
            };
            errorHandler = () => {
                finish(
                    reject,
                    new AnalysisRuntimeError('analysis-worker-failed'),
                );
            };
            messageErrorHandler = errorHandler;

            try {
                worker.addEventListener('message', messageHandler, { once: true });
                worker.addEventListener('error', errorHandler, { once: true });
                worker.addEventListener(
                    'messageerror',
                    messageErrorHandler,
                    { once: true },
                );
                signal?.addEventListener('abort', abort, { once: true });
                timer = setTimeout(() => {
                    finish(
                        reject,
                        new AnalysisRuntimeError('analysis-timeout'),
                    );
                }, boundedTimeout(timeoutMs, this.timeoutMs));
                worker.postMessage({
                    requestId,
                    revision,
                    kind,
                    input,
                });
            } catch {
                finish(
                    reject,
                    new AnalysisRuntimeError('analysis-worker-failed'),
                );
            }
        });
    }

    runLocal(kind, input, {
        signal,
        timeoutMs,
        revision,
    }) {
        return new Promise((resolve, reject) => {
            let settled = false;
            let timer = null;
            const finish = (callback, value) => {
                if (settled) return;
                settled = true;
                if (timer != null) clearTimeout(timer);
                try {
                    signal?.removeEventListener('abort', abort);
                } catch {
                    // A malformed signal cannot leave this request pending.
                }
                callback(value);
            };
            const abort = () => finish(
                reject,
                new AnalysisRuntimeError('analysis-cancelled'),
            );
            try {
                signal?.addEventListener('abort', abort, { once: true });
                timer = setTimeout(() => {
                    finish(
                        reject,
                        new AnalysisRuntimeError('analysis-timeout'),
                    );
                }, boundedTimeout(timeoutMs, this.timeoutMs));
            } catch {
                finish(
                    reject,
                    new AnalysisRuntimeError('analysis-input-invalid'),
                );
                return;
            }

            queueMicrotask(() => {
                if (settled || signal?.aborted) return;
                if (this.currentRevision(revision) !== revision) {
                    finish(
                        reject,
                        new AnalysisRuntimeError('analysis-stale'),
                    );
                    return;
                }
                try {
                    finish(resolve, runAnalysisTask(kind, input));
                } catch (error) {
                    finish(
                        reject,
                        error instanceof AnalysisRuntimeError
                            ? error
                            : new AnalysisRuntimeError('analysis-failed'),
                    );
                }
            });
        });
    }
}
