import { searchSnapshot } from './model.js';

self.addEventListener('message', (event) => {
    try {
        const { snapshot, query, options } = event.data ?? {};
        self.postMessage({
            ok: true,
            matches: searchSnapshot(snapshot, query, options),
        });
    } catch (error) {
        self.postMessage({
            ok: false,
            code: error?.code || 'search-failed',
        });
    }
});
