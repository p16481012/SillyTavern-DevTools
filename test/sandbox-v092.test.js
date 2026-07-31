import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('v0.10.1 sandbox exposes every browser review fixture deterministically', async () => {
    const harness = await readFile(
        new URL('../sandbox/ui-harness.js', import.meta.url),
        'utf8',
    );
    const [html, server] = await Promise.all([
        readFile(new URL('../sandbox/index.html', import.meta.url), 'utf8'),
        readFile(new URL('../scripts/manual-ui-server.mjs', import.meta.url), 'utf8'),
    ]);

    assert.match(harness, /schemaVersion:\s*7/);
    assert.match(harness, /extensionVersion:\s*'0\.10\.1'/);
    assert.match(harness, /version:\s*'0\.10\.1'/);
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
    assert.match(harness, /runExclusiveImport\(operation\)/);
    assert.match(harness, /runArchiveImportSmokeTest/);
    assert.match(harness, /runArchiveRollbackSmokeTest/);
    assert.match(harness, /usage-local-estimate/);
    assert.match(harness, /pricing-user-override/);
    assert.match(harness, /pricing-overrides:v1/);

    assert.match(html, /ST DevTools v0\.10\.1 UI Sandbox/);
    assert.match(html, /생성 세션·로컬 사용량·사용자 가격표/);
    assert.match(html, /sandbox-archive-import-valid/);
    assert.match(server, /requestPath === '\/' \? 'sandbox\/index\.html'/);
    assert.match(server, /127\.0\.0\.1:8766\/sandbox\/index\.html/);
});
