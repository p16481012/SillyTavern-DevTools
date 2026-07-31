import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createSnapshotArchive,
    executeSnapshotArchiveImport,
    parseSnapshotArchive,
    prepareSnapshotArchiveImport,
    serializeSnapshotArchive,
    SnapshotArchiveError,
    snapshotArchiveReplaceConfirmationToken,
} from '../src/snapshot-archive.js';
import {
    snapshotDigest,
    transformSnapshotPrivacy,
} from '../src/snapshot-privacy.js';
import { SnapshotStore } from '../src/storage.js';

function snapshot(id, chatId, timestamp, marker = id) {
    return {
        schemaVersion: 6,
        id,
        chatId,
        timestamp,
        extensionVersion: '0.10.0',
        api: 'openai',
        provider: 'openrouter',
        model: 'test-model',
        promptType: 'chat-completion',
        generationType: 'normal',
        capture: {
            eventName: 'CHAT_COMPLETION_SETTINGS_READY',
            stage: 'backend-request-ready',
            requestBodyAvailable: true,
            fallback: false,
            correlationId: `request-${marker}`,
            correlationMethod: 'explicit-id',
            requestStatus: 'captured',
            generationStatus: 'completed',
        },
        request: {
            body: {
                messages: [{ role: 'system', content: `secret-${marker}` }],
            },
            settings: {},
            bodyKeys: ['messages'],
            redactedPaths: [],
            omittedMediaPaths: [],
            correlationId: `request-${marker}`,
        },
        payload: [{ role: 'system', content: `secret-${marker}` }],
        finalText: `# 1 SYSTEM\nsecret-${marker}`,
        sources: [],
        lorebookEntries: [],
        stats: { totalTokens: timestamp + 1 },
    };
}

function timelines(...values) {
    const grouped = new Map();
    for (const value of values) {
        if (!grouped.has(value.chatId)) grouped.set(value.chatId, []);
        grouped.get(value.chatId).push(value);
    }
    return [...grouped].map(([chatId, timeline]) => ({ chatId, timeline }));
}

class FakeStore {
    constructor(
        initial = [],
        {
            failAddAt = null,
            dropAdds = false,
            retentionLimit = Number.POSITIVE_INFINITY,
        } = {},
    ) {
        this.records = new Map();
        this.rawOrphans = new Map();
        this.failAddAt = failAddAt;
        this.dropAdds = dropAdds;
        this.retentionLimit = retentionLimit;
        this.addAttempts = 0;
        this.addOptions = [];
        this.exclusiveTail = Promise.resolve();
        this.importGate = null;
        for (const { chatId, timeline } of initial) {
            for (const value of timeline) {
                this.records.set(JSON.stringify([chatId, value.id]), structuredClone(value));
            }
        }
    }

    directTimelines() {
        const grouped = new Map();
        for (const value of this.records.values()) {
            const chatId = value.chatId ?? '__global__';
            if (!grouped.has(chatId)) grouped.set(chatId, []);
            grouped.get(chatId).push(structuredClone(value));
        }
        return [...grouped].map(([chatId, timeline]) => ({ chatId, timeline }));
    }

    async getAllStoredTimelines() {
        await this.exclusiveTail;
        return this.directTimelines();
    }

    async directAdd(value, options = {}) {
        this.addAttempts += 1;
        this.addOptions.push(structuredClone(options));
        if (this.failAddAt === this.addAttempts) {
            this.failAddAt = null;
            throw new Error(`must-not-leak-${value.finalText ?? 'metadata'}`);
        }
        if (!this.dropAdds) {
            this.records.set(
                JSON.stringify([value.chatId ?? '__global__', value.id]),
                structuredClone(value),
            );
        } else {
            this.dropAdds = false;
        }
        if (!options.skipRetention && Number.isFinite(this.retentionLimit)) {
            const chatId = value.chatId ?? '__global__';
            const sameChat = [...this.records.entries()]
                .filter(([, snapshotValue]) => (
                    (snapshotValue.chatId ?? '__global__') === chatId
                ))
                .sort((left, right) => (
                    (Number(left[1].timestamp) || 0)
                    - (Number(right[1].timestamp) || 0)
                ));
            for (const [key] of sameChat.slice(
                0,
                Math.max(0, sameChat.length - this.retentionLimit),
            )) {
                this.records.delete(key);
            }
        }
        return value;
    }

    async addSnapshot(value, options = {}) {
        await this.exclusiveTail;
        return this.directAdd(value, options);
    }

    async clearAll() {
        await this.exclusiveTail;
        return this.directClearAll();
    }

    async directClearAll() {
        const snapshotCount = this.records.size;
        this.records.clear();
        this.rawOrphans.clear();
        return { chatCount: 0, snapshotCount };
    }

    async runExclusiveImport(operation) {
        const previous = this.exclusiveTail;
        let release;
        this.exclusiveTail = new Promise((resolve) => {
            release = resolve;
        });
        await previous;
        const recordsBefore = structuredClone(this.records);
        const orphansBefore = structuredClone(this.rawOrphans);
        try {
            await this.importGate?.();
            return await operation({
                getAllStoredTimelines: async () => this.directTimelines(),
                addSnapshot: async (value, options) => this.directAdd(value, options),
                clearAll: async () => this.directClearAll(),
            });
        } catch (error) {
            this.records = recordsBefore;
            this.rawOrphans = orphansBefore;
            throw error;
        } finally {
            release();
        }
    }
}

test('archive export is deterministic, strict, and labels full-backup privacy risk', async () => {
    const first = snapshot('one', 'chat-a', 1);
    const second = snapshot('two', 'chat-b', 2);
    const options = {
        timelines: timelines(second, first),
        mode: 'full',
        exportedAt: 10,
        extensionVersion: '0.10.0',
    };

    const left = await createSnapshotArchive(options);
    const right = await createSnapshotArchive(options);
    assert.deepEqual(left, right);
    assert.equal(left.privacy.warning, 'contains-private-prompt-data');
    assert.equal(left.privacy.rawPromptContentIncluded, true);
    assert.deepEqual(
        left.entries.map(({ chatId, id }) => [chatId, id]),
        [['chat-a', 'one'], ['chat-b', 'two']],
    );

    const serialized = await serializeSnapshotArchive(options);
    assert.deepEqual(await parseSnapshotArchive(serialized), left);
});

test('redacted and metadata archives remove raw prompt and identifier values', async () => {
    const original = snapshot('private-id', 'private-chat', 1, 'private-value');
    for (const mode of ['redacted', 'metadata']) {
        const document = await createSnapshotArchive({
            timelines: timelines(original),
            mode,
            exportedAt: 10,
        });
        const serialized = JSON.stringify(document);
        assert.equal(serialized.includes('secret-private-value'), false);
        assert.equal(serialized.includes('private-chat'), false);
        assert.equal(serialized.includes('request-private-value'), false);
        assert.equal(document.privacy.warning, null);
        assert.equal(document.privacy.rawPromptContentIncluded, false);
        assert.match(document.entries[0].id, /^snapshot-[0-9a-f]{24}$/u);
        assert.match(document.entries[0].chatId, /^chat-[0-9a-f]{24}$/u);
    }
});

test('full backup preserves existing private records as mixed per-entry modes', async () => {
    const raw = snapshot('raw', 'chat-raw', 1, 'raw-private');
    const redacted = await transformSnapshotPrivacy(
        snapshot('redacted', 'chat-redacted', 2, 'redacted-private'),
        { mode: 'redacted' },
    );
    const metadata = await transformSnapshotPrivacy(
        snapshot('metadata', 'chat-metadata', 3, 'metadata-private'),
        { mode: 'metadata' },
    );
    const document = await createSnapshotArchive({
        timelines: timelines(raw, redacted, metadata),
        mode: 'full',
        exportedAt: 10,
    });

    assert.equal(document.schemaVersion, 2);
    assert.equal(document.privacy.mode, 'mixed');
    assert.equal(document.privacy.requestedMode, 'full');
    assert.deepEqual(
        document.privacy.entryModes,
        ['full', 'redacted', 'metadata'],
    );
    assert.deepEqual(document.summary.privacyModeCounts, {
        full: 1,
        redacted: 1,
        metadata: 1,
    });
    assert.deepEqual(
        document.entries.map(({ privacyMode }) => privacyMode).sort(),
        ['full', 'metadata', 'redacted'],
    );
    assert.deepEqual(
        document.entries.find(({ privacyMode }) => privacyMode === 'redacted').snapshot,
        redacted,
    );
    assert.deepEqual(
        document.entries.find(({ privacyMode }) => privacyMode === 'metadata').snapshot,
        metadata,
    );
    assert.deepEqual(await parseSnapshotArchive(document), document);
});

test('full backup round-trips a private snapshot into its raw local storage partition', async () => {
    const rawStorageChatId = 'raw-local-chat';
    const privateSnapshot = await transformSnapshotPrivacy(
        snapshot('private', rawStorageChatId, 1, 'private-partition'),
        { mode: 'redacted' },
    );
    const source = new SnapshotStore({ namespace: 'archive-source' });
    await source.addSnapshot(privateSnapshot, {
        partitionChatId: rawStorageChatId,
    });

    const sourceTimelines = await source.getAllStoredTimelines();
    assert.equal(sourceTimelines[0].chatId, rawStorageChatId);
    assert.notEqual(sourceTimelines[0].timeline[0].chatId, rawStorageChatId);

    const document = await createSnapshotArchive({
        timelines: sourceTimelines,
        mode: 'full',
        exportedAt: 10,
    });
    const [entry] = document.entries;
    assert.equal(entry.storageChatId, rawStorageChatId);
    assert.equal(entry.chatId, privateSnapshot.chatId);
    assert.equal(document.privacy.rawPromptContentIncluded, false);
    assert.equal(document.privacy.rawChatIdIncluded, true);
    assert.equal(document.privacy.warning, 'contains-private-prompt-data');

    const snapshotOnlyDigest = structuredClone(document);
    snapshotOnlyDigest.entries[0].digest = await snapshotDigest(
        snapshotOnlyDigest.entries[0].snapshot,
    );
    await assert.rejects(
        parseSnapshotArchive(snapshotOnlyDigest),
        (error) => (
            error instanceof SnapshotArchiveError
            && error.code === 'digest-mismatch'
        ),
    );

    const tamperedPartition = structuredClone(document);
    tamperedPartition.entries[0].storageChatId = 'different-local-chat';
    await assert.rejects(
        parseSnapshotArchive(tamperedPartition),
        (error) => (
            error instanceof SnapshotArchiveError
            && error.code === 'storage-partition-mismatch'
        ),
    );

    const detachedDocument = structuredClone(document);
    delete detachedDocument.entries[0].storageChatId;
    detachedDocument.entries[0].digest = await snapshotDigest(
        detachedDocument.entries[0].snapshot,
    );
    detachedDocument.privacy.rawChatIdIncluded = false;
    detachedDocument.privacy.warning = null;
    assert.notEqual(
        await snapshotArchiveReplaceConfirmationToken(document),
        await snapshotArchiveReplaceConfirmationToken(detachedDocument),
    );

    const duplicatePlan = await prepareSnapshotArchiveImport(
        document,
        sourceTimelines,
    );
    assert.equal(duplicatePlan.summary.duplicateCount, 1);
    assert.equal(duplicatePlan.summary.addCount, 0);

    const target = new SnapshotStore({ namespace: 'archive-target' });
    const plan = await prepareSnapshotArchiveImport(
        document,
        await target.getAllStoredTimelines(),
    );
    assert.deepEqual(plan.stagedStorageChatIds, [rawStorageChatId]);
    const result = await executeSnapshotArchiveImport(target, plan);
    assert.equal(result.ok, true);
    assert.equal(
        (await target.getTimelinePage(rawStorageChatId)).totalCount,
        1,
    );
    assert.equal(
        (await target.getTimelinePage(privateSnapshot.chatId)).totalCount,
        0,
    );

    const safeArchive = await createSnapshotArchive({
        timelines: sourceTimelines,
        mode: 'redacted',
        exportedAt: 10,
    });
    assert.equal(Object.hasOwn(safeArchive.entries[0], 'storageChatId'), false);
    assert.equal(JSON.stringify(safeArchive).includes(rawStorageChatId), false);
});

test('parser independently rejects forged private snapshots even with updated digests', async () => {
    const redacted = await createSnapshotArchive({
        timelines: timelines(snapshot('private-record', 'chat', 1, 'redacted-secret')),
        mode: 'redacted',
        exportedAt: 10,
    });
    const forgedRedacted = structuredClone(redacted);
    forgedRedacted.entries[0].snapshot.finalText = 'forged raw prompt';
    forgedRedacted.entries[0].digest = await snapshotDigest(
        forgedRedacted.entries[0].snapshot,
    );
    await assert.rejects(
        parseSnapshotArchive(forgedRedacted),
        (error) => (
            error instanceof SnapshotArchiveError
            && error.code === 'invalid-private-snapshot'
        ),
    );

    const metadata = await createSnapshotArchive({
        timelines: timelines(snapshot('metadata-record', 'chat', 1, 'metadata-secret')),
        mode: 'metadata',
        exportedAt: 10,
    });
    const forgedMetadata = structuredClone(metadata);
    forgedMetadata.entries[0].snapshot.sources = [{
        id: 'raw-source',
        content: 'forged metadata prompt',
    }];
    forgedMetadata.entries[0].digest = await snapshotDigest(
        forgedMetadata.entries[0].snapshot,
    );
    await assert.rejects(
        parseSnapshotArchive(forgedMetadata),
        (error) => (
            error instanceof SnapshotArchiveError
            && error.code === 'invalid-private-snapshot'
        ),
    );

    const forgedEnvelope = structuredClone(redacted);
    forgedEnvelope.privacy.rawPromptContentIncluded = true;
    await assert.rejects(
        parseSnapshotArchive(forgedEnvelope),
        (error) => (
            error instanceof SnapshotArchiveError
            && error.code === 'invalid-privacy-metadata'
        ),
    );
});

test('safe schema-v1 archives migrate while unsafe private v1 records are refused', async () => {
    const current = await createSnapshotArchive({
        timelines: timelines(snapshot('legacy', 'chat', 1, 'legacy-private')),
        mode: 'redacted',
        exportedAt: 10,
    });
    const legacy = structuredClone(current);
    legacy.schemaVersion = 1;
    legacy.privacy = {
        mode: 'redacted',
        rawPromptContentIncluded: false,
        rawChatIdIncluded: false,
        rawRequestIdIncluded: false,
        warning: null,
    };
    delete legacy.summary.privacyModeCounts;
    legacy.entries.forEach((entry) => delete entry.privacyMode);

    const migrated = await parseSnapshotArchive(legacy);
    assert.equal(migrated.schemaVersion, 2);
    assert.equal(migrated.entries[0].privacyMode, 'redacted');

    const unsafe = structuredClone(legacy);
    unsafe.entries[0].snapshot.finalText = 'unsafe legacy raw prompt';
    unsafe.entries[0].digest = await snapshotDigest(unsafe.entries[0].snapshot);
    await assert.rejects(
        parseSnapshotArchive(unsafe),
        (error) => (
            error instanceof SnapshotArchiveError
            && error.code === 'invalid-private-snapshot'
        ),
    );
});

test('archive parser rejects version changes, digest tampering, duplicates, and unsafe keys', async () => {
    const document = await createSnapshotArchive({
        timelines: timelines(snapshot('one', 'chat', 1, 'do-not-echo')),
        exportedAt: 10,
    });

    await assert.rejects(
        parseSnapshotArchive({ ...document, formatVersion: 2 }),
        (error) => (
            error instanceof SnapshotArchiveError
            && error.code === 'unsupported-format-version'
        ),
    );

    const tampered = structuredClone(document);
    tampered.entries[0].snapshot.finalText = 'do-not-echo-tampered';
    await assert.rejects(
        parseSnapshotArchive(tampered),
        (error) => (
            error instanceof SnapshotArchiveError
            && error.code === 'digest-mismatch'
            && !error.message.includes('do-not-echo')
        ),
    );

    const duplicate = structuredClone(document);
    duplicate.entries.push(structuredClone(duplicate.entries[0]));
    duplicate.summary.snapshotCount = 2;
    await assert.rejects(
        parseSnapshotArchive(duplicate),
        (error) => (
            error instanceof SnapshotArchiveError
            && error.code === 'duplicate-snapshot-id'
        ),
    );

    const unsafe = structuredClone(document);
    Object.defineProperty(unsafe.entries[0].snapshot, '__proto__', {
        value: { polluted: true },
        enumerable: true,
    });
    await assert.rejects(
        parseSnapshotArchive(unsafe),
        (error) => (
            error instanceof SnapshotArchiveError
            && error.code === 'unsafe-key'
        ),
    );
    assert.equal({}.polluted, undefined);
});

test('archive input bounds reject excessive bytes, depth, and counts before staging', async () => {
    await assert.rejects(
        parseSnapshotArchive(' '.repeat(257), {
            limits: { inputBytes: 256 },
        }),
        (error) => (
            error instanceof SnapshotArchiveError
            && error.code === 'archive-too-large'
        ),
    );

    let nested = 'leaf';
    for (let index = 0; index < 10; index += 1) nested = { child: nested };
    const deep = await createSnapshotArchive({
        timelines: timelines(snapshot('one', 'chat', 1)),
        exportedAt: 10,
    });
    deep.entries[0].snapshot.extra = nested;
    await assert.rejects(
        parseSnapshotArchive(deep, { limits: { depth: 6 } }),
        (error) => (
            error instanceof SnapshotArchiveError
            && error.code === 'input-too-deep'
        ),
    );

    await assert.rejects(
        createSnapshotArchive({
            timelines: timelines(
                snapshot('one', 'chat', 1),
                snapshot('two', 'chat', 2),
            ),
            limits: { snapshots: 1 },
        }),
        (error) => (
            error instanceof SnapshotArchiveError
            && error.code === 'too-many-snapshots'
        ),
    );
});

test('merge planning skips identical snapshots and handles changed-id conflicts explicitly', async () => {
    const current = snapshot('same', 'chat', 1, 'current');
    const identicalArchive = await createSnapshotArchive({
        timelines: timelines(current),
        exportedAt: 10,
    });
    const identical = await prepareSnapshotArchiveImport(
        identicalArchive,
        timelines(current),
    );
    assert.equal(identical.summary.addCount, 0);
    assert.equal(identical.summary.duplicateCount, 1);
    assert.equal(identical.skipped[0].reason, 'same-digest');

    const changed = snapshot('same', 'chat', 2, 'changed');
    const changedArchive = await createSnapshotArchive({
        timelines: timelines(changed),
        exportedAt: 10,
    });
    const keepBoth = await prepareSnapshotArchiveImport(
        changedArchive,
        timelines(current),
        { conflictPolicy: 'keep-both' },
    );
    assert.equal(keepBoth.summary.addCount, 1);
    assert.equal(keepBoth.summary.conflictCount, 1);
    assert.match(keepBoth.stagedSnapshots[0].id, /^same~import-[0-9a-f]{12}$/u);

    const skipped = await prepareSnapshotArchiveImport(
        changedArchive,
        timelines(current),
        { conflictPolicy: 'skip' },
    );
    assert.equal(skipped.summary.addCount, 0);
    assert.equal(skipped.skipped[0].reason, 'id-conflict');
});

test('replace planning requires the archive-specific explicit confirmation token', async () => {
    const document = await createSnapshotArchive({
        timelines: timelines(snapshot('replacement', 'chat', 2)),
        exportedAt: 10,
    });
    await assert.rejects(
        prepareSnapshotArchiveImport(
            document,
            timelines(snapshot('current', 'chat', 1)),
            { strategy: 'replace' },
        ),
        (error) => (
            error instanceof SnapshotArchiveError
            && error.code === 'replace-confirmation-required'
            && error.confirmationTokenRequired === true
        ),
    );

    const token = await snapshotArchiveReplaceConfirmationToken(document);
    assert.match(token, /^REPLACE-[0-9A-F]{16}$/u);
    const plan = await prepareSnapshotArchiveImport(
        document,
        timelines(snapshot('current', 'chat', 1)),
        {
            strategy: 'replace',
            confirmationToken: token,
        },
    );
    assert.equal(plan.strategy, 'replace');
    assert.equal(plan.summary.addCount, 1);
    assert.equal(plan.summary.projectedSnapshotCount, 1);
});

test('archive import uses public store APIs and verifies successful read-back', async () => {
    const current = snapshot('current', 'chat', 1);
    const added = snapshot('added', 'chat', 2);
    const store = new FakeStore(timelines(current));
    const document = await createSnapshotArchive({
        timelines: timelines(added),
        exportedAt: 10,
    });
    const plan = await prepareSnapshotArchiveImport(
        document,
        await store.getAllStoredTimelines(),
    );

    const result = await executeSnapshotArchiveImport(store, plan);
    assert.equal(result.ok, true);
    assert.equal(result.verified, true);
    assert.equal(result.appliedCount, 1);
    assert.deepEqual(store.addOptions, [{ skipRetention: true }]);
    assert.deepEqual(
        (await store.getAllStoredTimelines())[0].timeline
            .map(({ id }) => id)
            .sort(),
        ['added', 'current'],
    );
});

test('partial store failure restores the base state without exposing raw errors', async () => {
    const current = snapshot('current', 'chat', 1, 'base-private');
    const first = snapshot('first', 'chat', 2, 'first-private');
    const second = snapshot('second', 'chat', 3, 'second-private');
    const store = new FakeStore(timelines(current), { failAddAt: 2 });
    store.rawOrphans.set('corrupt-orphan-key', {
        raw: 'preserve-corrupt-orphan-verbatim',
    });
    const document = await createSnapshotArchive({
        timelines: timelines(first, second),
        exportedAt: 10,
    });
    const plan = await prepareSnapshotArchiveImport(
        document,
        await store.getAllStoredTimelines(),
    );

    const result = await executeSnapshotArchiveImport(store, plan);
    assert.deepEqual(
        {
            ok: result.ok,
            code: result.code,
            appliedCount: result.appliedCount,
            verified: result.verified,
            recoveryStatus: result.recovery.status,
        },
        {
            ok: false,
            code: 'store-write-failed',
            appliedCount: 1,
            verified: false,
            recoveryStatus: 'transaction-rolled-back',
        },
    );
    assert.equal(result.recovery.rawKeysRestored, true);
    assert.equal(result.recovery.replayedHealthySnapshots, false);
    assert.deepEqual(store.rawOrphans.get('corrupt-orphan-key'), {
        raw: 'preserve-corrupt-orphan-verbatim',
    });
    assert.equal(JSON.stringify(result).includes('second-private'), false);
    assert.deepEqual(
        (await store.getAllStoredTimelines())[0].timeline.map(({ id }) => id),
        ['current'],
    );
});

test('rollback failure is reported without claiming raw storage restoration', async () => {
    const document = await createSnapshotArchive({
        timelines: timelines(snapshot('added', 'chat', 2)),
        exportedAt: 10,
    });
    const plan = await prepareSnapshotArchiveImport(document, []);
    const result = await executeSnapshotArchiveImport({
        async runExclusiveImport() {
            const error = new Error('backend remained unavailable');
            error.code = 'import-rollback-failed';
            throw error;
        },
    }, plan);

    assert.deepEqual(
        {
            ok: result.ok,
            code: result.code,
            status: result.recovery.status,
            restored: result.recovery.restored,
            rawKeysRestored: result.recovery.rawKeysRestored,
        },
        {
            ok: false,
            code: 'import-rollback-failed',
            status: 'rollback-failed',
            restored: false,
            rawKeysRestored: false,
        },
    );
});

test('stale plans and silent write loss stop safely before reporting success', async () => {
    const current = snapshot('current', 'chat', 1);
    const added = snapshot('added', 'chat', 2);
    const document = await createSnapshotArchive({
        timelines: timelines(added),
        exportedAt: 10,
    });
    const store = new FakeStore(timelines(current));
    const plan = await prepareSnapshotArchiveImport(
        document,
        await store.getAllStoredTimelines(),
    );
    await store.addSnapshot(snapshot('concurrent', 'chat', 3));
    const stale = await executeSnapshotArchiveImport(store, plan);
    assert.equal(stale.code, 'stale-import-plan');
    assert.equal(stale.appliedCount, 0);

    const lossyStore = new FakeStore(timelines(current), { dropAdds: true });
    const lossyPlan = await prepareSnapshotArchiveImport(
        document,
        await lossyStore.getAllStoredTimelines(),
    );
    const loss = await executeSnapshotArchiveImport(lossyStore, lossyPlan);
    assert.equal(loss.ok, false);
    assert.equal(loss.code, 'read-back-mismatch');
    assert.equal(loss.recovery.status, 'transaction-rolled-back');
});

test('execute refuses stores without an exclusive transactional facade', async () => {
    const document = await createSnapshotArchive({
        timelines: timelines(snapshot('added', 'chat', 2)),
        exportedAt: 10,
    });
    const plan = await prepareSnapshotArchiveImport(document, []);
    await assert.rejects(
        executeSnapshotArchiveImport({
            getAllStoredTimelines: async () => [],
            addSnapshot: async () => {},
            clearAll: async () => {},
        }, plan),
        (error) => (
            error instanceof SnapshotArchiveError
            && error.code === 'exclusive-import-required'
        ),
    );
});

test('exclusive import serializes a concurrent capture after verified merge', async () => {
    const current = snapshot('current', 'chat', 1);
    const imported = snapshot('imported', 'chat', 2);
    const concurrent = snapshot('concurrent', 'chat', 3);
    const store = new FakeStore(timelines(current));
    const document = await createSnapshotArchive({
        timelines: timelines(imported),
        exportedAt: 10,
    });
    const plan = await prepareSnapshotArchiveImport(
        document,
        await store.getAllStoredTimelines(),
    );
    let announceImport;
    let releaseImport;
    const importEntered = new Promise((resolve) => {
        announceImport = resolve;
    });
    const importHeld = new Promise((resolve) => {
        releaseImport = resolve;
    });
    store.importGate = async () => {
        announceImport();
        await importHeld;
    };

    const importing = executeSnapshotArchiveImport(store, plan);
    await importEntered;
    let captureFinished = false;
    const capturing = store.addSnapshot(concurrent).then(() => {
        captureFinished = true;
    });
    await Promise.resolve();
    assert.equal(captureFinished, false);
    releaseImport();

    const result = await importing;
    await capturing;
    assert.equal(result.ok, true);
    assert.deepEqual(
        (await store.getAllStoredTimelines())[0].timeline
            .map(({ id }) => id)
            .sort(),
        ['concurrent', 'current', 'imported'],
    );
});

test('skipRetention prevents intermediate pruning from breaking archive merge', async () => {
    const current = snapshot('current', 'chat', 1);
    const first = snapshot('first', 'chat', 2);
    const second = snapshot('second', 'chat', 3);
    const store = new FakeStore(timelines(current), { retentionLimit: 1 });
    const document = await createSnapshotArchive({
        timelines: timelines(first, second),
        exportedAt: 10,
    });
    const plan = await prepareSnapshotArchiveImport(
        document,
        await store.getAllStoredTimelines(),
    );

    const result = await executeSnapshotArchiveImport(store, plan);
    assert.equal(result.ok, true);
    assert.deepEqual(store.addOptions, [
        { skipRetention: true },
        { skipRetention: true },
    ]);
    assert.equal(
        (await store.getAllStoredTimelines())[0].timeline.length,
        3,
    );
});

test('failed replace relies on raw transaction rollback without healthy replay', async () => {
    const current = snapshot('current', 'chat', 1, 'current-private');
    const first = snapshot('first', 'chat', 2, 'first-private');
    const second = snapshot('second', 'chat', 3, 'second-private');
    const store = new FakeStore(timelines(current), { failAddAt: 2 });
    store.rawOrphans.set('damaged-index-record', {
        sentinel: 'preserve-on-replace-rollback',
    });
    const document = await createSnapshotArchive({
        timelines: timelines(first, second),
        exportedAt: 10,
    });
    const confirmationToken = await snapshotArchiveReplaceConfirmationToken(document);
    const plan = await prepareSnapshotArchiveImport(
        document,
        await store.getAllStoredTimelines(),
        {
            strategy: 'replace',
            confirmationToken,
        },
    );

    const result = await executeSnapshotArchiveImport(store, plan);
    assert.equal(result.ok, false);
    assert.equal(result.recovery.status, 'transaction-rolled-back');
    assert.equal(result.recovery.replayedHealthySnapshots, false);
    assert.deepEqual(store.rawOrphans.get('damaged-index-record'), {
        sentinel: 'preserve-on-replace-rollback',
    });
    assert.deepEqual(
        (await store.getAllStoredTimelines())[0].timeline.map(({ id }) => id),
        ['current'],
    );
});
