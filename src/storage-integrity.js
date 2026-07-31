export const DEFAULT_INTEGRITY_METADATA_LIMIT = 100;
export const MAX_INTEGRITY_METADATA_LIMIT = 1_000;

const MAX_METADATA_TEXT_LENGTH = 256;

function boundedText(value) {
    return String(value ?? '').slice(0, MAX_METADATA_TEXT_LENGTH);
}

function normalizedLimit(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return DEFAULT_INTEGRITY_METADATA_LIMIT;
    return Math.min(
        MAX_INTEGRITY_METADATA_LIMIT,
        Math.max(1, Math.trunc(number)),
    );
}

function recordIdentity(chatId, id) {
    return `${String(chatId).length}:${chatId}${id}`;
}

function normalizeEntry(value) {
    if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !value.id) {
        return null;
    }
    return {
        id: value.id,
        timestamp: Number(value.timestamp) || 0,
        approximateBytes: Math.max(
            0,
            Math.trunc(Number(value.approximateBytes) || 0),
        ),
    };
}

function normalizeRecord(value) {
    if (
        !value
        || typeof value !== 'object'
        || typeof value.chatId !== 'string'
        || !value.chatId
        || typeof value.id !== 'string'
        || !value.id
    ) {
        return null;
    }
    return {
        chatId: value.chatId,
        id: value.id,
        valid: value.valid === true,
        timestamp: Number(value.timestamp) || 0,
        approximateBytes: Math.max(
            0,
            Math.trunc(Number(value.approximateBytes) || 0),
        ),
        errorCode: boundedText(value.errorCode || 'corrupt-record'),
    };
}

function sortedEntries(entries) {
    return [...new Map(entries.map((entry) => [entry.id, entry])).values()]
        .sort((left, right) => (
            left.timestamp - right.timestamp
            || left.id.localeCompare(right.id)
        ));
}

/**
 * Produces a deterministic diagnosis and an idempotent repair plan from bounded
 * record descriptors. Callers must never pass raw snapshot values here.
 */
export function inspectStorageIntegrityState({
    indexes = [],
    records = [],
    legacyContainers = [],
    extraSummary = {},
    metadataLimit = DEFAULT_INTEGRITY_METADATA_LIMIT,
} = {}) {
    const issueLimit = normalizedLimit(metadataLimit);
    const issues = [];
    let issueTotal = 0;
    const counts = {
        missingRecords: 0,
        corruptRecords: 0,
        validOrphans: 0,
        invalidIndexes: 0,
        duplicateLegacyContainers: 0,
        conflictingLegacyContainers: 0,
    };
    const addIssue = (kind, chatId, id, code) => {
        issueTotal += 1;
        counts[kind] += 1;
        if (issues.length >= issueLimit) return;
        issues.push({
            kind,
            chatId: boundedText(chatId),
            id: boundedText(id),
            code: boundedText(code),
        });
    };

    const normalizedRecords = records
        .map(normalizeRecord)
        .filter(Boolean);
    const recordsByIdentity = new Map(normalizedRecords.map((record) => [
        recordIdentity(record.chatId, record.id),
        record,
    ]));
    const validIndexes = new Map();
    const allChatIds = new Set(normalizedRecords.map(({ chatId }) => chatId));

    for (const descriptor of indexes) {
        const chatId = typeof descriptor?.chatId === 'string'
            ? descriptor.chatId
            : '';
        if (!chatId) continue;
        allChatIds.add(chatId);
        const entries = Array.isArray(descriptor?.entries)
            ? descriptor.entries.map(normalizeEntry).filter(Boolean)
            : [];
        if (descriptor?.valid !== true) {
            addIssue('invalidIndexes', chatId, '', 'invalid-index');
            continue;
        }
        validIndexes.set(chatId, sortedEntries(entries));
    }

    const referenced = new Set();
    const repairedEntries = new Map();
    for (const chatId of allChatIds) repairedEntries.set(chatId, []);

    for (const [chatId, entries] of validIndexes) {
        const nextEntries = repairedEntries.get(chatId);
        for (const entry of entries) {
            const identity = recordIdentity(chatId, entry.id);
            referenced.add(identity);
            const record = recordsByIdentity.get(identity);
            if (!record) {
                addIssue(
                    'missingRecords',
                    chatId,
                    entry.id,
                    'missing-snapshot-record',
                );
                continue;
            }
            if (!record.valid) {
                // Keep the reference so the existing corruption warning remains
                // discoverable, while leaving the raw corrupt value untouched.
                nextEntries.push(entry);
                continue;
            }
            nextEntries.push({
                id: record.id,
                timestamp: record.timestamp || entry.timestamp,
                approximateBytes: record.approximateBytes || entry.approximateBytes,
            });
        }
    }

    for (const record of normalizedRecords) {
        const identity = recordIdentity(record.chatId, record.id);
        if (!record.valid) {
            addIssue(
                'corruptRecords',
                record.chatId,
                record.id,
                record.errorCode,
            );
            continue;
        }
        if (referenced.has(identity)) continue;
        addIssue(
            'validOrphans',
            record.chatId,
            record.id,
            'valid-orphan-record',
        );
        repairedEntries.get(record.chatId).push({
            id: record.id,
            timestamp: record.timestamp,
            approximateBytes: record.approximateBytes,
        });
    }

    const repairedIndexes = [...repairedEntries]
        .map(([chatId, entries]) => ({
            chatId,
            entries: sortedEntries(entries),
        }))
        .sort((left, right) => left.chatId.localeCompare(right.chatId));
    const activeIndexes = repairedIndexes.filter(({ entries }) => entries.length > 0);
    const extraChatCount = Math.max(0, Math.trunc(Number(extraSummary.chatCount) || 0));
    const extraTimelineRecordCount = Math.max(
        0,
        Math.trunc(Number(extraSummary.timelineRecordCount) || extraChatCount),
    );
    const extraSnapshotCount = Math.max(
        0,
        Math.trunc(Number(extraSummary.snapshotCount) || 0),
    );
    const extraApproximateBytes = Math.max(
        0,
        Math.trunc(Number(extraSummary.approximateBytes) || 0),
    );
    const plannedSnapshotCount = activeIndexes.reduce(
        (total, index) => total + index.entries.length,
        0,
    );
    const plannedApproximateBytes = activeIndexes.reduce(
        (total, index) => total + index.entries.reduce(
            (subtotal, entry) => subtotal + entry.approximateBytes,
            0,
        ),
        0,
    );
    const legacyKeysToRemove = [];
    for (const descriptor of legacyContainers) {
        const chatId = typeof descriptor?.chatId === 'string'
            ? descriptor.chatId
            : '';
        if (!chatId) continue;
        if (descriptor.status === 'duplicate') {
            addIssue(
                'duplicateLegacyContainers',
                chatId,
                '',
                'duplicate-legacy-container',
            );
            legacyKeysToRemove.push(chatId);
        } else {
            addIssue(
                'conflictingLegacyContainers',
                chatId,
                '',
                'conflicting-legacy-container',
            );
        }
    }

    return {
        healthy: issueTotal === 0,
        counts: {
            ...counts,
            total: issueTotal,
        },
        issues,
        issuesTruncated: issueTotal > issues.length,
        repairPlan: {
            indexes: repairedIndexes,
            legacyChatIdsToRemove: legacyKeysToRemove.sort(),
            activeChatIds: activeIndexes.map(({ chatId }) => chatId),
            summary: {
                chatCount: activeIndexes.length + extraChatCount,
                timelineRecordCount: activeIndexes.length + extraTimelineRecordCount,
                snapshotCount: plannedSnapshotCount + extraSnapshotCount,
                approximateBytes: plannedApproximateBytes + extraApproximateBytes,
            },
        },
    };
}

export function integrityRepairTargetMetadata(
    repairPlan,
    limit = DEFAULT_INTEGRITY_METADATA_LIMIT,
) {
    const targetLimit = normalizedLimit(limit);
    const allTargets = [];
    for (const index of repairPlan?.indexes ?? []) {
        allTargets.push({
            kind: index.entries.length > 0 ? 'rebuild-index' : 'remove-index',
            chatId: boundedText(index.chatId),
            snapshotCount: index.entries.length,
        });
    }
    for (const chatId of repairPlan?.legacyChatIdsToRemove ?? []) {
        allTargets.push({
            kind: 'remove-duplicate-legacy',
            chatId: boundedText(chatId),
            snapshotCount: 0,
        });
    }
    return {
        targets: allTargets.slice(0, targetLimit),
        targetsTruncated: allTargets.length > targetLimit,
        targetCount: allTargets.length,
    };
}
