import {
    AnalysisRuntimeError,
    runAnalysisTask,
} from './analysis-runtime.js';

self.addEventListener('message', (event) => {
    const message = event.data ?? {};
    const requestId = message.requestId ?? null;
    const revision = message.revision ?? null;
    try {
        const result = runAnalysisTask(message.kind, message.input);
        self.postMessage({
            ok: true,
            requestId,
            revision,
            result,
        });
    } catch (error) {
        self.postMessage({
            ok: false,
            requestId,
            revision,
            code: error instanceof AnalysisRuntimeError
                ? error.code
                : 'analysis-failed',
        });
    }
});
