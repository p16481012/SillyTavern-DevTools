import assert from 'node:assert/strict';
import test from 'node:test';
import {
    DEFAULT_RETENTION_POLICY,
    MAX_RETENTION_TARGET_METADATA,
    normalizeRetentionPolicy,
    planRetentionGc,
} from '../src/retention-policy.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function entry(id, chatId, day, approximateBytes = 10, extra = {}) {
    return {
        id,
        chatId,
        timestamp: day * DAY_MS,
        approximateBytes,
        ...extra,
    };
}

test('retention policy keeps a positive count and treats zero age and bytes as off', () => {
    assert.deepEqual(normalizeRetentionPolicy(), DEFAULT_RETENTION_POLICY);
    assert.deepEqual(normalizeRetentionPolicy({
        maxSnapshotsPerChat: 0,
        maxAgeDays: -3,
        maxTotalBytes: -99,
    }), {
        maxSnapshotsPerChat: 1,
        maxAgeDays: 0,
        maxTotalBytes: 0,
    });
    assert.deepEqual(normalizeRetentionPolicy({
        maxSnapshotsPerChat: '12.9',
        maxAgeDays: '7.8',
        maxTotalBytes: '2048.9',
    }), {
        maxSnapshotsPerChat: 12,
        maxAgeDays: 7,
        maxTotalBytes: 2048,
    });
    assert.deepEqual(
        normalizeRetentionPolicy({
            maxSnapshotsPerChat: 'invalid',
            maxAgeDays: '',
            maxTotalBytes: Number.POSITIVE_INFINITY,
        }),
        DEFAULT_RETENTION_POLICY,
    );
});

test('GC applies age, then per-chat count, then global byte limits', () => {
    const result = planRetentionGc([
        entry('age', 'a', 0),
        entry('count', 'a', 6),
        entry('bytes', 'a', 7, 20),
        entry('a-new', 'a', 10, 20),
        entry('b-old', 'b', 8, 20),
        entry('b-new', 'b', 10, 20),
    ], {
        maxSnapshotsPerChat: 2,
        maxAgeDays: 5,
        maxTotalBytes: 60,
    }, {
        now: 10 * DAY_MS,
        revision: 42,
    });

    assert.equal(result.revision, 42);
    assert.deepEqual(result.targets.map(({ id, reason }) => [id, reason]), [
        ['age', 'age'],
        ['count', 'count'],
        ['bytes', 'bytes'],
    ]);
    assert.deepEqual(result.reasons, {
        age: { count: 1, bytes: 10 },
        count: { count: 1, bytes: 10 },
        bytes: { count: 1, bytes: 20 },
    });
    assert.equal(result.affectedChats, 1);
    assert.equal(result.deleteCount, 3);
    assert.equal(result.deleteBytes, 40);
    assert.equal(result.retainedCount, 3);
    assert.equal(result.retainedBytes, 60);
    assert.equal(result.overBudget, false);
    assert.deepEqual(result.unmet, { age: 0, count: 0, bytes: 0 });
});

test('newest healthy per chat and explicitly newly added entries survive every policy', () => {
    const result = planRetentionGc([
        entry('old', 'chat', 1, 4),
        entry('healthy-latest', 'chat', 2, 4),
        entry('new-corrupt', 'chat', 3, 4, { healthy: false }),
    ], {
        maxSnapshotsPerChat: 1,
        maxAgeDays: 1,
        maxTotalBytes: 5,
    }, {
        now: 10 * DAY_MS,
        newlyAddedId: 'new-corrupt',
    });

    assert.deepEqual(result.targets.map(({ id }) => id), ['old']);
    assert.equal(result.protectedCount, 2);
    assert.equal(result.protectedBytes, 8);
    assert.equal(result.retainedCount, 2);
    assert.equal(result.overBudget, true);
    assert.equal(result.overBudgetBytes, 3);
    assert.deepEqual(result.unmet, { age: 2, count: 1, bytes: 3 });
});

test('protectedIds are honored and an item at the age cutoff is retained', () => {
    const result = planRetentionGc([
        entry('protected-old', 'chat', 1),
        entry('at-cutoff', 'chat', 5),
        entry('newest', 'chat', 10),
    ], {
        maxSnapshotsPerChat: 3,
        maxAgeDays: 5,
        maxTotalBytes: 0,
    }, {
        now: 10 * DAY_MS,
        protectedIds: ['protected-old'],
    });

    assert.equal(result.deleteCount, 0);
    assert.equal(result.protectedCount, 2);
    assert.deepEqual(result.unmet, { age: 1, count: 0, bytes: 0 });
});

test('storage-owned protected entries count toward bytes but are never GC targets', () => {
    const result = planRetentionGc([
        entry('non-deletable', 'chat', 0, 20, {
            healthy: false,
            protected: true,
        }),
        entry('healthy', 'chat', 1, 5),
    ], {
        maxSnapshotsPerChat: 1,
        maxAgeDays: 0,
        maxTotalBytes: 10,
    });

    assert.equal(result.deleteCount, 0);
    assert.equal(result.protectedCount, 2);
    assert.equal(result.protectedBytes, 25);
    assert.equal(result.overBudget, true);
});

test('zero age and byte settings disable those stages', () => {
    const result = planRetentionGc([
        entry('old', 'chat', 0, 1_000),
        entry('new', 'chat', 1, 1_000),
    ], {
        maxSnapshotsPerChat: 1,
        maxAgeDays: 0,
        maxTotalBytes: 0,
    });

    assert.deepEqual(result.targets.map(({ id, reason }) => [id, reason]), [
        ['old', 'count'],
    ]);
    assert.deepEqual(result.reasons.age, { count: 0, bytes: 0 });
    assert.deepEqual(result.reasons.bytes, { count: 0, bytes: 0 });
    assert.equal(result.overBudget, false);
});

test('large previews are deterministic, bounded, exact, and contain no raw data', () => {
    const values = Array.from({ length: 151 }, (_, index) => ({
        ...entry(`item-${String(index).padStart(3, '0')}`, 'chat', index, index + 1),
        raw: `private-${index}`,
        snapshot: { prompt: `secret-${index}` },
    }));
    const options = {
        now: 1_000 * DAY_MS,
        targetMetadataLimit: 10_000,
    };
    const policy = {
        maxSnapshotsPerChat: 151,
        maxAgeDays: 1,
        maxTotalBytes: 0,
    };

    const forward = planRetentionGc(values, policy, options);
    const reversed = planRetentionGc([...values].reverse(), policy, options);

    assert.deepEqual(forward, reversed);
    assert.equal(forward.deleteCount, 150);
    assert.equal(forward.deleteBytes, (150 * 151) / 2);
    assert.equal(forward.targets.length, MAX_RETENTION_TARGET_METADATA);
    assert.equal(forward.targetsTruncated, true);
    assert.equal(forward.omittedTargetCount, 50);
    assert.deepEqual(Object.keys(forward.targets[0]), [
        'id',
        'chatId',
        'timestamp',
        'approximateBytes',
        'reason',
    ]);
    assert.equal(JSON.stringify(forward).includes('private-'), false);
    assert.equal(JSON.stringify(forward).includes('secret-'), false);
});

test('target metadata can be disabled while aggregate deletion data remains exact', () => {
    const result = planRetentionGc([
        entry('old', 'chat', 0, 7),
        entry('new', 'chat', 1, 11),
    ], {
        maxSnapshotsPerChat: 1,
        maxAgeDays: 0,
        maxTotalBytes: 0,
    }, {
        targetMetadataLimit: 0,
    });

    assert.deepEqual(result.targets, []);
    assert.equal(result.targetsTruncated, true);
    assert.equal(result.omittedTargetCount, 1);
    assert.equal(result.deleteCount, 1);
    assert.equal(result.deleteBytes, 7);
});

test('enabled age policy requires explicit time and malformed metadata is rejected', () => {
    assert.throws(
        () => planRetentionGc([], {
            maxSnapshotsPerChat: 1,
            maxAgeDays: 1,
            maxTotalBytes: 0,
        }),
        /options\.now/,
    );
    assert.throws(
        () => planRetentionGc([{
            id: 'bad',
            chatId: 'chat',
            timestamp: 1,
            approximateBytes: -1,
        }], DEFAULT_RETENTION_POLICY),
        /approximateBytes/,
    );
    assert.throws(
        () => planRetentionGc([
            entry('duplicate', 'chat', 1),
            entry('duplicate', 'chat', 2),
        ], DEFAULT_RETENTION_POLICY),
        /Duplicate retention entry/,
    );
});
