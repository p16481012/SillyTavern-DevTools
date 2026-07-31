const REVIEW_DECISIONS = new Set(['valid', 'false-positive']);
const REVIEW_SCOPES = Object.freeze(['global', 'preset', 'character', 'chat']);
const REVIEW_SCOPE_SET = new Set(REVIEW_SCOPES);
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const MAX_DOCUMENT_LENGTH = 1_048_576;
const MAX_DECISIONS = 2_000;
const MAX_IGNORES = 2_000;
const MAX_AUDIT_ENTRIES = 300;
const MAX_FINDINGS = 5_000;
const MAX_SOURCES = 10_000;
const MAX_KEY_LENGTH = 160;
const MAX_LABEL_LENGTH = 160;
const MAX_CONTEXT_VALUE_LENGTH = 512;
const MAX_IDENTITY_TEXT_LENGTH = 4_096;
const MAX_CONTENT_FINGERPRINT_LENGTH = 65_536;
const MAX_EVIDENCE_FINGERPRINT_LENGTH = 65_536;

export const FINDING_REVIEW_DOCUMENT_VERSION = 1;
export const FINDING_REVIEW_SCOPES = REVIEW_SCOPES;
export const DEFAULT_FINDING_REVIEW_DOCUMENT = Object.freeze({
    version: FINDING_REVIEW_DOCUMENT_VERSION,
    decisions: Object.freeze([]),
    ignores: Object.freeze([]),
    audit: Object.freeze([]),
});

function hasOwn(value, key) {
    return Boolean(
        value
        && typeof value === 'object'
        && Object.prototype.hasOwnProperty.call(value, key),
    );
}

function own(value, key, fallback = undefined) {
    return hasOwn(value, key) ? value[key] : fallback;
}

function boundedText(value, maximum = MAX_IDENTITY_TEXT_LENGTH) {
    return typeof value === 'string' ? value.slice(0, maximum) : '';
}

function normalizedText(value, maximum = MAX_IDENTITY_TEXT_LENGTH) {
    return boundedText(value, maximum)
        .normalize('NFKC')
        .replace(/\s+/gu, ' ')
        .trim();
}

function canonicalText(value, maximum = MAX_IDENTITY_TEXT_LENGTH) {
    return normalizedText(value, maximum).toLowerCase();
}

function containsUnsafeKey(value, state = { nodes: 0 }, depth = 0) {
    if (!value || typeof value !== 'object') return false;
    if (depth > 12 || state.nodes > 20_000) return true;
    state.nodes += 1;
    for (const key of Object.keys(value)) {
        if (UNSAFE_KEYS.has(key)) return true;
        if (containsUnsafeKey(value[key], state, depth + 1)) return true;
    }
    return false;
}

function parseDocument(value) {
    if (typeof value !== 'string') return value;
    if (value.length > MAX_DOCUMENT_LENGTH) return null;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function hashText(value) {
    let first = 2166136261;
    let second = 2246822507;
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        first ^= code;
        first = Math.imul(first, 16777619);
        second ^= code + (index & 255);
        second = Math.imul(second, 3266489909);
    }
    return `${(first >>> 0).toString(16).padStart(8, '0')}${
        (second >>> 0).toString(16).padStart(8, '0')
    }`;
}

function digest(parts) {
    return hashText(parts.map((part) => String(part ?? '')).join('\u001f'));
}

function metadataOf(source) {
    const metadata = own(source, 'metadata');
    return metadata && typeof metadata === 'object' ? metadata : {};
}

function sourceIdentifier(source) {
    const metadata = metadataOf(source);
    return normalizedText(
        own(metadata, 'identifier')
        || own(source, 'identifier'),
    );
}

function sourceIdentityParts(source, includeContent) {
    const metadata = metadataOf(source);
    const kind = canonicalText(
        own(metadata, 'sourceKind')
        || own(source, 'type')
        || own(metadata, 'type'),
    );
    const name = canonicalText(
        own(metadata, 'name')
        || own(source, 'label')
        || own(source, 'name'),
    );
    const role = canonicalText(own(metadata, 'role') || own(source, 'role'));
    const positionValue = own(metadata, 'position')
        ?? own(metadata, 'injectionPosition')
        ?? own(source, 'position');
    const position = canonicalText(
        positionValue == null ? '' : String(positionValue),
    );
    const depthValue = own(metadata, 'depth') ?? own(source, 'depth');
    const depth = normalizedText(
        depthValue == null ? '' : String(depthValue),
        32,
    );
    const parts = ['fallback', kind, name, role, position, depth];
    if (includeContent || !name) {
        parts.push(hashText(canonicalText(
            own(source, 'content'),
            MAX_CONTENT_FINGERPRINT_LENGTH,
        )));
    }
    return parts;
}

/**
 * Produces a stable, opaque source identity. Capture order, source IDs, ranges,
 * and final-prompt offsets are deliberately excluded.
 */
export function sourceFingerprint(source = {}) {
    const identifier = sourceIdentifier(source);
    if (identifier) {
        return `source:id:${digest([canonicalText(identifier)])}`;
    }
    return `source:fallback:${digest(sourceIdentityParts(source, true))}`;
}

function broadSourceFingerprint(source = {}) {
    const identifier = sourceIdentifier(source);
    if (identifier) return sourceFingerprint(source);
    return `source:broad:${digest(sourceIdentityParts(source, false))}`;
}

function sourceArray(sources) {
    if (Array.isArray(sources)) return sources.slice(0, MAX_SOURCES);
    if (sources instanceof Map) return [...sources.values()].slice(0, MAX_SOURCES);
    if (!sources || typeof sources !== 'object') return [];
    return Object.values(sources).slice(0, MAX_SOURCES);
}

function sourceMap(sources) {
    const result = new Map();
    for (const source of sourceArray(sources)) {
        const id = normalizedText(own(source, 'id'));
        if (id && !result.has(id)) result.set(id, source);
    }
    return result;
}

function sourceFingerprintLookup(sources) {
    return {
        byId: sourceMap(sources),
        exact: new Map(),
        broad: new Map(),
    };
}

function findingSourceFingerprintsFromLookup(finding, lookup, broad = false) {
    const sourceIds = Array.isArray(own(finding, 'sourceIds'))
        ? finding.sourceIds.slice(0, 100)
        : [];
    const fingerprints = sourceIds.map((sourceId) => {
        const normalizedId = normalizedText(sourceId);
        const source = lookup.byId.get(normalizedId);
        if (source) {
            const cache = broad ? lookup.broad : lookup.exact;
            if (!cache.has(normalizedId)) {
                cache.set(
                    normalizedId,
                    broad ? broadSourceFingerprint(source) : sourceFingerprint(source),
                );
            }
            return cache.get(normalizedId);
        }
        return `source:unknown:${digest([canonicalText(normalizedId)])}`;
    });
    return [...new Set(fingerprints)].sort();
}

function findingSourceFingerprints(finding, sources, broad = false) {
    return findingSourceFingerprintsFromLookup(
        finding,
        sourceFingerprintLookup(sources),
        broad,
    );
}

function stableEvidence(value, state = { length: 0 }, depth = 0) {
    if (state.length >= MAX_EVIDENCE_FINGERPRINT_LENGTH || depth > 6) return '';
    if (value == null) return '';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        const result = canonicalText(String(value), MAX_EVIDENCE_FINGERPRINT_LENGTH - state.length);
        state.length += result.length;
        return result;
    }
    if (Array.isArray(value)) {
        return value.slice(0, 100).map((item) => stableEvidence(item, state, depth + 1));
    }
    if (typeof value !== 'object' || containsUnsafeKey(value)) return '';
    const result = {};
    for (const key of Object.keys(value).sort().slice(0, 100)) {
        if (/^(?:start|end|offset|index|range|ranges)$/iu.test(key)) continue;
        result[canonicalText(key, 80)] = stableEvidence(value[key], state, depth + 1);
    }
    return result;
}

function evidenceDigest(finding) {
    const semanticRecords = own(finding, 'semanticRecords');
    const evidence = stableEvidence(
        Array.isArray(semanticRecords) && semanticRecords.length > 0
            ? semanticRecords
            : [
                own(finding, 'evidence'),
                own(finding, 'evidenceRecords'),
                own(finding, 'message'),
            ],
    );
    return hashText(JSON.stringify(evidence).slice(0, MAX_EVIDENCE_FINGERPRINT_LENGTH));
}

function findingSemanticId(finding, broad = false) {
    const raw = canonicalText(own(finding, 'id'), 512);
    if (!broad) return raw;
    const separator = raw.indexOf(':');
    return separator < 0 ? raw : raw.slice(0, separator);
}

/**
 * Exact key: changes when the finding's semantic evidence changes, while
 * excluding positions and keeping all prompt/evidence text behind a digest.
 */
function findingKeyFromLookup(finding = {}, lookup) {
    const semantic = Array.isArray(own(finding, 'semanticRecords'))
        && finding.semanticRecords.length > 0;
    return `finding:v1:${digest([
        canonicalText(own(finding, 'ruleId'), 160),
        findingSemanticId(finding, semantic),
        canonicalText(own(finding, 'relationKind'), 160),
        canonicalText(own(finding, 'method'), 160),
        canonicalText(own(finding, 'determination'), 160),
        findingSourceFingerprintsFromLookup(finding, lookup, false).join(','),
        evidenceDigest(finding),
    ])}`;
}

export function findingKey(finding = {}, sources = []) {
    return findingKeyFromLookup(finding, sourceFingerprintLookup(sources));
}

/**
 * Broader key: excludes exact evidence and the variable suffix of a finding ID
 * so an "always ignore" rule can survive equivalent future captures.
 */
function suppressionKeyFromLookup(finding = {}, lookup) {
    const semanticRecords = Array.isArray(own(finding, 'semanticRecords'))
        ? finding.semanticRecords.map((record) => ({
            category: own(record, 'category'),
            target: own(record, 'target'),
            action: own(record, 'action'),
            property: own(record, 'property'),
            value: own(record, 'value'),
            polarity: own(record, 'polarity'),
            scope: own(record, 'scope'),
            condition: own(record, 'condition'),
            exception: own(record, 'exception'),
            priority: own(record, 'priority'),
            status: own(record, 'status'),
        }))
        : [];
    return `suppression:v1:${digest([
        canonicalText(own(finding, 'ruleId'), 160),
        findingSemanticId(finding, true),
        canonicalText(own(finding, 'relationKind'), 160),
        canonicalText(own(finding, 'method'), 160),
        findingSourceFingerprintsFromLookup(finding, lookup, true).join(','),
        semanticRecords.length > 0
            ? hashText(JSON.stringify(stableEvidence(semanticRecords)))
            : '',
        own(finding, 'suppressionSignature')
            ? hashText(canonicalText(
                own(finding, 'suppressionSignature'),
                MAX_EVIDENCE_FINGERPRINT_LENGTH,
            ))
            : '',
    ])}`;
}

export function suppressionKey(finding = {}, sources = []) {
    return suppressionKeyFromLookup(finding, sourceFingerprintLookup(sources));
}

function validStoredKey(value, prefix) {
    const key = normalizedText(value, MAX_KEY_LENGTH);
    return new RegExp(`^${prefix}:v\\d+:[0-9a-f]{16}$`, 'u').test(key) ? key : '';
}

function validTimestamp(value) {
    const input = boundedText(value, 48);
    if (!input || !Number.isFinite(Date.parse(input))) return '';
    return new Date(input).toISOString();
}

export function reviewScopeKey(scope, value) {
    if (scope === 'global') return null;
    if (!REVIEW_SCOPE_SET.has(scope)) return '';
    const input = normalizedText(value, MAX_CONTEXT_VALUE_LENGTH);
    if (!input) return '';
    if (new RegExp(`^scope:${scope}:[0-9a-f]{16}$`, 'u').test(input)) return input;
    return `scope:${scope}:${digest([canonicalText(input, MAX_CONTEXT_VALUE_LENGTH)])}`;
}

function normalizeDecision(value) {
    const finding = validStoredKey(own(value, 'findingKey'), 'finding');
    const decision = normalizedText(own(value, 'decision'), 32);
    if (!finding || !REVIEW_DECISIONS.has(decision)) return null;
    return {
        findingKey: finding,
        decision,
        updatedAt: validTimestamp(own(value, 'updatedAt')) || null,
    };
}

function normalizeIgnore(value) {
    const suppression = validStoredKey(own(value, 'suppressionKey'), 'suppression');
    const scope = normalizedText(own(value, 'scope'), 32);
    if (!suppression || !REVIEW_SCOPE_SET.has(scope)) return null;
    const scopeKey = reviewScopeKey(scope, own(value, 'scopeKey'));
    if (scope !== 'global' && !scopeKey) return null;
    return {
        suppressionKey: suppression,
        scope,
        scopeKey,
        label: normalizedText(own(value, 'label'), MAX_LABEL_LENGTH) || null,
        updatedAt: validTimestamp(own(value, 'updatedAt')) || null,
    };
}

function normalizeAuditEntry(value) {
    const action = normalizedText(own(value, 'action'), 64);
    const targetKey = normalizedText(own(value, 'targetKey'), MAX_KEY_LENGTH);
    const at = validTimestamp(own(value, 'at'));
    if (!action || !/^[a-z][a-z0-9.-]*$/u.test(action) || !at) return null;
    if (
        !validStoredKey(targetKey, 'finding')
        && !validStoredKey(targetKey, 'suppression')
    ) {
        return null;
    }
    const scope = normalizedText(own(value, 'scope'), 32);
    const normalizedScope = REVIEW_SCOPE_SET.has(scope) ? scope : null;
    const scopeKey = normalizedScope
        ? reviewScopeKey(normalizedScope, own(value, 'scopeKey'))
        : null;
    return {
        at,
        action,
        targetKey,
        scope: normalizedScope,
        scopeKey,
    };
}

function currentTimestamp(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function appendAudit(document, entry) {
    return [
        ...document.audit,
        normalizeAuditEntry(entry),
    ].filter(Boolean).slice(-MAX_AUDIT_ENTRIES);
}

function deduplicate(items, identity) {
    const result = new Map();
    for (const item of items) {
        const key = identity(item);
        if (result.has(key)) result.delete(key);
        result.set(key, item);
    }
    return [...result.values()];
}

/**
 * Accepts a parsed value or bounded JSON string and returns a fresh, known-key
 * document. Unknown fields (including prompt/evidence payloads) are discarded.
 */
export function normalizeFindingReviewDocument(value = {}) {
    const parsed = parseDocument(value);
    if (!parsed || typeof parsed !== 'object' || containsUnsafeKey(parsed)) {
        return {
            version: FINDING_REVIEW_DOCUMENT_VERSION,
            decisions: [],
            ignores: [],
            audit: [],
        };
    }

    const rawDecisions = Array.isArray(own(parsed, 'decisions'))
        ? parsed.decisions
        : Array.isArray(own(parsed, 'exactDecisions'))
            ? parsed.exactDecisions
            : [];
    const rawIgnores = Array.isArray(own(parsed, 'ignores'))
        ? parsed.ignores
        : Array.isArray(own(parsed, 'scopedIgnores'))
            ? parsed.scopedIgnores
            : [];
    const rawAudit = Array.isArray(own(parsed, 'audit')) ? parsed.audit : [];

    const decisions = deduplicate(
        rawDecisions.slice(-MAX_DECISIONS).map(normalizeDecision).filter(Boolean),
        ({ findingKey: key }) => key,
    );
    const ignores = deduplicate(
        rawIgnores.slice(-MAX_IGNORES).map(normalizeIgnore).filter(Boolean),
        ({ suppressionKey: key, scope, scopeKey }) => `${key}|${scope}|${scopeKey ?? ''}`,
    );
    const audit = rawAudit
        .slice(-MAX_AUDIT_ENTRIES)
        .map(normalizeAuditEntry)
        .filter(Boolean);

    return {
        version: FINDING_REVIEW_DOCUMENT_VERSION,
        decisions,
        ignores,
        audit,
    };
}

export function setFindingDecision(
    document,
    finding,
    sources,
    decision,
    { at = new Date() } = {},
) {
    const normalized = normalizeFindingReviewDocument(document);
    const key = findingKey(finding, sources);
    const nextDecision = REVIEW_DECISIONS.has(decision) ? decision : null;
    const decisions = normalized.decisions.filter((entry) => entry.findingKey !== key);
    if (nextDecision) {
        decisions.push({
            findingKey: key,
            decision: nextDecision,
            updatedAt: currentTimestamp(at),
        });
    }
    return normalizeFindingReviewDocument({
        ...normalized,
        decisions,
        audit: appendAudit(normalized, {
            at: currentTimestamp(at),
            action: nextDecision ? `decision.${nextDecision}` : 'decision.clear',
            targetKey: key,
        }),
    });
}

export function setFindingIgnore(
    document,
    finding,
    sources,
    {
        enabled = true,
        scope = 'global',
        scopeKey = null,
        label = null,
        at = new Date(),
    } = {},
) {
    const normalized = normalizeFindingReviewDocument(document);
    const key = suppressionKey(finding, sources);
    const normalizedScope = REVIEW_SCOPE_SET.has(scope) ? scope : 'global';
    const normalizedScopeKey = reviewScopeKey(normalizedScope, scopeKey);
    if (normalizedScope !== 'global' && !normalizedScopeKey) return normalized;
    const ignores = normalized.ignores.filter((entry) => !(
        entry.suppressionKey === key
        && entry.scope === normalizedScope
        && entry.scopeKey === normalizedScopeKey
    ));
    if (enabled) {
        ignores.push({
            suppressionKey: key,
            scope: normalizedScope,
            scopeKey: normalizedScopeKey,
            label: normalizedText(label, MAX_LABEL_LENGTH) || null,
            updatedAt: currentTimestamp(at),
        });
    }
    return normalizeFindingReviewDocument({
        ...normalized,
        ignores,
        audit: appendAudit(normalized, {
            at: currentTimestamp(at),
            action: enabled ? 'ignore.add' : 'ignore.remove',
            targetKey: key,
            scope: normalizedScope,
            scopeKey: normalizedScopeKey,
        }),
    });
}

function contextValues(context, scope) {
    const nested = own(context, scope);
    const metadata = own(context, 'metadata');
    const snapshot = own(context, 'snapshot');
    const snapshotMetadata = own(snapshot, 'metadata');
    const candidates = scope === 'preset'
        ? [
            own(context, 'presetId'),
            own(context, 'presetName'),
            typeof nested === 'string' ? nested : null,
            own(nested, 'id'),
            own(nested, 'name'),
            own(metadata, 'presetId'),
            own(metadata, 'presetName'),
            own(snapshotMetadata, 'presetId'),
            own(snapshotMetadata, 'presetName'),
        ]
        : scope === 'character'
            ? [
                own(context, 'characterId'),
                own(context, 'characterName'),
                typeof nested === 'string' ? nested : null,
                own(nested, 'id'),
                own(nested, 'name'),
                own(metadata, 'characterId'),
                own(metadata, 'characterName'),
                own(snapshotMetadata, 'characterId'),
                own(snapshotMetadata, 'characterName'),
            ]
            : [
                own(context, 'chatId'),
                own(context, 'chatName'),
                typeof nested === 'string' ? nested : null,
                own(nested, 'id'),
                own(nested, 'name'),
                own(metadata, 'chatId'),
                own(metadata, 'chatName'),
                own(snapshotMetadata, 'chatId'),
                own(snapshotMetadata, 'chatName'),
            ];
    const explicitScopeKeys = own(context, 'scopeKeys');
    candidates.push(own(explicitScopeKeys, scope));
    return candidates.filter((candidate) => candidate != null && candidate !== '');
}

function contextScopeKeys(context, scope) {
    if (scope === 'global') return new Set([null]);
    return new Set(contextValues(context ?? {}, scope)
        .map((value) => reviewScopeKey(scope, value))
        .filter(Boolean));
}

function prepareReviewResolver(
    sources,
    document,
    context = {},
    hiddenOnce = new Set(),
) {
    const normalized = normalizeFindingReviewDocument(document);
    const fingerprints = sourceFingerprintLookup(sources);
    const decisions = new Map(
        normalized.decisions.map((entry) => [entry.findingKey, entry]),
    );
    const ignores = new Map();
    normalized.ignores.forEach((entry, index) => {
        ignores.set(
            `${entry.suppressionKey}|${entry.scope}|${entry.scopeKey ?? ''}`,
            { entry, index },
        );
    });
    const acceptedScopeKeys = new Map(REVIEW_SCOPES.map((scope) => [
        scope,
        contextScopeKeys(context, scope),
    ]));

    return (finding) => {
        const exactKey = findingKeyFromLookup(finding, fingerprints);
        const broadKey = suppressionKeyFromLookup(finding, fingerprints);
        const exact = decisions.get(exactKey) ?? null;

        let ignore = null;
        for (const scope of REVIEW_SCOPES) {
            let latest = null;
            for (const scopeKey of acceptedScopeKeys.get(scope)) {
                const candidate = ignores.get(
                    `${broadKey}|${scope}|${scopeKey ?? ''}`,
                );
                if (candidate && (!latest || candidate.index > latest.index)) {
                    latest = candidate;
                }
            }
            if (latest) ignore = latest.entry;
        }

        const hiddenForSession = Boolean(
            hiddenOnce?.has?.(exactKey)
            || hiddenOnce?.has?.(broadKey),
        );
        const ignored = exact?.decision === 'valid' ? false : Boolean(ignore);
        return {
            findingKey: exactKey,
            suppressionKey: broadKey,
            decision: exact?.decision ?? null,
            ignored,
            hiddenOnce: hiddenForSession,
            hidden: hiddenForSession || ignored,
            ignoreScope: ignore?.scope ?? null,
            ignoreScopeKey: ignore?.scopeKey ?? null,
        };
    };
}

/**
 * Resolves exact review state and the most specific applicable ignore.
 * Scope precedence is global -> preset -> character -> chat. An exact "valid"
 * decision deliberately overrides a broader ignore.
 */
export function resolveFindingReview(
    finding,
    sources,
    document,
    context = {},
    hiddenOnce = new Set(),
) {
    return prepareReviewResolver(
        sources,
        document,
        context,
        hiddenOnce,
    )(finding);
}

/**
 * Classifies findings without mutating findings, the persisted document, or the
 * caller-owned hide-once Set.
 */
export function applyFindingReviews(
    findings,
    sources,
    document,
    context = {},
    hiddenOnce = new Set(),
) {
    const input = Array.isArray(findings) ? findings.slice(0, MAX_FINDINGS) : [];
    const resolve = prepareReviewResolver(
        sources,
        document,
        context,
        hiddenOnce,
    );
    const reviewed = [];
    const visible = [];
    const hidden = [];
    const counts = {
        total: 0,
        visible: 0,
        hidden: 0,
        valid: 0,
        falsePositive: 0,
    };
    for (const finding of input) {
        const item = { ...finding, review: resolve(finding) };
        reviewed.push(item);
        counts.total += 1;
        if (item.review.hidden) {
            hidden.push(item);
            counts.hidden += 1;
        } else {
            visible.push(item);
            counts.visible += 1;
        }
        if (item.review.decision === 'valid') counts.valid += 1;
        if (item.review.decision === 'false-positive') counts.falsePositive += 1;
    }
    return {
        findings: visible,
        visible,
        hidden,
        all: reviewed,
        counts,
    };
}
