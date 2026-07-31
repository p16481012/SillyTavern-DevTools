import { validateTimelineDiagnostics } from './diagnostics.js';

const MAX_COUNT_KEYS = 200;
const MAX_SNAPSHOT_CHANGES = 100;
const MAX_COUNT_KEY_LENGTH = 128;
const MAX_LABEL_LENGTH = 256;

const SUMMARY_SCALARS = Object.freeze([
    'snapshotCount',
    'chatCount',
    'fallbackCaptures',
    'correlatedCaptures',
    'redactedFields',
    'omittedMedia',
    'ruleFindings',
    'firstTimestamp',
    'lastTimestamp',
]);

const COUNT_MAPS = Object.freeze([
    'apiCounts',
    'providerCounts',
    'modelCounts',
    'promptTypeCounts',
    'generationTypeCounts',
    'captureStageCounts',
    'correlationMethodCounts',
    'sourceTypeCounts',
    'ruleSeverityCounts',
]);

const SNAPSHOT_FIELDS = Object.freeze([
    ['api'],
    ['provider'],
    ['model'],
    ['promptType'],
    ['generationType'],
    ['schemaVersion'],
    ['extensionVersion'],
    ['capture', 'eventName'],
    ['capture', 'stage'],
    ['capture', 'fallback'],
    ['capture', 'correlationMethod'],
    ['capture', 'hasCorrelationId'],
    ['capture', 'requestStatus'],
    ['capture', 'generationStatus'],
    ['capture', 'statusEvent'],
    ['tokens', 'prompt'],
    ['tokens', 'maxContext'],
    ['tokens', 'maxOutput'],
    ['tokens', 'contextUsage'],
    ['tokens', 'remainingContext'],
    ['rules', 'total'],
]);

function getPath(value, path) {
    let current = value;
    for (const segment of path) {
        if (!current || typeof current !== 'object') return null;
        current = current[segment];
    }
    return current ?? null;
}

function comparableValue(value) {
    if (value == null) return null;
    if (typeof value === 'string') return value.slice(0, MAX_LABEL_LENGTH);
    if (typeof value === 'boolean' || Number.isFinite(value)) return value;
    return null;
}

function numericValue(value) {
    return Number.isFinite(value) ? value : null;
}

function delta(before, after) {
    if (!Number.isFinite(before) || !Number.isFinite(after)) return null;
    return after - before;
}

function scalarChanges(beforeSummary, afterSummary) {
    return SUMMARY_SCALARS.map((field) => {
        const before = numericValue(beforeSummary?.[field]);
        const after = numericValue(afterSummary?.[field]);
        return {
            field,
            before,
            after,
            delta: delta(before, after),
        };
    }).filter(({ before, after }) => before !== after);
}

function countMapChanges(beforeSummary, afterSummary) {
    const result = {};
    const truncation = {};
    for (const field of COUNT_MAPS) {
        const beforeMap = beforeSummary?.[field] ?? {};
        const afterMap = afterSummary?.[field] ?? {};
        const keys = [...new Set([
            ...Object.keys(beforeMap),
            ...Object.keys(afterMap),
        ])];
        let hiddenChanges = 0;
        const changes = [];
        for (const key of keys) {
            const before = Number.isFinite(beforeMap[key]) ? beforeMap[key] : 0;
            const after = Number.isFinite(afterMap[key]) ? afterMap[key] : 0;
            if (before === after) continue;
            if (key.length > MAX_COUNT_KEY_LENGTH) {
                hiddenChanges += 1;
                continue;
            }
            changes.push({ key, before, after, delta: after - before });
        }
        changes.sort((left, right) => (
            left.key < right.key ? -1 : left.key > right.key ? 1 : 0
        ));
        const visibleChanges = changes.slice(0, MAX_COUNT_KEYS);
        if (visibleChanges.length > 0) result[field] = visibleChanges;
        if (changes.length > MAX_COUNT_KEYS || hiddenChanges > 0) {
            truncation[field] = {
                totalChanges: changes.length + hiddenChanges,
                shownChanges: visibleChanges.length,
            };
        }
    }
    return { changes: result, truncation };
}

function tokenChanges(beforeSummary, afterSummary) {
    const before = beforeSummary?.tokens ?? {};
    const after = afterSummary?.tokens ?? {};
    return ['minimum', 'maximum', 'average', 'first', 'last', 'delta']
        .map((field) => ({
            field,
            before: numericValue(before[field]),
            after: numericValue(after[field]),
            delta: delta(before[field], after[field]),
        }))
        .filter((change) => change.before !== change.after);
}

function snapshotIdentity(snapshot, index) {
    const id = typeof snapshot?.id === 'string' && snapshot.id.length <= 256
        ? snapshot.id
        : null;
    const chatRef = typeof snapshot?.chatRef === 'string'
        ? snapshot.chatRef.slice(0, 128)
        : '';
    if (id) return JSON.stringify(['id', chatRef, id]);
    return JSON.stringify([
        'fallback',
        chatRef,
        Number(snapshot?.timestamp) || 0,
        String(snapshot?.api ?? 'unknown').slice(0, 64),
        String(snapshot?.provider ?? 'unknown').slice(0, 64),
        index,
    ]);
}

function snapshotLabel(snapshot) {
    return {
        timestamp: Number(snapshot?.timestamp) || null,
        api: String(snapshot?.api ?? 'unknown').slice(0, 64),
        provider: String(snapshot?.provider ?? 'unknown').slice(0, 128),
        model: snapshot?.model == null
            ? null
            : String(snapshot.model).slice(0, 256),
        captureStage: snapshot?.capture?.stage == null
            ? null
            : String(snapshot.capture.stage).slice(0, 128),
    };
}

function snapshotFieldChanges(before, after) {
    return SNAPSHOT_FIELDS.map((path) => {
        const beforeValue = comparableValue(getPath(before, path));
        const afterValue = comparableValue(getPath(after, path));
        return {
            field: path.join('.'),
            before: beforeValue,
            after: afterValue,
        };
    }).filter(({ before: beforeValue, after: afterValue }) => (
        beforeValue !== afterValue
    ));
}

function snapshotChanges(beforeSnapshots, afterSnapshots) {
    const indexedSnapshots = (snapshots) => {
        const occurrences = new Map();
        return new Map(snapshots.map((snapshot, index) => {
            const identity = snapshotIdentity(snapshot, index);
            const occurrence = occurrences.get(identity) ?? 0;
            occurrences.set(identity, occurrence + 1);
            return [JSON.stringify([identity, occurrence]), snapshot];
        }));
    };
    const beforeById = indexedSnapshots(beforeSnapshots);
    const afterById = indexedSnapshots(afterSnapshots);
    const added = [];
    const removed = [];
    const changed = [];

    for (const [identity, snapshot] of afterById) {
        const previous = beforeById.get(identity);
        if (!previous) {
            added.push(snapshotLabel(snapshot));
            continue;
        }
        const fields = snapshotFieldChanges(previous, snapshot);
        if (fields.length > 0) {
            changed.push({
                snapshot: snapshotLabel(snapshot),
                fields,
            });
        }
    }
    for (const [identity, snapshot] of beforeById) {
        if (!afterById.has(identity)) removed.push(snapshotLabel(snapshot));
    }

    return {
        addedCount: added.length,
        removedCount: removed.length,
        changedCount: changed.length,
        added: added.slice(0, MAX_SNAPSHOT_CHANGES),
        removed: removed.slice(0, MAX_SNAPSHOT_CHANGES),
        changed: changed.slice(0, MAX_SNAPSHOT_CHANGES),
        truncated: (
            added.length > MAX_SNAPSHOT_CHANGES
            || removed.length > MAX_SNAPSHOT_CHANGES
            || changed.length > MAX_SNAPSHOT_CHANGES
        ),
    };
}

export function compareDiagnosticReports(beforeReport, afterReport) {
    const before = validateTimelineDiagnostics(beforeReport);
    const after = validateTimelineDiagnostics(afterReport);
    const warnings = [];
    if (before.scope !== after.scope) warnings.push('scope-mismatch');
    if (before.reportVersion !== after.reportVersion) {
        warnings.push('report-version-mismatch');
    }
    const countMaps = countMapChanges(before.summary, after.summary);

    return {
        comparisonVersion: 1,
        compatible: (
            before.scope === after.scope
            && before.reportVersion === after.reportVersion
        ),
        before: {
            reportVersion: before.reportVersion,
            scope: before.scope,
            generatedAt: before.generatedAt,
        },
        after: {
            reportVersion: after.reportVersion,
            scope: after.scope,
            generatedAt: after.generatedAt,
        },
        warnings,
        summary: {
            scalars: scalarChanges(before.summary, after.summary),
            countMaps: countMaps.changes,
            countMapTruncation: countMaps.truncation,
            tokens: tokenChanges(before.summary, after.summary),
        },
        snapshots: snapshotChanges(
            before.snapshots ?? [],
            after.snapshots ?? [],
        ),
    };
}
