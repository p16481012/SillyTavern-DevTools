import assert from 'node:assert/strict';
import test from 'node:test';
import {
    inspectStorageIntegrityState,
    integrityRepairTargetMetadata,
} from '../src/storage-integrity.js';

test('diagnoses missing, corrupt, orphan and invalid index records without raw data', () => {
    const diagnosis = inspectStorageIntegrityState({
        indexes: [
            {
                chatId: 'chat-a',
                valid: true,
                entries: [
                    { id: 'healthy', timestamp: 1, approximateBytes: 10 },
                    { id: 'missing', timestamp: 2, approximateBytes: 20 },
                    { id: 'corrupt', timestamp: 3, approximateBytes: 30 },
                ],
            },
            { chatId: 'chat-b', valid: false, raw: { secret: 'must-not-leak' } },
        ],
        records: [
            {
                chatId: 'chat-a',
                id: 'healthy',
                valid: true,
                timestamp: 1,
                approximateBytes: 11,
            },
            {
                chatId: 'chat-a',
                id: 'corrupt',
                valid: false,
                errorCode: 'invalid-schema',
                raw: { secret: 'must-not-leak' },
            },
            {
                chatId: 'chat-b',
                id: 'orphan',
                valid: true,
                timestamp: 4,
                approximateBytes: 40,
            },
        ],
    });

    assert.deepEqual(diagnosis.counts, {
        missingRecords: 1,
        corruptRecords: 1,
        validOrphans: 1,
        invalidIndexes: 1,
        duplicateLegacyContainers: 0,
        conflictingLegacyContainers: 0,
        total: 4,
    });
    assert.deepEqual(
        diagnosis.repairPlan.indexes.find(({ chatId }) => chatId === 'chat-a').entries,
        [
            { id: 'healthy', timestamp: 1, approximateBytes: 11 },
            { id: 'corrupt', timestamp: 3, approximateBytes: 30 },
        ],
    );
    assert.deepEqual(
        diagnosis.repairPlan.indexes.find(({ chatId }) => chatId === 'chat-b').entries,
        [{ id: 'orphan', timestamp: 4, approximateBytes: 40 }],
    );
    assert.doesNotMatch(JSON.stringify(diagnosis), /must-not-leak/u);
});

test('duplicate legacy containers are repairable while conflicting raw data is preserved', () => {
    const diagnosis = inspectStorageIntegrityState({
        indexes: [{
            chatId: 'chat',
            valid: true,
            entries: [{ id: 'current', timestamp: 1, approximateBytes: 10 }],
        }],
        records: [{
            chatId: 'chat',
            id: 'current',
            valid: true,
            timestamp: 1,
            approximateBytes: 10,
        }],
        legacyContainers: [
            { chatId: 'chat', status: 'duplicate' },
            { chatId: 'conflict', status: 'conflict' },
        ],
    });

    assert.equal(diagnosis.counts.duplicateLegacyContainers, 1);
    assert.equal(diagnosis.counts.conflictingLegacyContainers, 1);
    assert.deepEqual(diagnosis.repairPlan.legacyChatIdsToRemove, ['chat']);
    assert.equal(
        diagnosis.repairPlan.legacyChatIdsToRemove.includes('conflict'),
        false,
    );
});

test('repair plan is deterministic and retry-safe after it has been applied', () => {
    const initial = inspectStorageIntegrityState({
        indexes: [{
            chatId: 'chat',
            valid: true,
            entries: [{ id: 'gone', timestamp: 1, approximateBytes: 10 }],
        }],
        records: [{
            chatId: 'chat',
            id: 'orphan',
            valid: true,
            timestamp: 2,
            approximateBytes: 20,
        }],
    });
    const appliedIndexes = initial.repairPlan.indexes.map((index) => ({
        ...index,
        valid: true,
    }));
    const retried = inspectStorageIntegrityState({
        indexes: appliedIndexes,
        records: [{
            chatId: 'chat',
            id: 'orphan',
            valid: true,
            timestamp: 2,
            approximateBytes: 20,
        }],
    });

    assert.equal(retried.healthy, true);
    assert.equal(retried.counts.total, 0);
    assert.deepEqual(retried.repairPlan.indexes, initial.repairPlan.indexes);
});

test('diagnostic and repair target metadata stay bounded with 1000+ light entries', () => {
    const indexes = [];
    const records = [];
    for (let index = 0; index < 1_200; index += 1) {
        const chatId = `chat-${index}`;
        indexes.push({ chatId, valid: false });
        records.push({
            chatId,
            id: `snapshot-${index}`,
            valid: true,
            timestamp: index,
            approximateBytes: 1,
        });
    }
    const diagnosis = inspectStorageIntegrityState({
        indexes,
        records,
        metadataLimit: 25,
    });
    const targets = integrityRepairTargetMetadata(diagnosis.repairPlan, 30);

    assert.equal(diagnosis.counts.invalidIndexes, 1_200);
    assert.equal(diagnosis.counts.validOrphans, 1_200);
    assert.equal(diagnosis.issues.length, 25);
    assert.equal(diagnosis.issuesTruncated, true);
    assert.equal(targets.targetCount, 1_200);
    assert.equal(targets.targets.length, 30);
    assert.equal(targets.targetsTruncated, true);
});
