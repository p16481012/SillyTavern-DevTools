function stableValue(value) {
    if (Array.isArray(value)) return value.join(',');
    if (value == null) return '';
    return String(value);
}

export function loreEntryKey(entry) {
    const world = stableValue(entry?.world);
    const uid = stableValue(entry?.uid);
    if (world || uid) return `${world}:${uid}`;
    const key = stableValue(entry?.key);
    if (key) return `key:${key}`;
    return `content:${stableValue(entry?.content)}`;
}

export function loreEntryLabel(entry) {
    return entry?.comment
        || (Array.isArray(entry?.key) ? entry.key.join(', ') : entry?.key)
        || [entry?.world, entry?.uid].filter((value) => value != null).join(' #')
        || '이름 없는 로어북 항목';
}

function equivalentValue(left, right) {
    if (Object.is(left, right)) return true;
    try {
        return JSON.stringify(left) === JSON.stringify(right);
    } catch {
        return false;
    }
}

function loreFieldChanges(before, after, beforeOrder, afterOrder) {
    const fields = [
        ['content', before?.content ?? null, after?.content ?? null],
        ['key', before?.key ?? null, after?.key ?? null],
        ['position', before?.position ?? null, after?.position ?? null],
        ['order', beforeOrder, afterOrder],
    ];
    return fields
        .filter(([, beforeValue, afterValue]) => (
            !equivalentValue(beforeValue, afterValue)
        ))
        .map(([field, beforeValue, afterValue]) => ({
            field,
            before: beforeValue,
            after: afterValue,
        }));
}

export function compareLoreEntries(baseEntries = [], compareEntries = []) {
    const base = new Map(baseEntries.map((entry, order) => [
        loreEntryKey(entry),
        { entry, order },
    ]));
    const compare = new Map(compareEntries.map((entry, order) => [
        loreEntryKey(entry),
        { entry, order },
    ]));
    const retainedKeys = [...compare.keys()].filter((key) => base.has(key));
    const changed = retainedKeys.flatMap((key) => {
        const before = base.get(key);
        const after = compare.get(key);
        const changes = loreFieldChanges(
            before.entry,
            after.entry,
            before.order,
            after.order,
        );
        return changes.length
            ? [{
                key,
                before: before.entry,
                after: after.entry,
                changes,
            }]
            : [];
    });
    return {
        activated: [...compare]
            .filter(([key]) => !base.has(key))
            .map(([, { entry }]) => entry),
        removed: [...base]
            .filter(([key]) => !compare.has(key))
            .map(([, { entry }]) => entry),
        retained: retainedKeys.map((key) => compare.get(key).entry),
        changed,
    };
}

function sourceBaseKey(source) {
    const metadata = source?.metadata ?? {};
    const discriminator = metadata.field
        ?? metadata.key
        ?? metadata.identifier
        ?? (metadata.uid != null ? `${metadata.world ?? ''}:${metadata.uid}` : null)
        ?? source?.labelKey
        ?? source?.label
        ?? source?.id
        ?? 'unknown';
    return `${source?.type ?? 'unknown'}:${stableValue(discriminator)}`;
}

function indexSources(sources = []) {
    const counts = new Map();
    const indexed = new Map();
    for (const source of sources.filter((item) => item?.type !== 'final')) {
        const base = sourceBaseKey(source);
        const occurrence = counts.get(base) ?? 0;
        counts.set(base, occurrence + 1);
        indexed.set(`${base}#${occurrence}`, source);
    }
    return indexed;
}

const SOURCE_METADATA_FIELDS = [
    'role',
    'depth',
    'position',
    'enabled',
    'promptOrder',
];

function firstDefined(...values) {
    return values.find((value) => value !== undefined) ?? null;
}

function sourceMetadataValue(source, field) {
    const metadata = source?.metadata ?? {};
    if (field === 'enabled') {
        return firstDefined(
            source?.configuredEnabled,
            source?.enabled,
            metadata.configuredEnabled,
            metadata.enabled,
        );
    }
    return firstDefined(metadata[field], source?.[field]);
}

function sourceMetadataChanges(before, after) {
    return SOURCE_METADATA_FIELDS.flatMap((field) => {
        const beforeValue = sourceMetadataValue(before, field);
        const afterValue = sourceMetadataValue(after, field);
        return equivalentValue(beforeValue, afterValue)
            ? []
            : [{
                field,
                before: beforeValue,
                after: afterValue,
            }];
    });
}

function sourceComparisonPolicy(source) {
    return source?.comparisonPolicy
        ?? source?.metadata?.comparisonPolicy
        ?? null;
}

function alternativePolicyGroup(policy) {
    if (policy?.mode !== 'alternative') return null;
    const groupInstanceKey = stableValue(policy.groupInstanceKey).trim();
    const groupKey = stableValue(policy.groupKey).trim();
    if (groupInstanceKey) return `instance:${groupInstanceKey}`;
    return groupKey ? `group:${groupKey}` : null;
}

function alternativeReplacementGroup(change) {
    if (!['added', 'removed'].includes(change?.status)) return null;
    const source = change.status === 'added' ? change.after : change.before;
    const policy = sourceComparisonPolicy(source);
    const identity = alternativePolicyGroup(policy);
    if (!identity) return null;
    return {
        identity,
        policy,
    };
}

function normalizedOption(policy) {
    return stableValue(policy?.option).trim().toLocaleLowerCase();
}

function alternativePolicyChange(before, after) {
    const beforePolicy = sourceComparisonPolicy(before);
    const afterPolicy = sourceComparisonPolicy(after);
    if (
        beforePolicy?.mode !== 'alternative'
        && afterPolicy?.mode !== 'alternative'
    ) return null;
    const beforeGroupIdentity = alternativePolicyGroup(beforePolicy);
    const afterGroupIdentity = alternativePolicyGroup(afterPolicy);
    const beforeOption = normalizedOption(beforePolicy);
    const afterOption = normalizedOption(afterPolicy);
    if (
        beforeGroupIdentity === afterGroupIdentity
        && beforeOption === afterOption
    ) return null;
    return {
        beforeGroup: beforePolicy?.group
            ?? beforePolicy?.groupKey
            ?? beforePolicy?.groupInstanceKey
            ?? null,
        afterGroup: afterPolicy?.group
            ?? afterPolicy?.groupKey
            ?? afterPolicy?.groupInstanceKey
            ?? null,
        beforeOption: beforePolicy?.option ?? null,
        afterOption: afterPolicy?.option ?? null,
    };
}

function activeAlternativeGroupCounts(sources = []) {
    const counts = new Map();
    for (const source of sources) {
        if (!sourceIsIncludedInRequest(source)) continue;
        const identity = alternativePolicyGroup(sourceComparisonPolicy(source));
        if (!identity) continue;
        counts.set(identity, (counts.get(identity) ?? 0) + 1);
    }
    return counts;
}

function replacementChange(removed, added, group) {
    const before = removed.before;
    const after = added.after;
    const metadataChanges = sourceMetadataChanges(before, after);
    const changeKinds = ['option'];
    if (before.content !== after.content) changeKinds.push('content');
    if (before.tokenCount !== after.tokenCount) changeKinds.push('tokens');
    if (before.attribution !== after.attribution) changeKinds.push('attribution');
    if (metadataChanges.length) changeKinds.push('metadata');
    const beforePolicy = sourceComparisonPolicy(before);
    const afterPolicy = sourceComparisonPolicy(after);
    return {
        key: `replacement:${group.identity}:${removed.key}->${added.key}`,
        status: 'replaced',
        before,
        after,
        source: after,
        tokenDelta: (after.tokenCount ?? 0) - (before.tokenCount ?? 0),
        changeKinds,
        metadataChanges,
        replacement: {
            mode: 'alternative',
            group: afterPolicy?.group ?? beforePolicy?.group ?? null,
            groupKey: afterPolicy?.groupKey ?? beforePolicy?.groupKey ?? null,
            groupInstanceKey: afterPolicy?.groupInstanceKey
                ?? beforePolicy?.groupInstanceKey
                ?? null,
            beforeOption: beforePolicy?.option ?? null,
            afterOption: afterPolicy?.option ?? null,
        },
    };
}

export function pairAlternativeSourceReplacements(changes = [], {
    baseSources = null,
    compareSources = null,
} = {}) {
    const hasSnapshotContext = Array.isArray(baseSources) && Array.isArray(compareSources);
    const baseGroupCounts = hasSnapshotContext
        ? activeAlternativeGroupCounts(baseSources)
        : null;
    const compareGroupCounts = hasSnapshotContext
        ? activeAlternativeGroupCounts(compareSources)
        : null;
    const groups = new Map();
    for (const [index, change] of changes.entries()) {
        const group = alternativeReplacementGroup(change);
        if (!group) continue;
        const candidates = groups.get(group.identity) ?? {
            ...group,
            added: [],
            removed: [],
        };
        candidates[change.status].push({ change, index });
        groups.set(group.identity, candidates);
    }

    const replacements = new Map();
    const consumed = new Set();
    for (const group of groups.values()) {
        if (group.added.length !== 1 || group.removed.length !== 1) continue;
        const added = group.added[0];
        const removed = group.removed[0];
        const beforeOption = normalizedOption(sourceComparisonPolicy(removed.change.before));
        const afterOption = normalizedOption(sourceComparisonPolicy(added.change.after));
        if (!beforeOption || !afterOption || beforeOption === afterOption) continue;
        if (
            hasSnapshotContext
            && (
                baseGroupCounts.get(group.identity) !== 1
                || compareGroupCounts.get(group.identity) !== 1
            )
        ) continue;
        const insertionIndex = Math.min(added.index, removed.index);
        replacements.set(
            insertionIndex,
            replacementChange(removed.change, added.change, group),
        );
        consumed.add(added.index);
        consumed.add(removed.index);
    }

    return changes.flatMap((change, index) => {
        const replacement = replacements.get(index);
        if (replacement) return [replacement];
        return consumed.has(index) ? [] : [change];
    });
}

export function compareSnapshotSources(baseSnapshot, compareSnapshot) {
    const base = indexSources(baseSnapshot?.sources);
    const compare = indexSources(compareSnapshot?.sources);
    const keys = new Set([...base.keys(), ...compare.keys()]);
    const results = [];

    for (const key of keys) {
        const before = base.get(key) ?? null;
        const after = compare.get(key) ?? null;
        const beforeIncluded = sourceIsIncludedInRequest(before);
        const afterIncluded = sourceIsIncludedInRequest(after);
        const metadataChanges = before && after
            ? sourceMetadataChanges(before, after)
            : [];
        const optionChange = before && after
            ? alternativePolicyChange(before, after)
            : null;
        const changeKinds = [];
        let status = 'unchanged';
        if (!before) {
            if (!afterIncluded) continue;
            status = 'added';
            changeKinds.push('presence');
        } else if (!after) {
            if (!beforeIncluded) continue;
            status = 'removed';
            changeKinds.push('presence');
        } else if (!beforeIncluded && afterIncluded) {
            status = 'added';
            changeKinds.push('presence');
        } else if (beforeIncluded && !afterIncluded) {
            status = 'removed';
            changeKinds.push('presence');
        } else {
            if (beforeIncluded && afterIncluded) {
                if (before.content !== after.content) changeKinds.push('content');
                if (before.tokenCount !== after.tokenCount) changeKinds.push('tokens');
                if (before.attribution !== after.attribution) {
                    changeKinds.push('attribution');
                }
                if (optionChange) changeKinds.push('option');
            }
            if (metadataChanges.length) changeKinds.push('metadata');
            if (changeKinds.length) status = 'changed';
        }
        if (metadataChanges.length && !changeKinds.includes('metadata')) {
            changeKinds.push('metadata');
        }

        if (status === 'unchanged') continue;
        results.push({
            key,
            status,
            before,
            after,
            source: after ?? before,
            tokenDelta: (after?.tokenCount ?? 0) - (before?.tokenCount ?? 0),
            changeKinds,
            metadataChanges,
            ...(changeKinds.includes('option') && optionChange
                ? { optionChange }
                : {}),
        });
    }
    return pairAlternativeSourceReplacements(results, {
        baseSources: baseSnapshot?.sources ?? [],
        compareSources: compareSnapshot?.sources ?? [],
    });
}

export function sourceIsIncludedInRequest(source) {
    if (!source || source.type === 'final') return false;
    return source.included !== false
        && source.enabled !== false
        && source.configuredEnabled !== false
        && source.metadata?.enabled !== false
        && source.metadata?.configuredEnabled !== false;
}

export function largestIncludedSource(sources = []) {
    return sources
        .filter(sourceIsIncludedInRequest)
        .reduce((largest, source) => (
            !largest || (Number(source.tokenCount) || 0) > (Number(largest.tokenCount) || 0)
                ? source
                : largest
        ), null);
}

export function buildTimelineAnalysis(timeline = [], { includeSourceChanges = true } = {}) {
    const ordered = [...timeline].sort((left, right) => left.timestamp - right.timestamp);
    return ordered.map((snapshot, index) => {
        const previous = ordered[index - 1] ?? null;
        return {
            snapshot,
            previous,
            tokenDelta: previous
                ? (snapshot.stats?.totalTokens ?? 0) - (previous.stats?.totalTokens ?? 0)
                : 0,
            lore: compareLoreEntries(
                previous?.lorebookEntries ?? [],
                snapshot.lorebookEntries ?? [],
            ),
            sourceChanges: includeSourceChanges && previous
                ? compareSnapshotSources(previous, snapshot)
                : [],
        };
    });
}

export function buildRangeSegments(text, sources = []) {
    const content = String(text ?? '');
    if (!content) return [];

    const starts = new Map();
    const ends = new Map();
    const boundaries = new Set([0, content.length]);
    const sourceOrder = new Map();
    for (const source of sources.filter((item) => item?.type !== 'final')) {
        if (!sourceOrder.has(source.id)) {
            sourceOrder.set(source.id, sourceOrder.size);
        }
        for (const range of source.ranges ?? []) {
            const start = Math.max(0, Math.min(content.length, Number(range.start) || 0));
            const end = Math.max(start, Math.min(content.length, Number(range.end) || 0));
            if (end <= start) continue;
            starts.set(start, [...(starts.get(start) ?? []), source.id]);
            ends.set(end, [...(ends.get(end) ?? []), source.id]);
            boundaries.add(start);
            boundaries.add(end);
        }
    }

    const positions = [...boundaries].sort((left, right) => left - right);
    const segments = [];
    const active = new Map();
    for (let index = 0; index < positions.length - 1; index += 1) {
        const start = positions[index];
        const end = positions[index + 1];
        for (const sourceId of ends.get(start) ?? []) {
            const count = (active.get(sourceId) ?? 0) - 1;
            if (count > 0) active.set(sourceId, count);
            else active.delete(sourceId);
        }
        for (const sourceId of starts.get(start) ?? []) {
            active.set(sourceId, (active.get(sourceId) ?? 0) + 1);
        }
        if (end <= start) continue;
        segments.push({
            start,
            end,
            text: content.slice(start, end),
            sourceIds: [...active.keys()].sort(
                (left, right) => sourceOrder.get(left) - sourceOrder.get(right),
            ),
        });
    }
    return segments;
}
