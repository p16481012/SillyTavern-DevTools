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
    for (const source of sources.filter((item) => item?.type !== 'final')) {
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

export function buildTimelineAnalysis(timeline = []) {
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
            sourceChanges: previous
                ? compareSnapshotSources(previous, snapshot)
                : [],
        };
    });
}

export function buildRangeSegments(text, sources = []) {
    const content = String(text ?? '');
    if (!content) return [];

    const mappings = [];
    const boundaries = new Set([0, content.length]);
    for (const source of sources.filter((item) => item?.type !== 'final')) {
        for (const range of source.ranges ?? []) {
            const start = Math.max(0, Math.min(content.length, Number(range.start) || 0));
            const end = Math.max(start, Math.min(content.length, Number(range.end) || 0));
            if (end <= start) continue;
            mappings.push({ start, end, sourceId: source.id });
            boundaries.add(start);
            boundaries.add(end);
        }
    }

    const positions = [...boundaries].sort((left, right) => left - right);
    const segments = [];
    for (let index = 0; index < positions.length - 1; index += 1) {
        const start = positions[index];
        const end = positions[index + 1];
        if (end <= start) continue;
        const sourceIds = [...new Set(
            mappings
                .filter((range) => range.start < end && range.end > start)
                .map((range) => range.sourceId),
        )];
        segments.push({
            start,
            end,
            text: content.slice(start, end),
            sourceIds,
        });
    }
    return segments;
}
