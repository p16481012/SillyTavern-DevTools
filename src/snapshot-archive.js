import {
    assertBoundedJsonValue,
    canonicalJson,
    collectSensitiveSnapshotSeeds,
    scanSnapshotSeedLeaks,
    sha256Hex,
    snapshotDigest,
    SNAPSHOT_PRIVACY_SCHEMA_VERSION,
    SnapshotPrivacyError,
    transformSnapshotPrivacy,
    validateCanonicalSnapshotPrivacy,
} from './snapshot-privacy.js';

export const SNAPSHOT_ARCHIVE_KIND = 'st-devtools-snapshot-archive';
export const SNAPSHOT_ARCHIVE_FORMAT_VERSION = 1;
export const SNAPSHOT_ARCHIVE_SCHEMA_VERSION = 2;
export const SNAPSHOT_IMPORT_PLAN_VERSION = 1;

export const SNAPSHOT_ARCHIVE_LIMITS = Object.freeze({
    inputBytes: 16 * 1024 * 1024,
    depth: 24,
    nodes: 200_000,
    chats: 1_000,
    snapshots: 10_000,
    snapshotBytes: 4 * 1024 * 1024,
    idLength: 256,
    chatIdLength: 512,
});

const ARCHIVE_WARNING = 'contains-private-prompt-data';
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const MODES = new Set(['full', 'redacted', 'metadata']);
const ENVELOPE_MODES = new Set([...MODES, 'mixed']);
const MODE_RANK = Object.freeze({ full: 0, redacted: 1, metadata: 2 });
const STRATEGIES = new Set(['merge', 'replace']);
const CONFLICT_POLICIES = new Set(['keep-both', 'skip']);
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export class SnapshotArchiveError extends Error {
    constructor(code, message = code, details = {}) {
        super(message);
        this.name = 'SnapshotArchiveError';
        this.code = code;
        Object.assign(this, details);
    }
}

function reject(code, message, details) {
    throw new SnapshotArchiveError(code, message, details);
}

function byteLength(value) {
    return new TextEncoder().encode(String(value ?? '')).length;
}

function plainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function requirePlainObject(value, code = 'invalid-object') {
    if (!plainObject(value)) {
        reject(code, 'The snapshot archive contains an invalid object.');
    }
    return value;
}

function knownKeys(value, allowed) {
    for (const key of Object.keys(value)) {
        if (UNSAFE_KEYS.has(key) || !allowed.has(key)) {
            reject('unknown-field', 'The snapshot archive contains an unsupported field.');
        }
    }
}

function boundedString(value, maximum, { nullable = false } = {}) {
    if (value == null && nullable) return null;
    if (typeof value !== 'string' || !value || value.length > maximum) {
        reject('invalid-string', 'The snapshot archive contains an invalid string.');
    }
    if (/[\0-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
        reject('invalid-string', 'The snapshot archive contains a control character.');
    }
    return value;
}

function finiteTimestamp(value) {
    const timestamp = Number(value);
    if (!Number.isFinite(timestamp) || timestamp < 0) {
        reject('invalid-timestamp', 'The snapshot archive timestamp is invalid.');
    }
    return timestamp;
}

function entryKey(chatId, id) {
    return JSON.stringify([chatId, id]);
}

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

function orderedModes(values) {
    return [...new Set(values)].sort(
        (left, right) => ['full', 'redacted', 'metadata'].indexOf(left)
            - ['full', 'redacted', 'metadata'].indexOf(right),
    );
}

function aggregatePrivacy(
    entryModes,
    requestedMode,
    { rawStorageChatIdIncluded = false } = {},
) {
    const modes = orderedModes(entryModes);
    const includesFull = modes.includes('full');
    return {
        mode: modes.length === 1 ? modes[0] : modes.length > 1 ? 'mixed' : requestedMode,
        requestedMode,
        entryModes: modes,
        rawPromptContentIncluded: includesFull,
        rawChatIdIncluded: includesFull || rawStorageChatIdIncluded,
        rawRequestIdIncluded: includesFull,
        warning: includesFull || rawStorageChatIdIncluded ? ARCHIVE_WARNING : null,
    };
}

function privacyLimits(limits = {}) {
    return {
        inputBytes: Math.min(
            SNAPSHOT_ARCHIVE_LIMITS.snapshotBytes,
            Number.isFinite(limits.snapshotBytes)
                ? Math.max(1, Math.trunc(limits.snapshotBytes))
                : SNAPSHOT_ARCHIVE_LIMITS.snapshotBytes,
        ),
        outputBytes: Math.min(
            SNAPSHOT_ARCHIVE_LIMITS.snapshotBytes,
            Number.isFinite(limits.snapshotBytes)
                ? Math.max(1, Math.trunc(limits.snapshotBytes))
                : SNAPSHOT_ARCHIVE_LIMITS.snapshotBytes,
        ),
        depth: Math.min(
            SNAPSHOT_ARCHIVE_LIMITS.depth,
            Number.isFinite(limits.depth)
                ? Math.max(1, Math.trunc(limits.depth))
                : SNAPSHOT_ARCHIVE_LIMITS.depth,
        ),
        nodes: Math.min(
            SNAPSHOT_ARCHIVE_LIMITS.nodes,
            Number.isFinite(limits.nodes)
                ? Math.max(1, Math.trunc(limits.nodes))
                : SNAPSHOT_ARCHIVE_LIMITS.nodes,
        ),
    };
}

function archiveLimits(overrides = {}) {
    return Object.fromEntries(Object.entries(SNAPSHOT_ARCHIVE_LIMITS).map(
        ([key, fallback]) => {
            const candidate = Number(overrides?.[key]);
            return [
                key,
                Number.isFinite(candidate) && candidate > 0
                    ? Math.min(fallback, Math.trunc(candidate))
                    : fallback,
            ];
        },
    ));
}

function flattenTimelines(timelines, limits) {
    if (!Array.isArray(timelines)) {
        reject('invalid-timelines', 'Snapshot timelines must be an array.');
    }
    if (timelines.length > limits.chats) {
        reject('too-many-chats', 'Snapshot archive contains too many chats.');
    }
    const flattened = [];
    for (const container of timelines) {
        requirePlainObject(container, 'invalid-timeline');
        const chatId = boundedString(
            container.chatId ?? '__global__',
            limits.chatIdLength,
        );
        if (!Array.isArray(container.timeline)) {
            reject('invalid-timeline', 'A snapshot timeline is invalid.');
        }
        for (const snapshot of container.timeline) {
            if (!plainObject(snapshot)) {
                reject('invalid-snapshot', 'A snapshot is invalid.');
            }
            flattened.push({
                storageChatId: chatId,
                snapshot,
            });
            if (flattened.length > limits.snapshots) {
                reject('too-many-snapshots', 'Snapshot archive contains too many snapshots.');
            }
        }
    }
    return flattened;
}

function flattenArchiveInput({ timelines, snapshots }, limits) {
    if (snapshots != null) {
        if (!Array.isArray(snapshots)) {
            reject('invalid-snapshots', 'Snapshot archive snapshots must be an array.');
        }
        if (snapshots.length > limits.snapshots) {
            reject('too-many-snapshots', 'Snapshot archive contains too many snapshots.');
        }
        const flattened = snapshots.map((snapshot) => {
            if (!plainObject(snapshot)) {
                reject('invalid-snapshot', 'A snapshot is invalid.');
            }
            return {
                storageChatId: boundedString(
                    snapshot.storageChatId ?? snapshot.chatId ?? '__global__',
                    limits.chatIdLength,
                ),
                snapshot,
            };
        });
        if (
            new Set(flattened.map(({ storageChatId }) => storageChatId)).size
            > limits.chats
        ) {
            reject('too-many-chats', 'Snapshot archive contains too many chats.');
        }
        return flattened;
    }
    return flattenTimelines(timelines ?? [], limits);
}

async function expectedPrivateChatId(storageChatId, options) {
    const digest = await sha256Hex(`chat\0${storageChatId}`, options);
    return `chat-${digest.slice(0, 24)}`;
}

async function validateStorageChatId(
    snapshot,
    storageChatId,
    {
        requestedMode,
        limits,
        digest,
    },
) {
    if (storageChatId == null) return null;
    const normalized = boundedString(storageChatId, limits.chatIdLength);
    if (requestedMode !== 'full') {
        reject(
            'unsafe-storage-partition',
            'Raw local chat partitions are allowed only in a full backup.',
        );
    }
    if (normalized === (snapshot.chatId ?? '__global__')) {
        reject(
            'redundant-storage-partition',
            'A snapshot archive contains a redundant storage partition.',
        );
    }
    if (!['redacted', 'metadata'].includes(snapshot.privacy?.mode)) {
        reject(
            'invalid-storage-partition',
            'Only privacy-protected snapshots may use a separate storage partition.',
        );
    }
    if (
        snapshot.chatId
        !== await expectedPrivateChatId(normalized, { digest })
    ) {
        reject(
            'storage-partition-mismatch',
            'A private snapshot does not belong to its declared local chat partition.',
        );
    }
    return normalized;
}

async function archiveEntryDigest(snapshot, storageChatId, options) {
    if (storageChatId == null) {
        return snapshotDigest(snapshot, {
            digest: options.digest,
            limits: privacyLimits(options.limits),
        });
    }
    return sha256Hex(canonicalJson(
        {
            snapshot,
            storageChatId,
        },
        { limits: privacyLimits(options.limits) },
    ), options);
}

async function validateArchiveEntry(
    rawEntry,
    {
        legacyMode,
        archiveSchemaVersion,
        index,
    },
    options,
) {
    const entry = requirePlainObject(rawEntry, 'invalid-entry');
    knownKeys(entry, new Set([
        'chatId',
        'id',
        'digest',
        'privacyMode',
        'storageChatId',
        'snapshot',
    ]));
    const privacyMode = entry.privacyMode ?? (
        archiveSchemaVersion === 1 ? legacyMode : null
    );
    if (!MODES.has(privacyMode)) {
        reject('invalid-entry-privacy', 'A snapshot entry privacy mode is invalid.');
    }
    if (archiveSchemaVersion >= 2 && entry.privacyMode !== privacyMode) {
        reject('missing-entry-privacy', 'A snapshot entry privacy mode is required.');
    }
    const chatId = boundedString(entry.chatId, options.limits.chatIdLength);
    const id = boundedString(entry.id, options.limits.idLength);
    if (!DIGEST_PATTERN.test(String(entry.digest ?? ''))) {
        reject('invalid-entry-digest', 'A snapshot archive digest is invalid.');
    }
    const snapshot = requirePlainObject(entry.snapshot, 'invalid-snapshot');
    assertBoundedJsonValue(snapshot, {
        limits: privacyLimits(options.limits),
    });
    if (
        snapshot.id !== id
        || (snapshot.chatId ?? '__global__') !== chatId
        || !Number.isInteger(Number(snapshot.schemaVersion))
        || Number(snapshot.schemaVersion) < 1
        || !Number.isFinite(Number(snapshot.timestamp))
    ) {
        reject('invalid-snapshot-identity', 'A snapshot archive identity is invalid.');
    }
    if (
        snapshot.privacy?.schemaVersion !== SNAPSHOT_PRIVACY_SCHEMA_VERSION
        || snapshot.privacy?.mode !== privacyMode
    ) {
        reject('privacy-mode-mismatch', 'Snapshot privacy metadata is inconsistent.');
    }
    try {
        validateCanonicalSnapshotPrivacy(snapshot, privacyMode, {
            limits: privacyLimits(options.limits),
        });
    } catch (error) {
        if (error instanceof SnapshotPrivacyError) {
            reject(
                'invalid-private-snapshot',
                'A privacy-protected snapshot is not in canonical safe form.',
            );
        }
        throw error;
    }
    const storageChatId = await validateStorageChatId(
        snapshot,
        Object.prototype.hasOwnProperty.call(entry, 'storageChatId')
            ? entry.storageChatId
            : null,
        {
            requestedMode: options.requestedMode,
            limits: options.limits,
            digest: options.digest,
        },
    );
    const computedDigest = await archiveEntryDigest(snapshot, storageChatId, {
        digest: options.digest,
        limits: options.limits,
    });
    if (computedDigest !== entry.digest) {
        reject('digest-mismatch', 'A snapshot archive digest does not match its data.');
    }
    return {
        index,
        chatId,
        id,
        digest: computedDigest,
        privacyMode,
        ...(storageChatId == null ? {} : { storageChatId }),
        snapshot: cloneJson(snapshot),
    };
}

async function normalizeArchiveDocument(document, options) {
    const envelope = requirePlainObject(document, 'invalid-archive');
    assertBoundedJsonValue(envelope, {
        limits: {
            inputBytes: options.limits.inputBytes,
            depth: options.limits.depth,
            nodes: options.limits.nodes,
        },
    });
    knownKeys(envelope, new Set([
        'kind',
        'formatVersion',
        'schemaVersion',
        'exportedAt',
        'extensionVersion',
        'digestAlgorithm',
        'privacy',
        'summary',
        'entries',
    ]));
    if (envelope.kind !== SNAPSHOT_ARCHIVE_KIND) {
        reject('invalid-kind', 'This is not an ST DevTools snapshot archive.');
    }
    if (envelope.formatVersion !== SNAPSHOT_ARCHIVE_FORMAT_VERSION) {
        reject('unsupported-format-version', 'Snapshot archive format is unsupported.');
    }
    if (![1, SNAPSHOT_ARCHIVE_SCHEMA_VERSION].includes(envelope.schemaVersion)) {
        reject('unsupported-schema-version', 'Snapshot archive schema is unsupported.');
    }
    const archiveSchemaVersion = envelope.schemaVersion;
    if (envelope.digestAlgorithm !== 'SHA-256') {
        reject('unsupported-digest', 'Snapshot archive digest algorithm is unsupported.');
    }
    const privacy = requirePlainObject(envelope.privacy, 'invalid-privacy');
    knownKeys(privacy, new Set([
        'mode',
        'requestedMode',
        'entryModes',
        'rawPromptContentIncluded',
        'rawChatIdIncluded',
        'rawRequestIdIncluded',
        'warning',
    ]));
    if (
        !(archiveSchemaVersion === 1 ? MODES : ENVELOPE_MODES).has(privacy.mode)
    ) {
        reject('invalid-privacy-mode', 'Snapshot archive privacy mode is unsupported.');
    }
    const requestedMode = archiveSchemaVersion === 1
        ? privacy.mode
        : privacy.requestedMode;
    if (!MODES.has(requestedMode)) {
        reject('invalid-requested-privacy', 'Requested archive privacy mode is invalid.');
    }
    if (
        archiveSchemaVersion >= 2
        && (
            !Array.isArray(privacy.entryModes)
            || privacy.entryModes.some((mode) => !MODES.has(mode))
            || JSON.stringify(privacy.entryModes)
                !== JSON.stringify(orderedModes(privacy.entryModes))
        )
    ) {
        reject('invalid-entry-privacy-summary', 'Archive entry privacy modes are invalid.');
    }
    const summary = requirePlainObject(envelope.summary, 'invalid-summary');
    knownKeys(summary, new Set([
        'snapshotCount',
        'chatCount',
        'privacyModeCounts',
    ]));
    if (
        !Number.isInteger(summary.snapshotCount)
        || summary.snapshotCount < 0
        || summary.snapshotCount > options.limits.snapshots
        || !Number.isInteger(summary.chatCount)
        || summary.chatCount < 0
        || summary.chatCount > options.limits.chats
    ) {
        reject('invalid-summary', 'Snapshot archive summary is invalid.');
    }
    if (!Array.isArray(envelope.entries)) {
        reject('invalid-entries', 'Snapshot archive entries must be an array.');
    }
    if (
        envelope.entries.length !== summary.snapshotCount
        || envelope.entries.length > options.limits.snapshots
    ) {
        reject('snapshot-count-mismatch', 'Snapshot archive count does not match its entries.');
    }

    const entries = [];
    const identities = new Set();
    for (const [index, rawEntry] of envelope.entries.entries()) {
        const entry = await validateArchiveEntry(
            rawEntry,
            {
                legacyMode: privacy.mode,
                archiveSchemaVersion,
                index,
            },
            {
                ...options,
                requestedMode,
            },
        );
        const identity = entryKey(entry.chatId, entry.id);
        if (identities.has(identity)) {
            reject('duplicate-snapshot-id', 'Snapshot archive contains a duplicate identity.');
        }
        identities.add(identity);
        entries.push(entry);
    }
    const actualChatCount = new Set(entries.map(({ chatId }) => chatId)).size;
    if (actualChatCount !== summary.chatCount) {
        reject('chat-count-mismatch', 'Snapshot archive chat count is inconsistent.');
    }
    const actualPrivacy = aggregatePrivacy(
        entries.map(({ privacyMode }) => privacyMode),
        requestedMode,
        {
            rawStorageChatIdIncluded: entries.some(
                ({ storageChatId }) => storageChatId != null,
            ),
        },
    );
    const expectedPrivacy = archiveSchemaVersion === 1
        ? {
            mode: privacy.mode,
            requestedMode,
            entryModes: orderedModes(entries.map(() => privacy.mode)),
            rawPromptContentIncluded: privacy.mode === 'full',
            rawChatIdIncluded: privacy.mode === 'full',
            rawRequestIdIncluded: privacy.mode === 'full',
            warning: privacy.mode === 'full' ? ARCHIVE_WARNING : null,
        }
        : actualPrivacy;
    for (const key of [
        'mode',
        'rawPromptContentIncluded',
        'rawChatIdIncluded',
        'rawRequestIdIncluded',
        'warning',
    ]) {
        if (privacy[key] !== expectedPrivacy[key]) {
            reject(
                'invalid-privacy-metadata',
                'Snapshot archive privacy metadata is invalid.',
            );
        }
    }
    if (
        archiveSchemaVersion >= 2
        && (
            privacy.requestedMode !== actualPrivacy.requestedMode
            || JSON.stringify(privacy.entryModes)
                !== JSON.stringify(actualPrivacy.entryModes)
        )
    ) {
        reject('invalid-privacy-metadata', 'Snapshot archive privacy metadata is invalid.');
    }
    const privacyModeCounts = Object.fromEntries(
        [...MODES].map((mode) => [
            mode,
            entries.filter((entry) => entry.privacyMode === mode).length,
        ]),
    );
    if (
        archiveSchemaVersion >= 2
        && (
            !plainObject(summary.privacyModeCounts)
            || Object.keys(summary.privacyModeCounts).some((key) => !MODES.has(key))
            || [...MODES].some(
                (mode) => summary.privacyModeCounts[mode] !== privacyModeCounts[mode],
            )
        )
    ) {
        reject('invalid-summary', 'Snapshot archive privacy counts are invalid.');
    }
    const normalized = {
        kind: SNAPSHOT_ARCHIVE_KIND,
        formatVersion: SNAPSHOT_ARCHIVE_FORMAT_VERSION,
        schemaVersion: SNAPSHOT_ARCHIVE_SCHEMA_VERSION,
        exportedAt: finiteTimestamp(envelope.exportedAt),
        extensionVersion: envelope.extensionVersion == null
            ? null
            : boundedString(envelope.extensionVersion, 64),
        digestAlgorithm: 'SHA-256',
        privacy: actualPrivacy,
        summary: {
            snapshotCount: entries.length,
            chatCount: actualChatCount,
            privacyModeCounts,
        },
        entries: entries.map(({ index: _index, ...entry }) => entry),
    };
    const serialized = JSON.stringify(normalized);
    if (byteLength(serialized) > options.limits.inputBytes) {
        reject('archive-too-large', 'Snapshot archive exceeds the size limit.');
    }
    return normalized;
}

export async function parseSnapshotArchive(
    input,
    {
        digest = null,
        limits = null,
    } = {},
) {
    const normalized = archiveLimits(limits);
    let document = input;
    if (typeof input === 'string') {
        if (byteLength(input) > normalized.inputBytes) {
            reject('archive-too-large', 'Snapshot archive exceeds the size limit.');
        }
        try {
            document = JSON.parse(input);
        } catch {
            reject('invalid-json', 'Snapshot archive is not valid JSON.');
        }
    }
    try {
        return await normalizeArchiveDocument(document, {
            digest,
            limits: normalized,
        });
    } catch (error) {
        if (error instanceof SnapshotPrivacyError) {
            reject(error.code, 'Snapshot archive failed a bounded-data validation.');
        }
        throw error;
    }
}

export async function createSnapshotArchive({
    timelines = null,
    snapshots = null,
    mode = 'full',
    exportedAt = Date.now(),
    extensionVersion = null,
    digest = null,
    limits = null,
} = {}) {
    if (!MODES.has(mode)) {
        reject('invalid-privacy-mode', 'Snapshot archive privacy mode is unsupported.');
    }
    const normalized = archiveLimits(limits);
    const rawEntries = flattenArchiveInput({ timelines, snapshots }, normalized);
    const entries = [];
    const identities = new Set();

    for (const { storageChatId, snapshot } of rawEntries) {
        const sourceSnapshot = snapshot.chatId == null
            ? { ...snapshot, chatId: storageChatId }
            : snapshot;
        const existingMode = MODES.has(snapshot?.privacy?.mode)
            ? snapshot.privacy.mode
            : null;
        const entryMode = existingMode && MODE_RANK[existingMode] > MODE_RANK[mode]
            ? existingMode
            : mode;
        const seeds = entryMode === 'full'
            ? null
            : collectSensitiveSnapshotSeeds(sourceSnapshot, {
                limits: privacyLimits(normalized),
            });
        const transformed = await transformSnapshotPrivacy(
            sourceSnapshot,
            {
                mode: entryMode,
                digest,
                limits: privacyLimits(normalized),
            },
        );
        validateCanonicalSnapshotPrivacy(transformed, entryMode, {
            limits: privacyLimits(normalized),
        });
        if (entryMode !== 'full') {
            const leakScan = scanSnapshotSeedLeaks(transformed, seeds, {
                limits: privacyLimits(normalized),
            });
            if (!leakScan.safe) {
                reject(
                    'seeded-leak-detected',
                    'Snapshot archive was blocked because original data remained.',
                );
            }
        }
        const transformedChatId = boundedString(
            transformed.chatId ?? '__global__',
            normalized.chatIdLength,
        );
        const transformedId = boundedString(
            transformed.id,
            normalized.idLength,
        );
        const archivedStorageChatId = mode === 'full'
            && storageChatId !== transformedChatId
            ? await validateStorageChatId(
                transformed,
                storageChatId,
                {
                    requestedMode: mode,
                    limits: normalized,
                    digest,
                },
            )
            : null;
        const identity = entryKey(transformedChatId, transformedId);
        if (identities.has(identity)) {
            reject('duplicate-snapshot-id', 'Snapshot archive contains a duplicate identity.');
        }
        identities.add(identity);
        const entry = {
            chatId: transformedChatId,
            id: transformedId,
            privacyMode: entryMode,
            ...(archivedStorageChatId == null
                ? {}
                : { storageChatId: archivedStorageChatId }),
            digest: await archiveEntryDigest(transformed, archivedStorageChatId, {
                digest,
                limits: normalized,
            }),
            snapshot: transformed,
        };
        entries.push(entry);
    }
    entries.sort(
        (left, right) => left.chatId.localeCompare(right.chatId)
            || (Number(left.snapshot.timestamp) || 0)
                - (Number(right.snapshot.timestamp) || 0)
            || left.id.localeCompare(right.id),
    );
    const privacy = aggregatePrivacy(
        entries.map(({ privacyMode }) => privacyMode),
        mode,
        {
            rawStorageChatIdIncluded: entries.some(
                ({ storageChatId }) => storageChatId != null,
            ),
        },
    );
    const privacyModeCounts = Object.fromEntries(
        [...MODES].map((entryMode) => [
            entryMode,
            entries.filter((entry) => entry.privacyMode === entryMode).length,
        ]),
    );
    const document = {
        kind: SNAPSHOT_ARCHIVE_KIND,
        formatVersion: SNAPSHOT_ARCHIVE_FORMAT_VERSION,
        schemaVersion: SNAPSHOT_ARCHIVE_SCHEMA_VERSION,
        exportedAt: finiteTimestamp(exportedAt),
        extensionVersion: extensionVersion == null
            ? null
            : boundedString(extensionVersion, 64),
        digestAlgorithm: 'SHA-256',
        privacy,
        summary: {
            snapshotCount: entries.length,
            chatCount: new Set(entries.map(({ chatId }) => chatId)).size,
            privacyModeCounts,
        },
        entries,
    };
    return normalizeArchiveDocument(document, {
        digest,
        limits: normalized,
    });
}

export async function serializeSnapshotArchive(options, { space = 2 } = {}) {
    const document = await createSnapshotArchive(options);
    return JSON.stringify(
        document,
        null,
        Number.isInteger(space) ? Math.max(0, Math.min(4, space)) : 2,
    );
}

async function replacementTokenFromDocument(document, options) {
    const digest = await sha256Hex(canonicalJson(
        document.entries.map(({
            chatId,
            id,
            privacyMode,
            storageChatId = null,
            digest: entryDigest,
        }) => ({
            chatId,
            id,
            privacyMode,
            storageChatId,
            digest: entryDigest,
        })),
        { limits: privacyLimits(options.limits) },
    ), options);
    return `REPLACE-${digest.slice(0, 16).toUpperCase()}`;
}

export async function snapshotArchiveReplaceConfirmationToken(input, options = {}) {
    const limits = archiveLimits(options.limits);
    const document = await parseSnapshotArchive(input, {
        digest: options.digest,
        limits,
    });
    return replacementTokenFromDocument(document, {
        digest: options.digest,
        limits,
    });
}

async function rawState(timelines, options) {
    const flattened = flattenTimelines(timelines ?? [], options.limits);
    const entries = [];
    for (const { storageChatId, snapshot } of flattened) {
        const normalizedSnapshot = snapshot.chatId == null
            ? { ...snapshot, chatId: storageChatId }
            : snapshot;
        entries.push({
            chatId: storageChatId,
            id: boundedString(normalizedSnapshot.id, options.limits.idLength),
            digest: await snapshotDigest(normalizedSnapshot, {
                digest: options.digest,
                limits: privacyLimits(options.limits),
            }),
            snapshot: cloneJson(normalizedSnapshot),
        });
    }
    entries.sort(
        (left, right) => left.chatId.localeCompare(right.chatId)
            || left.id.localeCompare(right.id),
    );
    const digest = await sha256Hex(canonicalJson(
        entries.map(({ chatId, id, digest: entryDigest }) => ({
            chatId,
            id,
            digest: entryDigest,
        })),
        { limits: privacyLimits(options.limits) },
    ), options);
    return { entries, digest };
}

async function comparisonState(raw, mode, options) {
    const entries = [];
    for (const entry of raw.entries) {
        let transformed;
        try {
            transformed = await transformSnapshotPrivacy(entry.snapshot, {
                mode,
                digest: options.digest,
                limits: privacyLimits(options.limits),
            });
        } catch (error) {
            if (
                error instanceof SnapshotPrivacyError
                && error.code === 'privacy-mode-upgrade'
            ) {
                continue;
            }
            throw error;
        }
        entries.push({
            key: entryKey(entry.chatId, transformed.id),
            digest: await snapshotDigest(transformed, {
                digest: options.digest,
                limits: privacyLimits(options.limits),
            }),
            partitionDigest: await archiveEntryDigest(
                transformed,
                entry.chatId === (transformed.chatId ?? '__global__')
                    ? null
                    : entry.chatId,
                options,
            ),
        });
    }
    return new Map(entries.map((entry) => [entry.key, entry]));
}

function conflictId(id, digest, occupied, chatId, maximum) {
    const suffix = `~import-${digest.slice(0, 12)}`;
    const base = id.slice(0, Math.max(1, maximum - suffix.length));
    let candidate = `${base}${suffix}`;
    let sequence = 2;
    while (occupied.has(entryKey(chatId, candidate))) {
        const numberedSuffix = `${suffix}-${sequence}`;
        candidate = `${id.slice(0, Math.max(1, maximum - numberedSuffix.length))}${
            numberedSuffix
        }`;
        sequence += 1;
    }
    return candidate;
}

export async function prepareSnapshotArchiveImport(
    input,
    currentTimelines = [],
    {
        strategy = 'merge',
        conflictPolicy = 'keep-both',
        confirmationToken = null,
        digest = null,
        limits = null,
    } = {},
) {
    if (!STRATEGIES.has(strategy)) {
        reject('invalid-import-strategy', 'Snapshot import strategy is unsupported.');
    }
    if (!CONFLICT_POLICIES.has(conflictPolicy)) {
        reject('invalid-conflict-policy', 'Snapshot conflict policy is unsupported.');
    }
    const normalized = archiveLimits(limits);
    const options = { digest, limits: normalized };
    const document = await parseSnapshotArchive(input, options);
    if (strategy === 'replace') {
        const expectedToken = await replacementTokenFromDocument(document, options);
        if (confirmationToken !== expectedToken) {
            reject(
                'replace-confirmation-required',
                'Replacing all snapshots requires the archive-specific confirmation token.',
                { confirmationTokenRequired: true },
            );
        }
    }

    const base = await rawState(currentTimelines, options);
    const comparisons = new Map();
    for (const mode of orderedModes(
        document.entries.map(({ privacyMode }) => privacyMode),
    )) {
        comparisons.set(mode, await comparisonState(base, mode, options));
    }
    const physicalOccupied = new Set(
        base.entries.map(({ chatId, id }) => entryKey(chatId, id)),
    );
    const stagedSnapshots = [];
    const stagedStorageChatIds = [];
    const skipped = [];
    let duplicateCount = 0;
    let conflictCount = 0;

    for (const entry of document.entries) {
        const storageChatId = entry.storageChatId ?? entry.chatId;
        if (strategy === 'replace') {
            stagedSnapshots.push(cloneJson(entry.snapshot));
            stagedStorageChatIds.push(entry.storageChatId ?? null);
            continue;
        }
        const comparisonEntry = comparisons
            .get(entry.privacyMode)
            ?.get(entryKey(storageChatId, entry.id));
        const comparisonDigest = entry.storageChatId == null
            ? comparisonEntry?.digest
            : comparisonEntry?.partitionDigest;
        if (comparisonDigest === entry.digest) {
            duplicateCount += 1;
            skipped.push({ entryIndex: stagedSnapshots.length + skipped.length, reason: 'same-digest' });
            continue;
        }
        let snapshot = cloneJson(entry.snapshot);
        const physicalKey = entryKey(storageChatId, entry.id);
        if (comparisonEntry || physicalOccupied.has(physicalKey)) {
            conflictCount += 1;
            if (conflictPolicy === 'skip') {
                skipped.push({
                    entryIndex: stagedSnapshots.length + skipped.length,
                    reason: 'id-conflict',
                });
                continue;
            }
            snapshot.id = conflictId(
                snapshot.id,
                entry.digest,
                physicalOccupied,
                storageChatId,
                normalized.idLength,
            );
        }
        physicalOccupied.add(entryKey(storageChatId, snapshot.id));
        stagedSnapshots.push(snapshot);
        stagedStorageChatIds.push(entry.storageChatId ?? null);
    }

    const stagedEntries = stagedSnapshots.map((snapshot, index) => ({
        snapshot,
        storageChatId:
            stagedStorageChatIds[index]
            ?? snapshot.chatId
            ?? '__global__',
    }));
    const projected = strategy === 'replace'
        ? stagedEntries
        : [
            ...base.entries.map(({ chatId, snapshot }) => ({
                snapshot,
                storageChatId: chatId,
            })),
            ...stagedEntries,
        ];
    const projectedTimelines = new Map();
    for (const { snapshot, storageChatId } of projected) {
        if (!projectedTimelines.has(storageChatId)) {
            projectedTimelines.set(storageChatId, []);
        }
        const timeline = projectedTimelines.get(storageChatId);
        const existingIndex = timeline.findIndex(({ id }) => id === snapshot.id);
        if (existingIndex >= 0) timeline.splice(existingIndex, 1);
        timeline.push(snapshot);
    }
    const expected = await rawState(
        [...projectedTimelines].map(([chatId, timeline]) => ({ chatId, timeline })),
        options,
    );

    return {
        kind: 'st-devtools-snapshot-import-plan',
        version: SNAPSHOT_IMPORT_PLAN_VERSION,
        strategy,
        conflictPolicy,
        archiveMode: document.privacy.mode,
        archiveEntryModes: [...document.privacy.entryModes],
        baseStateDigest: base.digest,
        expectedStateDigest: expected.digest,
        stagedSnapshots,
        stagedStorageChatIds,
        skipped,
        summary: {
            archiveSnapshotCount: document.entries.length,
            currentSnapshotCount: base.entries.length,
            addCount: stagedSnapshots.length,
            skipCount: skipped.length,
            duplicateCount,
            conflictCount,
            projectedSnapshotCount: expected.entries.length,
        },
        recovery: {
            baseSnapshotCount: base.entries.length,
            requiresReadBackVerification: true,
            exclusiveStoreAccessRequired: true,
            mergeRollback: 'exclusive-transaction-raw-key-rollback',
            replaceRollback: 'exclusive-transaction-raw-key-rollback',
        },
    };
}

export async function executeSnapshotArchiveImport(
    store,
    plan,
    {
        digest = null,
        limits = null,
    } = {},
) {
    if (
        !plainObject(plan)
        || plan.kind !== 'st-devtools-snapshot-import-plan'
        || plan.version !== SNAPSHOT_IMPORT_PLAN_VERSION
        || !STRATEGIES.has(plan.strategy)
        || !Array.isArray(plan.stagedSnapshots)
        || !Array.isArray(plan.stagedStorageChatIds)
        || plan.stagedStorageChatIds.length !== plan.stagedSnapshots.length
        || plan.stagedStorageChatIds.some(
            (chatId) => chatId != null && typeof chatId !== 'string',
        )
        || !DIGEST_PATTERN.test(String(plan.baseStateDigest ?? ''))
        || !DIGEST_PATTERN.test(String(plan.expectedStateDigest ?? ''))
    ) {
        reject('invalid-import-plan', 'Snapshot import plan is invalid.');
    }
    if (
        !store
        || typeof store.runExclusiveImport !== 'function'
    ) {
        reject(
            'exclusive-import-required',
            'Snapshot store must provide an exclusive transactional import boundary.',
        );
    }
    const normalized = archiveLimits(limits);
    const options = { digest, limits: normalized };
    for (const [index, storageChatId] of plan.stagedStorageChatIds.entries()) {
        if (storageChatId == null) continue;
        await validateStorageChatId(
            plan.stagedSnapshots[index],
            storageChatId,
            {
                requestedMode: 'full',
                limits: normalized,
                digest,
            },
        );
    }
    let appliedCount = 0;
    let baseSnapshotCount = Number(plan.summary?.currentSnapshotCount) || 0;
    try {
        return await store.runExclusiveImport(async (facade) => {
            if (
                !facade
                || typeof facade.getAllStoredTimelines !== 'function'
                || typeof facade.addSnapshot !== 'function'
                || (
                    plan.strategy === 'replace'
                    && typeof facade.clearAll !== 'function'
                )
            ) {
                throw new SnapshotArchiveError(
                    'unsupported-import-facade',
                    'Exclusive import facade is incomplete.',
                );
            }
            const base = await rawState(
                await facade.getAllStoredTimelines(),
                options,
            );
            baseSnapshotCount = base.entries.length;
            if (base.digest !== plan.baseStateDigest) {
                return {
                    ok: false,
                    code: 'stale-import-plan',
                    appliedCount: 0,
                    verified: false,
                    recovery: {
                        status: 'not-needed',
                        restored: false,
                        rawKeysRestored: false,
                        replayedHealthySnapshots: false,
                        baseSnapshotCount,
                    },
                };
            }

            if (plan.strategy === 'replace') await facade.clearAll();
            for (const [index, snapshot] of plan.stagedSnapshots.entries()) {
                const storageChatId = plan.stagedStorageChatIds[index];
                await facade.addSnapshot(
                    cloneJson(snapshot),
                    {
                        skipRetention: true,
                        ...(storageChatId == null
                            ? {}
                            : { partitionChatId: storageChatId }),
                    },
                );
                appliedCount += 1;
            }
            const readBack = await rawState(
                await facade.getAllStoredTimelines(),
                options,
            );
            if (readBack.digest !== plan.expectedStateDigest) {
                throw new SnapshotArchiveError(
                    'read-back-mismatch',
                    'Snapshot import read-back verification failed.',
                );
            }
            return {
                ok: true,
                code: 'import-complete',
                appliedCount,
                verified: true,
                summary: { ...plan.summary },
                recovery: {
                    status: 'not-needed',
                    restored: false,
                    rawKeysRestored: false,
                    replayedHealthySnapshots: false,
                    baseSnapshotCount,
                },
            };
        });
    } catch (error) {
        const failureCode = error instanceof SnapshotArchiveError
            ? error.code
            : error?.code === 'import-rollback-failed'
                ? 'import-rollback-failed'
                : 'store-write-failed';
        const rollbackFailed = failureCode === 'import-rollback-failed';
        return {
            ok: false,
            code: failureCode,
            appliedCount,
            verified: false,
            summary: { ...plan.summary },
            recovery: {
                status: rollbackFailed
                    ? 'rollback-failed'
                    : 'transaction-rolled-back',
                restored: !rollbackFailed,
                rawKeysRestored: !rollbackFailed,
                replayedHealthySnapshots: false,
                baseSnapshotCount,
                steps: rollbackFailed
                    ? [
                        'exclusive-transaction-aborted',
                        'raw-store-state-restore-failed',
                    ]
                    : [
                        'exclusive-transaction-aborted',
                        'raw-store-state-restored',
                    ],
            },
        };
    }
}
