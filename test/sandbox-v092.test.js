import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('v0.9.2 sandbox exposes every browser review fixture deterministically', async () => {
    const harness = await readFile(
        new URL('../sandbox/ui-harness.js', import.meta.url),
        'utf8',
    );
    const html = await readFile(
        new URL('../sandbox/ui-harness.html', import.meta.url),
        'utf8',
    );

    assert.match(harness, /schemaVersion:\s*6/);
    assert.match(harness, /extensionVersion:\s*'0\.9\.2'/);
    assert.match(harness, /version:\s*'0\.9\.2'/);
    assert.match(harness, /Date\.UTC\(2026,\s*6,\s*31,\s*12,\s*0,\s*0\)/);

    assert.match(harness, /providerTrace:\s*\{/);
    assert.match(harness, /upstreamProvider:\s*\{[\s\S]*?status:\s*'unknown'/);
    assert.match(harness, /availability:\s*'available'/);
    assert.match(harness, /availability:\s*'legacy-unavailable'/);
    assert.match(harness, /locationsTruncated:\s*true/);
    assert.match(harness, /locationCount:\s*52/);

    assert.match(harness, /prefillStatus:\s*'inferred'/);
    assert.match(harness, /prefillStatus:\s*'confirmed'/);
    assert.match(harness, /languageRole:\s*'developer'/);
    assert.match(harness, /languageDepth:\s*4/);
    assert.match(harness, /languagePosition:\s*'in-chat'/);
    assert.match(harness, /languagePromptOrder:\s*7/);

    assert.equal((harness.match(/uid:\s*1/g) ?? []).length >= 2, true);
    assert.match(harness, /content:\s*'배경은 한여름입니다\.'/);
    assert.match(harness, /content:\s*'배경은 눈 내리는 한겨울입니다\.'/);
    assert.match(harness, /corruptCount:\s*corruptRecordCount/);
    assert.match(harness, /corrupt-warning/);

    assert.match(html, /ST DevTools v0\.9\.2 UI Sandbox/);
    assert.match(html, /구조 위치·생성 경로·프리필 상태/);
});
