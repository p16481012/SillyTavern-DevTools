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

export function compareLoreEntries(baseEntries = [], compareEntries = []) {
    const base = new Map(baseEntries.map((entry) => [loreEntryKey(entry), entry]));
    const compare = new Map(compareEntries.map((entry) => [loreEntryKey(entry), entry]));
    return {
        activated: [...compare].filter(([key]) => !base.has(key)).map(([, entry]) => entry),
        removed: [...base].filter(([key]) => !compare.has(key)).map(([, entry]) => entry),
        retained: [...compare].filter(([key]) => base.has(key)).map(([, entry]) => entry),
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
    for (const source of sources.filter(sourceIsIncludedInRequest)) {
        const base = sourceBaseKey(source);
        const occurrence = counts.get(base) ?? 0;
        counts.set(base, occurrence + 1);
        indexed.set(`${base}#${occurrence}`, source);
    }
    return indexed;
}

export function compareSnapshotSources(baseSnapshot, compareSnapshot) {
    const base = indexSources(baseSnapshot?.sources);
    const compare = indexSources(compareSnapshot?.sources);
    const keys = new Set([...base.keys(), ...compare.keys()]);
    const results = [];

    for (const key of keys) {
        const before = base.get(key) ?? null;
        const after = compare.get(key) ?? null;
        let status = 'unchanged';
        if (!before) status = 'added';
        else if (!after) status = 'removed';
        else if (
            before.content !== after.content
            || before.tokenCount !== after.tokenCount
            || before.attribution !== after.attribution
        ) status = 'changed';

        if (status === 'unchanged') continue;
        results.push({
            key,
            status,
            before,
            after,
            source: after ?? before,
            tokenDelta: (after?.tokenCount ?? 0) - (before?.tokenCount ?? 0),
        });
    }
    return results;
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
