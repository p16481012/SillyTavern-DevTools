import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { prepareSemanticInspection } from '../src/semantic-inspector.js';

test('v0.12.0 sandbox exposes every browser review fixture deterministically', async () => {
    const harness = await readFile(
        new URL('../sandbox/ui-harness.js', import.meta.url),
        'utf8',
    );
    const [html, server] = await Promise.all([
        readFile(new URL('../sandbox/index.html', import.meta.url), 'utf8'),
        readFile(new URL('../scripts/manual-ui-server.mjs', import.meta.url), 'utf8'),
    ]);

    assert.match(harness, /schemaVersion:\s*7/);
    assert.match(harness, /extensionVersion:\s*'0\.12\.0'/);
    assert.match(harness, /privacy:\s*\{[\s\S]*?mode:\s*'full'/);
    assert.match(harness, /version:\s*'0\.12\.0'/);
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
    assert.match(harness, /runHungTokenizerCaptureSmokeTest/);
    assert.match(harness, /new SnapshotStore\(\{/);
    assert.match(harness, /getTokenCountAsync:\s*\(\) => new Promise\(\(\) => \{\}\)/);
    assert.match(harness, /name:\s*undefined/);
    assert.match(harness, /logit_bias:\s*undefined/);
    assert.match(harness, /verified:\s*storedSnapshot\?\.id === persistedSnapshot\.id/);
    assert.match(harness, /undefinedNormalized:/);
    assert.match(harness, /usage-local-estimate/);
    assert.match(harness, /pricing-user-override/);
    assert.match(harness, /pricing-overrides:v1/);
    assert.match(harness, /new SemanticInspectorMemoryCache\(\)/);
    assert.match(harness, /class SandboxSemanticInspector extends SemanticInspector/);
    assert.match(harness, /super\.prepare\(options\)/);
    assert.match(harness, /super\.inspect\(prepared,\s*\{\s*signal\s*\}\)/);
    assert.match(harness, /const sandboxSemanticAdapter = \{/);
    assert.match(harness, /connectionProfiles\(\)/);
    assert.match(harness, /name:\s*'빠른 검사 프로필'/);
    assert.match(harness, /async generate\(\{\s*prompt,\s*signal\s*\}\)/);
    assert.match(harness, /semanticRequestFromPrompt\(prompt\)/);
    assert.match(harness, /document\.body\.dataset\.semanticCore/);
    assert.match(harness, /document\.body\.dataset\.semanticNetworkCallCount = '0'/);
    assert.match(harness, /semanticValidatedResultCount/);
    assert.match(harness, /semanticFixtureMode === 'slow'/);
    assert.match(harness, /SEMANTIC_ABORTED/);
    assert.match(harness, /SEMANTIC_PROVIDER_ERROR/);
    assert.match(harness, /semanticInspector:\s*sandboxSemanticInspector/);
    assert.match(harness, /semantic-consent-preview/);
    assert.match(harness, /semantic-no-provider-call/);
    assert.match(harness, /setSemanticFixtureMode/);
    assert.match(harness, /new CustomEvent\('capture-status'/);

    assert.match(html, /ST DevTools v0\.12\.0 UI Sandbox/);
    assert.match(html, /실제 제공자·네트워크 호출은 없습니다/);
    assert.match(html, /sandbox-archive-import-valid/);
    assert.match(html, /sandbox-semantic-success/);
    assert.match(html, /sandbox-semantic-error/);
    assert.match(html, /sandbox-semantic-slow/);
    assert.match(server, /requestPath === '\/' \? 'sandbox\/index\.html'/);
    assert.match(server, /127\.0\.0\.1:8766\/sandbox\/index\.html/);
});

test('v0.11 sandbox full privacy fixture reaches a real semantic consent preview', async () => {
    const content = 'Always answer in Korean.';
    const source = {
        id: 'sandbox-source',
        type: 'system',
        label: 'Sandbox rule',
        content,
        included: true,
        configuredEnabled: true,
        ranges: [{ start: 0, end: content.length }],
    };
    const atom = {
        id: 'sandbox-atom',
        sourceId: source.id,
        category: 'language',
        target: 'response',
        action: 'set',
        property: 'response.language',
        value: 'ko',
        polarity: 'require',
        scope: 'output',
        condition: '',
        exception: '',
        priority: 'high',
        status: 'confirmed',
        localRange: { start: 0, end: content.length },
        finalRanges: source.ranges,
    };
    const prepared = await prepareSemanticInspection({
        snapshot: {
            schemaVersion: 7,
            privacy: {
                schemaVersion: 1,
                mode: 'full',
                digestAlgorithm: 'SHA-256',
                rawPromptContentIncluded: true,
                rawChatIdIncluded: true,
                rawRequestIdIncluded: true,
                originalSchemaVersion: 7,
            },
            sources: [source],
        },
        analysis: {
            findings: [{
                id: 'sandbox-finding',
                title: 'Sandbox finding',
                severity: 'info',
                sourceIds: [source.id],
                atomIds: [atom.id],
                finalRanges: source.ranges,
            }],
            instructions: {
                atoms: [atom],
                relations: [],
                clusters: [],
                capabilities: [{ sourceId: source.id, active: true }],
            },
            comparison: {
                skippedSources: [],
                groups: [],
            },
        },
        targetIds: ['finding:sandbox-finding'],
        provider: 'claude',
        model: 'claude-sonnet-4',
    });

    assert.equal(prepared.preview.providerIdentity.status, 'available');
    assert.deepEqual(
        prepared.preview.includedSources.map(({ id }) => id),
        [source.id],
    );
    assert.equal(prepared.preview.includedSources[0].content, content);
});
