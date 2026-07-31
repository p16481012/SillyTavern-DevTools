import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('v0.11 wires the optional semantic service without making startup depend on it', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');

    assert.match(source, /new SemanticCaptureGate\(\)/u);
    assert.match(source, /new SemanticProviderAdapter\(\{/u);
    assert.match(source, /new SemanticInspector\(\{/u);
    assert.match(source, /semanticCaptureGate,/u);
    assert.match(source, /semanticInspector,/u);
    assert.match(
        source,
        /catch \{\s*console\.warn\('\[ST DevTools\] Optional semantic inspector is unavailable\.'\);\s*\}/u,
    );
    assert.doesNotMatch(source, /generateQuietPrompt|generateRawData|api[_-]?key/iu);
});

test('v5 preference bootstrap recognizes v4 data before legacy retention fallback', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');

    assert.match(source, /V4_UI_PREFERENCES_KEY/u);
    assert.match(
        source,
        /localStorage\.getItem\(V4_UI_PREFERENCES_KEY\) != null/u,
    );
    assert.match(source, /currentPreferences\(\)\.semanticConnectionProfileId/u);
});
