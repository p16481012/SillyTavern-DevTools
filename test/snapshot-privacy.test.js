import assert from 'node:assert/strict';
import test from 'node:test';
import {
    collectSensitiveSnapshotSeeds,
    sha256Hex,
    SnapshotPrivacyError,
    transformSnapshotPrivacy,
} from '../src/snapshot-privacy.js';
import {
    createSnapshotShareDocument,
    SnapshotShareError,
    snapshotSharePreview,
} from '../src/share-export.js';

function privateSnapshot() {
    return {
        schemaVersion: 6,
        id: 'raw-snapshot-id',
        timestamp: 1234,
        extensionVersion: '0.10.0',
        chatId: 'private-chat-id',
        messageCount: 2,
        api: 'openai',
        provider: 'openrouter',
        model: 'private-model-name',
        preset: 'My private preset',
        promptType: 'chat-completion',
        generationType: 'normal',
        capture: {
            eventName: 'CHAT_COMPLETION_SETTINGS_READY',
            stage: 'backend-request-ready',
            requestBodyAvailable: true,
            fallback: false,
            correlationId: 'raw-request-id-123',
            correlationMethod: 'explicit-id',
            requestStatus: 'captured',
            generationStatus: 'completed',
        },
        request: {
            body: {
                messages: [{
                    role: 'system',
                    content: ['X', { text: 'Nested private instruction.' }],
                }],
                request_id: 'raw-request-id-123',
            },
            settings: {
                stop: ['Private stop sequence.'],
            },
            bodyKeys: ['messages', 'request_id'],
            redactedPaths: [],
            omittedMediaPaths: [],
            correlationId: 'raw-request-id-123',
        },
        payload: [{
            role: 'system',
            content: ['X', { type: 'text', text: 'Nested private instruction.' }],
        }],
        finalText: '# 1 SYSTEM\nX\nNested private instruction.',
        sources: [{
            id: 'system:0',
            type: 'system',
            label: 'Private prompt label',
            content: 'Nested private instruction.',
            color: '#000000',
            attribution: 'exact',
            included: true,
            tokenCount: 4,
            metadata: {
                identifier: 'private-configured-id',
            },
            ranges: [{
                start: 13,
                end: 40,
                quote: 'Nested private instruction.',
            }],
            provenance: {
                method: 'exact',
                confidence: 1,
                availability: 'available',
                locations: [{
                    jsonPointer: '/payload/0/content/1/text',
                    messageIndex: 0,
                    role: 'system',
                    valueRange: { start: 0, end: 27 },
                    finalRange: { start: 13, end: 40 },
                }],
                locationCount: 1,
                locationsTruncated: false,
            },
        }],
        lorebookEntries: [{
            uid: 1,
            key: ['private-keyword'],
            comment: 'Private lore title',
            content: 'Private lore content.',
        }],
        profileContext: {
            preset: { label: 'My private preset', fingerprint: 'safe-fingerprint' },
        },
        stats: {
            totalTokens: 42,
            contextUsage: 0.1,
            structured: {
                multimodalEstimateMethod: 'Private statistical label',
            },
        },
    };
}

test('SHA-256 uses a deterministic lowercase digest', async () => {
    assert.equal(
        await sha256Hex('abc'),
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
});

test('full mode keeps a bounded fast path without prompt digest work', async () => {
    const largeText = 'large prompt block '.repeat(60_000);
    const original = {
        ...privateSnapshot(),
        payload: [{ role: 'system', content: largeText }],
        finalText: largeText,
        sources: [],
        lorebookEntries: [],
    };
    const startedAt = performance.now();
    const transformed = await transformSnapshotPrivacy(original, { mode: 'full' });
    const elapsed = performance.now() - startedAt;

    assert.equal(transformed.finalText, largeText);
    assert.equal(transformed.privacySummary.promptDigest, null);
    assert.equal(
        transformed.privacySummary.measurement,
        'not-collected-full-fast-path',
    );
    assert.ok(elapsed < 500, `full privacy transform took ${elapsed.toFixed(1)}ms`);
});

test('shared DAG references are accepted while true cycles remain rejected', async () => {
    const original = privateSnapshot();
    const sharedMessage = { role: 'system', content: 'shared private content' };
    original.payload = [sharedMessage, sharedMessage];
    original.request.body.messages = original.payload;

    const redacted = await transformSnapshotPrivacy(original, { mode: 'redacted' });
    assert.equal(redacted.payload.length, 2);
    assert.equal(redacted.request.body.messages.length, 2);
    assert.equal(redacted.payload[0].content, redacted.payload[1].content);
});

test('full, redacted, and metadata transforms are pure and mode-explicit', async () => {
    const original = privateSnapshot();
    const before = structuredClone(original);

    const full = await transformSnapshotPrivacy(original, { mode: 'full' });
    const redacted = await transformSnapshotPrivacy(original, { mode: 'redacted' });
    const metadata = await transformSnapshotPrivacy(original, { mode: 'metadata' });

    assert.deepEqual(original, before);
    assert.notStrictEqual(full, original);
    assert.equal(full.finalText, original.finalText);
    assert.equal(full.privacy.mode, 'full');
    assert.equal(full.privacy.rawPromptContentIncluded, true);

    const redactedJson = JSON.stringify(redacted);
    for (const seed of collectSensitiveSnapshotSeeds(original).uniqueValues) {
        if (seed.length >= 8) assert.equal(redactedJson.includes(seed), false, seed);
    }
    assert.match(redacted.finalText, /chars=40 bytes=40 sha256=[0-9a-f]{64}/u);
    assert.match(redacted.payload[0].content[0], /chars=1 bytes=1 sha256=/u);
    assert.equal(redacted.capture.correlationId, null);
    assert.equal(redacted.request.correlationId, null);
    assert.match(redacted.id, /^snapshot-[0-9a-f]{24}$/u);
    assert.match(redacted.chatId, /^chat-[0-9a-f]{24}$/u);
    assert.match(redacted.sources[0].id, /^source-[0-9a-f]{24}$/u);
    assert.equal(redactedJson.includes(original.sources[0].id), false);
    assert.deepEqual(redacted.sources[0].ranges, []);
    assert.deepEqual(redacted.sources[0].provenance.locations, []);
    assert.equal(redacted.sources[0].rangeSummary.quotedValueCount, 1);
    assert.equal(redacted.usage.status, 'local-estimate');
    assert.equal(redacted.usage.inputTokens, 42);
    assert.equal(redacted.usage.sourceEvent, 'legacy-snapshot-token-count');
    assert.deepEqual(
        await transformSnapshotPrivacy(redacted, { mode: 'redacted' }),
        redacted,
    );

    assert.equal(metadata.privacy.mode, 'metadata');
    assert.equal(metadata.provider, original.provider);
    assert.equal(metadata.model, original.model);
    assert.equal(metadata.timestamp, original.timestamp);
    assert.equal(metadata.stats.totalTokens, 42);
    assert.deepEqual(metadata.usage, redacted.usage);
    for (const field of [
        'finalText',
        'payload',
        'request',
        'sources',
        'lorebookEntries',
        'preset',
        'profileContext',
    ]) {
        assert.equal(Object.hasOwn(metadata, field), false, field);
    }
    assert.match(metadata.chatId, /^chat-[0-9a-f]{24}$/u);
    assert.equal(metadata.privacySummary.sourceCount, 1);
    assert.equal(metadata.privacySummary.loreEntryCount, 1);
    assert.deepEqual(
        await transformSnapshotPrivacy(metadata, { mode: 'metadata' }),
        metadata,
    );
});

test('privacy transforms reject attempts to reconstruct a less private mode', async () => {
    const metadata = await transformSnapshotPrivacy(privateSnapshot(), {
        mode: 'metadata',
    });
    await assert.rejects(
        transformSnapshotPrivacy(metadata, { mode: 'redacted' }),
        (error) => (
            error instanceof SnapshotPrivacyError
            && error.code === 'privacy-mode-upgrade'
        ),
    );
});

test('share export allows only redacted or metadata modes and strips identifiers', async () => {
    const original = privateSnapshot();
    await assert.rejects(
        createSnapshotShareDocument({
            snapshots: [original],
            mode: 'full',
        }),
        (error) => (
            error instanceof SnapshotShareError
            && error.code === 'unsafe-share-mode'
        ),
    );

    const document = await createSnapshotShareDocument({
        snapshots: [original],
        mode: 'redacted',
        exportedAt: 5,
        extensionVersion: '0.10.0',
    });
    const serialized = JSON.stringify(document);
    assert.equal(serialized.includes(original.chatId), false);
    assert.equal(serialized.includes(original.capture.correlationId), false);
    assert.equal(serialized.includes(original.finalText), false);
    assert.equal(document.snapshots[0].id, 'shared-snapshot-1');
    assert.equal(Object.hasOwn(document.snapshots[0], 'chatId'), false);
    assert.equal(document.privacy.seededLeakScan, 'passed');
    assert.deepEqual(snapshotSharePreview(document), {
        mode: 'redacted',
        snapshotCount: 1,
        sourceCount: 1,
        loreEntryCount: 1,
        seededLeakScan: 'passed',
        includedFields: document.includedFields,
    });

    const storedRedacted = await transformSnapshotPrivacy(original, {
        mode: 'redacted',
    });
    const reshared = await createSnapshotShareDocument({
        snapshots: [storedRedacted],
        mode: 'redacted',
        exportedAt: 6,
    });
    assert.equal(reshared.privacy.seededLeakScan, 'passed');
    assert.equal(
        JSON.stringify(reshared).includes(storedRedacted.chatId),
        false,
    );
});

test('share export fails closed when retained metadata equals a prompt seed', async () => {
    const snapshot = {
        ...privateSnapshot(),
        finalText: 'openrouter',
        payload: [{ role: 'system', content: 'openrouter' }],
        sources: [],
        lorebookEntries: [],
    };
    await assert.rejects(
        createSnapshotShareDocument({
            snapshots: [snapshot],
            mode: 'metadata',
        }),
        (error) => (
            error instanceof SnapshotShareError
            && error.code === 'seeded-leak-detected'
        ),
    );
});

test('privacy boundary rejects cycles, excessive depth, and oversized input', async () => {
    const circular = privateSnapshot();
    circular.payload.push(circular);
    await assert.rejects(
        transformSnapshotPrivacy(circular, { mode: 'redacted' }),
        (error) => (
            error instanceof SnapshotPrivacyError
            && error.code === 'circular-input'
        ),
    );

    let nested = 'leaf';
    for (let index = 0; index < 8; index += 1) nested = { child: nested };
    await assert.rejects(
        transformSnapshotPrivacy({
            ...privateSnapshot(),
            payload: nested,
        }, {
            mode: 'redacted',
            limits: { depth: 5 },
        }),
        (error) => (
            error instanceof SnapshotPrivacyError
            && error.code === 'input-too-deep'
        ),
    );

    await assert.rejects(
        transformSnapshotPrivacy({
            ...privateSnapshot(),
            finalText: 'secret'.repeat(100),
        }, {
            mode: 'redacted',
            limits: { inputBytes: 128 },
        }),
        (error) => (
            error instanceof SnapshotPrivacyError
            && error.code === 'input-too-large'
        ),
    );
});
