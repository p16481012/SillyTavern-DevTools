const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TARGET_METADATA_LIMIT = 50;

export const MAX_RETENTION_TARGET_METADATA = 100;

export const DEFAULT_RETENTION_POLICY = Object.freeze({
    maxSnapshotsPerChat: 30,
    maxAgeDays: 0,
    maxTotalBytes: 0,
});

function numericValue(value) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && value.trim()) return Number(value);
    return Number.NaN;
}

function wholeNumber(value, fallback, {
    minimum = 0,
    maximum = Number.MAX_SAFE_INTEGER,
} = {}) {
    const number = numericValue(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(maximum, Math.max(minimum, Math.trunc(number)));
}

/**
 * Normalize user-facing retention settings without retaining caller-owned data.
 * A zero age or byte limit disables that constraint; the per-chat count always
 * keeps at least one snapshot.
 */
export function normalizeRetentionPolicy(value = {}) {
    const source = value && typeof value === 'object' ? value : {};
    return {
        maxSnapshotsPerChat: wholeNumber(
            source.maxSnapshotsPerChat,
            DEFAULT_RETENTION_POLICY.maxSnapshotsPerChat,
            { minimum: 1 },
        ),
        maxAgeDays: wholeNumber(
            source.maxAgeDays,
            DEFAULT_RETENTION_POLICY.maxAgeDays,
            { maximum: Math.floor(Number.MAX_SAFE_INTEGER / DAY_MS) },
        ),
        maxTotalBytes: wholeNumber(
            source.maxTotalBytes,
            DEFAULT_RETENTION_POLICY.maxTotalBytes,
        ),
    };
}

function compareText(left, right) {
    if (left === right) return 0;
    return left < right ? -1 : 1;
}

function compareOldestFirst(left, right) {
    return left.timestamp - right.timestamp
        || compareText(left.chatId, right.chatId)
        || compareText(left.id, right.id);
}

function entryKey(entry) {
    return `${entry.chatId.length}:${entry.chatId}${entry.id}`;
}

function normalizeEntry(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('Retention entries must be objects.');
    }
    if (typeof value.id !== 'string' || !value.id) {
        throw new TypeError('Retention entries require a non-empty id.');
    }
    const timestamp = numericValue(value.timestamp);
    if (!Number.isFinite(timestamp)) {
        throw new TypeError(`Retention entry "${value.id}" has an invalid timestamp.`);
    }
    const approximateBytes = numericValue(value.approximateBytes);
    if (
        !Number.isFinite(approximateBytes)
        || approximateBytes < 0
        || approximateBytes > Number.MAX_SAFE_INTEGER
    ) {
        throw new TypeError(`Retention entry "${value.id}" has invalid approximateBytes.`);
    }
    return {
        id: value.id,
        chatId: typeof value.chatId === 'string' && value.chatId
            ? value.chatId
            : '__global__',
        timestamp,
        approximateBytes: Math.trunc(approximateBytes),
        healthy: value.healthy !== false,
        removedReason: null,
        protected: value.protected === true,
    };
}

function normalizeEntries(values) {
    if (!Array.isArray(values)) {
        throw new TypeError('Retention entries must be an array.');
    }
    const seen = new Set();
    const entries = values.map(normalizeEntry);
    for (const entry of entries) {
        const key = entryKey(entry);
        if (seen.has(key)) {
            throw new TypeError(
                `Duplicate retention entry "${entry.id}" in chat "${entry.chatId}".`,
            );
        }
        seen.add(key);
    }
    return entries.sort(compareOldestFirst);
}

function idsFromOptions(options) {
    const protectedIds = new Set(
        Array.isArray(options.protectedIds)
            ? options.protectedIds.filter((id) => typeof id === 'string' && id)
            : [],
    );
    if (typeof options.newlyAddedId === 'string' && options.newlyAddedId) {
        protectedIds.add(options.newlyAddedId);
    }
    return protectedIds;
}

function protectEntries(entries, options) {
    const explicitlyProtected = idsFromOptions(options);
    const newestHealthyByChat = new Map();

    for (const entry of entries) {
        if (explicitlyProtected.has(entry.id)) entry.protected = true;
        if (!entry.healthy) continue;
        const current = newestHealthyByChat.get(entry.chatId);
        if (!current || compareOldestFirst(current, entry) < 0) {
            newestHealthyByChat.set(entry.chatId, entry);
        }
    }
    for (const entry of newestHealthyByChat.values()) entry.protected = true;
}

function sumBytes(entries) {
    return entries.reduce((total, entry) => total + entry.approximateBytes, 0);
}

function activeEntries(entries) {
    return entries.filter(({ removedReason }) => removedReason == null);
}

function markRemoved(entry, reason, removed) {
    entry.removedReason = reason;
    removed.push(entry);
}

function applyAgePolicy(entries, policy, now, removed) {
    if (policy.maxAgeDays === 0) return;
    const cutoff = now - (policy.maxAgeDays * DAY_MS);
    for (const entry of entries) {
        if (!entry.protected && entry.timestamp < cutoff) {
            markRemoved(entry, 'age', removed);
        }
    }
}

function applyCountPolicy(entries, policy, removed) {
    const byChat = new Map();
    for (const entry of activeEntries(entries)) {
        if (!byChat.has(entry.chatId)) byChat.set(entry.chatId, []);
        byChat.get(entry.chatId).push(entry);
    }

    for (const chatId of [...byChat.keys()].sort(compareText)) {
        const chatEntries = byChat.get(chatId);
        let excess = Math.max(0, chatEntries.length - policy.maxSnapshotsPerChat);
        if (excess === 0) continue;
        for (const entry of chatEntries) {
            if (entry.protected) continue;
            markRemoved(entry, 'count', removed);
            excess -= 1;
            if (excess === 0) break;
        }
    }
}

function applyBytePolicy(entries, policy, removed) {
    if (policy.maxTotalBytes === 0) return;
    let remainingBytes = sumBytes(activeEntries(entries));
    if (remainingBytes <= policy.maxTotalBytes) return;

    for (const entry of activeEntries(entries)) {
        if (entry.protected) continue;
        markRemoved(entry, 'bytes', removed);
        remainingBytes -= entry.approximateBytes;
        if (remainingBytes <= policy.maxTotalBytes) break;
    }
}

function reasonSummary(removed, reason) {
    const matching = removed.filter((entry) => entry.removedReason === reason);
    return {
        count: matching.length,
        bytes: sumBytes(matching),
    };
}

function countUnmetConstraints(entries, policy, now) {
    const retained = activeEntries(entries);
    const byChat = new Map();
    for (const entry of retained) {
        byChat.set(entry.chatId, (byChat.get(entry.chatId) ?? 0) + 1);
    }
    const count = [...byChat.values()].reduce(
        (total, value) => total
            + Math.max(0, value - policy.maxSnapshotsPerChat),
        0,
    );
    const age = policy.maxAgeDays === 0
        ? 0
        : retained.filter(
            (entry) => entry.timestamp < now - (policy.maxAgeDays * DAY_MS),
        ).length;
    const bytes = policy.maxTotalBytes === 0
        ? 0
        : Math.max(0, sumBytes(retained) - policy.maxTotalBytes);
    return { age, count, bytes };
}

function targetMetadata(entry) {
    return {
        id: entry.id,
        chatId: entry.chatId,
        timestamp: entry.timestamp,
        approximateBytes: entry.approximateBytes,
        reason: entry.removedReason,
    };
}

/**
 * Build a deterministic, non-mutating garbage-collection preview.
 *
 * Only bounded lightweight target metadata is returned. Callers that apply a
 * large plan should re-evaluate under their storage mutation lock and process
 * deterministic batches rather than placing snapshot bodies in the preview.
 */
export function planRetentionGc(values, rawPolicy, options = {}) {
    const policy = normalizeRetentionPolicy(rawPolicy);
    const entries = normalizeEntries(values);
    const now = numericValue(options.now);
    if (policy.maxAgeDays > 0 && !Number.isFinite(now)) {
        throw new TypeError('A finite options.now is required when maxAgeDays is enabled.');
    }

    protectEntries(entries, options);
    const removed = [];
    applyAgePolicy(entries, policy, now, removed);
    applyCountPolicy(entries, policy, removed);
    applyBytePolicy(entries, policy, removed);

    const retained = activeEntries(entries);
    const protectedEntries = entries.filter((entry) => entry.protected);
    const targetMetadataLimit = wholeNumber(
        options.targetMetadataLimit,
        DEFAULT_TARGET_METADATA_LIMIT,
        { maximum: MAX_RETENTION_TARGET_METADATA },
    );
    const targets = removed
        .slice(0, targetMetadataLimit)
        .map(targetMetadata);
    const deleteBytes = sumBytes(removed);
    const retainedBytes = sumBytes(retained);
    const protectedBytes = sumBytes(protectedEntries);
    const affectedChats = new Set(removed.map(({ chatId }) => chatId)).size;
    const overBudget = policy.maxTotalBytes > 0
        && protectedBytes > policy.maxTotalBytes;

    return {
        revision: Number.isFinite(options.revision)
            ? Math.trunc(options.revision)
            : null,
        policy,
        affectedChats,
        deleteCount: removed.length,
        deleteBytes,
        retainedCount: retained.length,
        retainedBytes,
        protectedCount: protectedEntries.length,
        protectedBytes,
        overBudget,
        overBudgetBytes: overBudget
            ? protectedBytes - policy.maxTotalBytes
            : 0,
        reasons: {
            age: reasonSummary(removed, 'age'),
            count: reasonSummary(removed, 'count'),
            bytes: reasonSummary(removed, 'bytes'),
        },
        unmet: countUnmetConstraints(entries, policy, now),
        targets,
        targetsTruncated: targets.length < removed.length,
        omittedTargetCount: Math.max(0, removed.length - targets.length),
    };
}
