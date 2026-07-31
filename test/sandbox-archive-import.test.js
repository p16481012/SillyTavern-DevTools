import assert from 'node:assert/strict';
import test from 'node:test';

function memoryLocalStorage() {
    const values = new Map();
    return {
        get length() {
            return values.size;
        },
        key(index) {
            return [...values.keys()][index] ?? null;
        },
        getItem(key) {
            return values.get(key) ?? null;
        },
        setItem(key, value) {
            values.set(key, String(value));
        },
        removeItem(key) {
            values.delete(key);
        },
    };
}

test('sandbox archive import succeeds and failed exclusive work rolls back', async () => {
    const controls = new Map();
    globalThis.location = { search: '' };
    globalThis.localStorage = memoryLocalStorage();
    globalThis.document = {
        body: {
            dataset: {},
            style: {
                setProperty() {},
            },
        },
        getElementById(id) {
            if (!controls.has(id)) {
                controls.set(id, {
                    addEventListener() {},
                });
            }
            return controls.get(id);
        },
    };

    await import('../sandbox/ui-harness.js?archive-import-test');
    const fixtures = globalThis.devToolsSandboxFixtures;

    assert.equal(await fixtures.runArchiveRollbackSmokeTest(), true);
    const result = await fixtures.runArchiveImportSmokeTest();
    assert.equal(result.ok, true);
    assert.equal(result.code, 'import-complete');
    assert.equal(result.verified, true);
    assert.equal(document.body.dataset.archiveImportResult, 'import-complete');
    assert.equal(document.body.dataset.archiveImportVerified, 'true');
    assert.equal(document.body.dataset.archiveRollbackRestored, 'true');
});
