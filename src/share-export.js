import {
    canonicalJson,
    collectSensitiveSnapshotSeeds,
    scanSnapshotSeedLeaks,
    SNAPSHOT_PRIVACY_SCHEMA_VERSION,
    SnapshotPrivacyError,
    transformSnapshotPrivacy,
} from './snapshot-privacy.js';

export const SNAPSHOT_SHARE_KIND = 'st-devtools-snapshot-share';
export const SNAPSHOT_SHARE_FORMAT_VERSION = 1;

export const SNAPSHOT_SHARE_LIMITS = Object.freeze({
    snapshots: 1_000,
    outputBytes: 20 * 1024 * 1024,
});

export class SnapshotShareError extends Error {
    constructor(code, message = code) {
        super(message);
        this.name = 'SnapshotShareError';
        this.code = code;
    }
}

function reject(code, message) {
    throw new SnapshotShareError(code, message);
}

function byteLength(value) {
    return new TextEncoder().encode(String(value ?? '')).length;
}

function normalizedTimestamp(value) {
    const timestamp = Number(value);
    if (!Number.isFinite(timestamp) || timestamp < 0) {
        reject('invalid-export-time', 'The share export timestamp is invalid.');
    }
    return timestamp;
}

function stripSharedIdentifiers(snapshot, index) {
    const result = {
        ...snapshot,
        id: `shared-snapshot-${index + 1}`,
        privacy: {
            ...snapshot.privacy,
            rawChatIdIncluded: false,
            rawRequestIdIncluded: false,
        },
    };
    delete result.chatId;
    if (result.capture) {
        result.capture = {
            ...result.capture,
            correlationId: null,
        };
    }
    if (result.request) {
        result.request = {
            ...result.request,
            correlationId: null,
        };
    }
    if (Array.isArray(result.sources)) {
        result.sources = result.sources.map((source, sourceIndex) => ({
            ...source,
            id: `shared-source-${sourceIndex + 1}`,
        }));
    }
    return result;
}

export function snapshotShareIncludedFields(mode) {
    if (!['redacted', 'metadata'].includes(mode)) {
        reject('unsafe-share-mode', 'Sharing full snapshots is not allowed.');
    }
    return {
        provider: true,
        model: true,
        timestamp: true,
        captureLifecycle: true,
        statistics: true,
        promptStructure: mode === 'redacted',
        sourcePlaceholders: mode === 'redacted',
        lorePlaceholders: mode === 'redacted',
        promptDigests: true,
        rawPromptText: false,
        rawPayloadText: false,
        rawRequestBodyText: false,
        rawChatId: false,
        rawRequestId: false,
    };
}

export async function createSnapshotShareDocument({
    snapshots,
    mode = 'metadata',
    exportedAt = Date.now(),
    extensionVersion = null,
    digest = null,
    limits = null,
} = {}) {
    if (!['redacted', 'metadata'].includes(mode)) {
        reject('unsafe-share-mode', 'Sharing full snapshots is not allowed.');
    }
    if (!Array.isArray(snapshots)) {
        reject('invalid-snapshots', 'Share export snapshots must be an array.');
    }
    const maximum = Math.min(
        SNAPSHOT_SHARE_LIMITS.snapshots,
        Number.isFinite(limits?.snapshots)
            ? Math.max(1, Math.trunc(limits.snapshots))
            : SNAPSHOT_SHARE_LIMITS.snapshots,
    );
    if (snapshots.length > maximum) {
        reject('too-many-snapshots', 'Share export contains too many snapshots.');
    }

    const transformed = [];
    const allSeeds = [];
    let scannedSeedCount = 0;
    for (const [index, snapshot] of snapshots.entries()) {
        let seeds;
        let privateSnapshot;
        try {
            seeds = collectSensitiveSnapshotSeeds(snapshot, { limits });
            privateSnapshot = await transformSnapshotPrivacy(snapshot, {
                mode,
                digest,
                limits,
            });
        } catch (error) {
            if (error instanceof SnapshotPrivacyError) {
                reject(error.code, 'A snapshot could not be made safe for sharing.');
            }
            throw error;
        }
        const sharedSnapshot = stripSharedIdentifiers(privateSnapshot, index);
        const scan = scanSnapshotSeedLeaks(sharedSnapshot, seeds, { limits });
        if (!scan.safe) {
            reject(
                'seeded-leak-detected',
                'Share export was blocked because original snapshot data remained.',
            );
        }
        transformed.push(sharedSnapshot);
        allSeeds.push(...seeds.uniqueValues);
        scannedSeedCount += scan.scannedSeedCount;
    }

    const document = {
        kind: SNAPSHOT_SHARE_KIND,
        formatVersion: SNAPSHOT_SHARE_FORMAT_VERSION,
        privacySchemaVersion: SNAPSHOT_PRIVACY_SCHEMA_VERSION,
        exportedAt: normalizedTimestamp(exportedAt),
        extensionVersion: typeof extensionVersion === 'string'
            ? extensionVersion.slice(0, 64)
            : null,
        privacy: {
            mode,
            digestAlgorithm: 'SHA-256',
            promptContentIncluded: false,
            chatIdValuesIncluded: false,
            requestIdValuesIncluded: false,
            seededLeakScan: 'passed',
            scannedSeedCount,
        },
        includedFields: snapshotShareIncludedFields(mode),
        summary: {
            snapshotCount: transformed.length,
            sourceCount: transformed.reduce(
                (total, snapshot) => total
                    + (snapshot.privacySummary?.sourceCount ?? 0),
                0,
            ),
            loreEntryCount: transformed.reduce(
                (total, snapshot) => total
                    + (snapshot.privacySummary?.loreEntryCount ?? 0),
                0,
            ),
        },
        snapshots: transformed,
    };
    const finalScan = scanSnapshotSeedLeaks(document, allSeeds, { limits });
    if (!finalScan.safe) {
        reject(
            'seeded-leak-detected',
            'Share export was blocked because original snapshot data remained.',
        );
    }
    const serialized = canonicalJson(document, {
        limits: {
            ...limits,
            inputBytes: Math.min(
                SNAPSHOT_SHARE_LIMITS.outputBytes,
                Number.isFinite(limits?.outputBytes)
                    ? Math.max(1, Math.trunc(limits.outputBytes))
                    : SNAPSHOT_SHARE_LIMITS.outputBytes,
            ),
        },
    });
    if (byteLength(serialized) > SNAPSHOT_SHARE_LIMITS.outputBytes) {
        reject('share-too-large', 'Share export exceeds the size limit.');
    }
    return document;
}

export async function serializeSnapshotShareDocument(options, { space = 2 } = {}) {
    const document = await createSnapshotShareDocument(options);
    return JSON.stringify(
        document,
        null,
        Number.isInteger(space) ? Math.max(0, Math.min(4, space)) : 2,
    );
}

export function snapshotSharePreview(document) {
    if (
        !document
        || document.kind !== SNAPSHOT_SHARE_KIND
        || document.formatVersion !== SNAPSHOT_SHARE_FORMAT_VERSION
    ) {
        reject('invalid-share-document', 'The share document is invalid.');
    }
    return {
        mode: document.privacy?.mode ?? null,
        snapshotCount: document.summary?.snapshotCount ?? 0,
        sourceCount: document.summary?.sourceCount ?? 0,
        loreEntryCount: document.summary?.loreEntryCount ?? 0,
        seededLeakScan: document.privacy?.seededLeakScan ?? 'unknown',
        includedFields: { ...(document.includedFields ?? {}) },
    };
}
