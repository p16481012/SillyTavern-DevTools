import assert from 'node:assert/strict';
import test from 'node:test';
import { snapshotExportPreview } from '../src/export-preview.js';

const snapshot = {
    payload: [{ role: 'user', content: 'hello' }],
    request: {
        body: { messages: [{ role: 'user', content: 'hello' }] },
        settings: { model: 'test' },
    },
    sources: [{ id: 'one', content: 'hello' }],
    lorebookEntries: [{ uid: 1, content: 'lore' }],
};

test('JSON export preview identifies full structured fields', () => {
    assert.deepEqual(snapshotExportPreview(snapshot, 'json', '{"private":true}'), {
        format: 'json',
        approximateBytes: 16,
        sourceCount: 1,
        containsRawPromptText: true,
        includesRequestBody: true,
        includesRequestSettings: true,
        includesRawPayload: true,
        includesLorebookData: true,
    });
});

test('text export preview does not claim JSON-only structures', () => {
    const preview = snapshotExportPreview(snapshot, 'txt', 'hello');
    assert.equal(preview.containsRawPromptText, true);
    assert.equal(preview.includesRequestBody, false);
    assert.equal(preview.includesRequestSettings, false);
    assert.equal(preview.includesRawPayload, false);
    assert.equal(preview.includesLorebookData, false);
});

test('final prompt text is reported even when source extraction is empty', () => {
    const preview = snapshotExportPreview({
        finalText: 'raw final prompt',
        sources: [],
    }, 'txt', 'raw final prompt');
    assert.equal(preview.containsRawPromptText, true);
    assert.equal(preview.sourceCount, 0);
});
