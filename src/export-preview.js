function byteLength(value) {
    return new TextEncoder().encode(String(value ?? '')).length;
}

export function snapshotExportPreview(snapshot, format, serializedContent = '') {
    const sources = Array.isArray(snapshot?.sources) ? snapshot.sources : [];
    return {
        format,
        approximateBytes: byteLength(serializedContent),
        sourceCount: sources.length,
        containsRawPromptText: Boolean(snapshot?.finalText)
            || sources.some((source) => Boolean(source?.content)),
        includesRequestBody: format === 'json' && Boolean(snapshot?.request?.body),
        includesRequestSettings: format === 'json'
            && Object.keys(snapshot?.request?.settings ?? {}).length > 0,
        includesRawPayload: format === 'json' && snapshot?.payload != null,
        includesLorebookData: format === 'json'
            && (snapshot?.lorebookEntries?.length ?? 0) > 0,
    };
}
