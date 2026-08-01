import {
    attributionDisplayLabel,
    generationTypeDisplayLabel,
    providerDisplayLabel,
    promptTypeDisplayLabel,
    sourceDisplayLabel,
    t,
} from './i18n.js';
import {
    parseTimelineDiagnostics,
    serializeAllTimelineDiagnostics,
    serializeTimelineDiagnostics,
} from './diagnostics.js';
import {
    SEARCH_QUERY_MAX_LENGTH,
    serializeSnapshot,
    snapshotProvider,
} from './model.js';
import {
    buildRangeSegments,
    buildTimelineAnalysis,
    compareLoreEntries,
    compareSnapshotSources,
    largestIncludedSource,
    loreEntryLabel,
} from './pipeline-analysis.js';
import {
    DEFAULT_RULE_SETTINGS,
    RULE_DEFINITIONS,
    analyzeSnapshotDetailed,
    normalizeRuleSettings,
} from './rules.js';
import {
    COMPARISON_POLICY_PROFILE_SCOPES,
    DEFAULT_COMPARISON_POLICY_SETTINGS,
    annotateSourcesWithPolicies,
    buildBulkManualAssignments,
    comparisonScopeKeyEquals,
    normalizeComparisonPolicySettings,
    previewNameMatcher,
    resolveComparisonPolicyContext,
} from './comparison-policy.js';
import {
    DEFAULT_FINDING_REVIEW_DOCUMENT,
    applyFindingReviews,
    normalizeFindingReviewDocument,
    setFindingDecision,
    setFindingIgnore,
} from './finding-review.js';
import {
    DEFAULT_AUDIT_LOG,
    appendAuditEntry,
    configurationDigest,
    normalizeAuditLog,
} from './audit-log.js';
import { buildPolicyChangePreview } from './policy-preview.js';
import {
    POLICY_IO_LIMITS,
    preparePolicyImport,
    serializePolicyDocument,
} from './policy-io.js';
import { resolvePanelTheme } from './theme.js';
import { descriptionParagraphs } from './text-format.js';
import {
    USER_REGEX_MAX_LENGTH,
    validateUserRegex,
} from './regex-safety.js';
import {
    SEARCH_DEBOUNCE_MS,
} from './search-runtime.js';
import {
    AnalysisRuntime,
    DEFAULT_ANALYSIS_TIMEOUT_MS,
} from './analysis-runtime.js';
import {
    AnalysisCache,
    createAnalysisCacheKey,
} from './analysis-cache.js';
import { VirtualListMetrics } from './virtual-list.js';
import { snapshotExportPreview } from './export-preview.js';
import {
    executeSnapshotArchiveImport,
    prepareSnapshotArchiveImport,
    serializeSnapshotArchive,
    snapshotArchiveReplaceConfirmationToken,
} from './snapshot-archive.js';
import {
    createSnapshotShareDocument,
    snapshotSharePreview,
} from './share-export.js';
import { compareDiagnosticReports } from './diagnostic-compare.js';
import {
    DEFAULT_UI_PREFERENCES,
    MAX_SEMANTIC_RESPONSE_TOKEN_CAP,
    MAX_RETENTION_MAX_AGE_DAYS,
    MAX_RETENTION_MAX_BYTES,
    MAX_TIMELINE_RETENTION_LIMIT,
    MAX_TIMELINE_READ_LIMIT,
    MIN_TIMELINE_RETENTION_LIMIT,
    MIN_TIMELINE_READ_LIMIT,
    MIN_SEMANTIC_RESPONSE_TOKEN_CAP,
    PANEL_THEME_MODES,
    SNAPSHOT_CAPTURE_MODES,
    UI_PREFERENCES_KEY,
    V1_UI_PREFERENCES_KEY,
    V2_UI_PREFERENCES_KEY,
    V3_UI_PREFERENCES_KEY,
    V4_UI_PREFERENCES_KEY,
    normalizeUiPreferences,
    readUiPreferencesFromStorage,
} from './preferences.js';
import {
    MAX_PRICE_PER_MILLION,
    MAX_PRICING_OVERRIDES,
    PRICING_OVERRIDE_SCHEMA_VERSION,
    calculateUsageCost,
    normalizeModelId,
    normalizePricingOverrides,
    unavailableCost,
} from './pricing-overrides.js';
import {
    getProviderCapabilities,
    normalizeProviderId,
} from './provider-capabilities.js';
import {
    createUnavailableUsage,
    normalizeUsageRecord,
} from './provider-usage.js';
import { normalizeSemanticConnectionProfileId } from './semantic-connection-profiles.js';

const STORAGE_PREFIX = 'st-devtools:';
const RULE_SETTINGS_KEY = `${STORAGE_PREFIX}rule-settings:v1`;
const LEGACY_COMPARISON_POLICY_SETTINGS_KEY = `${STORAGE_PREFIX}comparison-policy:v1`;
const COMPARISON_POLICY_SETTINGS_KEY = `${STORAGE_PREFIX}comparison-policy:v2`;
const FINDING_REVIEW_SETTINGS_KEY = `${STORAGE_PREFIX}finding-reviews:v1`;
const RULE_AUDIT_LOG_KEY = `${STORAGE_PREFIX}rule-audit:v1`;
const PRICING_OVERRIDES_KEY = `${STORAGE_PREFIX}pricing-overrides:v1`;
const LAST_TAB_KEY = `${STORAGE_PREFIX}last-tab`;
const GEOMETRY_KEY = `${STORAGE_PREFIX}geometry`;
const KNOWN_LOCAL_DATA_KEYS = [
    RULE_SETTINGS_KEY,
    LEGACY_COMPARISON_POLICY_SETTINGS_KEY,
    COMPARISON_POLICY_SETTINGS_KEY,
    FINDING_REVIEW_SETTINGS_KEY,
    RULE_AUDIT_LOG_KEY,
    PRICING_OVERRIDES_KEY,
    LAST_TAB_KEY,
    GEOMETRY_KEY,
    UI_PREFERENCES_KEY,
    V4_UI_PREFERENCES_KEY,
    V3_UI_PREFERENCES_KEY,
    V2_UI_PREFERENCES_KEY,
    V1_UI_PREFERENCES_KEY,
];
const COMPARISON_MODES = ['alternative', 'ignore', 'normal'];
const COMPARISON_TARGETS = ['configured', 'all'];
const COMPARISON_RULE_KINDS = ['template', 'regex'];
const GROWTH_CHART_POINT_LIMIT = 10;
const POLICY_PREVIEW_SOURCE_LIMIT = 100;
const MEBIBYTE = 1024 * 1024;
const MAX_RETENTION_MIB = Math.floor(MAX_RETENTION_MAX_BYTES / MEBIBYTE);
const STORAGE_TOOL_METADATA_LIMIT = 25;
const VIRTUAL_LIST_THRESHOLD = 100;
const VIRTUAL_LIST_OVERSCAN = 6;
const VIRTUAL_LIST_FALLBACK_VIEWPORT = 640;
const PRICING_RATE_FIELDS = Object.freeze([
    'inputPerMillion',
    'outputPerMillion',
    'cachedInputPerMillion',
]);
const TABS = [
    ['explorer', 'tab.explorer', 'nav.short.explorer', 'fa-layer-group'],
    ['rules', 'tab.rules', 'nav.short.rules', 'fa-shield-halved'],
    ['timeline', 'tab.timeline', 'nav.short.timeline', 'fa-clock-rotate-left'],
    ['diff', 'tab.diff', 'nav.short.diff', 'fa-code-compare'],
    ['context', 'tab.context', 'nav.short.context', 'fa-file-lines'],
    ['search', 'tab.search', 'nav.short.search', 'fa-magnifying-glass'],
];
const CAPTURE_STATUS_STATES = new Set([
    'waiting',
    'capturing',
    'processing',
    'saved',
    'failed',
    'excluded-semantic',
    'skipped-safety',
]);
const CAPTURE_PIPELINE_PHASES = new Set([
    'finalizing',
    'privacy',
    'storage',
    'storage-verify',
]);
const CAPTURE_PIPELINE_ERROR_KEYS = new Map([
    ['finalizeSnapshot', 'capture.error.finalizing'],
    ['transformPrivacy', 'capture.error.privacy'],
]);
let tooltipSequence = 0;
let fieldSequence = 0;

function capturePipelineErrorMessage(detail) {
    const code = typeof detail?.error?.code === 'string'
        ? detail.error.code
        : 'unknown';
    const key = CAPTURE_PIPELINE_ERROR_KEYS.get(detail?.operation)
        ?? 'capture.error.pipeline';
    return t(key, { code });
}

function element(tag, options = {}) {
    const node = document.createElement(tag);
    if (options.className) node.className = options.className;
    if (options.text != null) node.textContent = String(options.text);
    if (options.title) node.title = options.title;
    if (options.type) node.type = options.type;
    return node;
}

function closeIcon() {
    const icon = element('span', {
        className: 'st-devtools-button-glyph',
        text: '\u00d7',
    });
    icon.setAttribute('aria-hidden', 'true');
    return icon;
}

function setPolicyFormStatus(node, text, isError = false) {
    node.textContent = text;
    node.classList.toggle('is-error', isError);
}

function attachLazyDetailsContent(details, createContent) {
    let mounted = false;
    const mount = () => {
        if (mounted) return;
        const content = createContent();
        if (content) details.appendChild(content);
        mounted = true;
    };
    details.__stDevToolsMountContent = mount;
    details.addEventListener('toggle', () => {
        if (details.open) mount();
    });
    if (details.open) mount();
    return details;
}

function mountDetailsContent(details) {
    details?.__stDevToolsMountContent?.();
}

function proseElement(tag, text, options = {}) {
    const node = element(tag, options);
    for (const paragraph of descriptionParagraphs(text)) {
        node.appendChild(element('span', {
            className: 'st-devtools-prose-paragraph',
            text: paragraph,
        }));
    }
    return node;
}

function tooltipClippingRect(wrapper) {
    const boundary = {
        left: 0,
        right: window.innerWidth,
        top: 0,
        bottom: window.innerHeight,
    };
    for (
        let ancestor = wrapper.parentElement;
        ancestor;
        ancestor = ancestor.parentElement
    ) {
        const style = getComputedStyle(ancestor);
        const clipsX = style.overflowX !== 'visible';
        const clipsY = style.overflowY !== 'visible';
        if (clipsX || clipsY) {
            const rect = ancestor.getBoundingClientRect();
            if (clipsX) {
                boundary.left = Math.max(boundary.left, rect.left);
                boundary.right = Math.min(boundary.right, rect.right);
            }
            if (clipsY) {
                boundary.top = Math.max(boundary.top, rect.top);
                boundary.bottom = Math.min(boundary.bottom, rect.bottom);
            }
        }
        if (ancestor.classList.contains('st-devtools-overlay')) break;
    }
    return {
        ...boundary,
        width: Math.max(0, boundary.right - boundary.left),
        height: Math.max(0, boundary.bottom - boundary.top),
    };
}

function positionHelpTooltip(wrapper) {
    const tooltip = wrapper.querySelector('.st-devtools-help-bubble');
    const anchor = wrapper.closest('.st-devtools-explained-title') ?? wrapper;
    if (!tooltip || !anchor) return;
    wrapper.classList.add('is-positioning');
    try {
        const boundaryRect = tooltipClippingRect(wrapper);
        if (boundaryRect.width <= 0 || boundaryRect.height <= 0) return;
        const anchorRect = anchor.getBoundingClientRect();
        const triggerRect = wrapper.getBoundingClientRect();
        const margin = 8;
        const gap = 7;
        const maximumWidth = Math.max(1, Math.min(320, boundaryRect.width - (margin * 2)));
        const maximumHeight = Math.max(1, boundaryRect.height - (margin * 2));
        tooltip.style.maxWidth = `${maximumWidth}px`;
        tooltip.style.maxHeight = `${maximumHeight}px`;
        tooltip.style.left = '0px';
        tooltip.style.top = `${anchorRect.height + gap}px`;

        const measured = tooltip.getBoundingClientRect();
        const minimumLeft = boundaryRect.left + margin;
        const maximumLeft = Math.max(minimumLeft, boundaryRect.right - measured.width - margin);
        const desiredLeft = Math.min(maximumLeft, Math.max(minimumLeft, triggerRect.left));
        const belowTop = triggerRect.bottom + gap;
        const aboveTop = triggerRect.top - measured.height - gap;
        const desiredTop = belowTop + measured.height <= boundaryRect.bottom - margin
            ? belowTop
            : Math.max(boundaryRect.top + margin, aboveTop);

        tooltip.style.left = `${desiredLeft - anchorRect.left}px`;
        tooltip.style.top = `${desiredTop - anchorRect.top}px`;
    } finally {
        wrapper.classList.remove('is-positioning');
    }
}

function setHelpTooltipOpen(wrapper, open) {
    wrapper.classList.toggle('is-open', open);
    wrapper.querySelector('.st-devtools-help-trigger')
        ?.setAttribute('aria-expanded', String(open));
    if (open) positionHelpTooltip(wrapper);
}

function closeHelpTooltips(root = document, except = null) {
    for (const wrapper of root.querySelectorAll('.st-devtools-help-tooltip.is-open')) {
        if (wrapper !== except) setHelpTooltipOpen(wrapper, false);
    }
}

function helpTooltip(text, title) {
    const wrapper = element('span', { className: 'st-devtools-help-tooltip' });
    const trigger = element('button', {
        className: 'st-devtools-help-trigger',
        text: '?',
        type: 'button',
    });
    const tooltip = element('span', { className: 'st-devtools-help-bubble' });
    for (const paragraph of descriptionParagraphs(text)) {
        tooltip.appendChild(element('span', {
            className: 'st-devtools-help-paragraph',
            text: paragraph,
        }));
    }
    const tooltipId = `st-devtools-tooltip-${++tooltipSequence}`;
    tooltip.id = tooltipId;
    tooltip.setAttribute('role', 'tooltip');
    trigger.setAttribute('aria-label', t('common.showDescription', { title }));
    trigger.setAttribute('aria-controls', tooltipId);
    trigger.setAttribute('aria-describedby', tooltipId);
    trigger.setAttribute('aria-expanded', 'false');
    tooltip.addEventListener('pointerdown', (event) => event.stopPropagation());
    tooltip.addEventListener('click', (event) => event.stopPropagation());
    trigger.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const nextOpen = !wrapper.classList.contains('is-open');
        closeHelpTooltips(document, wrapper);
        setHelpTooltipOpen(wrapper, nextOpen);
        if (!nextOpen) trigger.blur();
    });
    trigger.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        setHelpTooltipOpen(wrapper, false);
        trigger.focus();
    });
    wrapper.addEventListener('focusout', (event) => {
        if (!wrapper.contains(event.relatedTarget)) {
            setHelpTooltipOpen(wrapper, false);
        }
    });
    wrapper.addEventListener('pointerenter', () => positionHelpTooltip(wrapper));
    trigger.addEventListener('focus', () => positionHelpTooltip(wrapper));
    wrapper.append(trigger, tooltip);
    return wrapper;
}

function snapshotProviderDisplay(snapshot) {
    return providerDisplayLabel(snapshotProvider(snapshot));
}

function explainedTitle(title, description, {
    tag = 'span',
    titleTag = 'strong',
    className = '',
} = {}) {
    const wrapper = element(tag, {
        className: `st-devtools-explained-title ${className}`.trim(),
    });
    wrapper.append(
        element(titleTag, { text: title }),
        helpTooltip(description, title),
    );
    return wrapper;
}

function describedControlField(labelText, control, description) {
    const wrapper = element('div', { className: 'st-devtools-policy-field' });
    const heading = element('div', {
        className: 'st-devtools-explained-title st-devtools-policy-field-heading',
    });
    const label = element('label', { text: labelText });
    const controlId = control.id || `st-devtools-policy-field-${++fieldSequence}`;
    const help = helpTooltip(description, labelText);
    const tooltipId = help.querySelector('.st-devtools-help-bubble')?.id;
    control.id = controlId;
    label.htmlFor = controlId;
    if (tooltipId) control.setAttribute('aria-describedby', tooltipId);
    heading.append(label, help);
    wrapper.append(heading, control);
    return wrapper;
}

function formatTimestamp(timestamp) {
    return new Intl.DateTimeFormat('ko-KR', {
        dateStyle: 'short',
        timeStyle: 'medium',
    }).format(new Date(timestamp));
}

function formatDelta(value) {
    const number = Number(value) || 0;
    return `${number > 0 ? '+' : ''}${number}`;
}

function formatBytes(value) {
    const bytes = Math.max(0, Number(value) || 0);
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 ** 2)).toFixed(1)} MB`;
}

function emptyPricingOverrides() {
    return normalizePricingOverrides({
        version: PRICING_OVERRIDE_SCHEMA_VERSION,
        entries: [],
    });
}

function restoreStorageValue(storage, key, value) {
    if (value == null) storage.removeItem(key);
    else storage.setItem(key, value);
}

function policyId(prefix) {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
        return `${prefix}:${globalThis.crypto.randomUUID()}`;
    }
    return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function categoriesFromInput(value) {
    const categories = String(value ?? '')
        .split(',')
        .map((category) => category.trim())
        .filter(Boolean);
    if (categories.length === 0 || categories.includes('*')) return '*';
    return [...new Set(categories)];
}

function categoriesLabel(categories) {
    if (categories === '*' || categories == null) return '*';
    return Array.isArray(categories) ? categories.join(', ') : String(categories);
}

function policyModeLabel(mode) {
    return translatedValue(`comparison.mode.${mode}`, mode || t('common.unknown'));
}

function policyReasonLabel(reason) {
    return translatedValue(`comparison.reason.${reason}`, reason || t('common.unknown'));
}

function comparisonRuleError(rule) {
    const pattern = String(rule?.pattern ?? '').trim();
    if (!pattern) return t('comparison.invalid.emptyPattern');
    if (rule?.kind === 'regex') {
        const validation = validateUserRegex(pattern);
        if (validation.ok) return null;
        const key = validation.code === 'regex-too-long'
            ? 'comparison.invalid.regexTooLong'
            : validation.code === 'unsafe-regex'
                ? 'comparison.invalid.regexUnsafe'
                : 'comparison.invalid.regex';
        return t(key);
    }
    const groupCount = pattern.split('{group}').length - 1;
    const optionCount = pattern.split('{option}').length - 1;
    if (!rule?.fixedGroup && groupCount === 0) {
        return t('comparison.invalid.templateGroup');
    }
    if (optionCount === 0) {
        return t('comparison.invalid.templateOption');
    }
    if (groupCount > 1 || optionCount !== 1) {
        return t('comparison.invalid.templateShape');
    }
    return null;
}

function isConfiguredPromptSource(source) {
    return source?.metadata?.sourceKind === 'configuredPrompt'
        || Object.prototype.hasOwnProperty.call(source?.metadata ?? {}, 'configuredEnabled');
}

function explorerSourceState(source) {
    const metadata = source?.metadata ?? {};
    if (
        source?.configuredEnabled === false
        || metadata.configuredEnabled === false
        || metadata.enabled === false
    ) return 'disabled';
    if (source?.included === true) return 'included';
    if (source?.included === false) return 'omitted';
    return 'unknown';
}

function explorerSourceGroups(sources = []) {
    const sourceOrder = new Map(sources.map((source, index) => [source.id, index]));
    const configured = sources
        .filter(isConfiguredPromptSource)
        .sort((left, right) => {
            const leftOrder = Number(left?.metadata?.promptOrder);
            const rightOrder = Number(right?.metadata?.promptOrder);
            const leftKnown = Number.isFinite(leftOrder);
            const rightKnown = Number.isFinite(rightOrder);
            if (leftKnown && rightKnown && leftOrder !== rightOrder) return leftOrder - rightOrder;
            if (leftKnown !== rightKnown) return leftKnown ? -1 : 1;
            return sourceOrder.get(left.id) - sourceOrder.get(right.id);
        });
    const final = sources.filter((source) => source.type === 'final');
    const other = sources.filter(
        (source) => source.type !== 'final' && !isConfiguredPromptSource(source),
    );
    return [
        {
            key: 'configured',
            sources: configured,
            open: configured.length > 0,
            promptManagerOrder: configured.length > 0 && configured.every(
                (source) => source?.metadata?.promptOrderSource === 'prompt-manager',
            ),
        },
        {
            key: 'other',
            sources: other,
            open: configured.length === 0,
        },
        {
            key: 'final',
            sources: final,
            open: false,
        },
    ].filter((group) => group.sources.length > 0);
}

function policySourceLabel(source) {
    return sourceDisplayLabel(source) || source?.metadata?.identifier || source?.id || t('common.unknown');
}

function sourceReferenceLabel(reference, sourceById) {
    if (typeof reference === 'string') {
        const source = sourceById.get(reference);
        return source ? policySourceLabel(source) : reference;
    }
    if (!reference || typeof reference !== 'object') return t('common.unknown');
    const source = sourceById.get(reference.sourceId ?? reference.id);
    return source
        ? policySourceLabel(source)
        : reference.label ?? reference.name ?? reference.identifier ?? reference.sourceId
            ?? reference.id ?? t('common.unknown');
}

function translatedValue(key, fallback) {
    const translated = t(key);
    return translated === key ? fallback : translated;
}

function normalizedCount(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : fallback;
}

function provenanceAvailabilityLabel(value) {
    const availability = value || 'unavailable';
    return translatedValue(
        `explorer.provenanceAvailability.${availability}`,
        availability,
    );
}

function prefillStatus(source) {
    if (source?.type !== 'assistant_prefill') return null;
    const value = source?.metadata?.prefillStatus;
    if (value === 'confirmed' || value === 'inferred') return value;
    return 'unknown';
}

function diffFieldLabel(namespace, field) {
    return translatedValue(`${namespace}.${field}`, field || t('common.unknown'));
}

function diffValueLabel(value) {
    if (value == null || value === '') return t('common.none');
    if (value === true) return t('common.enabled');
    if (value === false) return t('common.disabled');
    if (Array.isArray(value)) return value.map(diffValueLabel).join(', ');
    if (typeof value === 'object') {
        try {
            return JSON.stringify(value);
        } catch {
            return t('common.unknown');
        }
    }
    return String(value);
}

function multimodalEstimateLabels(source) {
    const estimate = source?.metadata?.tokenEstimate;
    if (!estimate) {
        return {
            estimate: t('multimodal.estimate.unavailable'),
            method: t('multimodal.methodLabel', {
                provider: t('multimodal.provider.unknown'),
                method: t('multimodal.method.provider-unsupported'),
            }),
        };
    }
    const estimateKey = `multimodal.estimate.${estimate.kind ?? 'unavailable'}`;
    const provider = translatedValue(
        `multimodal.provider.${estimate.provider ?? 'unknown'}`,
        estimate.provider ?? t('multimodal.provider.unknown'),
    );
    const method = translatedValue(
        `multimodal.method.${estimate.method ?? 'provider-unsupported'}`,
        estimate.method ?? t('multimodal.method.provider-unsupported'),
    );
    return {
        estimate: t(estimateKey, { count: estimate.tokens ?? '' }),
        method: t('multimodal.methodLabel', { provider, method }),
    };
}

function svgElement(tag, attributes = {}) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [name, value] of Object.entries(attributes)) {
        node.setAttribute(name, String(value));
    }
    return node;
}

function downloadText(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

async function copyText(text) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }
    const textarea = element('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
}

export class DevToolsWindow {
    constructor({
        getContext,
        store,
        capture,
        version,
        analysisWorkerClass = globalThis.Worker,
        analysisTimeoutMs = DEFAULT_ANALYSIS_TIMEOUT_MS,
        analysisCache = null,
        analysisRuntime = null,
        semanticInspector = null,
    }) {
        this.getContext = getContext;
        this.store = store;
        this.capture = capture;
        this.version = version;
        this.semanticInspector = semanticInspector;
        this.root = null;
        this.window = null;
        this.content = null;
        this.timeline = [];
        this.timelineTotalCount = 0;
        this.timelineCorruptCount = 0;
        this.selectedId = null;
        this.selectedTimelineIds = new Set();
        this.timelineSelectionChatId = null;
        this.analysisRevision = 0;
        this.analysisControllers = new Set();
        this.analysisSnapshotDigestCache = new WeakMap();
        this.virtualListCleanups = new Set();
        this.virtualSourceLists = new Map();
        this.openSourceIds = new Set();
        this.analysisCache = analysisCache ?? new AnalysisCache();
        this.analysisRuntime = analysisRuntime ?? new AnalysisRuntime({
            WorkerClass: analysisWorkerClass,
            timeoutMs: analysisTimeoutMs,
            cache: this.analysisCache,
            revisionProvider: () => this.analysisRevision,
        });
        this.localAnalysisRuntime = new AnalysisRuntime({
            WorkerClass: null,
            timeoutMs: analysisTimeoutMs,
            cache: this.analysisCache,
            revisionProvider: () => this.analysisRevision,
        });
        this.refreshRequestId = 0;
        this.storageSummaryRefreshPromise = null;
        this.storageSummaryRebuildPromise = null;
        this.storageSummaryRebuildScheduled = false;
        this.storageSummaryGeneration = 0;
        this.storageSummary = {
            ...(this.store.getStatus?.() ?? {
                type: 'memory',
                persistent: false,
                fallbackReason: 'status-unavailable',
            }),
            chatCount: null,
            snapshotCount: null,
            localSettingCount: null,
            approximateBytes: null,
            snapshotApproximateBytes: null,
            complete: false,
            rebuilding: false,
        };
        this.preferences = this.loadUiPreferences();
        this.pricingOverrides = this.loadPricingOverrides();
        this.pendingPricingOverrides = null;
        this.store.setMaxSnapshotsPerChat?.(this.preferences.timelineRetentionLimit);
        this.activeTab = localStorage.getItem(LAST_TAB_KEY) || 'explorer';
        this.captureStatus = {
            state: 'waiting',
            at: Date.now(),
        };
        this.captureStatusRegion = null;
        this.ruleSettings = this.loadRuleSettings();
        this.ruleSettingsOpen = false;
        this.comparisonPolicySettings = this.loadComparisonPolicySettings();
        this.savedComparisonPolicySettings = normalizeComparisonPolicySettings(
            this.comparisonPolicySettings,
        );
        this.comparisonPolicyDirty = false;
        this.policyPreviewRevision = 0;
        this.policyPreviewCache = null;
        this.activeComparisonProfileId = this.comparisonPolicySettings.profiles?.[0]?.id ?? 'global';
        this.findingReviewDocument = this.loadFindingReviewDocument();
        this.findingHiddenOnce = new Set();
        this.ruleAuditLog = this.loadRuleAuditLog();
        this.ruleReviewStatus = '';
        this.ruleReviewStatusIsError = false;
        this.pendingImportedRuleSettings = null;
        this.pendingImportedReviews = null;
        this.invalidatePolicyPreview();
        this.comparisonPolicyOpen = false;
        this.comparisonPolicySectionOpen = {
            profiles: false,
            groups: false,
            rules: false,
            manual: false,
            preview: false,
            transfer: false,
            reviewed: false,
            audit: false,
        };
        this.instructionModelOpen = false;
        this.instructionAtomsOpen = false;
        this.timelineSnapshotsOpen = false;
        this.previouslyFocused = null;
        this.settingsPreviouslyFocused = null;
        this.settingsOverlay = null;
        this.settingsPanel = null;
        this.settingsRefreshTimer = null;
        this.themeModeInput = null;
        this.timelineRetentionLimitInput = null;
        this.timelineReadLimitInput = null;
        this.retentionMaxAgeDaysInput = null;
        this.retentionMaxBytesMiBInput = null;
        this.captureModeInput = null;
        this.semanticInspectorEnabledInput = null;
        this.semanticConnectionProfileInput = null;
        this.semanticConnectionProfileStatus = null;
        this.semanticResponseTokenCapInput = null;
        this.semanticInspectorOpen = false;
        this.resetPricingEditor = null;
        this.semanticInspectionState = {
            snapshotId: null,
            analysisRevision: this.analysisRevision,
            targetIds: new Set(),
            status: 'idle',
            result: null,
            errorCode: null,
            sequence: 0,
            controller: null,
        };
        this.semanticInspectorHost = null;
        this.semanticConsentOverlay = null;
        this.semanticConsentPanel = null;
        this.semanticConsentBody = null;
        this.semanticConsentCheckbox = null;
        this.semanticConsentConfirmButton = null;
        this.semanticConsentPreviouslyFocused = null;
        this.semanticConsentResolve = null;
        this.storageToolsStatus = null;
        this.diagnosticCompareFiles = [];
        this.primaryRegions = [];
        this.storageErrors = [];
        this.importedDiagnostics = null;
        this.diagnosticImportError = null;
        this.capture.addEventListener('snapshot', (event) => this.onSnapshot(event.detail));
        this.capture.addEventListener('capture-error', (event) => this.onCaptureError(event.detail));
        this.capture.addEventListener('capture-status', (event) => {
            this.onCaptureStatus(event.detail);
        });
    }

    currentChatId() {
        const context = this.getContext();
        return context.getCurrentChatId?.() ?? context.chatId ?? '__global__';
    }

    snapshotStorageChatId(snapshot) {
        return snapshot?.storageChatId
            ?? snapshot?.chatId
            ?? this.currentChatId();
    }

    selectedSnapshot() {
        return this.timeline.find((snapshot) => snapshot.id === this.selectedId)
            ?? this.timeline.at(-1)
            ?? null;
    }

    invalidateAnalysisState() {
        if (this.analysisRevision >= Number.MAX_SAFE_INTEGER) {
            this.analysisRevision = 0;
            this.analysisCache.clear();
        } else {
            this.analysisRevision += 1;
        }
        if (
            this.semanticInspectionState
            && this.semanticInspectionState.analysisRevision !== this.analysisRevision
        ) {
            this.invalidateSemanticInspectionOutcome(this.semanticInspectionState);
        }
        for (const controller of this.analysisControllers) {
            controller.abort();
        }
        this.analysisControllers.clear();
    }

    disposeVirtualLists() {
        for (const cleanup of this.virtualListCleanups) {
            try {
                cleanup();
            } catch {
                // Detached observers and listeners are best-effort cleanup.
            }
        }
        this.virtualListCleanups.clear();
        this.virtualSourceLists.clear();
    }

    analysisTextDigest(value) {
        const text = String(value ?? '');
        const chunks = [];
        for (let index = 0; index < text.length; index += 32_768) {
            chunks.push(text.slice(index, index + 32_768));
        }
        return configurationDigest(chunks);
    }

    analysisSnapshotReference(snapshot) {
        if (snapshot && this.analysisSnapshotDigestCache.has(snapshot)) {
            return this.analysisSnapshotDigestCache.get(snapshot);
        }
        const sources = Array.isArray(snapshot?.sources) ? snapshot.sources : [];
        const sourceBatches = [];
        for (let index = 0; index < sources.length; index += 1_000) {
            sourceBatches.push(configurationDigest(
                sources.slice(index, index + 1_000).map((source) => ({
                    id: configurationDigest(String(source?.id ?? '')),
                    type: source?.type ?? null,
                    content: this.analysisTextDigest(source?.content),
                    tokenCount: Number(source?.tokenCount) || 0,
                    included: source?.included !== false,
                })),
            ));
        }
        const loreEntries = Array.isArray(snapshot?.lorebookEntries)
            ? snapshot.lorebookEntries
            : [];
        const loreBatches = [];
        for (let index = 0; index < loreEntries.length; index += 1_000) {
            loreBatches.push(configurationDigest(
                loreEntries.slice(index, index + 1_000).map((entry) => ({
                    uid: configurationDigest(String(entry?.uid ?? '')),
                    world: configurationDigest(String(entry?.world ?? '')),
                    key: configurationDigest(entry?.key ?? null),
                    content: this.analysisTextDigest(entry?.content),
                    position: entry?.position ?? null,
                })),
            ));
        }
        const reference = {
            id: configurationDigest(String(snapshot?.id ?? '')),
            timestamp: Number(snapshot?.timestamp) || 0,
            schemaVersion: Number(snapshot?.schemaVersion) || 0,
            sourceCount: sources.length,
            sourceDigest: configurationDigest(sourceBatches),
            loreCount: loreEntries.length,
            loreDigest: configurationDigest(loreBatches),
            finalTextDigest: this.analysisTextDigest(snapshot?.finalText),
        };
        const digest = configurationDigest(reference);
        if (snapshot && typeof snapshot === 'object') {
            this.analysisSnapshotDigestCache.set(snapshot, digest);
        }
        return digest;
    }

    analysisCacheKey(kind, snapshots, configuration) {
        return createAnalysisCacheKey({
            kind,
            snapshotDigest: configurationDigest(
                snapshots.map((snapshot) => (
                    this.analysisSnapshotReference(snapshot)
                )),
            ),
            configurationDigest: configurationDigest(configuration),
            revision: this.analysisRevision,
        });
    }

    analysisRuleSnapshot(snapshot) {
        return {
            sources: Array.isArray(snapshot?.sources) ? snapshot.sources : [],
            finalText: String(snapshot?.finalText ?? ''),
            stats: {
                totalTokens: Number(snapshot?.stats?.totalTokens) || 0,
                contextUsage: Number(snapshot?.stats?.contextUsage) || 0,
            },
            profileContext: snapshot?.profileContext ?? null,
            preset: snapshot?.preset ?? null,
            characterKey: snapshot?.characterKey ?? null,
            characterId: snapshot?.characterId ?? null,
            chatId: snapshot?.chatId ?? null,
        };
    }

    async runUiAnalysis(kind, input, {
        snapshots,
        configuration = {},
        controller = new AbortController(),
        timeoutMs = undefined,
    }) {
        const revision = this.analysisRevision;
        const cacheKey = this.analysisCacheKey(
            kind,
            snapshots,
            configuration,
        );
        this.analysisControllers.add(controller);
        const options = {
            signal: controller.signal,
            cacheKey,
            revision,
            ...(timeoutMs == null ? {} : { timeoutMs }),
        };
        try {
            try {
                return await this.analysisRuntime.run(kind, input, options);
            } catch (error) {
                if (
                    error?.code !== 'analysis-worker-unavailable'
                    || controller.signal.aborted
                    || revision !== this.analysisRevision
                    || this.analysisRuntime === this.localAnalysisRuntime
                    || (
                        kind === 'search'
                        && input.options?.regex
                        && typeof document !== 'undefined'
                    )
                ) {
                    throw error;
                }
                return await this.localAnalysisRuntime.run(kind, input, options);
            }
        } finally {
            this.analysisControllers.delete(controller);
        }
    }

    shouldUseAsyncAnalysis(kind, snapshots) {
        if (kind === 'search') return true;
        let sourceCount = 0;
        let loreCount = 0;
        let textLength = 0;
        for (const snapshot of snapshots) {
            const sources = Array.isArray(snapshot?.sources)
                ? snapshot.sources
                : [];
            sourceCount += sources.length;
            loreCount += snapshot?.lorebookEntries?.length ?? 0;
            textLength += String(snapshot?.finalText ?? '').length;
            for (const source of sources) {
                textLength += String(source?.content ?? '').length;
                if (textLength >= 200_000) return true;
            }
        }
        return (
            sourceCount >= VIRTUAL_LIST_THRESHOLD
            || loreCount >= VIRTUAL_LIST_THRESHOLD
            || textLength >= 200_000
        );
    }

    analysisErrorText(error) {
        const code = error?.code ?? error?.message;
        const keyByCode = {
            'analysis-timeout': 'analysis.error.timeout',
            'analysis-worker-unavailable': 'analysis.error.workerUnavailable',
            'analysis-worker-failed': 'analysis.error.workerFailed',
            'analysis-input-too-large': 'analysis.error.tooLarge',
            'analysis-failed': 'analysis.error.failed',
        };
        return t(keyByCode[code] ?? 'analysis.error.unknown');
    }

    mountVirtualList(container, items, {
        estimatedRowHeight,
        renderItem,
        focusSelector = 'button, summary, input, [tabindex]',
        ariaLabel = null,
    }) {
        const normalizedItems = Array.isArray(items) ? items : [];
        container.setAttribute('role', 'list');
        if (ariaLabel) container.setAttribute('aria-label', ariaLabel);
        const applyItemAccessibility = (node, index) => {
            node.dataset.virtualIndex = String(index);
            node.setAttribute('role', 'listitem');
            node.setAttribute('aria-setsize', String(normalizedItems.length));
            node.setAttribute('aria-posinset', String(index + 1));
            return node;
        };

        if (normalizedItems.length < VIRTUAL_LIST_THRESHOLD) {
            normalizedItems.forEach((item, index) => {
                container.appendChild(applyItemAccessibility(
                    renderItem(item, index),
                    index,
                ));
            });
            return {
                virtualized: false,
                refresh: () => {},
                scrollToIndex: (index, { focus = false } = {}) => {
                    const node = [...container.children].find(
                        (child) => Number(child.dataset.virtualIndex) === index,
                    );
                    node?.scrollIntoView?.({ block: 'center', behavior: 'auto' });
                    if (focus) node?.querySelector(focusSelector)?.focus?.({
                        preventScroll: true,
                    });
                    return node ?? null;
                },
            };
        }

        const metrics = new VirtualListMetrics({
            itemCount: normalizedItems.length,
            estimatedRowHeight,
            overscan: VIRTUAL_LIST_OVERSCAN,
        });
        container.classList.add('st-devtools-virtual-list');
        container.dataset.virtualized = 'true';
        container.dataset.virtualCount = String(normalizedItems.length);
        container.tabIndex = 0;
        let disposed = false;
        let scheduled = false;
        let scheduledHandle = null;
        let scheduledWithAnimationFrame = false;
        let currentStart = -1;
        let currentEnd = -1;
        let topSpacer = null;
        let bottomSpacer = null;
        const observedRows = new Set();
        let resizeObserver = null;

        const viewportHeight = () => (
            container.clientHeight || VIRTUAL_LIST_FALLBACK_VIEWPORT
        );
        const unobserveRows = () => {
            for (const row of observedRows) {
                resizeObserver?.unobserve?.(row);
            }
            observedRows.clear();
        };
        const restoreFocusedRow = (index) => {
            if (index == null) return;
            this.scheduleExplorerFocus(() => {
                if (disposed || !container.isConnected) return;
                const row = [...container.querySelectorAll(
                    '[data-virtual-index]',
                )].find((node) => Number(node.dataset.virtualIndex) === index);
                row?.querySelector(focusSelector)?.focus?.({
                    preventScroll: true,
                });
            });
        };
        const renderWindow = (force = false) => {
            if (disposed) return;
            const windowState = metrics.getWindow({
                scrollTop: container.scrollTop,
                viewportHeight: viewportHeight(),
            });
            if (
                !force
                && currentStart === windowState.start
                && currentEnd === windowState.end
            ) {
                if (topSpacer) {
                    topSpacer.style.height = `${windowState.topSpacer}px`;
                }
                if (bottomSpacer) {
                    bottomSpacer.style.height = `${windowState.bottomSpacer}px`;
                }
                return;
            }

            const activeRow = container.contains(document.activeElement)
                ? document.activeElement?.closest?.('[data-virtual-index]')
                : null;
            const focusedIndex = activeRow
                ? Number(activeRow.dataset.virtualIndex)
                : null;
            unobserveRows();
            const fragment = document.createDocumentFragment();
            topSpacer = element('div', {
                className: 'st-devtools-virtual-spacer is-top',
            });
            topSpacer.setAttribute('aria-hidden', 'true');
            topSpacer.style.height = `${windowState.topSpacer}px`;
            fragment.appendChild(topSpacer);
            for (
                let index = windowState.start;
                index < windowState.end;
                index += 1
            ) {
                const row = applyItemAccessibility(element('div', {
                    className: 'st-devtools-virtual-row',
                }), index);
                row.appendChild(
                    renderItem(normalizedItems[index], index),
                );
                fragment.appendChild(
                    row,
                );
                observedRows.add(row);
            }
            bottomSpacer = element('div', {
                className: 'st-devtools-virtual-spacer is-bottom',
            });
            bottomSpacer.setAttribute('aria-hidden', 'true');
            bottomSpacer.style.height = `${windowState.bottomSpacer}px`;
            fragment.appendChild(bottomSpacer);
            currentStart = windowState.start;
            currentEnd = windowState.end;
            container.replaceChildren(fragment);
            for (const row of observedRows) resizeObserver?.observe?.(row);
            if (
                Number.isInteger(focusedIndex)
                && focusedIndex >= currentStart
                && focusedIndex < currentEnd
            ) {
                restoreFocusedRow(focusedIndex);
            }
        };
        const schedule = () => {
            if (scheduled || disposed) return;
            scheduled = true;
            const callback = () => {
                scheduled = false;
                scheduledHandle = null;
                renderWindow();
            };
            if (typeof requestAnimationFrame === 'function') {
                scheduledWithAnimationFrame = true;
                scheduledHandle = requestAnimationFrame(callback);
            } else {
                scheduledWithAnimationFrame = false;
                scheduledHandle = setTimeout(callback, 0);
            }
        };
        const scrollToIndex = (value, {
            align = 'center',
            focus = false,
        } = {}) => {
            const index = Math.min(
                normalizedItems.length - 1,
                Math.max(0, Math.trunc(Number(value) || 0)),
            );
            const top = metrics.offsetForIndex(index);
            const bottom = metrics.offsetForIndex(index + 1);
            const viewport = viewportHeight();
            if (align === 'start') {
                container.scrollTop = top;
            } else if (align === 'end') {
                container.scrollTop = Math.max(0, bottom - viewport);
            } else {
                container.scrollTop = Math.max(
                    0,
                    top - ((viewport - (bottom - top)) / 2),
                );
            }
            renderWindow(true);
            const row = [...container.querySelectorAll(
                '[data-virtual-index]',
            )].find((node) => Number(node.dataset.virtualIndex) === index);
            if (focus) restoreFocusedRow(index);
            return row ?? null;
        };
        const handleKeydown = (event) => {
            if (
                event.altKey
                || event.ctrlKey
                || event.metaKey
                || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)
            ) {
                return;
            }
            const row = event.target.closest?.('[data-virtual-index]');
            if (!row) return;
            const current = Number(row.dataset.virtualIndex);
            const next = event.key === 'Home'
                ? 0
                : event.key === 'End'
                    ? normalizedItems.length - 1
                    : current + (event.key === 'ArrowDown' ? 1 : -1);
            if (next < 0 || next >= normalizedItems.length) return;
            event.preventDefault();
            scrollToIndex(next, { focus: true });
        };
        const handleResize = (entries) => {
            let changed = false;
            for (const entry of entries) {
                if (entry.target === container) {
                    changed = true;
                    continue;
                }
                const index = Number(entry.target.dataset.virtualIndex);
                const height = entry.borderBoxSize?.[0]?.blockSize
                    ?? entry.contentRect?.height;
                if (!Number.isInteger(index) || !Number.isFinite(height)) {
                    continue;
                }
                const previous = metrics.measuredHeights.get(index)
                    ?? metrics.estimatedRowHeight;
                if (Math.abs(previous - height) < 0.5) continue;
                if (metrics.updateMeasuredHeight(index, height)) changed = true;
            }
            if (changed) schedule();
        };

        container.addEventListener('scroll', schedule, { passive: true });
        container.addEventListener('keydown', handleKeydown);
        if (typeof ResizeObserver === 'function') {
            resizeObserver = new ResizeObserver(handleResize);
            resizeObserver.observe(container);
        } else {
            globalThis.addEventListener?.('resize', schedule);
        }
        const cleanup = () => {
            if (disposed) return;
            disposed = true;
            unobserveRows();
            resizeObserver?.disconnect?.();
            container.removeEventListener('scroll', schedule);
            container.removeEventListener('keydown', handleKeydown);
            globalThis.removeEventListener?.('resize', schedule);
            if (scheduledHandle != null) {
                if (
                    scheduledWithAnimationFrame
                    && typeof cancelAnimationFrame === 'function'
                ) {
                    cancelAnimationFrame(scheduledHandle);
                } else {
                    clearTimeout(scheduledHandle);
                }
            }
            this.virtualListCleanups.delete(cleanup);
        };
        this.virtualListCleanups.add(cleanup);
        renderWindow(true);
        return {
            virtualized: true,
            metrics,
            refresh: () => renderWindow(true),
            scrollToIndex,
            cleanup,
        };
    }

    async readTimelinePage(chatId) {
        const limit = this.preferences.timelineReadLimit;
        if (typeof this.store.getTimelinePage === 'function') {
            const page = await this.store.getTimelinePage(chatId, { limit });
            const snapshots = Array.isArray(page?.snapshots) ? page.snapshots : [];
            const corruptEntryCount = Array.isArray(page?.corruptEntries)
                ? page.corruptEntries.length
                : 0;
            return {
                snapshots,
                loadedCount: snapshots.length,
                totalCount: Math.max(
                    snapshots.length,
                    Number.isFinite(page?.totalCount)
                        ? Math.trunc(page.totalCount)
                        : snapshots.length,
                ),
                corruptCount: Math.max(
                    corruptEntryCount,
                    normalizedCount(page?.corruptCount),
                ),
                limit,
            };
        }
        const timeline = await this.store.getTimeline(chatId, { limit });
        const snapshots = Array.isArray(timeline) ? timeline.slice(-limit) : [];
        return {
            snapshots,
            loadedCount: snapshots.length,
            totalCount: Array.isArray(timeline) ? timeline.length : snapshots.length,
            corruptCount: 0,
            limit,
        };
    }

    loadUiPreferences() {
        const preferences = readUiPreferencesFromStorage(localStorage);
        try {
            let current = null;
            try {
                current = JSON.parse(
                    localStorage.getItem(UI_PREFERENCES_KEY) ?? 'null',
                );
            } catch {
                current = null;
            }
            const hasLegacy = (
                localStorage.getItem(V4_UI_PREFERENCES_KEY) != null
                || localStorage.getItem(V3_UI_PREFERENCES_KEY) != null
                || localStorage.getItem(V2_UI_PREFERENCES_KEY) != null
                || localStorage.getItem(V1_UI_PREFERENCES_KEY) != null
            );
            if (!current && hasLegacy) {
                localStorage.setItem(
                    UI_PREFERENCES_KEY,
                    JSON.stringify(preferences),
                );
                localStorage.removeItem(V4_UI_PREFERENCES_KEY);
                localStorage.removeItem(V3_UI_PREFERENCES_KEY);
                localStorage.removeItem(V2_UI_PREFERENCES_KEY);
                localStorage.removeItem(V1_UI_PREFERENCES_KEY);
            }
        } catch {
            // The helper already returned the best independently parsed value.
        }
        return preferences;
    }

    loadPricingOverrides(storage = null) {
        try {
            const target = storage ?? globalThis.localStorage;
            const raw = target?.getItem(PRICING_OVERRIDES_KEY);
            if (raw == null) return emptyPricingOverrides();
            return normalizePricingOverrides(JSON.parse(raw));
        } catch {
            return emptyPricingOverrides();
        }
    }

    saveUiPreferences(value) {
        const previousPreferences = this.preferences;
        const previousPricingOverrides = this.pricingOverrides;
        const preferences = normalizeUiPreferences(value);
        const pricingOverrides = normalizePricingOverrides(
            this.pendingPricingOverrides
            ?? this.pricingOverrides
            ?? emptyPricingOverrides(),
        );
        let storage = null;
        let backup = null;
        try {
            storage = globalThis.localStorage;
            backup = new Map([
                [UI_PREFERENCES_KEY, storage.getItem(UI_PREFERENCES_KEY)],
                [V4_UI_PREFERENCES_KEY, storage.getItem(V4_UI_PREFERENCES_KEY)],
                [V3_UI_PREFERENCES_KEY, storage.getItem(V3_UI_PREFERENCES_KEY)],
                [V2_UI_PREFERENCES_KEY, storage.getItem(V2_UI_PREFERENCES_KEY)],
                [V1_UI_PREFERENCES_KEY, storage.getItem(V1_UI_PREFERENCES_KEY)],
                [PRICING_OVERRIDES_KEY, storage.getItem(PRICING_OVERRIDES_KEY)],
            ]);
            const preferencesRaw = JSON.stringify(preferences);
            const pricingOverridesRaw = JSON.stringify(pricingOverrides);
            storage.setItem(UI_PREFERENCES_KEY, preferencesRaw);
            storage.setItem(PRICING_OVERRIDES_KEY, pricingOverridesRaw);
            if (
                storage.getItem(UI_PREFERENCES_KEY) !== preferencesRaw
                || storage.getItem(PRICING_OVERRIDES_KEY) !== pricingOverridesRaw
            ) {
                throw new Error('settings-storage-write-not-observed');
            }
            storage.removeItem(V4_UI_PREFERENCES_KEY);
            storage.removeItem(V3_UI_PREFERENCES_KEY);
            storage.removeItem(V2_UI_PREFERENCES_KEY);
            storage.removeItem(V1_UI_PREFERENCES_KEY);
            if (
                storage.getItem(V4_UI_PREFERENCES_KEY) !== null
                || storage.getItem(V3_UI_PREFERENCES_KEY) !== null
                || storage.getItem(V2_UI_PREFERENCES_KEY) !== null
                || storage.getItem(V1_UI_PREFERENCES_KEY) !== null
            ) {
                throw new Error('settings-storage-remove-not-observed');
            }
            this.preferences = preferences;
            this.pricingOverrides = pricingOverrides;
            return this.preferences;
        } catch (cause) {
            if (storage && backup) {
                for (const [key, oldValue] of backup) {
                    try {
                        restoreStorageValue(storage, key, oldValue);
                    } catch {
                        // Best effort: preserve the original storage failure.
                    }
                }
            }
            this.preferences = previousPreferences;
            this.pricingOverrides = previousPricingOverrides;
            const error = new Error('settings-storage-write-failed', { cause });
            error.code = 'settings-storage-write-failed';
            throw error;
        }
    }

    semanticConnectionProfiles() {
        try {
            const result = this.semanticInspector?.connectionProfiles?.();
            if (
                result
                && ['available', 'unavailable'].includes(result.status)
                && Array.isArray(result.profiles)
            ) {
                return result;
            }
        } catch {
            // Connection profiles are optional; the current connection remains usable.
        }
        return { status: 'unavailable', profiles: [] };
    }

    populateSemanticConnectionProfiles(select, selectedId = null, status = null) {
        if (!select) return null;
        const result = this.semanticConnectionProfiles();
        const profiles = result.profiles.filter((profile) => (
            profile
            && typeof profile.id === 'string'
            && profile.id.length > 0
        ));
        select.replaceChildren();
        const current = element('option', {
            text: t('settings.semanticConnectionProfile.current'),
        });
        current.value = '';
        select.appendChild(current);
        const preservedSelectedId = result.status === 'unavailable'
            ? normalizeSemanticConnectionProfileId(selectedId)
            : null;
        if (preservedSelectedId) {
            const savedUnavailable = element('option', {
                text: t('settings.semanticConnectionProfile.savedUnavailable'),
            });
            savedUnavailable.value = preservedSelectedId;
            savedUnavailable.disabled = true;
            select.appendChild(savedUnavailable);
        }
        for (const profile of profiles) {
            const option = element('option', {
                text: typeof profile.name === 'string' && profile.name.trim()
                    ? profile.name.trim()
                    : t('settings.semanticConnectionProfile.unnamed'),
            });
            option.value = profile.id;
            select.appendChild(option);
        }
        const selectedAvailable = typeof selectedId === 'string'
            && profiles.some(({ id }) => id === selectedId);
        select.value = selectedAvailable || preservedSelectedId
            ? selectedId
            : '';
        if (status) {
            status.textContent = result.status === 'unavailable'
                ? preservedSelectedId
                    ? t('settings.semanticConnectionProfile.unavailablePreserved')
                    : t('settings.semanticConnectionProfile.unavailable')
                : profiles.length === 0
                    ? t('settings.semanticConnectionProfile.empty')
                    : t('settings.semanticConnectionProfile.privacy');
        }
        return select.value || null;
    }

    buildPricingSettingsEditor() {
        const details = element('details', {
            className: 'st-devtools-pricing-editor st-devtools-settings-field',
        });
        const summary = element('summary');
        summary.appendChild(explainedTitle(
            t('settings.pricingTitle'),
            t('settings.pricingDescription'),
        ));
        const content = element('div', {
            className: 'st-devtools-pricing-content',
        });
        const rows = element('div', { className: 'st-devtools-pricing-rows' });
        const status = element('p', {
            className: 'st-devtools-pricing-status',
        });
        status.setAttribute('aria-live', 'polite');
        const add = element('button', {
            className: 'menu_button st-devtools-pricing-add',
            text: t('settings.pricingAdd'),
            type: 'button',
        });

        const updateRowLabels = () => {
            [...rows.querySelectorAll('.st-devtools-pricing-row')]
                .forEach((row, index) => {
                    const title = row.querySelector('.st-devtools-pricing-row-title');
                    if (title) {
                        title.textContent = t('settings.pricingEntry', {
                            number: index + 1,
                        });
                    }
                });
            add.disabled = rows.children.length >= MAX_PRICING_OVERRIDES;
        };
        const clearStatus = () => {
            status.textContent = '';
            status.classList.remove('is-error');
            status.removeAttribute('role');
        };
        const setError = (message) => {
            status.textContent = message;
            status.classList.add('is-error');
            status.setAttribute('role', 'alert');
        };
        const pricingField = (labelKey, field, value = '') => {
            const wrapper = element('label', {
                className: 'st-devtools-pricing-field',
            });
            const label = element('span', { text: t(labelKey) });
            const input = element('input');
            input.dataset.pricingField = field;
            input.value = value == null ? '' : String(value);
            if (PRICING_RATE_FIELDS.includes(field)) {
                input.type = 'number';
                input.min = '0';
                input.max = String(MAX_PRICE_PER_MILLION);
                input.step = 'any';
                input.inputMode = 'decimal';
            } else if (field === 'priceAsOf') {
                input.type = 'date';
            } else {
                input.type = 'text';
                input.maxLength = field === 'model'
                    ? 128
                    : field === 'currency'
                        ? 3
                        : 64;
                input.autocomplete = 'off';
                input.spellcheck = false;
            }
            wrapper.append(label, input);
            return wrapper;
        };
        const appendRow = (entry = {}) => {
            if (rows.children.length >= MAX_PRICING_OVERRIDES) {
                setError(t('settings.pricingLimit', {
                    count: MAX_PRICING_OVERRIDES,
                }));
                return null;
            }
            const row = element('section', {
                className: 'st-devtools-pricing-row',
            });
            const heading = element('div', {
                className: 'st-devtools-pricing-row-heading',
            });
            const rowTitle = element('strong', {
                className: 'st-devtools-pricing-row-title',
            });
            const remove = element('button', {
                className: 'menu_button st-devtools-pricing-remove',
                text: t('settings.pricingDelete'),
                type: 'button',
            });
            remove.addEventListener('click', () => {
                row.remove();
                clearStatus();
                updateRowLabels();
            });
            heading.append(rowTitle, remove);
            const fields = element('div', {
                className: 'st-devtools-pricing-fields',
            });
            fields.append(
                pricingField('settings.pricingProvider', 'provider', entry.provider),
                pricingField('settings.pricingModel', 'model', entry.model),
                pricingField('settings.pricingCurrency', 'currency', entry.currency),
                pricingField(
                    'settings.pricingInputRate',
                    'inputPerMillion',
                    entry.inputPerMillion,
                ),
                pricingField(
                    'settings.pricingOutputRate',
                    'outputPerMillion',
                    entry.outputPerMillion,
                ),
                pricingField(
                    'settings.pricingCacheRate',
                    'cachedInputPerMillion',
                    entry.cachedInputPerMillion,
                ),
                pricingField(
                    'settings.pricingAsOf',
                    'priceAsOf',
                    entry.priceAsOf,
                ),
            );
            row.append(heading, fields);
            rows.appendChild(row);
            updateRowLabels();
            return row;
        };
        const resetEntries = (entries = []) => {
            rows.replaceChildren();
            clearStatus();
            for (const entry of entries) appendRow(entry);
            updateRowLabels();
        };
        const readEntries = () => {
            const entries = [];
            for (const row of rows.querySelectorAll('.st-devtools-pricing-row')) {
                const values = Object.fromEntries(
                    [...row.querySelectorAll('[data-pricing-field]')]
                        .map((input) => [
                            input.dataset.pricingField,
                            String(input.value ?? '').trim(),
                        ]),
                );
                if (Object.values(values).every((value) => value === '')) continue;
                const entry = {
                    provider: values.provider,
                    model: values.model,
                    currency: values.currency,
                    priceAsOf: values.priceAsOf,
                };
                for (const field of PRICING_RATE_FIELDS) {
                    if (values[field] !== '') entry[field] = Number(values[field]);
                }
                entries.push(entry);
            }
            return normalizePricingOverrides({
                version: PRICING_OVERRIDE_SCHEMA_VERSION,
                entries,
            });
        };

        add.addEventListener('click', () => {
            clearStatus();
            const row = appendRow();
            row?.querySelector('[data-pricing-field="provider"]')?.focus();
        });
        content.addEventListener('input', clearStatus);
        content.append(
            proseElement('p', t('settings.pricingHint')),
            rows,
            add,
            status,
        );
        details.append(summary, content);
        resetEntries(this.pricingOverrides.entries);
        return {
            details,
            readEntries,
            resetEntries,
            setError,
        };
    }

    buildSettingsPanel() {
        const overlay = element('div', { className: 'st-devtools-settings-overlay' });
        overlay.hidden = true;
        overlay.addEventListener('pointerdown', (event) => {
            if (event.target === overlay) this.closeSettings();
        });

        const panel = element('section', { className: 'st-devtools-settings-panel' });
        panel.tabIndex = -1;
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.setAttribute('aria-labelledby', 'st-devtools-settings-title');

        const heading = element('div', { className: 'st-devtools-settings-header' });
        const titleGroup = element('div');
        const title = element('h2', {
            text: t('settings.title'),
        });
        title.id = 'st-devtools-settings-title';
        titleGroup.append(
            title,
            proseElement('p', t('settings.description')),
        );
        const close = element('button', {
            className: 'menu_button st-devtools-icon-button st-devtools-settings-close',
            title: t('action.close'),
            type: 'button',
        });
        close.setAttribute('aria-label', t('action.close'));
        close.appendChild(closeIcon());
        close.addEventListener('click', () => this.closeSettings());
        heading.append(titleGroup, close);

        const form = element('form', { className: 'st-devtools-settings-form' });
        const themeField = element('div', { className: 'st-devtools-settings-field' });
        const themeLabel = element('label');
        themeLabel.htmlFor = 'st-devtools-settings-theme';
        themeLabel.appendChild(element('strong', { text: t('settings.themeMode') }));
        const themeDescription = proseElement(
            'span',
            t('settings.themeModeDescription'),
            { className: 'st-devtools-settings-description' },
        );
        themeDescription.id = 'st-devtools-settings-theme-description';
        const themeSelect = element('select');
        themeSelect.id = 'st-devtools-settings-theme';
        themeSelect.setAttribute('aria-describedby', themeDescription.id);
        for (const mode of PANEL_THEME_MODES) {
            const option = element('option', {
                text: t(`settings.themeMode.${mode}`),
            });
            option.value = mode;
            themeSelect.appendChild(option);
        }
        themeSelect.value = this.preferences.themeMode;
        themeField.append(themeLabel, themeDescription, themeSelect);

        const retentionField = element('div', { className: 'st-devtools-settings-field' });
        const retentionLabel = element('label');
        retentionLabel.htmlFor = 'st-devtools-settings-retention-limit';
        retentionLabel.appendChild(element('strong', {
            text: t('settings.timelineRetentionLimit'),
        }));
        const retentionDescription = proseElement(
            'span',
            t('settings.timelineRetentionLimitDescription'),
            { className: 'st-devtools-settings-description' },
        );
        retentionDescription.id = 'st-devtools-settings-retention-limit-description';
        const retentionInput = element('input');
        retentionInput.id = 'st-devtools-settings-retention-limit';
        retentionInput.type = 'number';
        retentionInput.min = String(MIN_TIMELINE_RETENTION_LIMIT);
        retentionInput.max = String(MAX_TIMELINE_RETENTION_LIMIT);
        retentionInput.step = '1';
        retentionInput.inputMode = 'numeric';
        retentionInput.required = true;
        retentionInput.value = String(this.preferences.timelineRetentionLimit);
        retentionInput.setAttribute(
            'aria-describedby',
            'st-devtools-settings-retention-limit-description ' +
            'st-devtools-settings-retention-limit-hint',
        );
        const retentionHint = proseElement(
            'small',
            t('settings.timelineRetentionLimitHint', {
                min: MIN_TIMELINE_RETENTION_LIMIT,
                max: MAX_TIMELINE_RETENTION_LIMIT,
            }),
        );
        retentionHint.id = 'st-devtools-settings-retention-limit-hint';
        retentionField.append(
            retentionLabel,
            retentionDescription,
            retentionInput,
            retentionHint,
        );

        const ageField = element('div', { className: 'st-devtools-settings-field' });
        const ageInput = element('input');
        ageInput.id = 'st-devtools-settings-retention-age';
        ageInput.type = 'number';
        ageInput.min = '0';
        ageInput.max = String(MAX_RETENTION_MAX_AGE_DAYS);
        ageInput.step = '1';
        ageInput.inputMode = 'numeric';
        ageInput.required = true;
        ageInput.value = String(this.preferences.retentionMaxAgeDays);
        const ageLabel = element('label');
        ageLabel.htmlFor = ageInput.id;
        ageLabel.append(explainedTitle(
            t('settings.retentionMaxAgeDays'),
            t('settings.retentionMaxAgeDaysDescription'),
        ));
        ageField.append(
            ageLabel,
            ageInput,
            element('small', { text: t('settings.zeroDisablesPolicy') }),
        );

        const byteField = element('div', { className: 'st-devtools-settings-field' });
        const byteInput = element('input');
        byteInput.id = 'st-devtools-settings-retention-bytes';
        byteInput.type = 'number';
        byteInput.min = '0';
        byteInput.max = String(MAX_RETENTION_MIB);
        byteInput.step = '1';
        byteInput.inputMode = 'numeric';
        byteInput.required = true;
        byteInput.value = String(Math.floor(
            this.preferences.retentionMaxBytes / MEBIBYTE,
        ));
        const byteLabel = element('label');
        byteLabel.htmlFor = byteInput.id;
        byteLabel.append(explainedTitle(
            t('settings.retentionMaxBytes'),
            t('settings.retentionMaxBytesDescription'),
        ));
        byteField.append(
            byteLabel,
            byteInput,
            element('small', { text: t('settings.zeroDisablesPolicy') }),
        );

        const captureField = element('div', { className: 'st-devtools-settings-field' });
        const captureSelect = element('select');
        captureSelect.id = 'st-devtools-settings-capture-mode';
        for (const mode of SNAPSHOT_CAPTURE_MODES) {
            const option = element('option', {
                text: t(`settings.captureMode.${mode}`),
            });
            option.value = mode;
            captureSelect.appendChild(option);
        }
        captureSelect.value = this.preferences.captureMode;
        const captureLabel = element('label');
        captureLabel.htmlFor = captureSelect.id;
        captureLabel.append(explainedTitle(
            t('settings.captureMode'),
            t('settings.captureModeDescription'),
        ));
        captureField.append(
            captureLabel,
            captureSelect,
            element('small', {
                className: 'st-devtools-settings-privacy-note',
                text: t('settings.captureModeRedactedWarning'),
            }),
        );

        const semanticField = element('div', {
            className: 'st-devtools-settings-field st-devtools-semantic-settings',
        });
        semanticField.appendChild(explainedTitle(
            t('settings.semanticTitle'),
            t('settings.semanticDescription'),
        ));
        const semanticToggleLabel = element('label', {
            className: 'st-devtools-semantic-toggle',
        });
        const semanticToggle = element('input');
        semanticToggle.type = 'checkbox';
        semanticToggle.checked = this.preferences.semanticInspectorEnabled;
        semanticToggleLabel.append(
            semanticToggle,
            element('span', { text: t('settings.semanticEnabled') }),
        );
        const semanticProfileLabel = element('label', {
            className: 'st-devtools-semantic-profile',
        });
        semanticProfileLabel.appendChild(explainedTitle(
            t('settings.semanticConnectionProfile'),
            t('settings.semanticConnectionProfileDescription'),
        ));
        const semanticProfileSelect = element('select');
        semanticProfileSelect.id = 'st-devtools-settings-semantic-profile';
        semanticProfileSelect.setAttribute(
            'aria-label',
            t('settings.semanticConnectionProfile'),
        );
        const semanticProfileStatus = proseElement('small', '', {
            className: 'st-devtools-semantic-profile-status',
        });
        semanticProfileLabel.appendChild(semanticProfileSelect);
        this.populateSemanticConnectionProfiles(
            semanticProfileSelect,
            this.preferences.semanticConnectionProfileId,
            semanticProfileStatus,
        );
        const semanticCapLabel = element('label', {
            className: 'st-devtools-semantic-cap',
        });
        semanticCapLabel.appendChild(element('span', {
            text: t('settings.semanticResponseCap'),
        }));
        const semanticCapInput = element('input');
        semanticCapInput.type = 'number';
        semanticCapInput.min = String(MIN_SEMANTIC_RESPONSE_TOKEN_CAP);
        semanticCapInput.max = String(MAX_SEMANTIC_RESPONSE_TOKEN_CAP);
        semanticCapInput.step = '1';
        semanticCapInput.inputMode = 'numeric';
        semanticCapInput.required = true;
        semanticCapInput.value = String(
            this.preferences.semanticResponseTokenCap,
        );
        semanticCapLabel.appendChild(semanticCapInput);
        const semanticCapHint = proseElement('small', t(
            'settings.semanticResponseCapHint',
            {
                min: MIN_SEMANTIC_RESPONSE_TOKEN_CAP,
                max: MAX_SEMANTIC_RESPONSE_TOKEN_CAP,
            },
        ));
        const syncSemanticSettings = () => {
            semanticProfileSelect.disabled = !semanticToggle.checked;
            semanticCapInput.disabled = !semanticToggle.checked;
            semanticProfileLabel.classList.toggle(
                'is-disabled',
                semanticProfileSelect.disabled,
            );
            semanticCapLabel.classList.toggle(
                'is-disabled',
                semanticCapInput.disabled,
            );
        };
        semanticToggle.addEventListener('change', syncSemanticSettings);
        syncSemanticSettings();
        semanticField.append(
            semanticToggleLabel,
            semanticProfileLabel,
            semanticProfileStatus,
            semanticCapLabel,
            semanticCapHint,
            proseElement('small', t('settings.semanticPrivacyWarning'), {
                className: 'st-devtools-settings-privacy-note',
            }),
        );

        const readField = element('div', { className: 'st-devtools-settings-field' });
        const readLabel = element('label');
        readLabel.htmlFor = 'st-devtools-settings-timeline-limit';
        readLabel.appendChild(element('strong', { text: t('settings.timelineReadLimit') }));
        const readDescription = proseElement(
            'span',
            t('settings.timelineReadLimitDescription'),
            { className: 'st-devtools-settings-description' },
        );
        readDescription.id = 'st-devtools-settings-timeline-limit-description';
        const readInput = element('input');
        readInput.id = 'st-devtools-settings-timeline-limit';
        readInput.type = 'number';
        readInput.min = String(MIN_TIMELINE_READ_LIMIT);
        readInput.max = String(this.preferences.timelineRetentionLimit);
        readInput.step = '1';
        readInput.inputMode = 'numeric';
        readInput.required = true;
        readInput.value = String(this.preferences.timelineReadLimit);
        readInput.setAttribute(
            'aria-describedby',
            'st-devtools-settings-timeline-limit-description ' +
            'st-devtools-settings-timeline-limit-hint',
        );
        const readHint = proseElement('small');
        readHint.id = 'st-devtools-settings-timeline-limit-hint';
        readField.append(readLabel, readDescription, readInput, readHint);

        const syncReadLimit = () => {
            const retentionLimit = normalizeUiPreferences({
                timelineRetentionLimit: retentionInput.value,
                timelineReadLimit: readInput.value,
            }).timelineRetentionLimit;
            readInput.max = String(Math.min(MAX_TIMELINE_READ_LIMIT, retentionLimit));
            if (Number(readInput.value) > retentionLimit) {
                readInput.value = String(retentionLimit);
            }
            readHint.textContent = t('settings.timelineReadLimitHint', {
                min: MIN_TIMELINE_READ_LIMIT,
                max: retentionLimit,
            });
        };
        retentionInput.addEventListener('input', syncReadLimit);
        readInput.addEventListener('input', syncReadLimit);
        syncReadLimit();

        const pricingEditor = this.buildPricingSettingsEditor();
        const actions = element('div', { className: 'st-devtools-settings-actions' });
        const reset = element('button', {
            className: 'menu_button',
            text: t('action.resetSettings'),
            type: 'button',
        });
        reset.addEventListener('click', () => {
            themeSelect.value = DEFAULT_UI_PREFERENCES.themeMode;
            retentionInput.value = String(DEFAULT_UI_PREFERENCES.timelineRetentionLimit);
            readInput.value = String(DEFAULT_UI_PREFERENCES.timelineReadLimit);
            ageInput.value = String(DEFAULT_UI_PREFERENCES.retentionMaxAgeDays);
            byteInput.value = String(
                DEFAULT_UI_PREFERENCES.retentionMaxBytes / MEBIBYTE,
            );
            captureSelect.value = DEFAULT_UI_PREFERENCES.captureMode;
            semanticToggle.checked = DEFAULT_UI_PREFERENCES.semanticInspectorEnabled;
            this.populateSemanticConnectionProfiles(
                semanticProfileSelect,
                DEFAULT_UI_PREFERENCES.semanticConnectionProfileId,
                semanticProfileStatus,
            );
            semanticCapInput.value = String(
                DEFAULT_UI_PREFERENCES.semanticResponseTokenCap,
            );
            syncSemanticSettings();
            pricingEditor.resetEntries([]);
            syncReadLimit();
        });
        const cancel = element('button', {
            className: 'menu_button',
            text: t('action.cancel'),
            type: 'button',
        });
        cancel.addEventListener('click', () => this.closeSettings());
        const apply = element('button', {
            className: 'menu_button st-devtools-primary-button',
            text: t('action.applySettings'),
            type: 'submit',
        });
        actions.append(reset, cancel, apply);
        const settingsGroup = (
            labelKey,
            fields,
            { collapsible = false, open = false } = {},
        ) => {
            const content = element('div', {
                className: 'st-devtools-settings-group-content',
            });
            content.append(...fields);
            if (!collapsible) {
                const section = element('section', {
                    className: 'st-devtools-settings-section',
                });
                section.append(
                    element('h3', { text: t(labelKey) }),
                    content,
                );
                return section;
            }
            const details = element('details', {
                className: 'st-devtools-settings-group st-devtools-disclosure',
            });
            details.open = open;
            details.appendChild(element('summary', { text: t(labelKey) }));
            details.appendChild(content);
            return details;
        };
        form.append(
            settingsGroup('settings.group.basic', [themeField]),
            settingsGroup(
                'settings.group.snapshots',
                [retentionField, readField, captureField],
            ),
            settingsGroup(
                'settings.group.advanced',
                [ageField, byteField, semanticField, pricingEditor.details],
                { collapsible: true },
            ),
            actions,
        );
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (apply.disabled) return;
            const applyLabel = apply.textContent;
            apply.disabled = true;
            apply.textContent = t('settings.applying');
            apply.setAttribute('aria-busy', 'true');
            const previousPreferences = this.preferences;
            const requested = normalizeUiPreferences({
                themeMode: themeSelect.value,
                timelineRetentionLimit: retentionInput.value,
                timelineReadLimit: readInput.value,
                retentionMaxAgeDays: ageInput.value,
                retentionMaxBytes: Number(byteInput.value) * MEBIBYTE,
                captureMode: captureSelect.value,
                semanticInspectorEnabled: semanticToggle.checked,
                semanticConnectionProfileId: semanticProfileSelect.value || null,
                semanticResponseTokenCap: semanticCapInput.value,
            });
            const retentionPolicy = {
                maxSnapshotsPerChat: requested.timelineRetentionLimit,
                maxAgeDays: requested.retentionMaxAgeDays,
                maxTotalBytes: requested.retentionMaxBytes,
            };
            const retentionPolicyChanged = (
                requested.timelineRetentionLimit
                    !== previousPreferences.timelineRetentionLimit
                || requested.retentionMaxAgeDays
                    !== previousPreferences.retentionMaxAgeDays
                || requested.retentionMaxBytes
                    !== previousPreferences.retentionMaxBytes
            );
            const timelineSettingsChanged = (
                retentionPolicyChanged
                || requested.timelineReadLimit !== previousPreferences.timelineReadLimit
            );
            const semanticSettingsChanged = (
                requested.semanticInspectorEnabled
                    !== previousPreferences.semanticInspectorEnabled
                || requested.semanticConnectionProfileId
                    !== previousPreferences.semanticConnectionProfileId
                || requested.semanticResponseTokenCap
                    !== previousPreferences.semanticResponseTokenCap
            );
            try {
                let requestedPricingOverrides;
                try {
                    requestedPricingOverrides = pricingEditor.readEntries();
                } catch (error) {
                    pricingEditor.setError(t('settings.pricingInvalid'));
                    throw error;
                }
                let pruneResult = {
                    snapshotCount: 0,
                    affectedChatCount: 0,
                    approximateBytes: 0,
                };
                if (
                    retentionPolicyChanged
                    && typeof this.store.getRetentionPolicyPreview === 'function'
                    && typeof this.store.applyRetentionPolicy === 'function'
                ) {
                    let applied = false;
                    for (let attempt = 0; attempt < 3; attempt += 1) {
                        const preview = await this.store.getRetentionPolicyPreview(
                            retentionPolicy,
                            { metadataLimit: STORAGE_TOOL_METADATA_LIMIT },
                        );
                        const deleteCount = normalizedCount(
                            preview.deleteCount ?? preview.snapshotCount,
                        );
                        const overBudget = Boolean(preview.overBudget);
                        if (
                            (deleteCount > 0 || overBudget)
                            && !confirm(t('settings.retentionPolicyConfirm', {
                                chats: normalizedCount(
                                    preview.affectedChats
                                    ?? preview.affectedChatCount,
                                ),
                                count: deleteCount,
                                size: formatBytes(
                                    preview.deleteBytes
                                    ?? preview.approximateBytes,
                                ),
                                overBudget: this.retentionOverBudgetText(preview),
                            }))
                        ) {
                            return;
                        }
                        try {
                            pruneResult = await this.store.applyRetentionPolicy(
                                retentionPolicy,
                                { expectedRevision: preview.revision },
                            );
                            applied = true;
                            break;
                        } catch (error) {
                            if (error?.code === 'retention-preview-stale') continue;
                            throw error;
                        }
                    }
                    if (!applied) {
                        const error = new Error('retention-preview-unstable');
                        error.code = 'retention-preview-unstable';
                        throw error;
                    }
                } else if (
                    retentionPolicyChanged
                    && typeof this.store.applyRetentionLimit === 'function'
                ) {
                    if (typeof this.store.getRetentionPrunePreview === 'function') {
                        const preview = await this.store.getRetentionPrunePreview(
                            requested.timelineRetentionLimit,
                        );
                        if (
                            normalizedCount(preview.snapshotCount) > 0
                            && !confirm(t('settings.timelineRetentionDecreaseConfirm', {
                                limit: requested.timelineRetentionLimit,
                                chats: normalizedCount(preview.affectedChatCount),
                                count: normalizedCount(preview.snapshotCount),
                                size: formatBytes(preview.approximateBytes),
                            }))
                        ) {
                            return;
                        }
                        pruneResult = await this.store.applyRetentionLimit(
                            requested.timelineRetentionLimit,
                            { expectedRevision: preview.revision },
                        );
                    } else {
                        pruneResult = await this.store.applyRetentionLimit(
                            requested.timelineRetentionLimit,
                        );
                    }
                } else if (retentionPolicyChanged) {
                    this.store.setMaxSnapshotsPerChat?.(
                        requested.timelineRetentionLimit,
                    );
                }
                if (retentionPolicyChanged) {
                    this.storageSummaryGeneration += 1;
                    this.storageSummaryRebuildScheduled = false;
                    this.storageSummaryRefreshPromise = null;
                }
                this.pendingPricingOverrides = requestedPricingOverrides;
                const preferences = this.saveUiPreferences(requested);
                this.pendingPricingOverrides = null;
                themeSelect.value = preferences.themeMode;
                retentionInput.value = String(preferences.timelineRetentionLimit);
                readInput.value = String(preferences.timelineReadLimit);
                ageInput.value = String(preferences.retentionMaxAgeDays);
                byteInput.value = String(Math.floor(
                    preferences.retentionMaxBytes / MEBIBYTE,
                ));
                captureSelect.value = preferences.captureMode;
                semanticToggle.checked = preferences.semanticInspectorEnabled;
                this.populateSemanticConnectionProfiles(
                    semanticProfileSelect,
                    preferences.semanticConnectionProfileId,
                    semanticProfileStatus,
                );
                semanticCapInput.value = String(
                    preferences.semanticResponseTokenCap,
                );
                syncSemanticSettings();
                if (semanticSettingsChanged) {
                    this.resetSemanticInspectionForSettingsChange(preferences);
                }
                pricingEditor.resetEntries(this.pricingOverrides.entries);
                syncReadLimit();
                this.syncOpaqueTheme();
                this.closeSettings();
                const deletedCount = normalizedCount(
                    pruneResult.deleteCount ?? pruneResult.snapshotCount,
                );
                const overBudget = Boolean(pruneResult.overBudget);
                const savedMessage = overBudget
                    ? t('settings.savedOverBudget', {
                        count: deletedCount,
                        size: formatBytes(pruneResult.overBudgetBytes),
                    })
                    : deletedCount > 0
                        ? t('settings.savedWithPrune', { count: deletedCount })
                        : t('settings.saved');
                const toastKind = overBudget
                    && typeof globalThis.toastr?.warning === 'function'
                    ? 'warning'
                    : 'success';
                globalThis.toastr?.[toastKind]?.(
                    savedMessage,
                    'ST DevTools',
                );
                if (timelineSettingsChanged) this.scheduleSettingsRefresh();
                else if (semanticSettingsChanged) this.render();
            } catch (error) {
                this.pendingPricingOverrides = null;
                console.error('[ST DevTools] Failed to apply storage settings.', error);
                if (error?.code === 'settings-storage-write-failed') {
                    pricingEditor.setError(t('settings.pricingSaveFailed'));
                }
                globalThis.toastr?.error?.(
                    t('settings.saveFailed'),
                    'ST DevTools',
                );
            } finally {
                apply.disabled = false;
                apply.textContent = applyLabel;
                apply.removeAttribute('aria-busy');
            }
        });

        panel.append(heading, form, this.buildStorageToolsPanel());
        overlay.appendChild(panel);
        this.settingsOverlay = overlay;
        this.settingsPanel = panel;
        this.themeModeInput = themeSelect;
        this.timelineRetentionLimitInput = retentionInput;
        this.timelineReadLimitInput = readInput;
        this.retentionMaxAgeDaysInput = ageInput;
        this.retentionMaxBytesMiBInput = byteInput;
        this.captureModeInput = captureSelect;
        this.semanticInspectorEnabledInput = semanticToggle;
        this.semanticConnectionProfileInput = semanticProfileSelect;
        this.semanticConnectionProfileStatus = semanticProfileStatus;
        this.semanticResponseTokenCapInput = semanticCapInput;
        this.resetPricingEditor = () => {
            pricingEditor.details.open = false;
            pricingEditor.resetEntries(this.pricingOverrides.entries);
        };
        return overlay;
    }

    setStorageToolsStatus(message, { error = false } = {}) {
        if (!this.storageToolsStatus) return;
        this.storageToolsStatus.textContent = String(message ?? '');
        this.storageToolsStatus.classList.toggle('error', error);
        this.storageToolsStatus.setAttribute('role', error ? 'alert' : 'status');
    }

    safeToolError(error) {
        const code = String(error?.code ?? '');
        return /^[a-z0-9-]{1,64}$/u.test(code)
            ? code
            : t('common.unknown');
    }

    retentionOverBudgetText(report) {
        if (!report?.overBudget) return '';
        return t('settings.retentionOverBudget', {
            size: formatBytes(report.overBudgetBytes),
        });
    }

    storageIntegrityStatusVariables(report) {
        const counts = report?.counts ?? {};
        return {
            missing: normalizedCount(counts.missingRecords),
            corrupt: normalizedCount(counts.corruptRecords),
            orphan: normalizedCount(counts.validOrphans),
            indexes: normalizedCount(counts.invalidIndexes),
            duplicateLegacy: normalizedCount(counts.duplicateLegacyContainers),
            conflictingLegacy: normalizedCount(counts.conflictingLegacyContainers),
            indexRepair: t(report?.indexRepairNeeded
                ? 'storage.integrityNeeded'
                : 'storage.integrityNotNeeded'),
            summaryRepair: t(report?.summaryRepairNeeded
                ? 'storage.integrityNeeded'
                : 'storage.integrityNotNeeded'),
        };
    }

    async withBusyButton(button, task) {
        if (button.disabled) return null;
        const label = button.textContent;
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        try {
            return await task();
        } finally {
            button.disabled = false;
            button.textContent = label;
            button.removeAttribute('aria-busy');
        }
    }

    async storedTimelinesForTransfer() {
        const reader = this.store.getAllStoredTimelines
            ?? this.store.getAllTimelines;
        if (typeof reader !== 'function') {
            const error = new Error('unsupported-store');
            error.code = 'unsupported-store';
            throw error;
        }
        const timelines = await reader.call(this.store);
        return Array.isArray(timelines) ? timelines : [];
    }

    async reviewStorageIntegrity() {
        if (
            typeof this.store.inspectStorageIntegrity !== 'function'
            || typeof this.store.repairStorageIntegrity !== 'function'
        ) {
            throw Object.assign(new Error('unsupported-store'), {
                code: 'unsupported-store',
            });
        }
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const preview = await this.store.inspectStorageIntegrity({
                metadataLimit: STORAGE_TOOL_METADATA_LIMIT,
            });
            const status = this.storageIntegrityStatusVariables(preview);
            this.setStorageToolsStatus(t('storage.integrityPreview', status));
            if (!preview.repairNeeded) {
                this.setStorageToolsStatus(t('storage.integrityHealthy', status));
                return preview;
            }
            if (!confirm(t('storage.integrityRepairConfirm', status))) {
                return null;
            }
            try {
                const result = await this.store.repairStorageIntegrity({
                    expectedRevision: preview.revision,
                    metadataLimit: STORAGE_TOOL_METADATA_LIMIT,
                });
                this.setStorageToolsStatus(t(
                    'storage.integrityRepaired',
                    this.storageIntegrityStatusVariables(result),
                ));
                void this.refreshStorageSummary();
                return result;
            } catch (error) {
                if (error?.code === 'integrity-preview-stale') continue;
                throw error;
            }
        }
        throw Object.assign(new Error('integrity-preview-unstable'), {
            code: 'integrity-preview-unstable',
        });
    }

    async exportFullSnapshotArchive() {
        if (!confirm(t('storage.archiveFullConfirm'))) return null;
        const timelines = await this.storedTimelinesForTransfer();
        const serialized = await serializeSnapshotArchive({
            timelines,
            mode: 'full',
            extensionVersion: this.version,
        });
        downloadText(
            'st-devtools-full-backup.json',
            serialized,
            'application/json;charset=utf-8',
        );
        this.setStorageToolsStatus(t('storage.archiveExported', {
            count: timelines.reduce(
                (total, item) => total + (item.timeline?.length ?? 0),
                0,
            ),
        }));
        return serialized;
    }

    async exportSafeSnapshotShare(mode) {
        const timelines = await this.storedTimelinesForTransfer();
        const snapshots = timelines.flatMap(({ timeline }) => timeline ?? []);
        if (
            mode === 'redacted'
            && snapshots.some((snapshot) => snapshot?.privacy?.mode === 'metadata')
        ) {
            throw Object.assign(new Error('share-requires-metadata'), {
                code: 'share-requires-metadata',
            });
        }
        const documentValue = await createSnapshotShareDocument({
            snapshots,
            mode,
            extensionVersion: this.version,
        });
        const preview = snapshotSharePreview(documentValue);
        if (!confirm(t('storage.sharePreviewConfirm', {
            mode: t(`settings.captureMode.${preview.mode}`),
            snapshots: normalizedCount(preview.snapshotCount),
            sources: normalizedCount(preview.sourceCount),
        }))) {
            return null;
        }
        downloadText(
            `st-devtools-safe-share-${mode}.json`,
            JSON.stringify(documentValue, null, 2),
            'application/json;charset=utf-8',
        );
        this.setStorageToolsStatus(t('storage.shareExported', {
            count: normalizedCount(preview.snapshotCount),
        }));
        return preview;
    }

    async reportArchiveImportRetention(result) {
        let preview = null;
        if (typeof this.store.getRetentionPolicyPreview === 'function') {
            try {
                preview = await this.store.getRetentionPolicyPreview({
                    maxSnapshotsPerChat: this.preferences.timelineRetentionLimit,
                    maxAgeDays: this.preferences.retentionMaxAgeDays,
                    maxTotalBytes: this.preferences.retentionMaxBytes,
                }, { metadataLimit: STORAGE_TOOL_METADATA_LIMIT });
            } catch {
                // Import already succeeded. A best-effort policy warning must not
                // turn a verified archive import into a reported failure.
                preview = null;
            }
        }
        const deleteCount = normalizedCount(
            preview?.deleteCount ?? preview?.snapshotCount,
        );
        if (deleteCount > 0 || preview?.overBudget) {
            this.setStorageToolsStatus(t('storage.archiveImportedRetentionWarning', {
                count: normalizedCount(result?.appliedCount),
                deleteCount,
                deleteSize: formatBytes(
                    preview?.deleteBytes ?? preview?.approximateBytes,
                ),
                overBudget: preview?.overBudget
                    ? t('storage.archiveRetentionOverBudget', {
                        size: formatBytes(preview.overBudgetBytes),
                    })
                    : '',
            }));
        } else {
            this.setStorageToolsStatus(t('storage.archiveImported', {
                count: normalizedCount(result?.appliedCount),
            }));
        }
        return preview;
    }

    async importSnapshotArchive(file, {
        strategy = 'merge',
        conflictPolicy = 'keep-both',
    } = {}) {
        const input = await file.text();
        const current = await this.storedTimelinesForTransfer();
        let confirmationToken = null;
        if (strategy === 'replace') {
            const expected = await snapshotArchiveReplaceConfirmationToken(input);
            const entered = globalThis.prompt?.(
                t('storage.archiveReplaceTokenPrompt', { token: expected }),
                '',
            );
            if (entered !== expected) {
                this.setStorageToolsStatus(t('storage.archiveReplaceCancelled'));
                return null;
            }
            confirmationToken = entered;
        }
        const plan = await prepareSnapshotArchiveImport(input, current, {
            strategy,
            conflictPolicy,
            confirmationToken,
        });
        if (!confirm(t('storage.archiveImportConfirm', {
            add: normalizedCount(plan.summary?.addCount),
            skip: normalizedCount(plan.summary?.skipCount),
            conflicts: normalizedCount(plan.summary?.conflictCount),
            projected: normalizedCount(plan.summary?.projectedSnapshotCount),
        }))) {
            return null;
        }
        const result = await executeSnapshotArchiveImport(this.store, plan);
        if (!result.ok) {
            throw Object.assign(new Error(result.code), { code: result.code });
        }
        await this.refresh();
        void this.refreshStorageSummary();
        await this.reportArchiveImportRetention(result);
        return result;
    }

    async compareDiagnosticFiles(files) {
        if (files.length !== 2) {
            throw Object.assign(new Error('two-files-required'), {
                code: 'two-files-required',
            });
        }
        const [before, after] = await Promise.all(files.map(async (file) => (
            JSON.parse(await file.text())
        )));
        const comparison = compareDiagnosticReports(before, after);
        const countMapChanges = Object.values(
            comparison.summary?.countMaps ?? {},
        ).reduce((total, items) => total + items.length, 0);
        const summaryChangeCount = (
            (comparison.summary?.scalars?.length ?? 0)
            + (comparison.summary?.tokens?.length ?? 0)
            + countMapChanges
        );
        this.setStorageToolsStatus(t('diagnostic.compareSummary', {
            compatibility: comparison.compatible
                ? t('diagnostic.compatible')
                : t('diagnostic.incompatible'),
            summary: summaryChangeCount,
            added: normalizedCount(comparison.snapshots?.addedCount),
            removed: normalizedCount(comparison.snapshots?.removedCount),
            changed: normalizedCount(comparison.snapshots?.changedCount),
        }));
        return comparison;
    }

    buildStorageToolsPanel() {
        const tools = element('details', {
            className: 'st-devtools-settings-tools st-devtools-disclosure',
        });
        const heading = element('summary');
        heading.append(explainedTitle(
            t('storage.toolsTitle'),
            t('storage.toolsDescription'),
        ));
        const status = element('p', {
            className: 'st-devtools-settings-tool-status',
        });
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        this.storageToolsStatus = status;
        const tool = (titleKey, descriptionKey, controls) => {
            const details = element('details', {
                className: 'st-devtools-settings-tool',
            });
            const summary = element('summary');
            summary.append(explainedTitle(t(titleKey), t(descriptionKey)));
            const body = element('div', {
                className: 'st-devtools-settings-tool-controls',
            });
            body.append(...controls);
            details.append(summary, body);
            return details;
        };

        const integrity = element('button', {
            className: 'menu_button',
            text: t('storage.integrityAction'),
            type: 'button',
        });
        integrity.addEventListener('click', () => {
            void this.withBusyButton(integrity, async () => {
                try {
                    await this.reviewStorageIntegrity();
                } catch (error) {
                    this.setStorageToolsStatus(t('storage.toolFailed', {
                        code: this.safeToolError(error),
                    }), { error: true });
                }
            });
        });

        const backup = element('button', {
            className: 'menu_button',
            text: t('storage.archiveFullAction'),
            type: 'button',
        });
        backup.addEventListener('click', () => {
            void this.withBusyButton(backup, async () => {
                try {
                    await this.exportFullSnapshotArchive();
                } catch (error) {
                    this.setStorageToolsStatus(t('storage.toolFailed', {
                        code: this.safeToolError(error),
                    }), { error: true });
                }
            });
        });

        const shareMode = element('select');
        shareMode.setAttribute('aria-label', t('storage.shareMode'));
        for (const mode of ['redacted', 'metadata']) {
            const option = element('option', {
                text: t(`settings.captureMode.${mode}`),
            });
            option.value = mode;
            shareMode.appendChild(option);
        }
        shareMode.value = 'metadata';
        const share = element('button', {
            className: 'menu_button',
            text: t('storage.shareAction'),
            type: 'button',
        });
        share.addEventListener('click', () => {
            void this.withBusyButton(share, async () => {
                try {
                    await this.exportSafeSnapshotShare(shareMode.value);
                } catch (error) {
                    this.setStorageToolsStatus(t('storage.toolFailed', {
                        code: this.safeToolError(error),
                    }), { error: true });
                }
            });
        });

        const strategy = element('select');
        strategy.setAttribute('aria-label', t('storage.archiveStrategy'));
        for (const value of ['merge', 'replace']) {
            const option = element('option', {
                text: t(`storage.archiveStrategy.${value}`),
            });
            option.value = value;
            strategy.appendChild(option);
        }
        const conflicts = element('select');
        conflicts.setAttribute('aria-label', t('storage.archiveConflictPolicy'));
        for (const value of ['keep-both', 'skip']) {
            const option = element('option', {
                text: t(`storage.archiveConflictPolicy.${value}`),
            });
            option.value = value;
            conflicts.appendChild(option);
        }
        const importInput = element('input', {
            className: 'st-devtools-file-input',
        });
        importInput.type = 'file';
        importInput.accept = '.json,application/json';
        importInput.hidden = true;
        const importButton = element('button', {
            className: 'menu_button',
            text: t('storage.archiveImportAction'),
            type: 'button',
        });
        importButton.addEventListener('click', () => importInput.click());
        importInput.addEventListener('change', () => {
            const file = importInput.files?.[0];
            importInput.value = '';
            if (!file) return;
            void this.withBusyButton(importButton, async () => {
                try {
                    await this.importSnapshotArchive(file, {
                        strategy: strategy.value,
                        conflictPolicy: conflicts.value,
                    });
                } catch (error) {
                    this.setStorageToolsStatus(t('storage.toolFailed', {
                        code: this.safeToolError(error),
                    }), { error: true });
                }
            });
        });

        const compareInput = element('input', {
            className: 'st-devtools-file-input',
        });
        compareInput.type = 'file';
        compareInput.accept = '.json,application/json';
        compareInput.multiple = true;
        compareInput.hidden = true;
        const compareButton = element('button', {
            className: 'menu_button',
            text: t('diagnostic.compareAction'),
            type: 'button',
        });
        compareButton.addEventListener('click', () => compareInput.click());
        compareInput.addEventListener('change', () => {
            const files = [...(compareInput.files ?? [])];
            compareInput.value = '';
            void this.withBusyButton(compareButton, async () => {
                try {
                    await this.compareDiagnosticFiles(files);
                } catch (error) {
                    this.setStorageToolsStatus(t('storage.toolFailed', {
                        code: this.safeToolError(error),
                    }), { error: true });
                }
            });
        });

        tools.append(
            heading,
            tool(
                'storage.integrityTitle',
                'storage.integrityDescription',
                [integrity],
            ),
            tool(
                'storage.archiveTitle',
                'storage.archiveDescription',
                [backup],
            ),
            tool(
                'storage.shareTitle',
                'storage.shareDescription',
                [shareMode, share],
            ),
            tool(
                'storage.archiveImportTitle',
                'storage.archiveImportDescription',
                [
                    strategy,
                    conflicts,
                    importButton,
                    importInput,
                ],
            ),
            tool(
                'diagnostic.compareTitle',
                'diagnostic.compareDescription',
                [compareButton, compareInput],
            ),
            status,
        );
        return tools;
    }

    scheduleSettingsRefresh() {
        if (this.settingsRefreshTimer != null) {
            clearTimeout(this.settingsRefreshTimer);
        }
        this.settingsRefreshTimer = setTimeout(() => {
            this.settingsRefreshTimer = null;
            void this.refresh();
        }, 0);
    }

    openSettings() {
        if (!this.settingsOverlay || !this.settingsPanel) return;
        this.settingsPreviouslyFocused = document.activeElement;
        this.themeModeInput.value = this.preferences.themeMode;
        this.timelineRetentionLimitInput.value = String(
            this.preferences.timelineRetentionLimit,
        );
        this.timelineReadLimitInput.value = String(this.preferences.timelineReadLimit);
        this.timelineReadLimitInput.max = String(this.preferences.timelineRetentionLimit);
        this.retentionMaxAgeDaysInput.value = String(
            this.preferences.retentionMaxAgeDays,
        );
        this.retentionMaxBytesMiBInput.value = String(Math.floor(
            this.preferences.retentionMaxBytes / MEBIBYTE,
        ));
        this.captureModeInput.value = this.preferences.captureMode;
        this.semanticInspectorEnabledInput.checked = (
            this.preferences.semanticInspectorEnabled
        );
        this.populateSemanticConnectionProfiles(
            this.semanticConnectionProfileInput,
            this.preferences.semanticConnectionProfileId,
            this.semanticConnectionProfileStatus,
        );
        this.semanticConnectionProfileInput.disabled = (
            !this.preferences.semanticInspectorEnabled
        );
        this.semanticConnectionProfileInput.closest('.st-devtools-semantic-profile')
            ?.classList.toggle(
                'is-disabled',
                this.semanticConnectionProfileInput.disabled,
            );
        this.semanticResponseTokenCapInput.value = String(
            this.preferences.semanticResponseTokenCap,
        );
        this.semanticResponseTokenCapInput.disabled = (
            !this.preferences.semanticInspectorEnabled
        );
        this.semanticResponseTokenCapInput.closest('.st-devtools-semantic-cap')
            ?.classList.toggle(
                'is-disabled',
                this.semanticResponseTokenCapInput.disabled,
            );
        this.resetPricingEditor?.();
        this.window.setAttribute('aria-modal', 'false');
        for (const region of this.primaryRegions) {
            region.inert = true;
            region.setAttribute('aria-hidden', 'true');
        }
        this.settingsOverlay.hidden = false;
        this.settingsPanel.scrollTop = 0;
        queueMicrotask(() => {
            if (this.settingsOverlay && !this.settingsOverlay.hidden) {
                this.settingsPanel?.focus({ preventScroll: true });
            }
        });
    }

    closeSettings({ restoreFocus = true } = {}) {
        if (!this.settingsOverlay || this.settingsOverlay.hidden) return;
        this.settingsOverlay.hidden = true;
        this.window.setAttribute('aria-modal', 'true');
        for (const region of this.primaryRegions) {
            region.inert = false;
            region.removeAttribute('aria-hidden');
        }
        if (
            restoreFocus
            && this.settingsPreviouslyFocused?.isConnected
            && typeof this.settingsPreviouslyFocused.focus === 'function'
        ) {
            this.settingsPreviouslyFocused.focus();
        }
        this.settingsPreviouslyFocused = null;
    }

    buildSemanticConsentDialog() {
        const overlay = element('div', {
            className: 'st-devtools-semantic-consent-overlay',
        });
        overlay.hidden = true;
        overlay.addEventListener('pointerdown', (event) => {
            if (event.target === overlay) this.closeSemanticConsent(false);
        });
        const panel = element('section', {
            className: 'st-devtools-semantic-consent-panel',
        });
        panel.tabIndex = -1;
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.setAttribute(
            'aria-labelledby',
            'st-devtools-semantic-consent-title',
        );

        const header = element('header', {
            className: 'st-devtools-semantic-consent-header',
        });
        const title = element('h2', {
            text: t('semantic.consentTitle'),
        });
        title.id = 'st-devtools-semantic-consent-title';
        const close = element('button', {
            className: 'menu_button st-devtools-icon-button',
            title: t('action.cancel'),
            type: 'button',
        });
        close.setAttribute('aria-label', t('action.cancel'));
        close.appendChild(closeIcon());
        close.addEventListener('click', () => this.closeSemanticConsent(false));
        header.append(title, close);

        const body = element('div', {
            className: 'st-devtools-semantic-consent-body',
        });
        const consent = element('label', {
            className: 'st-devtools-semantic-consent-check',
        });
        const checkbox = element('input');
        checkbox.type = 'checkbox';
        consent.append(
            checkbox,
            element('span', { text: t('semantic.consentCheckbox') }),
        );
        const actions = element('div', {
            className: 'st-devtools-semantic-consent-actions',
        });
        const cancel = element('button', {
            className: 'menu_button',
            text: t('action.cancel'),
            type: 'button',
        });
        cancel.addEventListener('click', () => this.closeSemanticConsent(false));
        const confirm = element('button', {
            className: 'menu_button st-devtools-primary-button',
            text: t('semantic.consentSend'),
            type: 'button',
        });
        confirm.disabled = true;
        confirm.addEventListener('click', () => {
            if (checkbox.checked) this.closeSemanticConsent(true);
        });
        checkbox.addEventListener('change', () => {
            confirm.disabled = !checkbox.checked;
        });
        actions.append(cancel, confirm);
        panel.append(
            header,
            body,
            proseElement('p', t('semantic.consentWarning'), {
                className: 'st-devtools-semantic-consent-warning',
            }),
            consent,
            actions,
        );
        overlay.appendChild(panel);
        this.semanticConsentOverlay = overlay;
        this.semanticConsentPanel = panel;
        this.semanticConsentBody = body;
        this.semanticConsentCheckbox = checkbox;
        this.semanticConsentConfirmButton = confirm;
        return overlay;
    }

    semanticPreviewCostText(cost) {
        if (
            !cost
            || cost.priceSource !== 'user-override'
            || !['catalog-estimate', 'lower-bound'].includes(cost.status)
            || !Number.isFinite(cost.amount)
            || typeof cost.currency !== 'string'
        ) {
            return t('semantic.costUnavailable');
        }
        return t('semantic.costValue', {
            amount: Number(cost.amount).toLocaleString('ko-KR', {
                maximumFractionDigits: 12,
            }),
            currency: cost.currency,
            status: t(`context.costStatus.${cost.status}`),
        });
    }

    renderSemanticConsentPreview(preview = {}) {
        const content = element('div', {
            className: 'st-devtools-semantic-preview',
        });
        const metadata = element('dl', {
            className: 'st-devtools-semantic-preview-meta',
        });
        const appendMetadata = (labelKey, value) => {
            metadata.append(
                element('dt', { text: t(labelKey) }),
                element('dd', { text: value ?? t('common.unknown') }),
            );
        };
        appendMetadata(
            'semantic.previewIdentityStatus',
            translatedValue(
                `semantic.identity.${preview?.providerIdentity?.status}`,
                preview?.providerIdentity?.status ?? t('common.unknown'),
            ),
        );
        appendMetadata(
            'semantic.previewProvider',
            providerDisplayLabel(preview.provider),
        );
        appendMetadata(
            'semantic.previewModel',
            preview.model ?? t('common.unknown'),
        );
        appendMetadata(
            'semantic.previewInputTokens',
            Number.isFinite(preview.inputTokenEstimate)
                ? t('snapshot.tokens', {
                    count: Number(preview.inputTokenEstimate)
                        .toLocaleString('ko-KR'),
                })
                : t('common.unknown'),
        );
        appendMetadata(
            'semantic.previewResponseCap',
            t('snapshot.tokens', {
                count: Number(preview.responseTokenCap || 0)
                    .toLocaleString('ko-KR'),
            }),
        );
        appendMetadata(
            'semantic.previewCost',
            this.semanticPreviewCostText(preview.cost),
        );
        content.appendChild(metadata);

        const included = Array.isArray(preview.includedSources)
            ? preview.includedSources
            : [];
        const includedSection = element('section', {
            className: 'st-devtools-semantic-preview-sources',
        });
        includedSection.appendChild(element('h3', {
            text: t('semantic.includedSources', { count: included.length }),
        }));
        for (const source of included) {
            const card = element('article', {
                className: 'st-devtools-semantic-preview-source',
            });
            card.append(
                element('strong', {
                    text: source?.label ?? source?.id ?? t('common.unknown'),
                }),
                element('small', {
                    text: t('semantic.sourceBytes', {
                        count: normalizedCount(source?.bytes),
                    }),
                }),
                element('pre', {
                    text: typeof source?.content === 'string'
                        ? source.content
                        : t('semantic.previewContentUnavailable'),
                }),
            );
            includedSection.appendChild(card);
        }
        if (included.length === 0) {
            includedSection.appendChild(proseElement(
                'p',
                t('semantic.noIncludedSources'),
            ));
        }

        const excluded = Array.isArray(preview.excludedSources)
            ? preview.excludedSources
            : [];
        const excludedSection = element('section', {
            className: 'st-devtools-semantic-preview-excluded',
        });
        excludedSection.appendChild(element('h3', {
            text: t('semantic.excludedSources', { count: excluded.length }),
        }));
        const excludedList = element('ul');
        for (const source of excluded) {
            excludedList.appendChild(element('li', {
                text: t('semantic.excludedSource', {
                    name: source?.label ?? source?.id ?? t('common.unknown'),
                    reason: translatedValue(
                        `semantic.exclusion.${source?.reason}`,
                        source?.reason ?? t('common.unknown'),
                    ),
                }),
            }));
        }
        if (excluded.length === 0) {
            excludedList.appendChild(element('li', {
                text: t('common.none'),
            }));
        }
        excludedSection.appendChild(excludedList);
        content.append(includedSection, excludedSection);
        return content;
    }

    requestSemanticConsent(preview) {
        if (!this.semanticConsentOverlay || !this.semanticConsentPanel) {
            return Promise.resolve(false);
        }
        if (
            !Array.isArray(preview?.includedSources)
            || preview.includedSources.length === 0
            || preview.includedSources.some(
                (source) => typeof source?.content !== 'string',
            )
        ) {
            return Promise.resolve(false);
        }
        if (this.semanticConsentResolve) this.closeSemanticConsent(false);
        this.semanticConsentPreviouslyFocused = document.activeElement;
        this.semanticConsentCheckbox.checked = false;
        this.semanticConsentConfirmButton.disabled = true;
        this.semanticConsentBody.replaceChildren(
            this.renderSemanticConsentPreview(preview),
        );
        this.window.setAttribute('aria-modal', 'false');
        for (const region of this.primaryRegions) {
            region.inert = true;
            region.setAttribute('aria-hidden', 'true');
        }
        this.semanticConsentOverlay.hidden = false;
        queueMicrotask(() => this.semanticConsentCheckbox?.focus());
        return new Promise((resolve) => {
            this.semanticConsentResolve = resolve;
        });
    }

    closeSemanticConsent(approved = false, { restoreFocus = true } = {}) {
        if (!this.semanticConsentOverlay || this.semanticConsentOverlay.hidden) {
            return;
        }
        const resolve = this.semanticConsentResolve;
        this.semanticConsentResolve = null;
        this.semanticConsentOverlay.hidden = true;
        this.semanticConsentBody?.replaceChildren();
        this.semanticConsentCheckbox.checked = false;
        this.semanticConsentConfirmButton.disabled = true;
        this.window.setAttribute('aria-modal', 'true');
        for (const region of this.primaryRegions) {
            region.inert = false;
            region.removeAttribute('aria-hidden');
        }
        if (
            restoreFocus
            && this.semanticConsentPreviouslyFocused?.isConnected
            && typeof this.semanticConsentPreviouslyFocused.focus === 'function'
        ) {
            this.semanticConsentPreviouslyFocused.focus();
        }
        this.semanticConsentPreviouslyFocused = null;
        resolve?.(Boolean(approved));
    }

    loadRuleSettings() {
        try {
            const stored = JSON.parse(localStorage.getItem(RULE_SETTINGS_KEY) ?? 'null');
            return normalizeRuleSettings(stored ?? DEFAULT_RULE_SETTINGS);
        } catch {
            return normalizeRuleSettings(DEFAULT_RULE_SETTINGS);
        }
    }

    saveRuleSettings(settings) {
        this.invalidateAnalysisState();
        const previous = this.ruleSettings;
        this.ruleSettings = normalizeRuleSettings(settings);
        this.invalidatePolicyPreview();
        try {
            const serialized = JSON.stringify(this.ruleSettings);
            localStorage.setItem(RULE_SETTINGS_KEY, serialized);
            if (localStorage.getItem(RULE_SETTINGS_KEY) !== serialized) {
                throw new Error(t('comparison.storageVerificationFailed'));
            }
            return { ok: true, error: null };
        } catch (error) {
            this.ruleSettings = previous;
            return { ok: false, error };
        }
    }

    async open() {
        if (!this.root) {
            this.build();
        }
        if (!this.root.contains(document.activeElement)) {
            this.previouslyFocused = document.activeElement;
        }
        this.syncOpaqueTheme();
        this.root.hidden = false;
        await this.refresh();
        this.window?.focus({ preventScroll: true });
    }

    close() {
        this.invalidateAnalysisState();
        this.disposeVirtualLists();
        this.closeSemanticConsent(false, { restoreFocus: false });
        this.cancelSemanticInspection();
        this.closeSettings({ restoreFocus: false });
        if (this.root) {
            this.root.hidden = true;
        }
        if (this.previouslyFocused?.isConnected && typeof this.previouslyFocused.focus === 'function') {
            this.previouslyFocused.focus();
        }
        this.previouslyFocused = null;
    }

    build() {
        this.root = element('div', { className: 'st-devtools-overlay' });
        this.root.id = 'st-devtools-overlay';
        this.root.hidden = true;

        this.window = element('section', { className: 'st-devtools-window' });
        this.window.tabIndex = -1;
        this.window.setAttribute('role', 'dialog');
        this.window.setAttribute('aria-modal', 'true');
        this.window.setAttribute('aria-label', 'ST DevTools');
        this.restoreGeometry();

        const header = element('header', { className: 'st-devtools-header' });
        const title = element('div', { className: 'st-devtools-title' });
        const titleIcon = element('i', { className: 'fa-solid fa-code' });
        titleIcon.setAttribute('aria-hidden', 'true');
        this.captureStatusRegion = this.buildCaptureStatus();
        title.append(
            titleIcon,
            element('strong', { text: 'ST DevTools' }),
            this.captureStatusRegion,
            element('small', { text: `v${this.version}` }),
            element('span', { className: 'st-devtools-readonly-badge', text: t('app.readOnly') }),
        );

        const headerActions = element('div', { className: 'st-devtools-header-actions' });
        const settings = element('button', {
            className: 'menu_button st-devtools-icon-button',
            title: t('action.settings'),
            type: 'button',
        });
        settings.setAttribute('aria-label', t('action.settings'));
        const settingsIcon = element('i', { className: 'fa-solid fa-gear' });
        settingsIcon.setAttribute('aria-hidden', 'true');
        settings.appendChild(settingsIcon);
        settings.addEventListener('click', () => this.openSettings());
        const refresh = element('button', { className: 'menu_button st-devtools-icon-button', title: t('action.refresh'), type: 'button' });
        refresh.setAttribute('aria-label', t('action.refresh'));
        const refreshIcon = element('i', { className: 'fa-solid fa-rotate' });
        refreshIcon.setAttribute('aria-hidden', 'true');
        refresh.appendChild(refreshIcon);
        refresh.addEventListener('click', () => this.refresh());
        const close = element('button', { className: 'menu_button st-devtools-icon-button', title: t('action.close'), type: 'button' });
        close.setAttribute('aria-label', t('action.close'));
        close.appendChild(closeIcon());
        close.addEventListener('click', () => this.close());
        headerActions.append(settings, refresh, close);
        header.append(title, headerActions);

        const tabList = element('nav', {
            className: 'st-devtools-app-nav',
        });
        tabList.setAttribute('role', 'tablist');
        tabList.setAttribute('aria-label', t('nav.label'));
        for (const [id, labelKey, shortLabelKey, iconClass] of TABS) {
            const button = element('button', {
                className: 'st-devtools-app-nav-item',
                title: t(labelKey),
                type: 'button',
            });
            button.dataset.tab = id;
            button.id = this.tabElementId(id);
            button.setAttribute('role', 'tab');
            button.setAttribute('aria-controls', this.panelElementId(id));
            button.setAttribute('aria-label', t(labelKey));
            const icon = element('i', {
                className: `fa-solid ${iconClass}`,
            });
            icon.setAttribute('aria-hidden', 'true');
            button.append(
                icon,
                element('span', { text: t(shortLabelKey) }),
            );
            button.addEventListener('click', () => this.selectTab(id));
            button.addEventListener('keydown', (event) => this.handleTabKeydown(event, id));
            tabList.appendChild(button);
        }

        this.content = element('main', { className: 'st-devtools-content' });
        this.content.setAttribute('role', 'tabpanel');
        this.updateCaptureStatus();
        this.primaryRegions = [
            header,
            this.content,
            tabList,
        ];
        this.window.append(
            header,
            this.content,
            tabList,
            this.buildSettingsPanel(),
            this.buildSemanticConsentDialog(),
        );
        this.root.appendChild(this.window);
        document.body.appendChild(this.root);
        this.syncOpaqueTheme();

        this.root.addEventListener('pointerdown', (event) => {
            if (event.target === this.root) this.close();
            if (!event.target.closest('.st-devtools-help-tooltip')) {
                closeHelpTooltips(this.root);
            }
        });
        document.addEventListener('keydown', (event) => this.handleDialogKeydown(event));
        this.enableDragging(header);
        this.observeGeometry();
        this.selectTab(this.activeTab);
    }

    buildCaptureStatus() {
        const region = element('span', {
            className: 'st-devtools-capture-status',
        });
        region.dataset.tourId = 'capture-status';
        region.setAttribute('role', 'status');
        region.setAttribute('aria-live', 'polite');
        region.setAttribute('aria-atomic', 'true');
        const dot = element('span', {
            className: 'st-devtools-capture-status-dot',
            text: '',
        });
        dot.setAttribute('aria-hidden', 'true');
        region.append(
            dot,
            element('span', {
                className: 'st-devtools-capture-status-copy',
            }),
        );
        this.updateCaptureStatus();
        return region;
    }

    onCaptureStatus(detail) {
        const state = typeof detail?.state === 'string'
            ? detail.state
            : 'waiting';
        if (!CAPTURE_STATUS_STATES.has(state)) return;
        this.captureStatus = {
            state,
            at: Number.isFinite(detail?.at) ? detail.at : Date.now(),
            ...(typeof detail?.promptType === 'string'
                ? { promptType: detail.promptType }
                : {}),
            ...(typeof detail?.stage === 'string'
                ? { stage: detail.stage }
                : {}),
            ...(CAPTURE_PIPELINE_PHASES.has(detail?.phase)
                ? { phase: detail.phase }
                : {}),
        };
        this.updateCaptureStatus();
    }

    updateCaptureStatus() {
        if (!this.captureStatusRegion) return;
        const state = CAPTURE_STATUS_STATES.has(this.captureStatus?.state)
            ? this.captureStatus.state
            : 'waiting';
        for (const knownState of CAPTURE_STATUS_STATES) {
            this.captureStatusRegion.classList.remove(`is-${knownState}`);
        }
        this.captureStatusRegion.classList.add(`is-${state}`);
        const keySuffix = state === 'excluded-semantic'
            ? 'excludedSemantic'
            : state === 'skipped-safety'
                ? 'skippedSafety'
                : state;
        const copy = this.captureStatusRegion.querySelector(
            '.st-devtools-capture-status-copy',
        );
        const phase = this.captureStatus?.phase;
        const phasedKey = (
            ['processing', 'failed'].includes(state)
            && CAPTURE_PIPELINE_PHASES.has(phase)
        )
            ? `capture.status.${keySuffix}.${phase}`
            : null;
        const description = t(phasedKey ?? `capture.status.${keySuffix}`);
        if (copy) {
            copy.textContent = t(`capture.status.short.${keySuffix}`);
        }
        const accessibleStatus = t('capture.status.accessible', {
            status: description,
        });
        this.captureStatusRegion.setAttribute('aria-label', accessibleStatus);
        this.captureStatusRegion.title = accessibleStatus;
    }

    renderScreenHeader(tabId) {
        const tab = TABS.find(([id]) => id === tabId) ?? TABS[0];
        const header = element('header', {
            className: 'st-devtools-screen-header',
        });
        header.appendChild(explainedTitle(
            t(tab[1]),
            t(`screen.${tab[0]}.description`),
            {
                tag: 'div',
                titleTag: 'h1',
                className: 'st-devtools-screen-title',
            },
        ));
        return header;
    }

    renderQuickStart({ showHeading = false } = {}) {
        const section = element('section', {
            className: 'st-devtools-quick-start',
        });
        section.dataset.tourId = 'quick-start';
        if (showHeading) {
            section.appendChild(element('h4', {
                text: t('empty.quickStartTitle'),
            }));
        }
        const nextStep = element('div', {
            className: 'st-devtools-quick-start-next',
        });
        const nextStepIcon = element('span', {
            className: 'st-devtools-quick-start-icon',
        });
        nextStepIcon.setAttribute('aria-hidden', 'true');
        nextStepIcon.appendChild(element('i', {
            className: 'fa-solid fa-paper-plane',
        }));
        const nextStepCopy = element('div');
        nextStepCopy.append(
            element('strong', { text: t('help.step1Title') }),
            proseElement('p', t('help.step1Description')),
        );
        nextStep.append(nextStepIcon, nextStepCopy);
        const diagnostics = element('details', {
            className: 'st-devtools-empty-diagnostics st-devtools-disclosure',
        });
        diagnostics.append(
            element('summary', { text: t('help.troubleshootTitle') }),
            proseElement('p', t('help.troubleshootDescription')),
        );
        section.append(nextStep, diagnostics);
        return section;
    }

    syncOpaqueTheme() {
        if (!this.root) return;
        let textColor = '';
        if (this.preferences.themeMode === 'auto') {
            const probe = element('span');
            probe.style.cssText = 'position:fixed;pointer-events:none;visibility:hidden;color:var(--SmartThemeBodyColor, #eeeeee)';
            document.body.appendChild(probe);
            textColor = getComputedStyle(probe).color;
            probe.remove();
        }
        const darkTheme = resolvePanelTheme(
            this.preferences.themeMode,
            textColor,
        ) === 'dark';
        this.root.classList.toggle('st-devtools-theme-dark', darkTheme);
        this.root.classList.toggle('st-devtools-theme-light', !darkTheme);
    }

    restoreGeometry() {
        if (this.usesCompactLayout()) return;
        try {
            const geometry = JSON.parse(localStorage.getItem(GEOMETRY_KEY));
            if (!geometry) return;
            const margin = 16;
            const maximumWidth = Math.max(280, window.innerWidth - margin);
            const maximumHeight = Math.max(320, window.innerHeight - margin);
            const width = Math.min(
                maximumWidth,
                Math.max(Math.min(560, maximumWidth), Number(geometry.width) || 0),
            );
            const height = Math.min(
                maximumHeight,
                Math.max(Math.min(380, maximumHeight), Number(geometry.height) || 0),
            );
            const left = Math.min(
                Math.max(0, window.innerWidth - width),
                Math.max(0, Number(geometry.left) || 0),
            );
            const top = Math.min(
                Math.max(0, window.innerHeight - height),
                Math.max(0, Number(geometry.top) || 0),
            );
            this.window.style.width = `${width}px`;
            this.window.style.height = `${height}px`;
            this.window.style.left = `${left}px`;
            this.window.style.top = `${top}px`;
            this.window.style.transform = 'none';
        } catch {
            // Ignore invalid settings.
        }
    }

    observeGeometry() {
        const save = () => {
            if (this.usesCompactLayout()) return;
            const rect = this.window.getBoundingClientRect();
            localStorage.setItem(GEOMETRY_KEY, JSON.stringify({
                width: Math.round(rect.width),
                height: Math.round(rect.height),
                left: Math.max(0, Math.round(rect.left)),
                top: Math.max(0, Math.round(rect.top)),
            }));
        };
        if (typeof ResizeObserver === 'function') {
            new ResizeObserver(save).observe(this.window);
        }
        this.saveGeometry = save;
    }

    enableDragging(handle) {
        let drag = null;
        handle.addEventListener('pointerdown', (event) => {
            if (this.usesCompactLayout()) return;
            if (event.target.closest('button')) return;
            const rect = this.window.getBoundingClientRect();
            drag = { offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
            this.window.style.transform = 'none';
            handle.setPointerCapture(event.pointerId);
        });
        handle.addEventListener('pointermove', (event) => {
            if (!drag) return;
            const maxLeft = Math.max(0, window.innerWidth - this.window.offsetWidth);
            const maxTop = Math.max(0, window.innerHeight - this.window.offsetHeight);
            this.window.style.left = `${Math.min(maxLeft, Math.max(0, event.clientX - drag.offsetX))}px`;
            this.window.style.top = `${Math.min(maxTop, Math.max(0, event.clientY - drag.offsetY))}px`;
        });
        const endDrag = () => {
            if (!drag) return;
            drag = null;
            this.saveGeometry?.();
        };
        handle.addEventListener('pointerup', endDrag);
        handle.addEventListener('pointercancel', endDrag);
    }

    usesCompactLayout() {
        if (typeof window.matchMedia === 'function') {
            return window.matchMedia('(max-width: 700px)').matches;
        }
        return Number(window.innerWidth) <= 700;
    }

    async onSnapshot(snapshot) {
        this.invalidateAnalysisState();
        this.storageErrors = this.storageErrors.filter((item) => item.snapshotId !== snapshot.id);
        const panelVisible = Boolean(this.root && !this.root.hidden);
        if (this.snapshotStorageChatId(snapshot) === this.currentChatId()) {
            const alreadyPresent = this.timeline.some((item) => item.id === snapshot.id);
            this.timeline = [...this.timeline.filter((item) => item.id !== snapshot.id), snapshot]
                .sort((left, right) => left.timestamp - right.timestamp)
                .slice(-this.preferences.timelineReadLimit);
            if (!alreadyPresent) {
                const maximum = Number(this.store.maxSnapshotsPerChat)
                    || MAX_TIMELINE_READ_LIMIT;
                this.timelineTotalCount = Math.min(
                    maximum,
                    Math.max(this.timeline.length, this.timelineTotalCount + 1),
                );
            }
            this.pruneTimelineSelection();
            if (!alreadyPresent) this.selectedId = snapshot.id;
        }
        if (panelVisible) {
            this.render();
            if (this.activeTab === 'timeline') void this.refreshStorageSummary();
        }
    }

    onCaptureError(detail) {
        const snapshot = detail?.snapshot;
        const snapshotId = snapshot?.id ?? null;
        this.addStorageError({
            id: `capture:${snapshotId ?? Date.now()}`,
            snapshotId,
            error: snapshot
                ? detail?.error
                : new Error(capturePipelineErrorMessage(detail)),
            retry: snapshot ? () => this.capture.retrySnapshot(snapshot) : null,
            kind: snapshot ? 'storage' : 'capture',
        });
        globalThis.toastr?.error?.(
            t(snapshot ? 'storage.captureFailed' : 'capture.pipelineFailed'),
            'ST DevTools',
        );
    }

    addStorageError({
        id,
        snapshotId = null,
        error,
        retry = null,
        kind = 'storage',
    }) {
        const item = {
            id,
            snapshotId,
            message: error?.message || t('storage.unknownError'),
            retry,
            pending: false,
            kind,
        };
        this.storageErrors = [
            ...this.storageErrors.filter((existing) => existing.id !== id),
            item,
        ].slice(-5);
        if (this.root && !this.root.hidden) this.render();
        return item;
    }

    async retryStorageError(item) {
        if (!item?.retry || item.pending) return;
        item.pending = true;
        this.render();
        try {
            await item.retry();
            this.storageErrors = this.storageErrors.filter((existing) => existing.id !== item.id);
            globalThis.toastr?.success?.(t('storage.retrySucceeded'), 'ST DevTools');
        } catch (error) {
            item.message = error?.message || t('storage.unknownError');
            item.pending = false;
            globalThis.toastr?.error?.(t('storage.retryFailed'), 'ST DevTools');
        }
        this.render();
    }

    async refresh({
        throwOnError = false,
        chatId = this.currentChatId(),
    } = {}) {
        const requestId = ++this.refreshRequestId;
        try {
            const page = await this.readTimelinePage(chatId);
            if (requestId !== this.refreshRequestId || chatId !== this.currentChatId()) {
                return false;
            }
            this.timeline = page.snapshots;
            this.timelineTotalCount = page.totalCount;
            this.timelineCorruptCount = page.corruptCount;
            this.pruneTimelineSelection();
            if (!this.timeline.some((snapshot) => snapshot.id === this.selectedId)) {
                this.selectedId = this.timeline.at(-1)?.id ?? null;
            }
            this.storageErrors = this.storageErrors.filter((item) => item.id !== 'refresh');
            this.render();
            if (this.activeTab === 'timeline') void this.refreshStorageSummary();
            return true;
        } catch (error) {
            if (throwOnError) throw error;
            if (requestId !== this.refreshRequestId || chatId !== this.currentChatId()) {
                return false;
            }
            this.addStorageError({
                id: 'refresh',
                error,
                retry: () => this.refresh({ throwOnError: true, chatId }),
            });
            this.render();
            return false;
        }
    }

    async readStorageSummary() {
        const localData = this.readLocalDataSummary();
        try {
            const [summary, originStorage] = await Promise.all([
                typeof this.store.getStorageSummary === 'function'
                    ? this.store.getStorageSummary()
                    : Promise.resolve({
                    ...this.storageSummary,
                    ...(this.store.getStatus?.() ?? {}),
                    }),
                typeof this.store.getStorageQuotaStatus === 'function'
                    ? this.store.getStorageQuotaStatus()
                    : Promise.resolve(null),
            ]);
            const snapshotApproximateBytes = Number.isFinite(summary.snapshotApproximateBytes)
                ? summary.snapshotApproximateBytes
                : Number.isFinite(summary.approximateBytes)
                    ? summary.approximateBytes
                    : null;
            return {
                ...summary,
                localSettingCount: localData.count,
                originStorage,
                snapshotApproximateBytes,
                approximateBytes: snapshotApproximateBytes == null
                    ? null
                    : snapshotApproximateBytes + localData.approximateBytes,
            };
        } catch {
            const snapshotApproximateBytes = this.storageSummary.snapshotApproximateBytes ?? null;
            return {
                ...this.storageSummary,
                ...(this.store.getStatus?.() ?? {}),
                localSettingCount: localData.count,
                approximateBytes: snapshotApproximateBytes == null
                    ? null
                    : snapshotApproximateBytes + localData.approximateBytes,
                summaryError: true,
            };
        }
    }

    refreshStorageSummary() {
        if (this.storageSummaryRefreshPromise) return this.storageSummaryRefreshPromise;
        const generation = this.storageSummaryGeneration;
        const refresh = (async () => {
            const summary = await this.readStorageSummary();
            if (generation !== this.storageSummaryGeneration) return null;
            this.storageSummary = summary;
            const panelVisible = Boolean(this.root && !this.root.hidden);
            if (panelVisible && this.activeTab === 'timeline') this.render();
            if (
                panelVisible
                && this.activeTab === 'timeline'
                && summary.complete === false
            ) {
                this.scheduleStorageSummaryRebuild();
            }
            return summary;
        })().catch(() => null).finally(() => {
            if (this.storageSummaryRefreshPromise === refresh) {
                this.storageSummaryRefreshPromise = null;
            }
        });
        this.storageSummaryRefreshPromise = refresh;
        return refresh;
    }

    scheduleStorageSummaryRebuild() {
        if (
            this.storageSummaryRebuildScheduled
            || this.storageSummaryRebuildPromise
            || typeof this.store.rebuildStorageSummary !== 'function'
        ) {
            return;
        }
        this.storageSummaryRebuildScheduled = true;
        const generation = this.storageSummaryGeneration;
        const run = () => {
            this.storageSummaryRebuildScheduled = false;
            if (
                generation !== this.storageSummaryGeneration
                || !this.root
                || this.root.hidden
                || this.activeTab !== 'timeline'
                || this.storageSummaryRebuildPromise
            ) {
                return;
            }
            this.storageSummary = {
                ...this.storageSummary,
                rebuilding: true,
            };
            if (this.activeTab === 'timeline') this.render();
            const rebuild = this.store.rebuildStorageSummary()
                .then((summary) => {
                    if (summary && generation === this.storageSummaryGeneration) {
                        this.storageSummary = {
                            ...summary,
                            localSettingCount: this.storageSummary.localSettingCount,
                            originStorage: this.storageSummary.originStorage,
                            snapshotApproximateBytes: summary.approximateBytes,
                            approximateBytes: summary.approximateBytes == null
                                ? null
                                : summary.approximateBytes
                                    + this.readLocalDataSummary().approximateBytes,
                        };
                    }
                })
                .catch(() => {
                    if (generation !== this.storageSummaryGeneration) return;
                    this.storageSummary = {
                        ...this.storageSummary,
                        rebuilding: false,
                        summaryError: true,
                    };
                })
                .finally(() => {
                    if (this.storageSummaryRebuildPromise === rebuild) {
                        this.storageSummaryRebuildPromise = null;
                    }
                    if (
                        generation === this.storageSummaryGeneration
                        && this.storageSummary.complete === false
                        && !this.storageSummary.summaryError
                    ) {
                        this.storageSummary = {
                            ...this.storageSummary,
                            rebuilding: false,
                        };
                        this.scheduleStorageSummaryRebuild();
                    }
                    if (this.root && !this.root.hidden && this.activeTab === 'timeline') {
                        this.render();
                    }
                });
            this.storageSummaryRebuildPromise = rebuild;
        };
        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(run, { timeout: 1000 });
        } else {
            setTimeout(run, 50);
        }
    }

    localDataKeys() {
        const keys = new Set(KNOWN_LOCAL_DATA_KEYS);
        try {
            const length = Number(localStorage.length) || 0;
            for (let index = 0; index < length; index += 1) {
                const key = localStorage.key?.(index);
                if (key?.startsWith(STORAGE_PREFIX)) keys.add(key);
            }
        } catch {
            // Known keys remain available when enumeration is restricted.
        }
        return [...keys];
    }

    readLocalDataSummary() {
        let count = 0;
        let approximateBytes = 0;
        for (const key of this.localDataKeys()) {
            try {
                const value = localStorage.getItem(key);
                if (value == null) continue;
                count += 1;
                approximateBytes += new TextEncoder().encode(`${key}${value}`).length;
            } catch {
                // Keep the readable subset in the summary.
            }
        }
        return { count, approximateBytes };
    }

    clearLocalData() {
        this.resetSemanticInspectionForSettingsChange({
            semanticInspectorEnabled: false,
        });
        this.invalidateAnalysisState();
        this.analysisCache.clear();
        let deletedCount = 0;
        for (const key of this.localDataKeys()) {
            const exists = localStorage.getItem(key) != null;
            localStorage.removeItem(key);
            if (exists) deletedCount += 1;
        }
        this.ruleSettings = normalizeRuleSettings(DEFAULT_RULE_SETTINGS);
        this.ruleSettingsOpen = false;
        this.comparisonPolicySettings = normalizeComparisonPolicySettings(
            DEFAULT_COMPARISON_POLICY_SETTINGS,
        );
        this.savedComparisonPolicySettings = normalizeComparisonPolicySettings(
            DEFAULT_COMPARISON_POLICY_SETTINGS,
        );
        this.comparisonPolicyDirty = false;
        this.activeComparisonProfileId = 'global';
        this.findingReviewDocument = normalizeFindingReviewDocument(
            DEFAULT_FINDING_REVIEW_DOCUMENT,
        );
        this.findingHiddenOnce = new Set();
        this.ruleAuditLog = normalizeAuditLog(DEFAULT_AUDIT_LOG);
        this.ruleReviewStatus = '';
        this.ruleReviewStatusIsError = false;
        this.pendingImportedRuleSettings = null;
        this.pendingImportedReviews = null;
        this.comparisonPolicyOpen = false;
        this.comparisonPolicySectionOpen = {
            profiles: false,
            groups: false,
            rules: false,
            manual: false,
            preview: false,
            transfer: false,
            reviewed: false,
            audit: false,
        };
        this.preferences = normalizeUiPreferences(DEFAULT_UI_PREFERENCES);
        this.store.setMaxSnapshotsPerChat?.(this.preferences.timelineRetentionLimit);
        if (this.themeModeInput) {
            this.themeModeInput.value = this.preferences.themeMode;
        }
        if (this.timelineRetentionLimitInput) {
            this.timelineRetentionLimitInput.value = String(
                this.preferences.timelineRetentionLimit,
            );
        }
        if (this.timelineReadLimitInput) {
            this.timelineReadLimitInput.value = String(this.preferences.timelineReadLimit);
            this.timelineReadLimitInput.max = String(
                this.preferences.timelineRetentionLimit,
            );
        }
        if (this.semanticInspectorEnabledInput) {
            this.semanticInspectorEnabledInput.checked = (
                this.preferences.semanticInspectorEnabled
            );
        }
        if (this.semanticConnectionProfileInput) {
            this.populateSemanticConnectionProfiles(
                this.semanticConnectionProfileInput,
                this.preferences.semanticConnectionProfileId,
                this.semanticConnectionProfileStatus,
            );
            this.semanticConnectionProfileInput.disabled = true;
            this.semanticConnectionProfileInput
                .closest('.st-devtools-semantic-profile')
                ?.classList.add('is-disabled');
        }
        if (this.semanticResponseTokenCapInput) {
            this.semanticResponseTokenCapInput.value = String(
                this.preferences.semanticResponseTokenCap,
            );
            this.semanticResponseTokenCapInput.disabled = true;
        }
        this.importedDiagnostics = null;
        this.diagnosticImportError = null;
        return deletedCount;
    }

    tabElementId(id) {
        return `st-devtools-tab-${id}`;
    }

    panelElementId() {
        return 'st-devtools-panel';
    }

    activeTabButton() {
        return this.window?.querySelector(
            `.st-devtools-app-nav-item[data-tab="${this.activeTab}"]`,
        ) ?? null;
    }

    focusableElements() {
        if (!this.window) return [];
        const scope = this.semanticConsentOverlay
            && !this.semanticConsentOverlay.hidden
            ? this.semanticConsentPanel
            : this.settingsOverlay && !this.settingsOverlay.hidden
                ? this.settingsPanel
                : this.window;
        return [...scope.querySelectorAll(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
            'textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
        )].filter((node) => (
            !node.hidden
            && node.getAttribute('aria-hidden') !== 'true'
            && node.tabIndex >= 0
            && typeof node.focus === 'function'
            && (node.getClientRects().length > 0 || node === document.activeElement)
        ));
    }

    handleDialogKeydown(event) {
        if (!this.root || this.root.hidden) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            if (
                this.semanticConsentOverlay
                && !this.semanticConsentOverlay.hidden
            ) {
                this.closeSemanticConsent(false);
            } else if (this.settingsOverlay && !this.settingsOverlay.hidden) {
                this.closeSettings();
            } else {
                this.close();
            }
            return;
        }
        if (event.key !== 'Tab') return;

        const focusable = this.focusableElements();
        if (focusable.length === 0) {
            event.preventDefault();
            this.window.focus();
            return;
        }
        const first = focusable[0];
        const last = focusable.at(-1);
        const active = document.activeElement;
        const focusScope = this.semanticConsentOverlay
            && !this.semanticConsentOverlay.hidden
            ? this.semanticConsentPanel
            : this.settingsOverlay && !this.settingsOverlay.hidden
                ? this.settingsPanel
                : this.window;
        if (!focusScope.contains(active)) {
            event.preventDefault();
            (event.shiftKey ? last : first).focus();
        } else if (event.shiftKey && active === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus();
        }
    }

    loadComparisonPolicySettings() {
        try {
            const current = localStorage.getItem(COMPARISON_POLICY_SETTINGS_KEY);
            const legacy = localStorage.getItem(LEGACY_COMPARISON_POLICY_SETTINGS_KEY);
            const stored = JSON.parse(current ?? legacy ?? 'null');
            return normalizeComparisonPolicySettings(
                stored ?? DEFAULT_COMPARISON_POLICY_SETTINGS,
            );
        } catch {
            return normalizeComparisonPolicySettings(DEFAULT_COMPARISON_POLICY_SETTINGS);
        }
    }

    setComparisonPolicySettings(settings) {
        this.invalidateAnalysisState();
        this.comparisonPolicySettings = normalizeComparisonPolicySettings(settings);
        this.comparisonPolicyDirty = JSON.stringify(this.comparisonPolicySettings)
            !== JSON.stringify(this.savedComparisonPolicySettings)
            || Boolean(this.pendingImportedRuleSettings)
            || Boolean(this.pendingImportedReviews);
        this.invalidatePolicyPreview();
    }

    invalidatePolicyPreview() {
        this.policyPreviewRevision = (this.policyPreviewRevision ?? 0) + 1;
        this.policyPreviewCache = null;
    }

    saveComparisonPolicySettings(settings = this.comparisonPolicySettings) {
        const before = this.savedComparisonPolicySettings;
        this.setComparisonPolicySettings(settings);
        try {
            const serialized = JSON.stringify(this.comparisonPolicySettings);
            localStorage.setItem(
                COMPARISON_POLICY_SETTINGS_KEY,
                serialized,
            );
            if (localStorage.getItem(COMPARISON_POLICY_SETTINGS_KEY) !== serialized) {
                throw new Error(t('comparison.storageVerificationFailed'));
            }
            localStorage.removeItem(LEGACY_COMPARISON_POLICY_SETTINGS_KEY);
            this.savedComparisonPolicySettings = normalizeComparisonPolicySettings(
                this.comparisonPolicySettings,
            );
            this.comparisonPolicyDirty = false;
            this.ruleAuditLog = appendAuditEntry(this.ruleAuditLog, {
                action: 'policy.apply',
                before,
                after: this.savedComparisonPolicySettings,
                summary: {
                    profiles: this.savedComparisonPolicySettings.profiles.length,
                },
            });
            this.saveRuleAuditLog();
            return { ok: true, error: null };
        } catch (error) {
            this.savedComparisonPolicySettings = before;
            this.comparisonPolicyDirty = true;
            return { ok: false, error };
        }
    }

    loadFindingReviewDocument() {
        try {
            return normalizeFindingReviewDocument(JSON.parse(
                localStorage.getItem(FINDING_REVIEW_SETTINGS_KEY) ?? 'null',
            ) ?? DEFAULT_FINDING_REVIEW_DOCUMENT);
        } catch {
            return normalizeFindingReviewDocument(DEFAULT_FINDING_REVIEW_DOCUMENT);
        }
    }

    saveFindingReviewDocument(document = this.findingReviewDocument) {
        const normalized = normalizeFindingReviewDocument(document);
        try {
            const serialized = JSON.stringify(normalized);
            localStorage.setItem(FINDING_REVIEW_SETTINGS_KEY, serialized);
            if (localStorage.getItem(FINDING_REVIEW_SETTINGS_KEY) !== serialized) {
                throw new Error(t('comparison.storageVerificationFailed'));
            }
            this.findingReviewDocument = normalized;
            return { ok: true, error: null };
        } catch (error) {
            return { ok: false, error };
        }
    }

    loadRuleAuditLog() {
        try {
            return normalizeAuditLog(JSON.parse(
                localStorage.getItem(RULE_AUDIT_LOG_KEY) ?? 'null',
            ) ?? DEFAULT_AUDIT_LOG);
        } catch {
            return normalizeAuditLog(DEFAULT_AUDIT_LOG);
        }
    }

    saveRuleAuditLog(log = this.ruleAuditLog) {
        const normalized = normalizeAuditLog(log);
        try {
            localStorage.setItem(RULE_AUDIT_LOG_KEY, JSON.stringify(normalized));
            this.ruleAuditLog = normalized;
            return { ok: true, error: null };
        } catch (error) {
            return { ok: false, error };
        }
    }

    commitPolicyDraft() {
        const keys = [
            RULE_SETTINGS_KEY,
            COMPARISON_POLICY_SETTINGS_KEY,
            FINDING_REVIEW_SETTINGS_KEY,
            RULE_AUDIT_LOG_KEY,
        ];
        const backup = new Map();
        const previousState = {
            ruleSettings: this.ruleSettings,
            savedPolicy: this.savedComparisonPolicySettings,
            reviews: this.findingReviewDocument,
            audit: this.ruleAuditLog,
        };
        try {
            keys.forEach((key) => backup.set(key, localStorage.getItem(key)));
            const nextRuleSettings = normalizeRuleSettings(
                this.pendingImportedRuleSettings ?? this.ruleSettings,
            );
            const nextPolicy = normalizeComparisonPolicySettings(
                this.comparisonPolicySettings,
            );
            const nextReviews = normalizeFindingReviewDocument(
                this.pendingImportedReviews ?? this.findingReviewDocument,
            );
            const nextAudit = appendAuditEntry(this.ruleAuditLog, {
                action: this.pendingImportedRuleSettings
                    ? 'policy.import-apply'
                    : 'policy.apply',
                before: this.savedComparisonPolicySettings,
                after: nextPolicy,
                summary: {
                    profiles: nextPolicy.profiles.length,
                    imported: Boolean(this.pendingImportedRuleSettings),
                },
            });
            const values = new Map([
                [RULE_SETTINGS_KEY, JSON.stringify(nextRuleSettings)],
                [COMPARISON_POLICY_SETTINGS_KEY, JSON.stringify(nextPolicy)],
                [FINDING_REVIEW_SETTINGS_KEY, JSON.stringify(nextReviews)],
                [RULE_AUDIT_LOG_KEY, JSON.stringify(nextAudit)],
            ]);
            for (const [key, value] of values) {
                localStorage.setItem(key, value);
                if (localStorage.getItem(key) !== value) {
                    throw new Error(t('comparison.storageVerificationFailed'));
                }
            }
            localStorage.removeItem(LEGACY_COMPARISON_POLICY_SETTINGS_KEY);
            this.ruleSettings = nextRuleSettings;
            this.comparisonPolicySettings = nextPolicy;
            this.savedComparisonPolicySettings = normalizeComparisonPolicySettings(nextPolicy);
            this.findingReviewDocument = nextReviews;
            this.ruleAuditLog = nextAudit;
            this.comparisonPolicyDirty = false;
            this.pendingImportedRuleSettings = null;
            this.pendingImportedReviews = null;
            this.invalidatePolicyPreview();
            return { ok: true, error: null };
        } catch (error) {
            for (const [key, value] of backup) {
                try {
                    if (value == null) localStorage.removeItem(key);
                    else localStorage.setItem(key, value);
                } catch {
                    // Preserve the original error; in-memory state still rolls back.
                }
            }
            this.ruleSettings = previousState.ruleSettings;
            this.savedComparisonPolicySettings = previousState.savedPolicy;
            this.findingReviewDocument = previousState.reviews;
            this.ruleAuditLog = previousState.audit;
            this.comparisonPolicyDirty = true;
            this.invalidatePolicyPreview();
            return { ok: false, error };
        }
    }

    handleTabKeydown(event, id) {
        const ids = TABS.map(([tabId]) => tabId);
        const currentIndex = ids.indexOf(id);
        let nextIndex = null;
        if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % ids.length;
        if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + ids.length) % ids.length;
        if (event.key === 'Home') nextIndex = 0;
        if (event.key === 'End') nextIndex = ids.length - 1;
        if (nextIndex == null) return;
        event.preventDefault();
        this.selectTab(ids[nextIndex], { focus: true });
    }

    selectTab(id, { focus = false } = {}) {
        const nextTab = TABS.some(([tabId]) => tabId === id) ? id : 'explorer';
        const changed = nextTab !== this.activeTab;
        this.activeTab = nextTab;
        localStorage.setItem(LAST_TAB_KEY, this.activeTab);
        this.render();
        if (this.activeTab === 'timeline' && this.root && !this.root.hidden) {
            void this.refreshStorageSummary();
        }
        if (changed && this.content) this.content.scrollTop = 0;
        if (focus) this.activeTabButton()?.focus();
    }

    render() {
        if (!this.content) return;
        this.invalidateAnalysisState();
        this.disposeVirtualLists();
        this.syncOpaqueTheme();
        for (const button of this.window.querySelectorAll('.st-devtools-app-nav-item')) {
            const active = button.dataset.tab === this.activeTab;
            button.classList.toggle('active', active);
            button.setAttribute('aria-selected', String(active));
            button.tabIndex = active ? 0 : -1;
        }
        this.content.id = this.panelElementId(this.activeTab);
        this.content.setAttribute('aria-labelledby', this.tabElementId(this.activeTab));
        this.content.replaceChildren(this.renderScreenHeader(this.activeTab));
        if (this.storageErrors.length > 0) {
            this.content.appendChild(this.renderStorageErrors());
        }

        const snapshot = this.selectedSnapshot();
        if (!snapshot && this.activeTab !== 'timeline') {
            this.content.appendChild(this.renderEmpty());
            return;
        }
        const privacyMode = snapshot?.privacy?.mode ?? 'full';
        if (snapshot && privacyMode !== 'full') {
            const privacyNotice = this.renderSnapshotPrivacyNotice(snapshot);
            if (privacyMode === 'metadata' && this.activeTab !== 'timeline') {
                this.content.appendChild(this.renderMetadataOnlySnapshot(
                    snapshot,
                    privacyNotice,
                ));
                return;
            }
            if (
                privacyMode === 'redacted'
                && ['rules', 'search'].includes(this.activeTab)
            ) {
                this.content.appendChild(this.renderRedactedLimitedFeature(
                    snapshot,
                    privacyNotice,
                ));
                return;
            }
            this.content.appendChild(privacyNotice);
        }

        const renderers = {
            explorer: () => this.renderExplorer(snapshot),
            timeline: () => this.renderTimeline(),
            diff: () => this.renderDiff(),
            context: () => this.renderContext(snapshot),
            rules: () => this.renderRules(snapshot),
            search: () => this.renderSearch(snapshot),
        };
        this.content.appendChild(renderers[this.activeTab]());
    }

    renderSnapshotPrivacyNotice(snapshot) {
        const mode = snapshot?.privacy?.mode === 'metadata'
            ? 'metadata'
            : 'redacted';
        const notice = element('section', {
            className: `st-devtools-privacy-notice is-${mode}`,
        });
        notice.setAttribute('role', 'status');
        notice.append(
            element('strong', {
                text: t(`privacy.noticeTitle.${mode}`),
            }),
            proseElement('p', t(`privacy.noticeDescription.${mode}`)),
        );
        return notice;
    }

    renderMetadataOnlySnapshot(snapshot, privacyNotice = null) {
        const page = element('div', {
            className: 'st-devtools-page st-devtools-metadata-only',
        });
        page.appendChild(this.renderSnapshotPicker());
        if (privacyNotice) page.appendChild(privacyNotice);
        const metrics = element('dl', {
            className: 'st-devtools-metadata-only-metrics',
        });
        const addMetric = (label, value) => {
            metrics.append(
                element('dt', { text: label }),
                element('dd', { text: value }),
            );
        };
        addMetric(t('privacy.provider'), snapshotProviderDisplay(snapshot));
        addMetric(t('privacy.model'), snapshot.model ?? t('common.unknown'));
        addMetric(
            t('stat.promptTokens'),
            String(snapshot.stats?.totalTokens ?? 0),
        );
        addMetric(
            t('privacy.sourceCount'),
            String(snapshot.privacySummary?.sourceCount ?? 0),
        );
        page.append(
            proseElement('p', t('privacy.metadataUnavailable')),
            metrics,
            this.renderUsageCard(snapshot),
        );
        return page;
    }

    renderRedactedLimitedFeature(snapshot, privacyNotice = null) {
        const page = element('div', {
            className: 'st-devtools-page st-devtools-redacted-limited',
        });
        page.append(
            this.renderSnapshotPicker(),
            ...(privacyNotice ? [privacyNotice] : []),
            proseElement('p', t('privacy.redactedAnalysisUnavailable')),
        );
        return page;
    }

    renderStorageErrors() {
        const region = element('section', { className: 'st-devtools-storage-errors' });
        region.setAttribute('role', 'alert');
        region.setAttribute('aria-live', 'assertive');
        const kinds = new Set(this.storageErrors.map(({ kind }) => kind ?? 'storage'));
        const titleKey = kinds.size > 1
            ? 'error.generalTitle'
            : kinds.has('capture')
                ? 'capture.errorTitle'
                : 'storage.errorTitle';
        region.appendChild(element('strong', { text: t(titleKey) }));
        for (const item of this.storageErrors) {
            const row = element('div', { className: 'st-devtools-storage-error' });
            row.appendChild(element('span', {
                text: t('storage.errorMessage', { message: item.message }),
            }));
            const actions = element('span', { className: 'st-devtools-storage-error-actions' });
            if (item.retry) {
                const retry = element('button', {
                    className: 'menu_button',
                    text: item.pending ? t('storage.retrying') : t('action.retry'),
                    type: 'button',
                });
                retry.disabled = item.pending;
                retry.addEventListener('click', () => this.retryStorageError(item));
                actions.appendChild(retry);
            }
            const dismiss = element('button', {
                className: 'menu_button',
                text: t('action.dismiss'),
                type: 'button',
            });
            dismiss.addEventListener('click', () => {
                this.storageErrors = this.storageErrors.filter((existing) => existing.id !== item.id);
                this.render();
            });
            actions.appendChild(dismiss);
            row.appendChild(actions);
            region.appendChild(row);
        }
        return region;
    }

    renderEmpty() {
        const empty = element('div', { className: 'st-devtools-empty' });
        empty.append(
            element('i', { className: 'fa-solid fa-wave-square' }),
            element('h3', { text: t('empty.title') }),
            proseElement('p', t('empty.description')),
            this.renderQuickStart({ showHeading: true }),
        );
        const actions = element('div', {
            className: 'st-devtools-empty-actions',
        });
        const back = element('button', {
            className: 'menu_button st-devtools-primary-button',
            text: t('action.returnToChat'),
            type: 'button',
        });
        back.addEventListener('click', () => this.close());
        const refresh = element('button', {
            className: 'menu_button',
            text: t('action.refresh'),
            type: 'button',
        });
        refresh.addEventListener('click', () => this.refresh());
        actions.append(back, refresh);
        empty.appendChild(actions);
        return empty;
    }

    renderSnapshotPicker(labelText = t('snapshot.label')) {
        const wrapper = element('div', { className: 'st-devtools-picker' });
        wrapper.dataset.tourId = 'snapshot-picker';
        wrapper.appendChild(element('span', {
            className: 'st-devtools-picker-label',
            text: labelText,
        }));
        const select = element('select');
        select.setAttribute('aria-label', labelText);
        for (const snapshot of [...this.timeline].reverse()) {
            const option = element('option', {
                text: `${formatTimestamp(snapshot.timestamp)} · ${snapshotProviderDisplay(snapshot)} · ${t('snapshot.tokens', { count: snapshot.stats?.totalTokens ?? 0 })}`,
            });
            option.value = snapshot.id;
            option.selected = snapshot.id === this.selectedId;
            select.appendChild(option);
        }
        select.addEventListener('change', () => {
            this.selectedId = select.value;
            this.render();
        });
        wrapper.appendChild(select);
        return wrapper;
    }

    renderProvenanceDetails(source) {
        const provenance = source?.provenance ?? {};
        const locations = Array.isArray(provenance.locations)
            ? provenance.locations.filter((location) => (
                location
                && typeof location === 'object'
                && typeof location.jsonPointer === 'string'
            ))
            : [];
        const availability = provenance.availability
            ?? (locations.length > 0 ? 'available' : 'unavailable');
        const locationCount = Math.max(
            locations.length,
            normalizedCount(provenance.locationCount, locations.length),
        );
        const details = element('details', {
            className: 'st-devtools-provenance-details st-devtools-disclosure',
        });
        const summary = element('summary');
        const heading = element('span', {
            className: 'st-devtools-provenance-heading',
        });
        heading.appendChild(explainedTitle(
            t('explorer.provenanceTitle'),
            t('explorer.provenanceDescription'),
        ));
        summary.append(
            heading,
            element('span', {
                className: `st-devtools-badge provenance-${availability}`,
                text: locations.length > 0
                    ? t('explorer.provenanceCount', { count: locationCount })
                    : provenanceAvailabilityLabel(availability),
            }),
        );
        details.appendChild(summary);
        attachLazyDetailsContent(details, () => {
            const content = element('div', {
                className: 'st-devtools-provenance-content',
            });
            if (locations.length === 0) {
                content.appendChild(proseElement(
                    'p',
                    t(availability === 'legacy-unavailable'
                        ? 'explorer.provenanceLegacyUnavailable'
                        : 'explorer.provenanceUnavailable'),
                ));
                return content;
            }

            const list = element('ol', {
                className: 'st-devtools-provenance-list',
            });
            for (const [index, location] of locations.entries()) {
                const item = element('li', {
                    className: 'st-devtools-provenance-location',
                });
                item.append(
                    element('strong', {
                        text: t('explorer.provenanceLocation', {
                            count: index + 1,
                        }),
                    }),
                    element('code', {
                        text: location.jsonPointer || '/',
                    }),
                );
                const metadata = element('span', {
                    className: 'st-devtools-provenance-location-meta',
                });
                if (Number.isInteger(location.messageIndex)) {
                    metadata.appendChild(element('span', {
                        text: t('explorer.provenanceMessage', {
                            count: location.messageIndex + 1,
                        }),
                    }));
                }
                if (location.role) {
                    metadata.appendChild(element('span', {
                        text: t('explorer.provenanceRole', {
                            role: location.role,
                        }),
                    }));
                }
                if (
                    Number.isInteger(location.valueRange?.start)
                    && Number.isInteger(location.valueRange?.end)
                ) {
                    metadata.appendChild(element('span', {
                        text: t('explorer.provenanceValueRange', {
                            start: location.valueRange.start,
                            end: location.valueRange.end,
                        }),
                    }));
                }
                if (
                    Number.isInteger(location.finalRange?.start)
                    && Number.isInteger(location.finalRange?.end)
                ) {
                    metadata.appendChild(element('span', {
                        text: t('explorer.provenanceFinalRange', {
                            start: location.finalRange.start,
                            end: location.finalRange.end,
                        }),
                    }));
                }
                if (metadata.childElementCount > 0) item.appendChild(metadata);
                list.appendChild(item);
            }
            content.appendChild(list);
            if (
                provenance.locationsTruncated
                || locationCount > locations.length
            ) {
                content.appendChild(proseElement(
                    'small',
                    t('explorer.provenanceTruncated', {
                        total: locationCount,
                        shown: locations.length,
                    }),
                    { className: 'st-devtools-provenance-truncated' },
                ));
            }
            return content;
        });
        return details;
    }

    renderExplorerOverview(snapshot) {
        const overview = element('section', {
            className: 'st-devtools-overview-card',
        });
        const headline = element('div', {
            className: 'st-devtools-overview-headline',
        });
        const summary = element('div', {
            className: 'st-devtools-overview-summary',
        });
        summary.append(
            element('span', {
                className: 'st-devtools-overview-kicker',
                text: t('explorer.overviewTitle'),
            }),
            element('strong', {
                className: 'st-devtools-overview-total',
                text: snapshot.stats?.totalTokens ?? 0,
            }),
            element('span', {
                className: 'st-devtools-overview-total-label',
                text: t('stat.promptTokens'),
            }),
        );
        const model = element('span', {
            className: 'st-devtools-overview-model',
            text: t('explorer.overviewModel', {
                provider: snapshotProviderDisplay(snapshot),
                model: snapshot.model ?? t('common.unknown'),
            }),
        });
        headline.append(summary, model);

        const usage = Number.isFinite(snapshot.stats?.contextUsage)
            ? Math.max(0, Math.min(1, snapshot.stats.contextUsage))
            : null;
        const usageText = usage == null
            ? t('common.unknown')
            : `${(usage * 100).toFixed(1)}%`;
        const progressGroup = element('div', {
            className: 'st-devtools-overview-progress-group',
        });
        const progressLabels = element('div', {
            className: 'st-devtools-overview-progress-labels',
        });
        progressLabels.append(
            element('span', { text: t('stat.contextUsage') }),
            element('strong', { text: usageText }),
        );
        const progress = element('div', {
            className: 'st-devtools-overview-progress',
        });
        progress.setAttribute('role', 'progressbar');
        progress.setAttribute('aria-label', t('stat.contextUsage'));
        progress.setAttribute('aria-valuemin', '0');
        progress.setAttribute('aria-valuemax', '100');
        progress.setAttribute('aria-valuetext', usageText);
        if (usage != null) progress.setAttribute('aria-valuenow', String(Math.round(usage * 100)));
        const progressValue = element('span', {
            className: 'st-devtools-overview-progress-value',
        });
        progressValue.style.width = `${usage == null ? 0 : usage * 100}%`;
        progress.appendChild(progressValue);
        progressGroup.append(progressLabels, progress);

        const remaining = element('div', {
            className: 'st-devtools-overview-remaining',
        });
        remaining.append(
            element('span', { text: t('stat.remaining') }),
            element('strong', {
                text: snapshot.stats?.remainingContext ?? t('common.unknown'),
            }),
        );

        overview.append(
            headline,
            progressGroup,
            remaining,
            this.renderSnapshotPicker(),
        );
        return overview;
    }

    renderExplorer(snapshot) {
        const page = element('div', { className: 'st-devtools-page' });
        const sourceGroups = explorerSourceGroups(snapshot.sources);
        const configuredGroup = sourceGroups.find((group) => group.key === 'configured');
        const promptManagerOrder = configuredGroup?.promptManagerOrder ?? false;
        page.append(this.renderExplorerOverview(snapshot));
        const guide = element('details', {
            className: 'st-devtools-disclosure st-devtools-explorer-guide',
        });
        const guideList = element('ul');
        guideList.append(
            proseElement(
                'li',
                t(promptManagerOrder
                    ? 'explorer.guideOrder'
                    : 'explorer.guideOrderFallback'),
            ),
            proseElement('li', t('explorer.guideColor')),
            proseElement('li', t('explorer.guideStatus')),
        );
        const guideSummary = element('summary');
        guideSummary.appendChild(explainedTitle(
            t('explorer.guideTitle'),
            t('explorer.guideDescription'),
        ));
        guide.append(guideSummary, guideList);
        page.appendChild(guide);

        const sourceById = new Map(snapshot.sources.map((source) => [source.id, source]));
        const groups = element('div', { className: 'st-devtools-source-groups' });

        for (const groupData of sourceGroups) {
            const group = element('details', { className: 'st-devtools-source-group' });
            group.dataset.group = groupData.key;
            group.open = groupData.open;
            const groupSummary = element('summary');
            const groupHeading = element('span', { className: 'st-devtools-source-group-heading' });
            const groupTitle = t(`explorer.group.${groupData.key}`);
            const groupDescription = t(
                groupData.key === 'configured' && !groupData.promptManagerOrder
                    ? 'explorer.introFallback'
                    : groupData.key === 'configured'
                        ? 'explorer.intro'
                        : `explorer.group.${groupData.key}Description`,
            );
            groupHeading.append(explainedTitle(groupTitle, groupDescription));
            groupSummary.append(
                groupHeading,
                element('span', {
                    className: 'st-devtools-source-group-count',
                    text: t('explorer.groupCount', { count: groupData.sources.length }),
                }),
            );
            const sourceList = element('div', { className: 'st-devtools-source-list' });
            const renderSourceCard = (source, sourceIndex) => {
                const details = element('details', { className: 'st-devtools-source' });
                details.dataset.sourceId = source.id;
                details.dataset.sourceType = source.type;
                details.style.setProperty('--source-color', source.color);
                details.open = this.openSourceIds.has(source.id);
                details.addEventListener('toggle', () => {
                    if (details.open) this.openSourceIds.add(source.id);
                    else this.openSourceIds.delete(source.id);
                });
                const summary = element('summary');
                const heading = element('span', { className: 'st-devtools-source-heading' });
                if (isConfiguredPromptSource(source)) {
                    const promptOrder = Number(source.metadata?.promptOrder);
                    heading.appendChild(element('span', {
                        className: 'st-devtools-source-order',
                        text: t('explorer.promptOrder', {
                            count: Number.isFinite(promptOrder)
                                ? promptOrder + 1
                                : sourceIndex + 1,
                        }),
                    }));
                }
                heading.appendChild(element('span', {
                    className: 'st-devtools-source-name',
                    text: sourceDisplayLabel(source),
                }));
                const badges = element('span', { className: 'st-devtools-badges' });
                const multimodalLabels = source.type === 'multimodal'
                    ? multimodalEstimateLabels(source)
                    : null;
                badges.appendChild(element('span', {
                    className: 'st-devtools-badge',
                    text: multimodalLabels?.estimate
                        ?? t('snapshot.tokens', { count: source.tokenCount }),
                }));
                if (source.type !== 'final') {
                    const state = explorerSourceState(source);
                    badges.appendChild(element('span', {
                        className: `st-devtools-badge source-state-${state}`,
                        text: t(`explorer.state.${state}`),
                    }));
                }
                const sourcePrefillStatus = prefillStatus(source);
                if (sourcePrefillStatus) {
                    badges.appendChild(element('span', {
                        className: `st-devtools-badge prefill-${sourcePrefillStatus}`,
                        text: t(`explorer.prefillStatus.${sourcePrefillStatus}`),
                        title: t(
                            `explorer.prefillStatusDescription.${sourcePrefillStatus}`,
                        ),
                    }));
                }
                summary.append(heading, badges);

                details.appendChild(summary);
                attachLazyDetailsContent(details, () => {
                    const body = element('div', { className: 'st-devtools-source-body' });
                    if (source.type !== 'final') {
                        const metadata = element('div', { className: 'st-devtools-source-meta' });
                        const attribution = element('span', {
                            className: 'st-devtools-source-attribution',
                        });
                        attribution.append(
                            element('strong', {
                                text: `${t('explorer.attributionLabel')}: ${attributionDisplayLabel(source.attribution)}`,
                            }),
                            proseElement(
                                'small',
                                t(`explorer.attribution.${source.attribution}`),
                            ),
                        );
                        metadata.appendChild(attribution);
                        if (
                            source.attribution === 'template'
                            && Number.isFinite(source.provenance?.confidence)
                        ) {
                            metadata.appendChild(element('span', {
                                className: 'st-devtools-badge st-devtools-provenance-confidence',
                                text: t('provenance.confidence', {
                                    count: Math.round(source.provenance.confidence * 100),
                                }),
                                title: source.provenance.method ?? 'macro-template',
                            }));
                        }
                        if (multimodalLabels) {
                            metadata.appendChild(element('span', {
                                className: 'st-devtools-badge st-devtools-multimodal-method',
                                text: multimodalLabels.method,
                            }));
                        }
                        if (source.ranges?.length) {
                            metadata.appendChild(element('span', {
                                className: 'st-devtools-badge',
                                text: t('explorer.finalLocation', { count: source.ranges.length }),
                            }));
                        }
                        body.appendChild(metadata);
                        if (source.ranges?.length) {
                            const actions = element('div', {
                                className: 'st-devtools-source-actions',
                            });
                            const jump = element('button', {
                                className: 'menu_button st-devtools-range-jump',
                                text: t('action.jumpToFinal'),
                                type: 'button',
                            });
                            jump.setAttribute(
                                'aria-label',
                                `${sourceDisplayLabel(source)}: ${t('action.jumpToFinal')}`,
                            );
                            jump.addEventListener('click', () => this.jumpToFinalRange(source.id));
                            actions.appendChild(jump);
                            body.appendChild(actions);
                        }
                    }
                    if (source.provenance) {
                        body.appendChild(this.renderProvenanceDetails(source));
                    }
                    const pre = source.type === 'final'
                        ? this.renderMappedFinalPrompt(source.content, snapshot.sources, sourceById)
                        : element('pre', { text: source.content });
                    body.appendChild(pre);
                    return body;
                });
                if (source.type !== 'final' && source.ranges?.length) {
                    details.addEventListener('pointerenter', () => this.highlightSourceMapping([source.id]));
                    details.addEventListener('pointerleave', () => this.clearSourceMapping());
                    details.addEventListener('focusin', () => this.highlightSourceMapping([source.id]));
                    details.addEventListener('focusout', (event) => {
                        if (!details.contains(event.relatedTarget)) this.clearSourceMapping();
                    });
                }
                return details;
            };
            let sourceListController = null;
            const mountSourceList = () => {
                if (!sourceListController) {
                    sourceListController = this.mountVirtualList(
                        sourceList,
                        groupData.sources,
                        {
                            estimatedRowHeight: 92,
                            renderItem: renderSourceCard,
                            focusSelector: 'summary',
                            ariaLabel: groupTitle,
                        },
                    );
                }
                return sourceList;
            };
            group.appendChild(groupSummary);
            attachLazyDetailsContent(group, mountSourceList);
            groupData.sources.forEach((source, sourceIndex) => {
                this.virtualSourceLists.set(source.id, {
                    group,
                    index: sourceIndex,
                    ensureMounted: () => {
                        group.open = true;
                        mountDetailsContent(group);
                        return sourceListController;
                    },
                });
            });
            groups.appendChild(group);
        }
        page.appendChild(groups);
        return page;
    }

    renderMappedFinalPrompt(text, sources, sourceById) {
        const pre = element('pre', { className: 'st-devtools-final-prompt' });
        for (const segment of buildRangeSegments(text, sources)) {
            const classNames = ['st-devtools-final-segment'];
            if (segment.sourceIds.length === 0) {
                const unmapped = element('span', {
                    className: classNames.join(' '),
                    text: segment.text,
                });
                unmapped.dataset.start = String(segment.start);
                unmapped.dataset.end = String(segment.end);
                unmapped.tabIndex = -1;
                pre.appendChild(unmapped);
                continue;
            }
            classNames.push('st-devtools-final-range');
            const labels = segment.sourceIds
                .map((id) => sourceById.get(id))
                .filter(Boolean)
                .map((source) => sourceDisplayLabel(source));
            const mapped = element('span', {
                className: classNames.join(' '),
                text: segment.text,
                title: t('explorer.mappedSources', { sources: labels.join(', ') }),
            });
            mapped.dataset.sourceIds = JSON.stringify(segment.sourceIds);
            mapped.dataset.start = String(segment.start);
            mapped.dataset.end = String(segment.end);
            mapped.tabIndex = 0;
            mapped.setAttribute('role', 'button');
            const focus = () => this.highlightSourceMapping(segment.sourceIds);
            mapped.addEventListener('pointerenter', focus);
            mapped.addEventListener('pointerleave', () => this.clearSourceMapping());
            mapped.addEventListener('focus', focus);
            mapped.addEventListener('blur', () => this.clearSourceMapping());
            mapped.addEventListener('click', () => this.jumpToSourceCard(segment.sourceIds[0]));
            mapped.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    this.jumpToSourceCard(segment.sourceIds[0]);
                }
            });
            pre.appendChild(mapped);
        }
        return pre;
    }

    rangeSourceIds(node) {
        try {
            return JSON.parse(node.dataset.sourceIds ?? '[]');
        } catch {
            return [];
        }
    }

    highlightSourceMapping(sourceIds) {
        const selected = new Set(sourceIds);
        for (const card of this.window.querySelectorAll('.st-devtools-source')) {
            card.classList.toggle('mapping-focus', selected.has(card.dataset.sourceId));
        }
        for (const range of this.window.querySelectorAll('.st-devtools-final-range')) {
            range.classList.toggle(
                'mapping-focus',
                this.rangeSourceIds(range).some((id) => selected.has(id)),
            );
        }
    }

    clearSourceMapping() {
        for (const node of this.window.querySelectorAll('.mapping-focus')) {
            node.classList.remove('mapping-focus');
        }
    }

    jumpToFinalRange(sourceId) {
        const finalCard = [...this.window.querySelectorAll('.st-devtools-source')]
            .find((node) => node.dataset.sourceType === 'final');
        if (!finalCard) return;
        finalCard.closest('.st-devtools-source-group')?.setAttribute('open', '');
        finalCard.open = true;
        mountDetailsContent(finalCard);
        const range = [...this.window.querySelectorAll('.st-devtools-final-range')]
            .find((node) => this.rangeSourceIds(node).includes(sourceId));
        if (!range) return;
        this.highlightSourceMapping([sourceId]);
        range.focus({ preventScroll: true });
        range.scrollIntoView({ block: 'center', behavior: 'auto' });
    }

    jumpToSourceCard(sourceId) {
        let card = [...this.window.querySelectorAll('.st-devtools-source')]
            .find((node) => node.dataset.sourceId === sourceId);
        if (!card) {
            const virtualTarget = this.virtualSourceLists.get(sourceId);
            const controller = virtualTarget?.ensureMounted?.();
            controller?.scrollToIndex?.(virtualTarget.index);
            card = [...this.window.querySelectorAll('.st-devtools-source')]
                .find((node) => node.dataset.sourceId === sourceId);
        }
        if (!card) return;
        card.closest('.st-devtools-source-group')?.setAttribute('open', '');
        card.open = true;
        mountDetailsContent(card);
        this.highlightSourceMapping([sourceId]);
        card.querySelector('summary')?.focus({ preventScroll: true });
        card.scrollIntoView({ block: 'center', behavior: 'auto' });
    }

    clearRuleFocus() {
        for (const mark of this.window.querySelectorAll('.st-devtools-rule-evidence-mark')) {
            const parent = mark.parentNode;
            mark.replaceWith(document.createTextNode(mark.textContent ?? ''));
            parent?.normalize();
        }
        for (const node of this.window.querySelectorAll('.rule-focus')) {
            node.classList.remove('rule-focus');
        }
    }

    scheduleExplorerFocus(callback) {
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(callback);
            return;
        }
        setTimeout(callback, 0);
    }

    openExplorerForFinding(snapshot, finding, target) {
        this.selectedId = snapshot.id;
        this.activeTab = 'explorer';
        localStorage.setItem(LAST_TAB_KEY, this.activeTab);
        this.render();
        this.scheduleExplorerFocus(() => {
            if (target === 'sources') {
                this.focusRuleSources(finding.sourceIds, finding.finalRanges);
            } else {
                this.focusRuleEvidence(finding.finalRanges, finding.sourceIds);
            }
        });
    }

    focusRuleSources(sourceIds, finalRanges = []) {
        this.clearRuleFocus();
        const selected = new Set(sourceIds);
        let cards = [...this.window.querySelectorAll('.st-devtools-source')]
            .filter((node) => selected.has(node.dataset.sourceId));
        if (cards.length === 0 && sourceIds?.[0]) {
            const virtualTarget = this.virtualSourceLists.get(sourceIds[0]);
            const controller = virtualTarget?.ensureMounted?.();
            controller?.scrollToIndex?.(virtualTarget.index);
            cards = [...this.window.querySelectorAll('.st-devtools-source')]
                .filter((node) => selected.has(node.dataset.sourceId));
        }
        for (const card of cards) {
            card.closest('.st-devtools-source-group')?.setAttribute('open', '');
            card.open = true;
            mountDetailsContent(card);
            card.classList.add('rule-focus');
        }
        this.highlightSourceMapping(sourceIds);
        this.highlightFinalEvidence(finalRanges);
        const first = cards[0];
        if (!first) return;
        first.scrollIntoView({ block: 'center', behavior: 'smooth' });
        first.querySelector('summary')?.focus({ preventScroll: true });
    }

    highlightFinalEvidence(ranges) {
        const normalized = (ranges ?? [])
            .map(({ start, end }) => ({ start: Number(start), end: Number(end) }))
            .filter(({ start, end }) => Number.isFinite(start) && Number.isFinite(end) && end > start);
        const matches = [];
        for (const segment of this.window.querySelectorAll('.st-devtools-final-segment')) {
            const segmentStart = Number(segment.dataset.start);
            const segmentEnd = Number(segment.dataset.end);
            const intersections = normalized
                .map((range) => ({
                    start: Math.max(segmentStart, range.start),
                    end: Math.min(segmentEnd, range.end),
                }))
                .filter(({ start, end }) => end > start)
                .sort((left, right) => left.start - right.start);
            if (intersections.length === 0) continue;

            const merged = [];
            for (const intersection of intersections) {
                const previous = merged.at(-1);
                if (previous && intersection.start <= previous.end) {
                    previous.end = Math.max(previous.end, intersection.end);
                } else {
                    merged.push({ ...intersection });
                }
            }
            const text = segment.textContent ?? '';
            const fragment = document.createDocumentFragment();
            let cursor = segmentStart;
            for (const intersection of merged) {
                if (intersection.start > cursor) {
                    fragment.appendChild(document.createTextNode(
                        text.slice(cursor - segmentStart, intersection.start - segmentStart),
                    ));
                }
                const mark = element('mark', {
                    className: 'st-devtools-rule-evidence-mark',
                    text: text.slice(
                        intersection.start - segmentStart,
                        intersection.end - segmentStart,
                    ),
                });
                fragment.appendChild(mark);
                cursor = intersection.end;
            }
            if (cursor < segmentEnd) {
                fragment.appendChild(document.createTextNode(text.slice(cursor - segmentStart)));
            }
            segment.replaceChildren(fragment);
            segment.classList.add('rule-focus');
            matches.push(segment);
        }
        return matches;
    }

    focusRuleEvidence(finalRanges, sourceIds = []) {
        this.clearRuleFocus();
        this.highlightSourceMapping(sourceIds);
        const finalCard = [...this.window.querySelectorAll('.st-devtools-source')]
            .find((node) => node.dataset.sourceType === 'final');
        if (finalCard) {
            finalCard.closest('.st-devtools-source-group')?.setAttribute('open', '');
            finalCard.open = true;
            mountDetailsContent(finalCard);
        }
        const matches = this.highlightFinalEvidence(finalRanges);
        const first = matches[0];
        if (first) {
            first.scrollIntoView({ block: 'center', behavior: 'smooth' });
            first.focus({ preventScroll: true });
            return;
        }
        if (!finalCard) return;
        finalCard.classList.add('rule-focus');
        finalCard.scrollIntoView({ block: 'center', behavior: 'smooth' });
        finalCard.querySelector('summary')?.focus({ preventScroll: true });
    }

    renderTimeline() {
        const page = element('div', { className: 'st-devtools-page' });
        const analyses = buildTimelineAnalysis(this.timeline, { includeSourceChanges: false });
        this.pruneTimelineSelection();
        const loadedStatus = element('p', {
            className: 'st-devtools-section-intro',
            text: this.timelineTotalCount > this.timeline.length
                ? t('snapshot.loadedSubset', {
                    loaded: this.timeline.length,
                    total: this.timelineTotalCount,
                })
                : t('snapshot.loadedAll', { count: this.timeline.length }),
        });
        const storageOverview = this.renderStorageOverview();
        let corruptWarning = null;
        if (this.timelineCorruptCount > 0) {
            corruptWarning = element('section', {
                className: 'st-devtools-corrupt-warning',
            });
            corruptWarning.setAttribute('role', 'status');
            corruptWarning.append(
                element('strong', { text: t('storage.corruptSnapshotsTitle') }),
                proseElement('p', t('storage.corruptSnapshotsDescription', {
                    count: this.timelineCorruptCount,
                })),
            );
        }

        const toolbox = element('details', {
            className: 'st-devtools-toolbox st-devtools-timeline-toolbox',
        });
        const toolboxSummary = element('summary');
        const toolboxHeading = element('span', { className: 'st-devtools-toolbox-heading' });
        toolboxHeading.append(explainedTitle(
            t('timeline.toolsTitle'),
            t('timeline.toolsDescription'),
        ));
        toolboxSummary.appendChild(toolboxHeading);
        const toolboxContent = element('div', { className: 'st-devtools-toolbox-content' });
        const toolRow = (titleKey, descriptionKey, buttons, className = '') => {
            const row = element('div', {
                className: `st-devtools-tool-row ${className}`.trim(),
            });
            const description = element('span', { className: 'st-devtools-tool-description' });
            description.append(explainedTitle(t(titleKey), t(descriptionKey)));
            const actions = element('span', { className: 'st-devtools-tool-row-actions' });
            actions.append(...buttons);
            row.append(description, actions);
            return row;
        };
        toolboxContent.append(
            toolRow(
                'timeline.currentReportTitle',
                'timeline.diagnosticDescription',
                [
                    this.renderTimelineDiagnosticButton('json'),
                    this.renderTimelineDiagnosticButton('markdown'),
                ],
            ),
            toolRow(
                'timeline.allReportTitle',
                'timeline.allDiagnosticDescription',
                [
                    this.renderAllTimelineDiagnosticButton('json'),
                    this.renderAllTimelineDiagnosticButton('markdown'),
                ],
            ),
        );
        const importInput = element('input', { className: 'st-devtools-file-input' });
        importInput.type = 'file';
        importInput.accept = '.json,application/json';
        importInput.hidden = true;
        importInput.addEventListener('change', async () => {
            const file = importInput.files?.[0];
            importInput.value = '';
            if (file) await this.importDiagnosticFile(file);
        });
        const importButton = element('button', {
            className: 'menu_button',
            text: t('action.importDiagnostics'),
            type: 'button',
        });
        importButton.addEventListener('click', () => importInput.click());
        const clear = element('button', { className: 'menu_button', text: t('action.clearTimeline'), type: 'button' });
        clear.disabled = this.timeline.length === 0;
        clear.addEventListener('click', async () => {
            if (!confirm(t('timeline.deleteConfirm'))) return;
            await this.clearCurrentTimeline();
        });
        const clearAll = element('button', {
            className: 'menu_button',
            text: t('action.clearAllData'),
            type: 'button',
        });
        clearAll.disabled = (
            this.storageSummary.snapshotCount != null
            && this.storageSummary.snapshotCount === 0
        );
        clearAll.addEventListener('click', async () => {
            if (!confirm(t('storage.clearAllConfirm', {
                count: this.storageSummary.snapshotCount ?? t('common.unknown'),
            }))) return;
            await this.clearAllSnapshots();
        });
        toolboxContent.append(
            toolRow(
                'timeline.importTitle',
                'timeline.importDescription',
                [importButton, importInput],
            ),
            toolRow(
                'timeline.clearTitle',
                'timeline.clearDescription',
                [clear],
                'is-danger',
            ),
            toolRow(
                'storage.clearAllTitle',
                'storage.clearAllDescription',
                [clearAll],
                'is-danger',
            ),
        );
        toolbox.append(toolboxSummary, toolboxContent);
        const diagnosticStatus = this.renderDiagnosticImportStatus();

        const storageDetails = element('details', {
            className: 'st-devtools-disclosure st-devtools-timeline-storage-details',
        });
        storageDetails.appendChild(element('summary', {
            text: t('timeline.storageDetailsTitle'),
        }));
        const storageContent = element('div', {
            className: 'st-devtools-timeline-storage-content',
        });
        storageContent.append(loadedStatus, storageOverview, toolbox);
        if (diagnosticStatus) storageContent.appendChild(diagnosticStatus);
        storageDetails.appendChild(storageContent);

        if (this.timeline.length === 0) {
            page.appendChild(this.renderEmpty());
            if (corruptWarning) page.appendChild(corruptWarning);
            page.appendChild(storageDetails);
            return page;
        }

        page.appendChild(this.renderGrowthChart(analyses, this.timelineTotalCount));
        if (corruptWarning) page.appendChild(corruptWarning);
        const timelineItems = [...analyses].reverse();
        const renderTimelineEntry = (analysis) => {
            const { snapshot, previous, tokenDelta, lore } = analysis;
            const entry = element('article', { className: 'st-devtools-timeline-entry' });
            entry.classList.toggle('active', snapshot.id === this.selectedId);
            entry.classList.toggle('is-selected', this.selectedTimelineIds.has(snapshot.id));
            const selectWrapper = element('label', {
                className: 'st-devtools-timeline-select',
            });
            const select = element('input');
            select.type = 'checkbox';
            select.checked = this.selectedTimelineIds.has(snapshot.id);
            select.dataset.snapshotId = snapshot.id;
            select.setAttribute(
                'aria-label',
                t('timeline.selectSnapshot', { time: formatTimestamp(snapshot.timestamp) }),
            );
            select.addEventListener('change', () => {
                if (select.checked) {
                    this.selectedTimelineIds.add(snapshot.id);
                } else {
                    this.selectedTimelineIds.delete(snapshot.id);
                }
                this.updateTimelineSelectionControls();
            });
            selectWrapper.appendChild(select);
            const button = element('button', { className: 'st-devtools-timeline-item', type: 'button' });
            const heading = element('strong', { text: formatTimestamp(snapshot.timestamp) });
            const metadata = element('span', {
                text: `${snapshotProviderDisplay(snapshot)} · ${snapshot.model ?? t('timeline.unknownModel')} · ${t('snapshot.tokens', { count: snapshot.stats?.totalTokens ?? 0 })}`,
            });
            const loreMetadata = element('small', {
                text: `${promptTypeDisplayLabel(snapshot.promptType)} · ${t('timeline.loreCount', { count: snapshot.lorebookEntries?.length ?? 0 })} · ${generationTypeDisplayLabel(snapshot.generationType)}`,
            });
            const changes = element('span', { className: 'st-devtools-timeline-changes' });
            changes.appendChild(element('span', {
                className: `st-devtools-change-pill${tokenDelta > 0 ? ' increased' : tokenDelta < 0 ? ' decreased' : ''}`,
                text: previous
                    ? t('timeline.tokenDelta', { delta: formatDelta(tokenDelta) })
                    : this.timelineTotalCount > this.timeline.length
                        ? t('timeline.firstLoadedSnapshot')
                        : t('timeline.firstSnapshot'),
            }));
            if (previous) {
                if (lore.activated.length) {
                    changes.appendChild(element('span', {
                        className: 'st-devtools-change-pill activated',
                        text: t('timeline.loreActivated', { count: lore.activated.length }),
                    }));
                }
                if (lore.removed.length) {
                    changes.appendChild(element('span', {
                        className: 'st-devtools-change-pill removed',
                        text: t('timeline.loreRemoved', { count: lore.removed.length }),
                    }));
                }
                if (lore.changed?.length) {
                    changes.appendChild(element('span', {
                        className: 'st-devtools-change-pill changed',
                        text: t('timeline.loreChanged', { count: lore.changed.length }),
                    }));
                }
                if (
                    !lore.activated.length
                    && !lore.removed.length
                    && !(lore.changed?.length)
                ) {
                    changes.appendChild(element('span', {
                        className: 'st-devtools-change-pill',
                        text: t('timeline.loreNoChanges'),
                    }));
                }
            }
            button.append(heading, metadata, loreMetadata, changes);
            button.addEventListener('click', () => {
                this.selectedId = snapshot.id;
                this.selectTab('explorer');
            });

            const remove = element('button', {
                className: 'menu_button st-devtools-timeline-delete',
                title: t('action.deleteSnapshot'),
                type: 'button',
            });
            remove.setAttribute('aria-label', `${formatTimestamp(snapshot.timestamp)}: ${t('action.deleteSnapshot')}`);
            remove.appendChild(element('i', { className: 'fa-solid fa-trash' }));
            remove.addEventListener('click', async () => {
                if (!confirm(t('timeline.deleteSnapshotConfirm'))) return;
                await this.deleteTimelineSnapshot(snapshot);
            });
            entry.append(selectWrapper, button, remove);

            if (
                snapshot.id === this.selectedId
                && (
                    lore.activated.length
                    || lore.removed.length
                    || lore.changed?.length
                )
            ) {
                entry.appendChild(this.renderLoreChangeList(lore));
            }
            return entry;
        };
        const snapshots = element('details', {
            className: 'st-devtools-disclosure st-devtools-timeline-snapshots',
        });
        snapshots.open = this.timelineSnapshotsOpen;
        snapshots.addEventListener('toggle', () => {
            this.timelineSnapshotsOpen = snapshots.open;
        });
        const snapshotsSummary = element('summary');
        snapshotsSummary.append(
            element('strong', { text: t('timeline.snapshotsTitle') }),
            element('span', {
                className: 'st-devtools-disclosure-count',
                text: this.timelineTotalCount > analyses.length
                    ? t('timeline.loadedSnapshotCount', {
                        loaded: analyses.length,
                        total: this.timelineTotalCount,
                    })
                    : t('timeline.snapshotCount', { count: analyses.length }),
            }),
        );
        snapshots.appendChild(snapshotsSummary);
        attachLazyDetailsContent(snapshots, () => {
            const content = element('div', {
                className: 'st-devtools-timeline-snapshot-content',
            });
            const selectionToolbar = this.renderTimelineSelectionToolbar();
            const list = element('div', {
                className: 'st-devtools-timeline',
            });
            this.mountVirtualList(list, timelineItems, {
                estimatedRowHeight: 138,
                renderItem: renderTimelineEntry,
                focusSelector: '.st-devtools-timeline-item',
                ariaLabel: t('timeline.snapshotsTitle'),
            });
            content.append(selectionToolbar, list);
            return content;
        });
        page.appendChild(snapshots);
        page.appendChild(storageDetails);
        return page;
    }

    renderStorageOverview() {
        const summary = this.storageSummary ?? {};
        const pending = summary.complete === false || summary.rebuilding;
        const metricText = (value, completeKey, pendingKey, unknownKey, parameter) => {
            if (value == null) return t(pending ? pendingKey : unknownKey);
            return t(completeKey, { [parameter]: value });
        };
        const status = element('section', {
            className: `st-devtools-storage-overview${summary.persistent ? '' : ' is-temporary'}`,
        });
        const heading = element('div', { className: 'st-devtools-storage-overview-heading' });
        heading.append(
            element('strong', { text: t('storage.overviewTitle') }),
            element('span', {
                className: 'st-devtools-storage-backend',
                text: t(`storage.backend.${summary.type ?? 'memory'}`),
            }),
        );
        const metrics = element('div', { className: 'st-devtools-storage-metrics' });
        metrics.append(
            element('span', {
                text: metricText(
                    summary.chatCount,
                    'storage.chatCount',
                    'storage.chatCountPending',
                    'storage.chatCountUnknown',
                    'count',
                ),
            }),
            element('span', {
                text: metricText(
                    summary.snapshotCount,
                    'storage.snapshotCount',
                    'storage.snapshotCountPending',
                    'storage.snapshotCountUnknown',
                    'count',
                ),
            }),
            element('span', {
                text: metricText(
                    summary.localSettingCount,
                    'storage.localSettingCount',
                    'storage.localSettingCountPending',
                    'storage.localSettingCountUnknown',
                    'count',
                ),
            }),
            element('span', {
                text: metricText(
                    summary.approximateBytes == null
                        ? null
                        : formatBytes(summary.approximateBytes),
                    'storage.extensionApproximateSize',
                    'storage.approximateSizePending',
                    'storage.approximateSizeUnknown',
                    'size',
                ),
            }),
        );
        status.append(heading, metrics);
        const origin = summary.originStorage;
        if (origin) {
            const originMetrics = element('div', {
                className: 'st-devtools-storage-origin',
            });
            originMetrics.appendChild(element('strong', {
                text: t('storage.originScopeTitle'),
            }));
            if (origin.available) {
                originMetrics.append(
                    element('span', {
                        text: t('storage.originUsage', {
                            size: formatBytes(origin.usage),
                        }),
                    }),
                    element('span', {
                        text: t('storage.originQuota', {
                            size: formatBytes(origin.quota),
                        }),
                    }),
                );
            } else {
                originMetrics.appendChild(element('span', {
                    text: t('storage.originUnavailable'),
                }));
            }
            status.appendChild(originMetrics);
        }
        if (!summary.persistent) {
            const warning = proseElement('p', t('storage.memoryWarning'), {
                className: 'st-devtools-storage-warning',
            });
            warning.setAttribute('role', 'alert');
            status.appendChild(warning);
        } else if (summary.summaryError) {
            status.appendChild(proseElement('p', t('storage.summaryUnavailable')));
        } else if (pending) {
            status.appendChild(proseElement('p', t('storage.summaryPending')));
        }
        return status;
    }

    pruneTimelineSelection() {
        const chatId = this.currentChatId();
        if (this.timelineSelectionChatId !== chatId) {
            this.selectedTimelineIds.clear();
            this.timelineSelectionChatId = chatId;
        }
        const timelineIds = new Set(this.timeline.map(({ id }) => id));
        this.selectedTimelineIds = new Set(
            [...this.selectedTimelineIds].filter((id) => timelineIds.has(id)),
        );
    }

    renderTimelineSelectionToolbar() {
        const toolbar = element('div', { className: 'st-devtools-timeline-selection-toolbar' });
        const selectAllLabel = element('label', {
            className: 'st-devtools-timeline-select-all',
        });
        const selectAll = element('input');
        selectAll.type = 'checkbox';
        selectAll.checked = (
            this.timeline.length > 0
            && this.selectedTimelineIds.size === this.timeline.length
        );
        selectAll.indeterminate = (
            this.selectedTimelineIds.size > 0
            && this.selectedTimelineIds.size < this.timeline.length
        );
        selectAll.addEventListener('change', () => {
            this.selectedTimelineIds = selectAll.checked
                ? new Set(this.timeline.map(({ id }) => id))
                : new Set();
            this.updateTimelineSelectionControls();
        });
        selectAllLabel.append(
            selectAll,
            element('span', { text: t('timeline.selectAll') }),
        );

        const count = element('span', {
            className: 'st-devtools-timeline-selected-count',
            text: t('timeline.selectedCount', { count: this.selectedTimelineIds.size }),
        });
        count.setAttribute('role', 'status');
        count.setAttribute('aria-live', 'polite');

        const removeSelected = element('button', {
            className: 'menu_button st-devtools-timeline-delete-selected',
            text: t('timeline.deleteSelected'),
            type: 'button',
        });
        removeSelected.disabled = this.selectedTimelineIds.size === 0;
        removeSelected.addEventListener('click', async () => {
            const countToDelete = this.selectedTimelineIds.size;
            if (!confirm(t('timeline.deleteSelectedConfirm', { count: countToDelete }))) return;
            await this.deleteSelectedTimelineSnapshots();
        });
        toolbar.append(selectAllLabel, count, removeSelected);
        return toolbar;
    }

    updateTimelineSelectionControls() {
        const checkboxes = this.content?.querySelectorAll(
            '.st-devtools-timeline-select input[data-snapshot-id]',
        ) ?? [];
        for (const checkbox of checkboxes) {
            const selected = this.selectedTimelineIds.has(checkbox.dataset.snapshotId);
            checkbox.checked = selected;
            checkbox.closest('.st-devtools-timeline-entry')
                ?.classList.toggle('is-selected', selected);
        }
        const selectAll = this.content?.querySelector(
            '.st-devtools-timeline-select-all input',
        );
        if (selectAll) {
            selectAll.checked = (
                this.timeline.length > 0
                && this.selectedTimelineIds.size === this.timeline.length
            );
            selectAll.indeterminate = (
                this.selectedTimelineIds.size > 0
                && this.selectedTimelineIds.size < this.timeline.length
            );
        }
        const count = this.content?.querySelector('.st-devtools-timeline-selected-count');
        if (count) {
            count.textContent = t('timeline.selectedCount', {
                count: this.selectedTimelineIds.size,
            });
        }
        const removeSelected = this.content?.querySelector(
            '.st-devtools-timeline-delete-selected',
        );
        if (removeSelected) removeSelected.disabled = this.selectedTimelineIds.size === 0;
    }

    renderTimelineDiagnosticButton(format) {
        const label = format === 'markdown' ? 'Markdown' : format.toUpperCase();
        const button = element('button', {
            className: 'menu_button',
            text: t('action.exportDiagnostics', { format: label }),
            type: 'button',
        });
        button.disabled = this.timeline.length === 0;
        button.addEventListener('click', async () => {
            const errorId = `export-current:${format}`;
            try {
                const chatId = this.currentChatId();
                const maximum = Number(this.store.maxSnapshotsPerChat)
                    || MAX_TIMELINE_READ_LIMIT;
                const timeline = this.timelineTotalCount > this.timeline.length
                    ? await this.store.getTimeline(chatId, { limit: maximum })
                    : this.timeline;
                const extension = format === 'markdown' ? 'md' : format;
                const mime = format === 'json' ? 'application/json' : 'text/markdown';
                const date = new Date().toISOString().replaceAll(':', '-');
                downloadText(
                    `st-devtools-timeline-diagnostics-${date}.${extension}`,
                    serializeTimelineDiagnostics(timeline, format),
                    mime,
                );
                this.storageErrors = this.storageErrors.filter((item) => item.id !== errorId);
            } catch (error) {
                this.addStorageError({
                    id: errorId,
                    error,
                    retry: null,
                });
                globalThis.toastr?.error?.(t('storage.exportCurrentFailed'), 'ST DevTools');
            }
        });
        return button;
    }

    renderAllTimelineDiagnosticButton(format) {
        const label = format === 'markdown' ? 'Markdown' : format.toUpperCase();
        const button = element('button', {
            className: 'menu_button',
            text: t('action.exportAllDiagnostics', { format: label }),
            type: 'button',
        });
        button.addEventListener('click', () => this.exportAllTimelineDiagnostics(format));
        return button;
    }

    async exportAllTimelineDiagnostics(format, { throwOnError = false } = {}) {
        try {
            const chatTimelines = await this.store.getAllTimelines();
            const extension = format === 'markdown' ? 'md' : format;
            const mime = format === 'json' ? 'application/json' : 'text/markdown';
            const date = new Date().toISOString().replaceAll(':', '-');
            downloadText(
                `st-devtools-all-chat-diagnostics-${date}.${extension}`,
                serializeAllTimelineDiagnostics(chatTimelines, format),
                mime,
            );
            this.storageErrors = this.storageErrors.filter(
                (item) => item.id !== `export-all:${format}`,
            );
        } catch (error) {
            if (throwOnError) throw error;
            this.addStorageError({
                id: `export-all:${format}`,
                error,
                retry: () => this.exportAllTimelineDiagnostics(format, { throwOnError: true }),
            });
            globalThis.toastr?.error?.(t('storage.exportAllFailed'), 'ST DevTools');
        }
    }

    async importDiagnosticFile(file) {
        try {
            const report = parseTimelineDiagnostics(await file.text());
            this.importedDiagnostics = {
                fileName: file.name,
                report,
            };
            this.diagnosticImportError = null;
            globalThis.toastr?.success?.(t('diagnostic.importSucceeded'), 'ST DevTools');
        } catch (error) {
            this.diagnosticImportError = error?.message ?? t('common.unknown');
            globalThis.toastr?.error?.(
                t('diagnostic.importFailed', { message: this.diagnosticImportError }),
                'ST DevTools',
            );
        }
        this.render();
    }

    renderDiagnosticImportStatus() {
        if (!this.importedDiagnostics && !this.diagnosticImportError) return null;
        const status = element('section', {
            className: `st-devtools-diagnostic-import${this.diagnosticImportError ? ' error' : ''}`,
        });
        status.setAttribute('role', this.diagnosticImportError ? 'alert' : 'status');
        if (this.diagnosticImportError) {
            status.append(
                element('strong', {
                    text: t('diagnostic.importFailed', {
                        message: this.diagnosticImportError,
                    }),
                }),
            );
        } else {
            const { fileName, report } = this.importedDiagnostics;
            status.append(
                element('strong', { text: t('diagnostic.importTitle') }),
                element('small', { text: fileName }),
                element('span', {
                    text: t('diagnostic.importedSummary', {
                        scope: t(`diagnostic.scope.${report.scope}`),
                        snapshots: report.summary.snapshotCount,
                        chats: report.summary.chatCount ?? (report.summary.snapshotCount ? 1 : 0),
                    }),
                }),
                proseElement(
                    'small',
                    `${formatTimestamp(report.generatedAt)} · ${t('diagnostic.importReviewOnly')}`,
                ),
            );
        }
        const dismiss = element('button', {
            className: 'menu_button',
            text: this.diagnosticImportError
                ? t('action.dismiss')
                : t('action.removeImportedDiagnostics'),
            type: 'button',
        });
        dismiss.addEventListener('click', () => {
            this.importedDiagnostics = null;
            this.diagnosticImportError = null;
            this.render();
        });
        status.appendChild(dismiss);
        return status;
    }

    async clearAllSnapshots({ throwOnError = false } = {}) {
        const errorId = 'clear-all';
        try {
            if (typeof this.store.clearAll !== 'function') {
                throw new Error(t('storage.clearAllUnsupported'));
            }
            this.storageSummaryGeneration += 1;
            this.storageSummaryRebuildScheduled = false;
            const result = await this.store.clearAll();
            const localSettingCount = this.clearLocalData();
            this.timeline = [];
            this.timelineTotalCount = 0;
            this.timelineCorruptCount = 0;
            this.selectedId = null;
            this.selectedTimelineIds.clear();
            this.storageSummary = {
                ...(this.store.getStatus?.() ?? this.storageSummary),
                complete: true,
                rebuilding: false,
                chatCount: 0,
                snapshotCount: 0,
                localSettingCount: 0,
                snapshotApproximateBytes: 0,
                approximateBytes: 0,
            };
            this.storageErrors = this.storageErrors.filter((item) => item.id !== errorId);
            globalThis.toastr?.success?.(
                t('storage.clearedAll', {
                    count: result?.snapshotCount ?? 0,
                    localCount: localSettingCount,
                }),
                'ST DevTools',
            );
            this.render();
            return true;
        } catch (error) {
            if (throwOnError) throw error;
            this.addStorageError({
                id: errorId,
                error,
                retry: () => this.clearAllSnapshots({ throwOnError: true }),
            });
            globalThis.toastr?.error?.(t('storage.clearAllFailed'), 'ST DevTools');
            return false;
        }
    }

    async clearCurrentTimeline({
        throwOnError = false,
        chatId = this.timelineSelectionChatId ?? this.currentChatId(),
    } = {}) {
        if (chatId !== this.currentChatId() && !throwOnError) {
            this.selectedTimelineIds.clear();
            await this.refresh({ chatId: this.currentChatId() });
            return false;
        }
        try {
            await this.store.clearTimeline(chatId);
            if (chatId === this.currentChatId()) {
                this.timeline = [];
                this.timelineTotalCount = 0;
                this.timelineCorruptCount = 0;
                this.selectedId = null;
                this.selectedTimelineIds.clear();
            }
            this.storageErrors = this.storageErrors.filter((item) => item.id !== 'clear-timeline');
            this.render();
            void this.refreshStorageSummary();
            return true;
        } catch (error) {
            if (throwOnError) throw error;
            this.addStorageError({
                id: 'clear-timeline',
                error,
                retry: () => this.clearCurrentTimeline({ throwOnError: true, chatId }),
            });
            globalThis.toastr?.error?.(t('storage.clearFailed'), 'ST DevTools');
            return false;
        }
    }

    async deleteTimelineSnapshot(snapshot, {
        throwOnError = false,
        chatId = this.snapshotStorageChatId(snapshot),
    } = {}) {
        const errorId = `delete:${snapshot.id}`;
        try {
            const deleted = await this.store.deleteSnapshot(chatId, snapshot.id);
            if (!deleted) {
                if (chatId === this.currentChatId()) {
                    await this.refresh({ throwOnError: true, chatId });
                }
                return false;
            }
            if (chatId === this.currentChatId()) {
                await this.refresh({ throwOnError: true, chatId });
            }
            this.storageErrors = this.storageErrors.filter((item) => item.id !== errorId);
            this.render();
            void this.refreshStorageSummary();
            return true;
        } catch (error) {
            if (throwOnError) throw error;
            this.addStorageError({
                id: errorId,
                error,
                retry: () => this.deleteTimelineSnapshot(
                    snapshot,
                    { throwOnError: true, chatId },
                ),
            });
            globalThis.toastr?.error?.(t('storage.deleteFailed'), 'ST DevTools');
            return false;
        }
    }

    async deleteSelectedTimelineSnapshots(
        snapshotIds = [...this.selectedTimelineIds],
        {
            throwOnError = false,
            chatId = this.timelineSelectionChatId ?? this.currentChatId(),
        } = {},
    ) {
        const isActiveChat = chatId === this.currentChatId();
        if (!isActiveChat && !throwOnError) {
            this.selectedTimelineIds.clear();
            this.timelineSelectionChatId = this.currentChatId();
            this.render();
            return false;
        }
        const timelineIds = new Set(this.timeline.map(({ id }) => id));
        const ids = [...new Set(snapshotIds)].filter((id) => (
            typeof id === 'string'
            && id
            && (!isActiveChat || timelineIds.has(id))
        ));
        if (ids.length === 0) return false;
        const idSet = new Set(ids);
        const errorId = 'delete:selected';
        try {
            const deletedCount = await this.store.deleteSnapshots(chatId, ids);
            const pageAfterDelete = await this.readTimelinePage(chatId);
            const remainingCount = pageAfterDelete.snapshots
                .filter(({ id }) => idSet.has(id)).length;
            if (remainingCount > 0) {
                throw new Error(t('storage.deleteIncomplete', { count: remainingCount }));
            }
            if (chatId === this.currentChatId()) {
                this.timeline = pageAfterDelete.snapshots;
                this.timelineTotalCount = pageAfterDelete.totalCount;
                this.timelineCorruptCount = pageAfterDelete.corruptCount;
                this.selectedTimelineIds = new Set(
                    [...this.selectedTimelineIds].filter((id) => !idSet.has(id)),
                );
                if (this.selectedId && idSet.has(this.selectedId)) {
                    this.selectedId = this.timeline.at(-1)?.id ?? null;
                }
            }
            this.storageErrors = this.storageErrors.filter((item) => item.id !== errorId);
            globalThis.toastr?.success?.(
                t('timeline.deletedSelected', { count: deletedCount }),
                'ST DevTools',
            );
            this.render();
            void this.refreshStorageSummary();
            return true;
        } catch (error) {
            if (throwOnError) throw error;
            this.addStorageError({
                id: errorId,
                error,
                retry: () => this.deleteSelectedTimelineSnapshots(
                    ids,
                    { throwOnError: true, chatId },
                ),
            });
            globalThis.toastr?.error?.(t('storage.deleteFailed'), 'ST DevTools');
            return false;
        }
    }

    renderGrowthChart(analyses, retainedCount = analyses.length) {
        const figure = element('figure', { className: 'st-devtools-growth' });
        const visibleAnalyses = analyses.slice(-GROWTH_CHART_POINT_LIMIT);
        const values = visibleAnalyses.map(
            ({ snapshot }) => Number(snapshot.stats?.totalTokens) || 0,
        );
        const maximum = Math.max(1, ...values);
        const width = 600;
        const height = 150;
        const paddingX = 26;
        const paddingTop = 18;
        const paddingBottom = 28;
        const chartHeight = height - paddingTop - paddingBottom;
        const pointFor = (value, index) => ({
            x: values.length === 1
                ? width / 2
                : paddingX + (index * (width - (paddingX * 2))) / (values.length - 1),
            y: paddingTop + chartHeight - ((value / maximum) * chartHeight),
        });
        const points = values.map(pointFor);
        const chartDescription = t('timeline.growthDescription', {
            count: visibleAnalyses.length,
            total: retainedCount,
        });

        const caption = element('figcaption');
        const captionText = element('span');
        captionText.append(explainedTitle(
            t('timeline.growthTitle'),
            chartDescription,
        ));
        const captionMeta = element('span', { className: 'st-devtools-growth-caption-meta' });
        captionMeta.append(
            element('span', {
                text: t('timeline.growthWindow', {
                    count: visibleAnalyses.length,
                    total: retainedCount,
                }),
            }),
            element('span', {
                className: 'st-devtools-growth-maximum',
                text: t('timeline.maximumTokens', { count: maximum }),
            }),
        );
        caption.append(
            captionText,
            captionMeta,
        );

        const svg = svgElement('svg', {
            viewBox: `0 0 ${width} ${height}`,
            role: 'group',
            'aria-label': chartDescription,
        });
        svg.appendChild(svgElement('line', {
            class: 'st-devtools-growth-axis',
            x1: paddingX,
            y1: height - paddingBottom,
            x2: width - paddingX,
            y2: height - paddingBottom,
        }));
        svg.appendChild(svgElement('polyline', {
            class: 'st-devtools-growth-line',
            points: points.map(({ x, y }) => `${x},${y}`).join(' '),
        }));
        const detail = element('div', { className: 'st-devtools-growth-detail' });
        const detailText = element('strong');
        detailText.setAttribute('role', 'status');
        detailText.setAttribute('aria-live', 'polite');
        detailText.setAttribute('aria-atomic', 'true');
        const openSelected = element('button', {
            className: 'menu_button',
            text: t('timeline.openGrowthSnapshot'),
            type: 'button',
        });
        detail.append(detailText, openSelected);
        const pointNodes = [];
        const selectedIndex = visibleAnalyses.findIndex(
            ({ snapshot }) => snapshot.id === this.selectedId,
        );
        let pinnedIndex = selectedIndex >= 0 ? selectedIndex : visibleAnalyses.length - 1;
        const showPointDetail = (index, { pin = false } = {}) => {
            if (pin) {
                pinnedIndex = index;
                pointNodes.forEach((node, pointIndex) => {
                    node.setAttribute('tabindex', pointIndex === pinnedIndex ? '0' : '-1');
                });
            }
            const snapshot = visibleAnalyses[index]?.snapshot;
            if (!snapshot) return;
            detailText.textContent = t('timeline.growthPointDetail', {
                time: formatTimestamp(snapshot.timestamp),
                count: values[index],
            });
            pointNodes.forEach((node, pointIndex) => {
                const inspected = pointIndex === (pin ? pinnedIndex : index);
                node.classList.toggle('is-inspected', inspected);
                node.setAttribute(
                    'aria-pressed',
                    String(pointIndex === pinnedIndex),
                );
            });
        };
        openSelected.addEventListener('click', () => {
            const snapshot = visibleAnalyses[pinnedIndex]?.snapshot;
            if (!snapshot) return;
            this.selectedId = snapshot.id;
            this.selectTab('explorer');
        });
        points.forEach(({ x, y }, index) => {
            const snapshot = visibleAnalyses[index].snapshot;
            const isLatest = index === visibleAnalyses.length - 1;
            const isSelected = snapshot.id === this.selectedId;
            const label = [
                formatTimestamp(snapshot.timestamp),
                t('snapshot.tokens', { count: values[index] }),
                ...(isLatest ? [t('timeline.latestSnapshot')] : []),
            ].join(' · ');
            const point = svgElement('circle', {
                class: [
                    'st-devtools-growth-hit',
                    isLatest ? 'is-latest' : '',
                    isSelected ? 'is-selected' : '',
                ].filter(Boolean).join(' '),
                cx: x,
                cy: y,
                r: 28,
                tabindex: index === pinnedIndex ? 0 : -1,
                role: 'button',
                'aria-label': label,
                'aria-current': isSelected ? 'true' : 'false',
                'aria-pressed': 'false',
                'data-point-index': index,
            });
            point.appendChild(svgElement('title'));
            point.firstChild.textContent = label;
            const visualPoint = svgElement('circle', {
                class: `st-devtools-growth-point${isLatest ? ' is-latest' : ''}`,
                cx: x,
                cy: y,
                r: isLatest ? 6 : 4,
                'aria-hidden': 'true',
            });
            point.addEventListener('mouseenter', () => showPointDetail(index));
            point.addEventListener('mouseleave', () => showPointDetail(pinnedIndex));
            point.addEventListener('focus', () => showPointDetail(index));
            point.addEventListener('blur', () => showPointDetail(pinnedIndex));
            point.addEventListener('click', () => showPointDetail(index, { pin: true }));
            point.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    showPointDetail(index, { pin: true });
                    return;
                }
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                let nextIndex = index;
                if (event.key === 'ArrowLeft') nextIndex = Math.max(0, index - 1);
                if (event.key === 'ArrowRight') nextIndex = Math.min(points.length - 1, index + 1);
                if (event.key === 'Home') nextIndex = 0;
                if (event.key === 'End') nextIndex = points.length - 1;
                pointNodes.forEach((node, pointIndex) => {
                    node.setAttribute('tabindex', pointIndex === nextIndex ? '0' : '-1');
                });
                pointNodes[nextIndex]?.focus();
            });
            pointNodes.push(point);
            svg.append(point, visualPoint);
        });
        showPointDetail(pinnedIndex, { pin: true });
        figure.append(caption, svg, detail);
        return figure;
    }

    renderFieldChanges(changes, namespace, className = '') {
        const normalized = Array.isArray(changes)
            ? changes.filter((change) => change && typeof change === 'object')
            : [];
        if (normalized.length === 0) return null;
        const wrapper = element('div', {
            className: `st-devtools-field-change-table-wrap ${className}`.trim(),
        });
        const table = element('table', {
            className: 'st-devtools-field-change-table',
        });
        const head = element('thead');
        const headRow = element('tr');
        for (const label of [
            t('diff.changeKinds'),
            t('diff.before'),
            t('diff.after'),
        ]) {
            const heading = element('th', { text: label });
            heading.scope = 'col';
            headRow.appendChild(heading);
        }
        head.appendChild(headRow);
        const body = element('tbody');
        for (const change of normalized) {
            const row = element('tr');
            const before = element('td', { text: diffValueLabel(change.before) });
            before.dataset.label = t('diff.before');
            const after = element('td', { text: diffValueLabel(change.after) });
            after.dataset.label = t('diff.after');
            const field = element('th', {
                text: diffFieldLabel(namespace, change.field),
            });
            field.scope = 'row';
            row.append(field, before, after);
            body.appendChild(row);
        }
        table.append(head, body);
        wrapper.appendChild(table);
        return wrapper;
    }

    renderLoreChangeList(lore) {
        const wrapper = element('div', { className: 'st-devtools-lore-change-list' });
        const appendGroup = (labelKey, entries, className) => {
            if (!entries?.length) return;
            const group = element('div', { className });
            group.appendChild(element('strong', { text: t(labelKey) }));
            const list = element('ul');
            for (const entry of entries) {
                list.appendChild(element('li', { text: loreEntryLabel(entry) }));
            }
            group.appendChild(list);
            wrapper.appendChild(group);
        };
        appendGroup('timeline.loreActivatedList', lore.activated, 'activated');
        appendGroup('timeline.loreRemovedList', lore.removed, 'removed');
        if (lore.changed?.length) {
            const group = element('div', { className: 'changed' });
            group.appendChild(element('strong', {
                text: t('timeline.loreChangedList'),
            }));
            const cards = element('div', {
                className: 'st-devtools-lore-changed-cards',
            });
            for (const changed of lore.changed) {
                const changes = Array.isArray(changed?.changes)
                    ? changed.changes
                    : [];
                const fields = changes.map(({ field }) => (
                    diffFieldLabel('diff.loreField', field)
                ));
                const card = element('details', {
                    className: 'st-devtools-lore-changed-card',
                });
                const summary = element('summary');
                summary.append(
                    element('span', {
                        text: loreEntryLabel(changed?.after ?? changed?.before ?? {}),
                    }),
                    element('small', {
                        text: t('diff.loreChangedFields', {
                            fields: fields.join(' · ') || t('common.unknown'),
                        }),
                    }),
                );
                card.appendChild(summary);
                attachLazyDetailsContent(card, () => {
                    const content = element('div', {
                        className: 'st-devtools-lore-changed-content',
                    });
                    const contentChange = changes.find(({ field }) => field === 'content');
                    if (contentChange) {
                        content.appendChild(element('strong', {
                            text: t('diff.loreContentChanges'),
                        }));
                        const diff = element('pre');
                        this.appendDiffMarkup(
                            diff,
                            contentChange.before ?? '',
                            contentChange.after ?? '',
                        );
                        content.appendChild(diff);
                    }
                    const metadata = this.renderFieldChanges(
                        changes.filter(({ field }) => field !== 'content'),
                        'diff.loreField',
                    );
                    if (metadata) content.appendChild(metadata);
                    return content;
                });
                cards.appendChild(card);
            }
            group.appendChild(cards);
            wrapper.appendChild(group);
        }
        return wrapper;
    }

    renderDiff() {
        const page = element('div', { className: 'st-devtools-page' });
        if (this.timeline.length < 2) {
            page.appendChild(proseElement('p', t('diff.minimum')));
            return page;
        }

        const selectors = element('div', { className: 'st-devtools-diff-selectors' });
        const baseSelect = this.createTimelineSelect(
            this.timeline.at(-2).id,
            t('diff.base'),
            t('diff.baseDescription'),
        );
        const compareSelect = this.createTimelineSelect(
            this.selectedSnapshot()?.id ?? this.timeline.at(-1).id,
            t('diff.compare'),
            t('diff.compareDescription'),
        );
        selectors.append(baseSelect.wrapper, compareSelect.wrapper);
        const diffOutput = element('pre', { className: 'st-devtools-diff-output' });
        const fullDiff = element('details', {
            className: 'st-devtools-disclosure st-devtools-full-diff',
        });
        const fullDiffSummary = element('summary');
        const fullDiffHeading = element('span', { className: 'st-devtools-toolbox-heading' });
        fullDiffHeading.append(explainedTitle(
            t('diff.fullPromptChanges'),
            t('diff.fullPromptDescription'),
        ));
        fullDiffSummary.appendChild(fullDiffHeading);
        fullDiff.appendChild(fullDiffSummary);
        attachLazyDetailsContent(fullDiff, () => diffOutput);
        const sourceSection = element('section', { className: 'st-devtools-diff-section' });
        const loreSection = element('section', { className: 'st-devtools-diff-section' });
        let selectionRevision = 0;
        let renderedFullDiffRevision = -1;
        let selectedBase = null;
        let selectedCompare = null;
        let activeDiffController = null;
        const renderFullDiff = () => {
            mountDetailsContent(fullDiff);
            if (
                renderedFullDiffRevision === selectionRevision
                || !selectedBase
                || !selectedCompare
            ) return;
            diffOutput.replaceChildren();
            this.appendDiffMarkup(
                diffOutput,
                selectedBase.finalText,
                selectedCompare.finalText,
            );
            renderedFullDiffRevision = selectionRevision;
        };
        fullDiff.addEventListener('toggle', () => {
            if (fullDiff.open) renderFullDiff();
        });
        const renderDiff = async () => {
            selectedBase = this.timeline.find(
                (snapshot) => snapshot.id === baseSelect.select.value,
            );
            selectedCompare = this.timeline.find(
                (snapshot) => snapshot.id === compareSelect.select.value,
            );
            const currentSelectionRevision = ++selectionRevision;
            const currentAnalysisRevision = this.analysisRevision;
            activeDiffController?.abort();
            activeDiffController = null;
            sourceSection.replaceChildren();
            loreSection.replaceChildren();
            if (!selectedBase || !selectedCompare) return;

            if (fullDiff.open) renderFullDiff();
            if (!this.shouldUseAsyncAnalysis(
                'diff',
                [selectedBase, selectedCompare],
            )) {
                this.renderSourceChanges(
                    sourceSection,
                    selectedBase,
                    selectedCompare,
                );
                this.renderLoreChanges(
                    loreSection,
                    selectedBase,
                    selectedCompare,
                );
                return;
            }

            const status = element('p', {
                className: 'st-devtools-analysis-status',
                text: t('analysis.loading'),
            });
            status.setAttribute('role', 'status');
            status.setAttribute('aria-live', 'polite');
            sourceSection.appendChild(status);
            const controller = new AbortController();
            activeDiffController = controller;
            try {
                const response = await this.runUiAnalysis('diff', {
                    baseSnapshot: {
                        sources: selectedBase.sources ?? [],
                        lorebookEntries: selectedBase.lorebookEntries ?? [],
                    },
                    compareSnapshot: {
                        sources: selectedCompare.sources ?? [],
                        lorebookEntries: selectedCompare.lorebookEntries ?? [],
                    },
                }, {
                    snapshots: [selectedBase, selectedCompare],
                    configuration: { operation: 'source-lore-diff:v1' },
                    controller,
                });
                if (
                    controller.signal.aborted
                    || currentSelectionRevision !== selectionRevision
                    || currentAnalysisRevision !== this.analysisRevision
                    || !page.isConnected
                ) {
                    return;
                }
                sourceSection.replaceChildren();
                loreSection.replaceChildren();
                this.renderSourceChanges(
                    sourceSection,
                    selectedBase,
                    selectedCompare,
                    response.result?.sources ?? [],
                );
                this.renderLoreChanges(
                    loreSection,
                    selectedBase,
                    selectedCompare,
                    response.result?.lore ?? {
                        activated: [],
                        removed: [],
                        changed: [],
                    },
                );
            } catch (error) {
                if (
                    controller.signal.aborted
                    || ['analysis-cancelled', 'analysis-stale'].includes(
                        error?.code,
                    )
                    || currentSelectionRevision !== selectionRevision
                    || currentAnalysisRevision !== this.analysisRevision
                    || !page.isConnected
                ) {
                    return;
                }
                status.classList.add('is-error');
                status.textContent = this.analysisErrorText(error);
            } finally {
                if (activeDiffController === controller) {
                    activeDiffController = null;
                }
            }
        };
        baseSelect.select.addEventListener('change', () => {
            void renderDiff();
        });
        compareSelect.select.addEventListener('change', () => {
            void renderDiff();
        });
        page.append(selectors, sourceSection, loreSection, fullDiff);
        void renderDiff();
        return page;
    }

    appendDiffMarkup(container, beforeText, afterText) {
        const DiffMatchPatch = globalThis.SillyTavern?.libs?.DiffMatchPatch;
        if (!DiffMatchPatch) {
            container.textContent = `${beforeText}\n\n--- ${t('diff.compare')} ---\n\n${afterText}`;
            return;
        }
        const dmp = new DiffMatchPatch();
        dmp.Diff_Timeout = 1;
        const changes = dmp.diff_main(beforeText, afterText);
        dmp.diff_cleanupSemantic(changes);
        for (const [operation, text] of changes) {
            const span = element('span', { text });
            span.className = operation === 1 ? 'diff-added' : operation === -1 ? 'diff-removed' : 'diff-equal';
            container.appendChild(span);
        }
    }

    renderSourceChanges(section, base, compare, providedChanges = null) {
        section.appendChild(explainedTitle(
            t('diff.sourceChanges'),
            t('diff.description'),
            { tag: 'h3', titleTag: 'span' },
        ));
        const changes = providedChanges
            ?? compareSnapshotSources(base, compare);
        if (!changes.length) {
            section.appendChild(proseElement('p', t('diff.noSourceChanges')));
            return;
        }

        const list = element('div', { className: 'st-devtools-source-change-list' });
        for (const change of changes) {
            const changeKinds = Array.isArray(change.changeKinds)
                ? change.changeKinds
                : [];
            const card = element('details', {
                className: `st-devtools-source-change status-${change.status}`,
            });
            const summary = element('summary');
            const kindBadges = element('span', {
                className: 'st-devtools-source-change-kinds',
                title: t('diff.changeKinds'),
            });
            for (const kind of changeKinds) {
                kindBadges.appendChild(element('span', {
                    className: `st-devtools-change-kind kind-${kind}`,
                    text: translatedValue(`diff.changeKind.${kind}`, kind),
                }));
            }
            summary.append(
                element('strong', { text: sourceDisplayLabel(change.source) }),
                element('span', {
                    className: 'st-devtools-source-change-status',
                    text: t(`diff.status.${change.status}`),
                }),
                element('span', {
                    className: 'st-devtools-change-pill',
                    text: t('diff.tokenDelta', { delta: formatDelta(change.tokenDelta) }),
                }),
                kindBadges,
            );
            card.appendChild(summary);
            attachLazyDetailsContent(card, () => {
                const body = element('div', {
                    className: 'st-devtools-source-change-content',
                });
                const hasContentChange = (
                    change.status === 'added'
                    || change.status === 'removed'
                    || changeKinds.includes('content')
                );
                if (hasContentChange) {
                    body.appendChild(element('strong', {
                        text: t('diff.contentChanges'),
                    }));
                    const content = element('pre');
                    if (change.status === 'added') {
                        content.appendChild(element('span', {
                            className: 'diff-added',
                            text: change.after?.content ?? '',
                        }));
                    } else if (change.status === 'removed') {
                        content.appendChild(element('span', {
                            className: 'diff-removed',
                            text: change.before?.content ?? '',
                        }));
                    } else {
                        this.appendDiffMarkup(
                            content,
                            change.before?.content ?? '',
                            change.after?.content ?? '',
                        );
                    }
                    body.appendChild(content);
                }
                const metadata = this.renderFieldChanges(
                    change.metadataChanges,
                    'diff.metadataField',
                    'st-devtools-source-metadata-changes',
                );
                if (metadata) {
                    const metadataSection = element('section', {
                        className: 'st-devtools-source-metadata-section',
                    });
                    metadataSection.append(
                        element('strong', { text: t('diff.metadataChanges') }),
                        proseElement('p', t('diff.metadataDescription')),
                        metadata,
                    );
                    body.appendChild(metadataSection);
                }
                return body;
            });
            list.appendChild(card);
        }
        section.appendChild(list);
    }

    renderLoreChanges(section, base, compare, providedChanges = null) {
        section.appendChild(explainedTitle(
            t('diff.loreChanges'),
            t('diff.loreDescription'),
            { tag: 'h3', titleTag: 'span' },
        ));
        const changes = providedChanges ?? compareLoreEntries(
            base.lorebookEntries ?? [],
            compare.lorebookEntries ?? [],
        );
        if (
            !changes.activated.length
            && !changes.removed.length
            && !changes.changed?.length
        ) {
            section.appendChild(proseElement('p', t('diff.noLoreChanges')));
            return;
        }
        section.appendChild(this.renderLoreChangeList(changes));
    }

    createTimelineSelect(selectedId, labelText, description) {
        const wrapper = element('div', { className: 'st-devtools-picker' });
        wrapper.appendChild(explainedTitle(labelText, description, {
            titleTag: 'span',
        }));
        const select = element('select');
        select.setAttribute('aria-label', labelText);
        for (const snapshot of this.timeline) {
            const option = element('option', { text: formatTimestamp(snapshot.timestamp) });
            option.value = snapshot.id;
            option.selected = snapshot.id === selectedId;
            select.appendChild(option);
        }
        wrapper.appendChild(select);
        return { wrapper, select };
    }

    renderProviderTrace(snapshot) {
        const trace = snapshot?.providerTrace;
        if (!trace || typeof trace !== 'object') return null;
        const selected = trace.selectedSource ?? {};
        const upstream = trace.upstreamProvider ?? {};
        const transport = trace.transport ?? {};
        const section = element('section', {
            className: 'st-devtools-provider-trace',
        });
        section.appendChild(explainedTitle(
            t('context.providerTrace'),
            t('context.providerTraceDescription'),
            { tag: 'h3', titleTag: 'span' },
        ));
        const grid = element('div', {
            className: 'st-devtools-provider-trace-grid',
        });
        const appendProvider = (label, value, status, evidencePointer = null) => {
            const card = element('div', {
                className: `st-devtools-provider-trace-item provider-${status || 'unknown'}`,
            });
            card.append(
                element('small', { text: label }),
                element('strong', {
                    text: value
                        ? providerDisplayLabel(value)
                        : t('context.upstreamUnknown'),
                }),
                element('span', {
                    className: 'st-devtools-badge',
                    text: translatedValue(
                        `context.providerStatus.${status || 'unknown'}`,
                        status || t('common.unknown'),
                    ),
                }),
            );
            if (evidencePointer) {
                card.appendChild(element('code', {
                    text: t('context.providerEvidence', {
                        pointer: evidencePointer,
                    }),
                }));
            }
            grid.appendChild(card);
        };
        appendProvider(
            t('context.selectedGenerationSource'),
            selected.value && selected.value !== 'unknown' ? selected.value : null,
            selected.status,
            selected.evidencePointer,
        );
        appendProvider(
            t('context.upstreamProvider'),
            upstream.value,
            upstream.status,
            upstream.evidencePointer,
        );
        const transportSummary = element('small', {
            className: 'st-devtools-provider-transport',
            text: `${t('context.transportPath')}: ${
                promptTypeDisplayLabel(transport.promptType)
            } · ${generationTypeDisplayLabel(transport.generationType)} · ${
                transport.api || t('common.unknown')
            }`,
        });
        section.append(grid, transportSummary);
        return section;
    }

    snapshotUsageView(snapshot) {
        let usage;
        try {
            usage = normalizeUsageRecord(snapshot?.usage);
        } catch {
            usage = createUnavailableUsage({
                sourceEvent: 'ui-normalization-failed',
                correlatedAt: null,
            });
        }

        let cost = usage.cost ?? unavailableCost();
        if (cost.status !== 'provider-reported') {
            const provider = normalizeProviderId(snapshotProvider(snapshot));
            const model = normalizeModelId(snapshot?.model);
            const matchingEntries = provider && model
                ? this.pricingOverrides.entries.filter((entry) => (
                    entry.provider === provider
                    && entry.model === model
                ))
                : [];
            const currencies = new Set(
                matchingEntries.map((entry) => entry.currency),
            );
            if (currencies.size === 1) {
                try {
                    cost = calculateUsageCost(usage, {
                        overrides: this.pricingOverrides,
                        provider,
                        model,
                        currency: [...currencies][0],
                    });
                } catch {
                    cost = unavailableCost();
                }
            } else {
                cost = unavailableCost();
            }
        }
        return { usage, cost };
    }

    renderUsageCard(snapshot) {
        const { usage, cost } = this.snapshotUsageView(snapshot);
        const section = element('section', {
            className: 'st-devtools-usage-card',
        });
        const heading = element('div', {
            className: 'st-devtools-usage-heading',
        });
        heading.append(
            explainedTitle(
                t('context.usageTitle'),
                t('context.usageDescription'),
                { tag: 'h3', titleTag: 'span' },
            ),
            element('span', {
                className: `st-devtools-usage-status is-${usage.status}`,
                text: translatedValue(
                    `context.usageStatus.${usage.status}`,
                    usage.status,
                ),
            }),
        );

        const tokenGrid = element('dl', {
            className: 'st-devtools-usage-token-grid',
        });
        const appendToken = (labelKey, value) => {
            tokenGrid.append(
                element('div', { className: 'st-devtools-usage-token' }),
            );
            const item = tokenGrid.lastElementChild;
            item.append(
                element('dt', { text: t(labelKey) }),
                element('dd', {
                    text: value == null
                        ? t('common.unknown')
                        : t('snapshot.tokens', {
                            count: Number(value).toLocaleString('ko-KR'),
                        }),
                }),
            );
        };
        appendToken('context.usageInput', usage.inputTokens);
        appendToken('context.usageOutput', usage.outputTokens);
        appendToken('context.usageCache', usage.cachedInputTokens);
        appendToken('context.usageTotal', usage.totalTokens);

        const costText = cost.status === 'unavailable'
            ? t('context.usageCostUnavailable')
            : t('context.usageCostValue', {
                amount: Number(cost.amount).toLocaleString('ko-KR', {
                    maximumFractionDigits: 12,
                }),
                currency: cost.currency,
            });
        const sourceEvent = translatedValue(
            `context.usageSource.${usage.sourceEvent}`,
            usage.sourceEvent,
        );
        const costSource = translatedValue(
            `context.costSource.${cost.priceSource ?? 'unavailable'}`,
            cost.priceSource ?? t('common.unknown'),
        );
        const costStatus = translatedValue(
            `context.costStatus.${cost.status}`,
            cost.status,
        );
        const metadata = element('dl', {
            className: 'st-devtools-usage-metadata',
        });
        const appendMetadata = (labelKey, value) => {
            metadata.append(
                element('dt', { text: t(labelKey) }),
                element('dd', { text: value }),
            );
        };
        appendMetadata(
            'context.usageCost',
            `${costText} · ${costStatus}`,
        );
        appendMetadata('context.usageCostSource', costSource);
        appendMetadata(
            'context.usagePriceAsOf',
            cost.priceAsOf ?? t('common.unknown'),
        );
        appendMetadata('context.usageSourceEvent', sourceEvent);
        appendMetadata(
            'context.usageCorrelatedAt',
            usage.correlatedAt == null
                ? t('common.unknown')
                : formatTimestamp(usage.correlatedAt),
        );

        const provider = snapshotProvider(snapshot);
        const capabilities = getProviderCapabilities(provider);
        const capabilityDetails = element('details', {
            className: 'st-devtools-usage-capabilities st-devtools-disclosure',
        });
        const capabilitySummary = element('summary');
        capabilitySummary.appendChild(explainedTitle(
            t('context.usageCapabilities'),
            t('context.usageCapabilitiesDescription'),
        ));
        const capabilityContent = element('div', {
            className: 'st-devtools-usage-capability-content',
        });
        capabilityContent.appendChild(
            proseElement('p', t('context.usageOfficialBoundary')),
        );
        const capabilityList = element('dl', {
            className: 'st-devtools-usage-capability-list',
        });
        for (const key of [
            'publicRequestEvent',
            'publicResponseEvent',
            'publicStreamUsageEvent',
            'publicRequestCorrelation',
            'usageShape',
            'providerReportedCost',
        ]) {
            capabilityList.append(
                element('dt', {
                    text: t(`context.usageCapability.${key}`),
                }),
                element('dd', {
                    text: t(`context.capabilityState.${capabilities[key]}`),
                }),
            );
        }
        capabilityContent.appendChild(capabilityList);
        capabilityDetails.append(capabilitySummary, capabilityContent);

        section.append(heading, tokenGrid, metadata, capabilityDetails);
        return section;
    }

    renderContext(snapshot) {
        const page = element('div', { className: 'st-devtools-page' });
        page.appendChild(this.renderSnapshotPicker());
        const capture = snapshot.capture ?? {};
        const captureCard = element('details', {
            className: 'st-devtools-capture-boundary st-devtools-disclosure',
        });
        const generationStatus = capture.generationStatus ?? 'unknown';
        const requestStatus = capture.requestStatus ?? (
            capture.fallback ? 'prompt-only-timeout' : 'unknown'
        );
        const captureSummary = element('summary');
        captureSummary.append(
            explainedTitle(
                t('context.captureDetails'),
                t('context.captureDetailsDescription'),
            ),
            element('span', {
                className: `st-devtools-capture-stage${capture.fallback ? ' fallback' : ''}`,
                text: t(`capture.stage.${capture.stage ?? 'prompt-ready'}`),
            }),
            element('span', {
                className: `st-devtools-capture-lifecycle ${generationStatus}`,
                text: t(`capture.generationStatus.${generationStatus}`),
            }),
        );
        let captureDescription = capture.stage === 'backend-request-ready'
            ? t('capture.backendDescription')
            : capture.stage === 'generation-data-ready'
                ? t('capture.generationDescription')
                : t('capture.fallbackDescription');
        if (capture.migratedFrom) {
            captureDescription = t('capture.legacyDescription');
        }
        const captureContent = element('div', { className: 'st-devtools-capture-content' });
        captureContent.append(
            element('strong', { text: t('capture.title') }),
            proseElement('p', captureDescription),
            element('small', {
                text: t('capture.event', { event: capture.eventName ?? t('common.unknown') }),
            }),
            element('small', {
                text: t('capture.correlationDescription', {
                    method: t(`capture.correlation.${capture.correlationMethod ?? 'unknown'}`),
                }),
            }),
            element('small', {
                text: t('capture.requestStatusDescription', {
                    status: t(`capture.requestStatus.${requestStatus}`),
                }),
            }),
            element('small', {
                text: t('capture.generationStatusDescription', {
                    status: t(`capture.generationStatus.${generationStatus}`),
                }),
            }),
        );
        if (snapshot.request?.redactedPaths?.length) {
            captureContent.appendChild(element('small', {
                className: 'st-devtools-capture-redacted',
                text: t('capture.redacted', { count: snapshot.request.redactedPaths.length }),
            }));
        }
        if (snapshot.request?.omittedMediaPaths?.length) {
            captureContent.appendChild(element('small', {
                className: 'st-devtools-capture-redacted',
                text: t('capture.mediaOmitted', { count: snapshot.request.omittedMediaPaths.length }),
            }));
        }
        captureCard.append(captureSummary, captureContent);

        const structured = snapshot.stats?.structured ?? {};
        const largestSource = largestIncludedSource(snapshot.sources);
        const coreStatValues = [
            [t('stat.promptTokens'), snapshot.stats?.totalTokens ?? 0],
            [t('stat.contextUsage'), snapshot.stats.contextUsage == null ? t('common.unknown') : `${(snapshot.stats.contextUsage * 100).toFixed(1)}%`],
            [t('stat.remaining'), snapshot.stats.remainingContext ?? t('common.unknown')],
            [
                t('stat.largestSource'),
                largestSource,
            ],
        ];
        const detailStatValues = [
            [t('stat.contextLimit'), snapshot.stats.maxContext ?? t('common.unknown')],
            [t('stat.reservedOutput'), snapshot.stats.maxOutput ?? t('common.unknown')],
            [t('stat.toolSchemas'), structured.toolSchemas ?? 0],
            [t('stat.toolCalls'), structured.toolCalls ?? 0],
            [t('stat.toolResults'), structured.toolResults ?? 0],
            [t('stat.multimodalParts'), structured.multimodalParts ?? 0],
            [
                t('stat.multimodalEstimatedTokens'),
                structured.multimodalParts
                    ? structured.multimodalEstimatedTokens ?? t('common.unknown')
                    : 0,
            ],
            [
                t('stat.multimodalEstimateCoverage'),
                structured.multimodalEstimateCoverage == null
                    ? t('common.unknown')
                    : `${(structured.multimodalEstimateCoverage * 100).toFixed(1)}%`,
            ],
        ];
        const renderStats = (values, className = '') => {
            const stats = element('div', {
                className: `st-devtools-stats ${className}`.trim(),
            });
            for (const [label, value] of values) {
                const card = element('div', { className: 'st-devtools-stat' });
                const displayValue = typeof value === 'object' && value
                    ? sourceDisplayLabel(value)
                    : value ?? t('common.unknown');
                card.append(
                    element('small', { text: label }),
                    element('strong', { text: displayValue }),
                );
                stats.appendChild(card);
            }
            return stats;
        };
        const coreStats = renderStats(coreStatValues, 'st-devtools-context-core-stats');
        const detailStats = element('details', {
            className: 'st-devtools-context-details st-devtools-disclosure',
        });
        const detailStatsSummary = element('summary');
        detailStatsSummary.appendChild(explainedTitle(
            t('context.moreStats'),
            t('context.moreStatsDescription'),
        ));
        detailStats.append(
            detailStatsSummary,
            renderStats(detailStatValues),
        );

        const exportTools = element('details', {
            className: 'st-devtools-toolbox st-devtools-context-export',
        });
        const exportSummary = element('summary');
        const exportHeading = element('span', { className: 'st-devtools-toolbox-heading' });
        exportHeading.append(explainedTitle(
            t('context.exportTitle'),
            t('context.exportDescription'),
        ));
        exportSummary.appendChild(exportHeading);
        const exportActions = element('div', { className: 'st-devtools-tool-row-actions' });
        const copy = element('button', { className: 'menu_button', text: t('action.copy'), type: 'button' });
        copy.addEventListener('click', async () => {
            if (!confirm(t('export.copyConfirm'))) return;
            await copyText(snapshot.finalText);
            globalThis.toastr?.info?.(t('action.promptCopied'), 'ST DevTools');
        });
        exportActions.append(
            copy,
            this.renderExportButton(snapshot, 'json'),
            this.renderExportButton(snapshot, 'txt'),
            this.renderExportButton(snapshot, 'markdown'),
        );
        const exportContent = element('div', { className: 'st-devtools-toolbox-content' });
        exportContent.append(
            this.renderExportPrivacyPreview(snapshot),
            exportActions,
        );
        exportTools.append(exportSummary, exportContent);

        const settingsDetails = element('details', {
            className: 'st-devtools-context-details st-devtools-disclosure',
        });
        const settingsSummary = element('summary');
        settingsSummary.appendChild(explainedTitle(
            t('context.requestSettings'),
            t('context.requestSettingsDescription'),
        ));
        settingsDetails.appendChild(settingsSummary);
        attachLazyDetailsContent(settingsDetails, () => (
            element('pre', {
                text: JSON.stringify(snapshot.request?.settings ?? {}, null, 2),
            })
        ));
        const requestDetails = element('details', {
            className: 'st-devtools-context-details st-devtools-disclosure',
        });
        const requestSummary = element('summary');
        requestSummary.appendChild(explainedTitle(
            t('context.requestBody'),
            t('context.requestBodyDescription'),
        ));
        requestDetails.appendChild(requestSummary);
        attachLazyDetailsContent(requestDetails, () => (
            snapshot.request?.body
                ? element('pre', { text: JSON.stringify(snapshot.request.body, null, 2) })
                : proseElement('p', t('context.notCaptured'))
        ));
        const payloadDetails = element('details', {
            className: 'st-devtools-context-details st-devtools-disclosure',
        });
        const payloadSummary = element('summary');
        payloadSummary.appendChild(explainedTitle(
            t('context.promptPayload'),
            t('context.promptPayloadDescription'),
        ));
        payloadDetails.appendChild(payloadSummary);
        attachLazyDetailsContent(payloadDetails, () => (
            element('pre', {
                className: 'st-devtools-context-payload',
                text: snapshot.promptType === 'chat-completion'
                    ? JSON.stringify(snapshot.payload, null, 2)
                    : snapshot.finalText,
            })
        ));
        const providerTrace = this.renderProviderTrace(snapshot);
        page.append(
            coreStats,
            this.renderUsageCard(snapshot),
            captureCard,
            ...(providerTrace ? [providerTrace] : []),
            detailStats,
            exportTools,
            settingsDetails,
            requestDetails,
            payloadDetails,
        );
        return page;
    }

    renderExportPrivacyPreview(snapshot) {
        const jsonPreview = snapshotExportPreview(snapshot, 'json');
        const jsonFields = [
            jsonPreview.includesRequestBody ? t('export.field.requestBody') : null,
            jsonPreview.includesRequestSettings ? t('export.field.requestSettings') : null,
            jsonPreview.includesRawPayload ? t('export.field.payload') : null,
            jsonPreview.includesLorebookData ? t('export.field.lorebook') : null,
        ].filter(Boolean);
        const preview = element('section', { className: 'st-devtools-export-preview' });
        preview.append(
            element('strong', { text: t('export.previewTitle') }),
            proseElement('p', t('export.previewWarning')),
        );
        const fields = element('ul');
        fields.append(
            element('li', {
                text: t('export.previewSources', {
                    count: snapshot.sources?.length ?? 0,
                }),
            }),
            element('li', { text: t('export.previewTextFormats') }),
            element('li', {
                text: t('export.previewJson', {
                    fields: jsonFields.length > 0
                        ? jsonFields.join(' · ')
                        : t('export.field.metadataOnly'),
                }),
            }),
        );
        preview.appendChild(fields);
        return preview;
    }

    renderExportButton(snapshot, format) {
        const label = format === 'markdown' ? 'Markdown' : format.toUpperCase();
        const button = element('button', {
            className: 'menu_button',
            text: t('action.export', { format: label }),
            type: 'button',
        });
        button.addEventListener('click', () => {
            const extension = format === 'markdown' ? 'md' : format;
            const mime = format === 'json'
                ? 'application/json;charset=utf-8'
                : format === 'markdown'
                    ? 'text/markdown;charset=utf-8'
                    : 'text/plain;charset=utf-8';
            const serialized = serializeSnapshot(snapshot, format);
            const preview = snapshotExportPreview(snapshot, format, serialized);
            if (!confirm(t('export.confirm', {
                format: label,
                size: formatBytes(preview.approximateBytes),
            }))) return;
            downloadText(`st-devtools-${snapshot.id}.${extension}`, serialized, mime);
        });
        return button;
    }

    renderRuleSettings() {
        const details = element('details', { className: 'st-devtools-rule-settings' });
        const displayedRuleSettings = this.pendingImportedRuleSettings
            ?? this.ruleSettings;
        details.open = this.ruleSettingsOpen;
        details.addEventListener('toggle', () => {
            this.ruleSettingsOpen = details.open;
        });
        const summary = element('summary');
        summary.appendChild(explainedTitle(
            t('rules.settingsTitle'),
            t('rules.settingsDescription'),
        ));
        details.append(summary);

        const form = element('form');
        const toggles = element('div', { className: 'st-devtools-rule-setting-toggles' });
        for (const definition of RULE_DEFINITIONS) {
            const label = element('label');
            const input = element('input');
            input.type = 'checkbox';
            input.name = `enabled-${definition.id}`;
            input.checked = displayedRuleSettings.enabled[definition.id];
            label.append(input, document.createTextNode(` ${t(definition.labelKey)}`));
            toggles.appendChild(label);
        }

        const thresholds = element('div', { className: 'st-devtools-rule-thresholds' });
        const numberField = (name, labelKey, value, minimum, maximum, step = 1) => {
            const label = element('label');
            label.appendChild(element('span', { text: t(labelKey) }));
            const input = element('input');
            input.type = 'number';
            input.name = name;
            input.value = String(value);
            input.min = String(minimum);
            input.max = String(maximum);
            input.step = String(step);
            label.appendChild(input);
            return label;
        };
        thresholds.append(
            numberField(
                'contextWarning',
                'rules.setting.contextWarning',
                Math.round(displayedRuleSettings.contextWarning * 100),
                10,
                98,
            ),
            numberField(
                'contextCritical',
                'rules.setting.contextCritical',
                Math.round(displayedRuleSettings.contextCritical * 100),
                11,
                100,
            ),
            numberField(
                'largeSourceTokens',
                'rules.setting.largeSourceTokens',
                displayedRuleSettings.largeSourceTokens,
                1,
                1_000_000,
            ),
            numberField(
                'largeSourceShare',
                'rules.setting.largeSourceShare',
                Math.round(displayedRuleSettings.largeSourceShare * 100),
                1,
                100,
            ),
            numberField(
                'minimumSentenceLength',
                'rules.setting.minimumSentenceLength',
                displayedRuleSettings.minimumSentenceLength,
                5,
                500,
            ),
        );

        const actions = element('div', { className: 'st-devtools-rule-setting-actions' });
        const apply = element('button', {
            className: 'menu_button',
            text: t('action.applySettings'),
            type: 'submit',
        });
        const reset = element('button', {
            className: 'menu_button',
            text: t('action.resetSettings'),
            type: 'button',
        });
        reset.addEventListener('click', () => {
            if (this.pendingImportedRuleSettings) {
                this.pendingImportedRuleSettings = normalizeRuleSettings(
                    DEFAULT_RULE_SETTINGS,
                );
                this.comparisonPolicyDirty = true;
                this.invalidatePolicyPreview();
                this.ruleReviewStatus = t('rules.settingsDraftReset');
                this.ruleReviewStatusIsError = false;
            } else {
                const result = this.saveRuleSettings(DEFAULT_RULE_SETTINGS);
                this.ruleReviewStatus = result.ok
                    ? t('rules.settingsReset')
                    : t('rules.settingsSaveFailed', {
                        error: result.error?.message ?? t('common.unknown'),
                    });
                this.ruleReviewStatusIsError = !result.ok;
            }
            this.ruleSettingsOpen = true;
            this.render();
            const message = this.ruleReviewStatus;
            if (this.ruleReviewStatusIsError) {
                globalThis.toastr?.error?.(message, 'ST DevTools');
            } else {
                globalThis.toastr?.info?.(message, 'ST DevTools');
            }
        });
        actions.append(apply, reset);
        form.append(toggles, thresholds, actions);
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            const enabled = Object.fromEntries(RULE_DEFINITIONS.map(({ id }) => [
                id,
                form.querySelector(`[name="enabled-${id}"]`)?.checked ?? true,
            ]));
            const value = (name) => form.querySelector(`[name="${name}"]`)?.value;
            const numberValue = (name, divisor = 1) => {
                const raw = value(name);
                return raw === '' || raw == null ? undefined : Number(raw) / divisor;
            };
            const nextRuleSettings = {
                enabled,
                contextWarning: numberValue('contextWarning', 100),
                contextCritical: numberValue('contextCritical', 100),
                largeSourceTokens: numberValue('largeSourceTokens'),
                largeSourceShare: numberValue('largeSourceShare', 100),
                minimumSentenceLength: numberValue('minimumSentenceLength'),
            };
            if (this.pendingImportedRuleSettings) {
                this.pendingImportedRuleSettings = normalizeRuleSettings(nextRuleSettings);
                this.comparisonPolicyDirty = true;
                this.invalidatePolicyPreview();
                this.ruleReviewStatus = t('rules.settingsDraftUpdated');
                this.ruleReviewStatusIsError = false;
            } else {
                const result = this.saveRuleSettings(nextRuleSettings);
                this.ruleReviewStatus = result.ok
                    ? t('rules.settingsSaved')
                    : t('rules.settingsSaveFailed', {
                        error: result.error?.message ?? t('common.unknown'),
                    });
                this.ruleReviewStatusIsError = !result.ok;
            }
            this.ruleSettingsOpen = true;
            this.render();
            const message = this.ruleReviewStatus;
            if (this.ruleReviewStatusIsError) {
                globalThis.toastr?.error?.(message, 'ST DevTools');
            } else {
                globalThis.toastr?.info?.(message, 'ST DevTools');
            }
        });
        details.appendChild(form);
        return details;
    }

    comparisonNameRules() {
        const profile = this.activeComparisonProfile();
        const groups = new Map(
            (profile?.groupDefinitions ?? []).map((group) => [group.id, group]),
        );
        return (profile?.matchers ?? []).map((matcher) => {
            const group = groups.get(matcher.groupDefinitionId);
            return {
                ...matcher,
                mode: group?.mode ?? 'alternative',
                categories: group?.categories ?? ['*'],
            };
        });
    }

    comparisonManualAssignments() {
        const profile = this.activeComparisonProfile();
        const groups = new Map(
            (profile?.groupDefinitions ?? []).map((group) => [group.id, group]),
        );
        return (profile?.manualAssignments ?? []).map((assignment) => {
            const group = groups.get(assignment.groupDefinitionId);
            return {
                ...assignment,
                sourceIdentifier: assignment.sourceIdentity?.identifier ?? null,
                sourceFingerprint: assignment.sourceIdentity?.fingerprint ?? null,
                sourceId: assignment.sourceIdentity?.sourceId ?? null,
                sourceLabel: assignment.sourceIdentity?.label ?? null,
                mode: group?.mode ?? 'alternative',
                categories: group?.categories ?? ['*'],
            };
        });
    }

    comparisonProfiles() {
        return Array.isArray(this.comparisonPolicySettings?.profiles)
            ? this.comparisonPolicySettings.profiles
            : [];
    }

    activeComparisonProfile() {
        return this.comparisonProfiles().find(
            ({ id }) => id === this.activeComparisonProfileId,
        ) ?? this.comparisonProfiles()[0] ?? null;
    }

    comparisonGroupDefinitions() {
        return this.activeComparisonProfile()?.groupDefinitions ?? [];
    }

    replaceActiveComparisonProfile(update) {
        const active = this.activeComparisonProfile();
        if (!active) return;
        this.setComparisonPolicySettings({
            ...this.comparisonPolicySettings,
            profiles: this.comparisonProfiles().map((profile) => (
                profile.id === active.id
                    ? (typeof update === 'function' ? update(profile) : update)
                    : profile
            )),
        });
    }

    replaceComparisonGroupDefinitions(groupDefinitions) {
        const validGroupIds = new Set(groupDefinitions.map(({ id }) => id));
        this.replaceActiveComparisonProfile((profile) => ({
            ...profile,
            groupDefinitions,
            matchers: profile.matchers.filter(
                ({ groupDefinitionId }) => validGroupIds.has(groupDefinitionId),
            ),
            manualAssignments: profile.manualAssignments.filter(
                ({ groupDefinitionId }) => validGroupIds.has(groupDefinitionId),
            ),
        }));
    }

    replaceComparisonNameRules(nameRules) {
        this.replaceActiveComparisonProfile((profile) => ({
            ...profile,
            matchers: nameRules.map((rule, order) => ({
                id: rule.id,
                enabled: rule.enabled !== false,
                groupDefinitionId: rule.groupDefinitionId,
                kind: rule.kind,
                pattern: rule.pattern,
                fixedGroup: rule.fixedGroup ?? null,
                fixedOption: rule.fixedOption ?? null,
                target: rule.target ?? 'configured',
                order,
            })),
        }));
    }

    replaceManualAssignments(manualAssignments) {
        this.replaceActiveComparisonProfile((profile) => ({
            ...profile,
            manualAssignments: manualAssignments.map((assignment) => ({
                id: assignment.id,
                groupDefinitionId: assignment.groupDefinitionId,
                group: assignment.group,
                option: assignment.option ?? null,
                sourceIdentity: assignment.sourceIdentity ?? {
                    identifier: assignment.sourceIdentifier ?? null,
                    fingerprint: assignment.sourceFingerprint ?? null,
                    sourceId: assignment.sourceId ?? null,
                    label: assignment.sourceLabel ?? null,
                },
            })),
        }));
    }

    renderComparisonRuleCard(rule, index, snapshot) {
        const card = element('article', { className: 'st-devtools-policy-rule' });
        const heading = element('header');
        const enabledLabel = element('label', { className: 'st-devtools-policy-enabled' });
        const enabled = element('input');
        enabled.type = 'checkbox';
        enabled.checked = rule.enabled !== false;
        enabled.setAttribute(
            'aria-label',
            `${t('comparison.ruleNumber', { number: index + 1 })} · ${t('comparison.ruleEnabled')}`,
        );
        enabled.addEventListener('change', () => {
            const rules = this.comparisonNameRules().map((item, ruleIndex) => (
                ruleIndex === index ? { ...item, enabled: enabled.checked } : item
            ));
            this.replaceComparisonNameRules(rules);
            this.comparisonPolicyOpen = true;
            this.comparisonPolicySectionOpen.rules = true;
            this.render();
        });
        enabledLabel.append(enabled, document.createTextNode(` ${t('comparison.ruleEnabled')}`));
        const moveRule = (offset) => {
            const targetIndex = index + offset;
            const rules = [...this.comparisonNameRules()];
            if (targetIndex < 0 || targetIndex >= rules.length) return;
            [rules[index], rules[targetIndex]] = [rules[targetIndex], rules[index]];
            this.replaceComparisonNameRules(rules);
            this.comparisonPolicyOpen = true;
            this.render();
        };
        const moveUp = element('button', {
            className: 'menu_button',
            text: t('action.movePolicyRuleUp'),
            type: 'button',
        });
        moveUp.disabled = index === 0;
        moveUp.addEventListener('click', () => moveRule(-1));
        const moveDown = element('button', {
            className: 'menu_button',
            text: t('action.movePolicyRuleDown'),
            type: 'button',
        });
        moveDown.disabled = index === this.comparisonNameRules().length - 1;
        moveDown.addEventListener('click', () => moveRule(1));
        const remove = element('button', {
            className: 'menu_button',
            text: t('action.deletePolicyRule'),
            type: 'button',
        });
        remove.addEventListener('click', () => {
            this.replaceComparisonNameRules(
                this.comparisonNameRules().filter((_, ruleIndex) => ruleIndex !== index),
            );
            this.comparisonPolicyOpen = true;
            this.render();
        });
        heading.append(
            element('strong', {
                text: t('comparison.ruleNumber', { number: index + 1 }),
            }),
            enabledLabel,
            moveUp,
            moveDown,
            remove,
        );

        const metadata = element('div', { className: 'st-devtools-policy-rule-metadata' });
        const appendMetadata = (label, value) => {
            const item = element('span');
            item.append(
                element('small', { text: label }),
                document.createTextNode(String(value ?? '')),
            );
            metadata.appendChild(item);
        };
        appendMetadata(t('comparison.ruleKind'), t(`comparison.ruleKind.${rule.kind}`));
        appendMetadata(t('comparison.pattern'), rule.pattern);
        if (rule.fixedGroup) appendMetadata(t('comparison.fixedGroup'), rule.fixedGroup);
        appendMetadata(t('comparison.mode'), policyModeLabel(rule.mode));
        appendMetadata(
            t('comparison.categories'),
            categoriesLabel(rule.categories),
        );
        appendMetadata(
            t('comparison.target'),
            t(`comparison.target.${rule.target ?? 'configured'}`),
        );
        card.append(heading, metadata);

        const validationError = rule.error
            ?? rule.validationError
            ?? comparisonRuleError(rule);
        if (validationError) {
            const error = element('p', {
                className: 'st-devtools-policy-invalid',
                text: t('comparison.invalidRule', { message: validationError }),
            });
            error.setAttribute('role', 'alert');
            card.appendChild(error);
        }
        const editor = element('details', { className: 'st-devtools-policy-inline-editor' });
        editor.appendChild(element('summary', { text: t('action.editPolicyRule') }));
        const form = element('form', { className: 'st-devtools-policy-creator' });
        const kind = element('select');
        for (const value of COMPARISON_RULE_KINDS) {
            const option = element('option', { text: t(`comparison.ruleKind.${value}`) });
            option.value = value;
            option.selected = value === rule.kind;
            kind.appendChild(option);
        }
        const pattern = element('input');
        pattern.value = rule.pattern;
        pattern.required = true;
        const fixedGroup = element('input');
        fixedGroup.value = rule.fixedGroup ?? '';
        fixedGroup.placeholder = t('comparison.fixedGroupPlaceholder');
        const groupDefinition = this.renderGroupDefinitionSelect(rule.groupDefinitionId);
        const target = element('select');
        for (const value of COMPARISON_TARGETS) {
            const option = element('option', { text: t(`comparison.target.${value}`) });
            option.value = value;
            option.selected = value === rule.target;
            target.appendChild(option);
        }
        const status = element('p', { className: 'st-devtools-policy-form-status' });
        status.setAttribute('aria-live', 'polite');
        const updateLimit = () => {
            pattern.maxLength = kind.value === 'regex'
                ? USER_REGEX_MAX_LENGTH
                : SEARCH_QUERY_MAX_LENGTH;
        };
        const preview = () => {
            const group = this.comparisonGroupDefinitions().find(
                ({ id }) => id === groupDefinition.value,
            );
            const result = previewNameMatcher({
                ...rule,
                kind: kind.value,
                pattern: pattern.value.trim(),
                fixedGroup: fixedGroup.value.trim() || null,
                groupDefinitionId: groupDefinition.value,
                target: target.value,
            }, snapshot?.sources ?? [], group);
            setPolicyFormStatus(
                status,
                result.error
                    ? t('comparison.livePreviewError', { error: result.error })
                    : t('comparison.livePreviewMatches', { count: result.totalMatches }),
                Boolean(result.error),
            );
        };
        let previewTimer = null;
        const schedulePreview = () => {
            clearTimeout(previewTimer);
            previewTimer = setTimeout(preview, 180);
        };
        [kind, pattern, fixedGroup, groupDefinition, target].forEach((control) => {
            control.addEventListener('input', schedulePreview);
            control.addEventListener('change', schedulePreview);
        });
        kind.addEventListener('change', updateLimit);
        updateLimit();
        form.append(
            this.policyField('comparison.ruleKind', kind),
            this.policyField('comparison.pattern', pattern),
            this.policyField('comparison.fixedGroup', fixedGroup),
            this.policyField('comparison.groupDefinition', groupDefinition),
            this.policyField('comparison.target', target),
            element('button', {
                className: 'menu_button',
                text: t('action.savePolicyRule'),
                type: 'submit',
            }),
            status,
        );
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            const edited = {
                ...rule,
                kind: kind.value,
                pattern: pattern.value.trim(),
                fixedGroup: fixedGroup.value.trim() || null,
                groupDefinitionId: groupDefinition.value,
                target: target.value,
            };
            const error = comparisonRuleError(edited);
            if (error) {
                setPolicyFormStatus(
                    status,
                    t('comparison.invalidRule', { message: error }),
                    true,
                );
                return;
            }
            this.replaceComparisonNameRules(this.comparisonNameRules().map(
                (item, ruleIndex) => ruleIndex === index ? edited : item,
            ));
            this.comparisonPolicyOpen = true;
            this.comparisonPolicySectionOpen.rules = true;
            this.render();
        });
        editor.appendChild(form);
        card.appendChild(editor);
        return card;
    }

    policyField(labelKey, control, descriptionKey = null) {
        if (descriptionKey) {
            return describedControlField(t(labelKey), control, t(descriptionKey));
        }
        const label = element('label');
        label.append(element('span', { text: t(labelKey) }), control);
        return label;
    }

    renderGroupDefinitionSelect(selectedId = null) {
        const select = element('select');
        select.required = true;
        for (const group of this.comparisonGroupDefinitions()) {
            const option = element('option', {
                text: `${group.label} · ${policyModeLabel(group.mode)}`,
            });
            option.value = group.id;
            option.selected = group.id === selectedId;
            select.appendChild(option);
        }
        return select;
    }

    renderComparisonGroupDefinitions() {
        const wrapper = element('div', { className: 'st-devtools-policy-group-list' });
        for (const [index, group] of this.comparisonGroupDefinitions().entries()) {
            const form = element('form', {
                className: 'st-devtools-policy-group-definition',
            });
            const label = element('input');
            label.value = group.label;
            label.required = true;
            const mode = element('select');
            for (const value of COMPARISON_MODES) {
                const option = element('option', { text: policyModeLabel(value) });
                option.value = value;
                option.selected = value === group.mode;
                mode.appendChild(option);
            }
            const categories = element('input');
            categories.value = categoriesLabel(group.categories);
            categories.placeholder = t('comparison.categoriesPlaceholder');
            const save = element('button', {
                className: 'menu_button',
                text: t('action.saveGroupDefinition'),
                type: 'submit',
            });
            const remove = element('button', {
                className: 'menu_button',
                text: t('action.deleteGroupDefinition'),
                type: 'button',
            });
            remove.addEventListener('click', () => {
                const used = this.comparisonNameRules().some(
                    ({ groupDefinitionId }) => groupDefinitionId === group.id,
                ) || this.comparisonManualAssignments().some(
                    ({ groupDefinitionId }) => groupDefinitionId === group.id,
                );
                if (used && !confirm(t('comparison.groupDeleteConfirm'))) return;
                this.replaceComparisonGroupDefinitions(
                    this.comparisonGroupDefinitions().filter((_, itemIndex) => (
                        itemIndex !== index
                    )),
                );
                this.comparisonPolicyOpen = true;
                this.comparisonPolicySectionOpen.groups = true;
                this.render();
            });
            form.append(
                this.policyField('comparison.groupDefinitionLabel', label),
                this.policyField(
                    'comparison.mode',
                    mode,
                    'comparison.behaviorDescription',
                ),
                this.policyField('comparison.categories', categories),
                save,
                remove,
            );
            form.addEventListener('submit', (event) => {
                event.preventDefault();
                const definitions = this.comparisonGroupDefinitions().map(
                    (item, itemIndex) => itemIndex === index
                        ? {
                            ...item,
                            label: label.value.trim(),
                            mode: mode.value,
                            categories: categoriesFromInput(categories.value),
                        }
                        : item,
                );
                this.replaceComparisonGroupDefinitions(definitions);
                this.comparisonPolicyOpen = true;
                this.comparisonPolicySectionOpen.groups = true;
                this.render();
            });
            wrapper.appendChild(form);
        }

        const creator = element('form', {
            className: 'st-devtools-policy-group-definition',
        });
        const label = element('input');
        label.required = true;
        label.placeholder = t('comparison.groupDefinitionPlaceholder');
        const mode = element('select');
        for (const value of COMPARISON_MODES) {
            const option = element('option', { text: policyModeLabel(value) });
            option.value = value;
            mode.appendChild(option);
        }
        const categories = element('input');
        categories.value = '*';
        categories.placeholder = t('comparison.categoriesPlaceholder');
        creator.append(
            this.policyField('comparison.groupDefinitionLabel', label),
            this.policyField('comparison.mode', mode, 'comparison.behaviorDescription'),
            this.policyField('comparison.categories', categories),
            element('button', {
                className: 'menu_button',
                text: t('action.addGroupDefinition'),
                type: 'submit',
            }),
        );
        creator.addEventListener('submit', (event) => {
            event.preventDefault();
            this.replaceComparisonGroupDefinitions([
                ...this.comparisonGroupDefinitions(),
                {
                    id: policyId('group'),
                    label: label.value.trim(),
                    mode: mode.value,
                    categories: categoriesFromInput(categories.value),
                },
            ]);
            this.comparisonPolicyOpen = true;
            this.comparisonPolicySectionOpen.groups = true;
            this.render();
        });
        wrapper.appendChild(creator);
        return wrapper;
    }

    renderComparisonRuleCreator(snapshot) {
        if (this.comparisonGroupDefinitions().length === 0) {
            return proseElement('p', t('comparison.groupRequired'));
        }
        const form = element('form', { className: 'st-devtools-policy-creator' });
        const kind = element('select');
        kind.name = 'kind';
        for (const value of COMPARISON_RULE_KINDS) {
            const option = element('option', {
                text: t(`comparison.ruleKind.${value}`),
            });
            option.value = value;
            kind.appendChild(option);
        }
        const pattern = element('input');
        pattern.name = 'pattern';
        pattern.required = true;
        pattern.placeholder = t('comparison.patternPlaceholder');
        pattern.maxLength = SEARCH_QUERY_MAX_LENGTH;
        const fixedGroup = element('input');
        fixedGroup.name = 'fixedGroup';
        fixedGroup.placeholder = t('comparison.fixedGroupPlaceholder');
        const groupDefinition = this.renderGroupDefinitionSelect();
        const target = element('select');
        target.name = 'target';
        for (const value of COMPARISON_TARGETS) {
            const option = element('option', { text: t(`comparison.target.${value}`) });
            option.value = value;
            target.appendChild(option);
        }
        const updatePatternLimit = () => {
            pattern.maxLength = kind.value === 'regex'
                ? USER_REGEX_MAX_LENGTH
                : SEARCH_QUERY_MAX_LENGTH;
        };
        kind.addEventListener('change', updatePatternLimit);
        updatePatternLimit();
        const submit = element('button', {
            className: 'menu_button',
            text: t('action.addPolicyRule'),
            type: 'submit',
        });
        const status = element('p', { className: 'st-devtools-policy-form-status' });
        status.setAttribute('aria-live', 'polite');
        form.append(
            this.policyField('comparison.ruleKind', kind),
            this.policyField('comparison.pattern', pattern),
            this.policyField('comparison.fixedGroup', fixedGroup),
            this.policyField('comparison.groupDefinition', groupDefinition),
            this.policyField('comparison.target', target),
            submit,
            status,
        );
        let previewTimer = null;
        const updatePreview = () => {
            const group = this.comparisonGroupDefinitions().find(
                ({ id }) => id === groupDefinition.value,
            );
            const result = previewNameMatcher({
                id: 'preview',
                enabled: true,
                kind: kind.value,
                pattern: pattern.value.trim(),
                fixedGroup: fixedGroup.value.trim() || null,
                groupDefinitionId: groupDefinition.value,
                target: target.value,
            }, snapshot?.sources ?? [], group);
            setPolicyFormStatus(
                status,
                result.error
                    ? t('comparison.livePreviewError', { error: result.error })
                    : t('comparison.livePreviewMatches', { count: result.totalMatches }),
                Boolean(result.error),
            );
        };
        const schedulePreview = () => {
            clearTimeout(previewTimer);
            previewTimer = setTimeout(updatePreview, 180);
        };
        [kind, pattern, fixedGroup, groupDefinition, target].forEach((control) => {
            control.addEventListener('input', schedulePreview);
            control.addEventListener('change', schedulePreview);
        });
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            const rule = {
                id: policyId('name-rule'),
                enabled: true,
                kind: kind.value,
                pattern: pattern.value.trim(),
                fixedGroup: fixedGroup.value.trim() || null,
                groupDefinitionId: groupDefinition.value,
                target: target.value,
            };
            const validationError = comparisonRuleError(rule);
            if (validationError) {
                setPolicyFormStatus(
                    status,
                    t('comparison.invalidRule', { message: validationError }),
                    true,
                );
                return;
            }
            this.replaceComparisonNameRules([...this.comparisonNameRules(), rule]);
            this.comparisonPolicyOpen = true;
            this.comparisonPolicySectionOpen.rules = true;
            this.render();
        });
        return form;
    }

    renderManualAssignmentCard(assignment, index) {
        const card = element('article', { className: 'st-devtools-policy-assignment' });
        const identity = assignment.sourceIdentifier
            ? t('comparison.manualIdentifier', { identifier: assignment.sourceIdentifier })
            : assignment.sourceLabel ?? assignment.sourceId ?? t('common.unknown');
        const heading = element('header');
        const remove = element('button', {
            className: 'menu_button',
            text: t('action.removeManualAssignment'),
            type: 'button',
        });
        remove.addEventListener('click', () => {
            this.replaceManualAssignments(
                this.comparisonManualAssignments().filter(
                    (_, assignmentIndex) => assignmentIndex !== index,
                ),
            );
            this.comparisonPolicyOpen = true;
            this.render();
        });
        heading.append(element('strong', { text: assignment.sourceLabel || identity }), remove);
        card.append(
            heading,
            element('p', {
                text: `${assignment.group} · ${assignment.option || t('common.unknown')} · ${policyModeLabel(assignment.mode)} · ${categoriesLabel(assignment.categories)}`,
            }),
        );
        return card;
    }

    renderManualAssignmentCreator(snapshot) {
        const configuredSources = (snapshot?.sources ?? []).filter(isConfiguredPromptSource);
        if (configuredSources.length === 0) {
            return proseElement('p', t('comparison.manualNoSources'));
        }
        if (this.comparisonGroupDefinitions().length === 0) {
            return proseElement('p', t('comparison.groupRequired'));
        }

        const form = element('form', { className: 'st-devtools-policy-manual-form' });
        const sourceSelect = element('select');
        sourceSelect.multiple = true;
        sourceSelect.size = Math.min(6, Math.max(2, configuredSources.length));
        for (const source of configuredSources) {
            const option = element('option', { text: policySourceLabel(source) });
            option.value = source.id;
            sourceSelect.appendChild(option);
        }
        const group = element('input');
        group.required = true;
        group.placeholder = t('comparison.groupPlaceholder');
        const optionName = element('input');
        optionName.placeholder = t('comparison.optionPlaceholder');
        const groupDefinition = this.renderGroupDefinitionSelect();
        const submit = element('button', {
            className: 'menu_button',
            text: t('action.addManualAssignment'),
            type: 'submit',
        });
        form.append(
            this.policyField('comparison.manualSources', sourceSelect),
            proseElement('small', t('comparison.manualMultipleHint')),
            this.policyField('comparison.groupDefinition', groupDefinition),
            this.policyField('comparison.group', group),
            this.policyField('comparison.optionOptional', optionName),
            submit,
        );
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            const selectedIds = new Set(
                [...sourceSelect.selectedOptions].map(({ value }) => value),
            );
            const selectedSources = configuredSources.filter(
                ({ id }) => selectedIds.has(id),
            );
            if (selectedSources.length === 0) return;
            const assignments = buildBulkManualAssignments(selectedSources, {
                groupDefinitionId: groupDefinition.value,
                group: group.value.trim(),
                option: selectedSources.length === 1
                    ? optionName.value.trim() || null
                    : null,
            });
            const identities = new Set(assignments.map((assignment) => (
                assignment.sourceIdentity.identifier
                    ? `id:${assignment.sourceIdentity.identifier}`
                    : `fp:${assignment.sourceIdentity.fingerprint}`
            )));
            this.replaceManualAssignments([
                ...this.comparisonManualAssignments().filter((item) => {
                    const identity = item.sourceIdentifier
                        ? `id:${item.sourceIdentifier}`
                        : `fp:${item.sourceFingerprint}`;
                    return !identities.has(identity);
                }),
                ...assignments,
            ]);
            this.comparisonPolicyOpen = true;
            this.comparisonPolicySectionOpen.manual = true;
            this.render();
        });
        return form;
    }

    comparisonScopeContext(snapshot) {
        return resolveComparisonPolicyContext({
            snapshot,
            profileContext: snapshot?.profileContext,
        });
    }

    applicableComparisonProfiles(snapshot) {
        const context = this.comparisonScopeContext(snapshot);
        const precedence = new Map(
            COMPARISON_POLICY_PROFILE_SCOPES.map((scope, index) => [scope, index]),
        );
        return this.comparisonProfiles()
            .filter((profile) => {
                if (!profile.enabled) return false;
                if (profile.scope.kind === 'global') return true;
                return comparisonScopeKeyEquals(
                    context[profile.scope.kind]?.key,
                    profile.scope.key,
                );
            })
            .sort((left, right) => (
                precedence.get(right.scope.kind) - precedence.get(left.scope.kind)
                || right.priority - left.priority
            ));
    }

    renderComparisonProfiles(snapshot) {
        const wrapper = element('div', { className: 'st-devtools-policy-profile-manager' });
        const selector = element('select');
        for (const profile of this.comparisonProfiles()) {
            const option = element('option', {
                text: `${profile.label} · ${t(`comparison.profile.scope.${profile.scope.kind}`)}`,
            });
            option.value = profile.id;
            option.selected = profile.id === this.activeComparisonProfile()?.id;
            selector.appendChild(option);
        }
        selector.addEventListener('change', () => {
            this.activeComparisonProfileId = selector.value;
            this.comparisonPolicyOpen = true;
            this.comparisonPolicySectionOpen.profiles = true;
            this.render();
        });
        wrapper.appendChild(this.policyField('comparison.profile.editing', selector));

        const chain = this.applicableComparisonProfiles(snapshot);
        const chainCard = element('div', { className: 'st-devtools-policy-profile-chain' });
        chainCard.append(
            element('strong', { text: t('comparison.profile.activeChain') }),
            element('p', {
                text: chain.length > 0
                    ? chain.map((profile) => (
                        `${t(`comparison.profile.scope.${profile.scope.kind}`)}: ${profile.label}`
                    )).join(' → ')
                    : t('comparison.profile.noActive'),
            }),
        );
        wrapper.appendChild(chainCard);

        const active = this.activeComparisonProfile();
        if (active) {
            const actions = element('div', {
                className: 'st-devtools-policy-profile-actions',
            });
            const enabledLabel = element('label', {
                className: 'st-devtools-policy-enabled',
            });
            const enabled = element('input');
            enabled.type = 'checkbox';
            enabled.checked = active.enabled !== false;
            enabled.addEventListener('change', () => {
                this.replaceActiveComparisonProfile({
                    ...active,
                    enabled: enabled.checked,
                });
                this.comparisonPolicyOpen = true;
                this.comparisonPolicySectionOpen.profiles = true;
                this.render();
            });
            enabledLabel.append(enabled, document.createTextNode(
                ` ${t('comparison.profile.enabled')}`,
            ));
            actions.appendChild(enabledLabel);
            const priority = element('input');
            priority.type = 'number';
            priority.min = '-1000';
            priority.max = '1000';
            priority.step = '1';
            priority.value = String(active.priority ?? 0);
            priority.addEventListener('change', () => {
                this.replaceActiveComparisonProfile({
                    ...active,
                    priority: Math.max(
                        -1000,
                        Math.min(1000, Math.trunc(Number(priority.value) || 0)),
                    ),
                });
                this.comparisonPolicyOpen = true;
                this.comparisonPolicySectionOpen.profiles = true;
                this.render();
            });
            actions.appendChild(this.policyField(
                'comparison.profile.priority',
                priority,
                'comparison.profile.priorityDescription',
            ));
            if (active.scope.kind !== 'global') {
                const remove = element('button', {
                    className: 'menu_button',
                    text: t('action.deleteProfile'),
                    type: 'button',
                });
                remove.addEventListener('click', () => {
                    if (!confirm(t('comparison.profile.deleteConfirm'))) return;
                    const profiles = this.comparisonProfiles().filter(
                        ({ id }) => id !== active.id,
                    );
                    this.setComparisonPolicySettings({
                        ...this.comparisonPolicySettings,
                        profiles,
                    });
                    this.activeComparisonProfileId = profiles[0]?.id ?? 'global';
                    this.comparisonPolicyOpen = true;
                    this.comparisonPolicySectionOpen.profiles = true;
                    this.render();
                });
                actions.appendChild(remove);
            }
            wrapper.appendChild(actions);
        }

        const context = this.comparisonScopeContext(snapshot);
        const creator = element('form', {
            className: 'st-devtools-policy-profile-creator',
        });
        const scope = element('select');
        const scopeKey = (kind) => (
            kind === 'global' ? null : context[kind]?.key ?? null
        );
        const profileExists = (kind) => this.comparisonProfiles().some((profile) => (
            profile.scope.kind === kind
            && (
                kind === 'global'
                || comparisonScopeKeyEquals(profile.scope.key, scopeKey(kind))
            )
        ));
        const scopeAvailable = (kind) => (
            (kind === 'global' || Boolean(scopeKey(kind)))
            && !profileExists(kind)
        );
        for (const value of COMPARISON_POLICY_PROFILE_SCOPES) {
            const option = element('option', {
                text: t(`comparison.profile.scope.${value}`),
            });
            option.value = value;
            option.disabled = !scopeAvailable(value);
            scope.appendChild(option);
        }
        const firstAvailableScope = [...scope.options].find(({ disabled }) => !disabled);
        if (firstAvailableScope) scope.value = firstAvailableScope.value;
        scope.disabled = !firstAvailableScope;
        const label = element('input');
        label.required = true;
        label.placeholder = t('comparison.profile.labelPlaceholder');
        const scopeState = element('small', { className: 'st-devtools-policy-scope-state' });
        const updateScopeState = () => {
            const entry = context[scope.value];
            scopeState.textContent = !firstAvailableScope
                ? t('comparison.profile.noAvailableScopes')
                : profileExists(scope.value)
                    ? t('comparison.profile.scopeExists')
                    : scope.value === 'global'
                        ? t('comparison.profile.scopeGlobalHint')
                        : entry
                            ? t('comparison.profile.scopeDetected', { label: entry.label })
                            : t('comparison.profile.scopeUnavailable');
            if (!label.value.trim() && entry?.label) label.placeholder = entry.label;
        };
        scope.addEventListener('change', updateScopeState);
        updateScopeState();
        const add = element('button', {
            className: 'menu_button',
            text: t('action.addProfile'),
            type: 'submit',
        });
        add.disabled = !firstAvailableScope;
        creator.append(
            this.policyField('comparison.profile.scope', scope),
            scopeState,
            this.policyField('comparison.profile.label', label),
            add,
        );
        creator.addEventListener('submit', (event) => {
            event.preventDefault();
            const entry = context[scope.value];
            const key = scope.value === 'global' ? null : entry?.key;
            if (scope.value !== 'global' && !key) return;
            if (!scopeAvailable(scope.value)) return;
            const profile = {
                id: policyId(`profile-${scope.value}`),
                label: label.value.trim() || entry?.label || scope.value,
                enabled: true,
                priority: 0,
                scope: { kind: scope.value, key },
                groupDefinitions: [],
                matchers: [],
                manualAssignments: [],
            };
            this.setComparisonPolicySettings({
                ...this.comparisonPolicySettings,
                profiles: [...this.comparisonProfiles(), profile],
            });
            this.activeComparisonProfileId = profile.id;
            this.comparisonPolicyOpen = true;
            this.comparisonPolicySectionOpen.profiles = true;
            this.render();
        });
        wrapper.appendChild(creator);
        return wrapper;
    }

    renderPolicyTransfer() {
        const wrapper = element('div', { className: 'st-devtools-policy-transfer' });
        const includeReviewsLabel = element('label', {
            className: 'st-devtools-policy-checkbox-label',
        });
        const includeReviews = element('input');
        includeReviews.type = 'checkbox';
        includeReviewsLabel.append(
            includeReviews,
            document.createTextNode(` ${t('comparison.transfer.includeReviews')}`),
        );
        const exportButton = element('button', {
            className: 'menu_button',
            text: t('action.exportPolicy'),
            type: 'button',
        });
        const importInput = element('input');
        importInput.type = 'file';
        importInput.accept = 'application/json,.json';
        const status = element('p', { className: 'st-devtools-policy-form-status' });
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');

        exportButton.addEventListener('click', () => {
            try {
                const serialized = serializePolicyDocument({
                    ruleSettings: this.pendingImportedRuleSettings ?? this.ruleSettings,
                    comparisonPolicy: this.comparisonPolicySettings,
                    reviews: includeReviews.checked
                        ? this.pendingImportedReviews ?? this.findingReviewDocument
                        : null,
                    extensionVersion: this.version,
                });
                downloadText(
                    `st-devtools-rule-policy-${Date.now()}.json`,
                    serialized,
                    'application/json',
                );
                setPolicyFormStatus(status, t('comparison.transfer.exported'));
            } catch (error) {
                setPolicyFormStatus(
                    status,
                    t('comparison.transfer.failed', {
                        error: error?.code ?? error?.message ?? t('common.unknown'),
                    }),
                    true,
                );
            }
        });
        importInput.addEventListener('change', async () => {
            const file = importInput.files?.[0];
            if (!file) return;
            if (file.size > POLICY_IO_LIMITS.inputBytes) {
                setPolicyFormStatus(status, t('comparison.transfer.tooLarge'), true);
                importInput.value = '';
                return;
            }
            try {
                const prepared = preparePolicyImport(await file.text(), {
                    ruleSettings: this.pendingImportedRuleSettings ?? this.ruleSettings,
                    comparisonPolicy: this.comparisonPolicySettings,
                    reviews: this.pendingImportedReviews ?? this.findingReviewDocument,
                });
                this.pendingImportedRuleSettings = prepared.nextState.ruleSettings;
                this.pendingImportedReviews = prepared.nextState.reviews ?? null;
                this.setComparisonPolicySettings(prepared.nextState.comparisonPolicy);
                this.comparisonPolicyDirty = true;
                this.comparisonPolicyOpen = true;
                this.comparisonPolicySectionOpen.transfer = true;
                this.comparisonPolicySectionOpen.preview = true;
                this.ruleAuditLog = appendAuditEntry(this.ruleAuditLog, {
                    action: 'policy.import-preview',
                    before: this.savedComparisonPolicySettings,
                    after: this.comparisonPolicySettings,
                    summary: {
                        profiles: this.comparisonPolicySettings.profiles.length,
                    },
                });
                this.ruleReviewStatus = t('comparison.transfer.ready');
                this.ruleReviewStatusIsError = false;
                this.render();
            } catch (error) {
                setPolicyFormStatus(
                    status,
                    t('comparison.transfer.failed', {
                        error: error?.code ?? error?.message ?? t('common.unknown'),
                    }),
                    true,
                );
            } finally {
                importInput.value = '';
            }
        });
        wrapper.append(
            proseElement('p', t('comparison.transfer.privacy')),
            includeReviewsLabel,
            exportButton,
            this.policyField('comparison.transfer.import', importInput),
            status,
        );
        return wrapper;
    }

    createComparisonPolicySection(key, title, description) {
        const details = element('details', {
            className: 'st-devtools-disclosure st-devtools-policy-section',
        });
        details.dataset.policySection = key;
        details.open = this.comparisonPolicySectionOpen[key] ?? false;
        details.addEventListener('toggle', () => {
            this.comparisonPolicySectionOpen[key] = details.open;
        });
        const summary = element('summary');
        summary.appendChild(explainedTitle(title, description));
        const content = element('div', { className: 'st-devtools-policy-section-content' });
        details.append(summary, content);
        return { details, content };
    }

    policyPreviewFor(snapshot) {
        const key = [
            this.policyPreviewRevision,
            snapshot?.id ?? 'none',
            snapshot?.sources?.length ?? 0,
            snapshot?.finalText?.length ?? 0,
        ].join(':');
        if (this.policyPreviewCache?.key === key) {
            return this.policyPreviewCache.value;
        }
        const value = {
            preview: buildPolicyChangePreview(
                snapshot,
                this.ruleSettings,
                this.savedComparisonPolicySettings,
                this.comparisonPolicySettings,
                this.pendingImportedRuleSettings ?? this.ruleSettings,
            ),
            annotated: annotateSourcesWithPolicies(
                snapshot?.sources ?? [],
                this.comparisonPolicySettings,
                snapshot,
            ),
        };
        this.policyPreviewCache = { key, value };
        return value;
    }

    renderComparisonPreview(snapshot) {
        const { details: section, content } = this.createComparisonPolicySection(
            'preview',
            t('comparison.previewTitle'),
            t('comparison.previewDescription'),
        );
        let mounted = false;
        const mount = () => {
            if (mounted) return;
            mounted = true;
            try {
                if (!this.comparisonPolicyDirty) {
                    content.appendChild(proseElement(
                        'p',
                        t('comparison.diff.noDraftChanges'),
                    ));
                    return;
                }
                const { preview, annotated } = this.policyPreviewFor(snapshot);
                const summary = element('dl', {
                    className: 'st-devtools-policy-diff-summary',
                });
                const stat = (label, value) => {
                    const item = element('div');
                    item.append(
                        element('dt', { text: label }),
                        element('dd', { text: value }),
                    );
                    summary.appendChild(item);
                };
                stat(t('comparison.diff.beforeFindings'), preview.before.findings);
                stat(t('comparison.diff.afterFindings'), preview.after.findings);
                stat(t('comparison.diff.added'), preview.findingDelta.added);
                stat(t('comparison.diff.removed'), preview.findingDelta.removed);
                stat(t('comparison.diff.unchanged'), preview.findingDelta.unchanged);
                stat(t('comparison.diff.suppressed'), preview.after.suppressed);
                content.appendChild(summary);
                if (preview.truncated) {
                    content.appendChild(proseElement(
                        'p',
                        t('comparison.diff.truncated'),
                        { className: 'st-devtools-policy-invalid' },
                    ));
                }

                const rows = annotated.filter(({ type, content: sourceContent }) => (
                    type !== 'final'
                    && type !== 'chat_history'
                    && sourceContent?.trim()
                ));
                if (rows.length === 0) {
                    content.appendChild(proseElement('p', t('comparison.previewEmpty')));
                    return;
                }
                const list = element('div', { className: 'st-devtools-policy-preview-list' });
                for (const source of rows.slice(0, POLICY_PREVIEW_SOURCE_LIMIT)) {
                    const policy = source.comparisonPolicy
                        ?? source.metadata?.comparisonPolicy
                        ?? null;
                    const card = element('article', {
                        className: 'st-devtools-policy-preview-card',
                    });
                    card.appendChild(element('strong', {
                        text: policySourceLabel(source),
                    }));
                    if (policy) {
                        card.append(
                            element('span', {
                                text: `${policy.group} · ${
                                    policy.option || t('common.unknown')
                                }`,
                            }),
                            element('small', {
                                text: t('comparison.previewTrace', {
                                    profile: policy.profileLabel
                                        ?? policy.profileId
                                        ?? t('common.unknown'),
                                    scope: t(
                                        `comparison.profile.scope.${
                                            policy.profileScope ?? 'global'
                                        }`,
                                    ),
                                    origin: policy.origin === 'manual'
                                        ? t('comparison.previewManual')
                                        : t('comparison.previewRule'),
                                }),
                            }),
                        );
                    } else {
                        card.appendChild(element('span', {
                            text: t('comparison.previewNoPolicy'),
                        }));
                    }
                    const state = element('small', {
                        text: [
                            source.configuredEnabled === false
                                || source.metadata?.configuredEnabled === false
                                ? t('comparison.previewDisabled')
                                : t('comparison.previewEnabled'),
                            source.included === false
                                ? t('comparison.previewNotIncluded')
                                : t('comparison.previewIncluded'),
                        ].join(' · '),
                    });
                    card.appendChild(state);
                    list.appendChild(card);
                }
                content.appendChild(list);
                if (rows.length > POLICY_PREVIEW_SOURCE_LIMIT) {
                    content.appendChild(proseElement('p', t(
                        'comparison.previewSourceTruncated',
                        {
                            shown: POLICY_PREVIEW_SOURCE_LIMIT,
                            total: rows.length,
                        },
                    )));
                }
                if (preview.assignmentChanges.length > 0) {
                    content.appendChild(element('p', {
                        className: 'st-devtools-policy-preview-note',
                        text: t('comparison.diff.assignmentChanges', {
                            count: preview.assignmentChanges.length,
                        }),
                    }));
                }
            } catch (error) {
                const message = element('p', {
                    className: 'st-devtools-policy-invalid',
                    text: t('comparison.previewInvalid', {
                        message: error?.message ?? t('common.unknown'),
                    }),
                });
                message.setAttribute('role', 'alert');
                content.appendChild(message);
            }
        };
        section.addEventListener('toggle', () => {
            if (section.open) mount();
        });
        if (section.open) mount();
        return section;
    }

    renderComparisonPolicySettings(snapshot) {
        const details = element('details', {
            className: 'st-devtools-rule-settings st-devtools-policy-settings',
        });
        details.open = this.comparisonPolicyOpen;
        details.addEventListener('toggle', () => {
            this.comparisonPolicyOpen = details.open;
        });
        const summary = element('summary');
        summary.appendChild(explainedTitle(
            t('comparison.title'),
            [
                t('comparison.description'),
                t('comparison.precedence'),
            ].join(' '),
        ));
        details.append(summary);

        const content = element('div', { className: 'st-devtools-policy-content' });
        const {
            details: profileSection,
            content: profileContent,
        } = this.createComparisonPolicySection(
            'profiles',
            t('comparison.profile.title'),
            t('comparison.profile.description'),
        );
        profileContent.appendChild(this.renderComparisonProfiles(snapshot));

        const {
            details: groupSection,
            content: groupContent,
        } = this.createComparisonPolicySection(
            'groups',
            t('comparison.groupDefinition.title'),
            t('comparison.groupDefinition.description'),
        );
        groupContent.appendChild(this.renderComparisonGroupDefinitions());

        const {
            details: ruleSection,
            content: ruleContent,
        } = this.createComparisonPolicySection(
            'rules',
            t('comparison.rulesTitle'),
            `${t('comparison.rulesDescription')} ${t('comparison.regexDescription')}\n\n${t('comparison.rulesExample')}`,
        );
        const rules = this.comparisonNameRules();
        const ruleList = element('div', { className: 'st-devtools-policy-rule-list' });
        if (rules.length === 0) {
            ruleList.appendChild(proseElement('p', t('comparison.noRules')));
        } else {
            rules.forEach((rule, index) => {
                ruleList.appendChild(this.renderComparisonRuleCard(rule, index, snapshot));
            });
        }
        ruleContent.append(ruleList, this.renderComparisonRuleCreator(snapshot));

        const {
            details: manualSection,
            content: manualContent,
        } = this.createComparisonPolicySection(
            'manual',
            t('comparison.manualTitle'),
            t('comparison.manualDescription'),
        );
        const assignmentList = element('div', { className: 'st-devtools-policy-assignment-list' });
        this.comparisonManualAssignments().forEach((assignment, index) => {
            assignmentList.appendChild(this.renderManualAssignmentCard(assignment, index));
        });
        manualContent.append(assignmentList, this.renderManualAssignmentCreator(snapshot));

        const {
            details: transferSection,
            content: transferContent,
        } = this.createComparisonPolicySection(
            'transfer',
            t('comparison.transfer.title'),
            t('comparison.transfer.description'),
        );
        transferContent.appendChild(this.renderPolicyTransfer());

        const actions = element('div', {
            className: 'st-devtools-rule-setting-actions st-devtools-policy-actions',
        });
        const save = element('button', {
            className: 'menu_button',
            text: t('action.applySettings'),
            type: 'button',
        });
        save.addEventListener('click', () => {
            const result = this.commitPolicyDraft();
            this.comparisonPolicyOpen = true;
            if (!result.ok) {
                this.ruleReviewStatus = t('comparison.settingsSaveFailed', {
                    error: result.error?.message ?? t('common.unknown'),
                });
                this.ruleReviewStatusIsError = true;
                globalThis.toastr?.error?.(
                    t('comparison.settingsSaveFailed', {
                        error: result.error?.message ?? t('common.unknown'),
                    }),
                    'ST DevTools',
                );
                this.render();
                return;
            }
            this.ruleReviewStatus = t('comparison.settingsSaved');
            this.ruleReviewStatusIsError = false;
            this.render();
            globalThis.toastr?.info?.(t('comparison.settingsSaved'), 'ST DevTools');
        });
        const reset = element('button', {
            className: 'menu_button',
            text: t('action.resetSettings'),
            type: 'button',
        });
        reset.addEventListener('click', () => {
            this.pendingImportedRuleSettings = null;
            this.pendingImportedReviews = null;
            this.setComparisonPolicySettings(DEFAULT_COMPARISON_POLICY_SETTINGS);
            this.activeComparisonProfileId = 'global';
            this.comparisonPolicyOpen = true;
            this.comparisonPolicySectionOpen.preview = true;
            this.ruleReviewStatus = t('comparison.settingsResetDraft');
            this.ruleReviewStatusIsError = false;
            this.render();
            globalThis.toastr?.info?.(t('comparison.settingsResetDraft'), 'ST DevTools');
        });
        const dirty = element('span', {
            className: this.comparisonPolicyDirty
                ? 'st-devtools-policy-dirty is-dirty'
                : 'st-devtools-policy-dirty',
            text: this.comparisonPolicyDirty
                ? t('comparison.unsavedChanges')
                : t('comparison.savedState'),
        });
        const status = element('p', {
            className: this.ruleReviewStatusIsError
                ? 'st-devtools-policy-form-status is-error'
                : 'st-devtools-policy-form-status',
            text: this.ruleReviewStatus,
        });
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        actions.append(dirty, save, reset);
        content.append(
            profileSection,
            groupSection,
            ruleSection,
            manualSection,
            this.renderComparisonPreview(snapshot),
            transferSection,
            actions,
            status,
        );
        details.appendChild(content);
        return details;
    }

    renderComparisonAnalysis(snapshot, comparison = {}) {
        const suppressed = comparison.suppressedComparisons ?? [];
        const suppressedTotal = Number.isFinite(comparison.suppressedComparisonCount)
            ? comparison.suppressedComparisonCount
            : suppressed.length;
        const suppressedOmitted = Number.isFinite(comparison.suppressedComparisonsOmitted)
            ? comparison.suppressedComparisonsOmitted
            : Math.max(0, suppressedTotal - suppressed.length);
        const suppressedTruncated = comparison.suppressedComparisonsTruncated === true
            || suppressedOmitted > 0;
        const skipped = comparison.skippedSources ?? [];
        const groups = comparison.groups ?? [];
        const warnings = comparison.groupWarnings ?? [];
        const details = element('details', { className: 'st-devtools-policy-results' });
        if (warnings.length > 0) details.open = true;

        const summary = element('summary');
        summary.append(
            explainedTitle(
                t('comparison.resultSummary'),
                t('comparison.resultDescription'),
            ),
            element('span', {
                className: 'st-devtools-policy-result-count',
                text: t('comparison.suppressedCount', { count: suppressedTotal }),
            }),
        );
        details.appendChild(summary);

        attachLazyDetailsContent(details, () => {
            const content = element('div', { className: 'st-devtools-policy-result-content' });
            const badges = element('div', { className: 'st-devtools-rule-summary' });
            badges.append(
                element('span', {
                    className: 'st-devtools-policy-result-count',
                    text: t('comparison.skippedCount', { count: skipped.length }),
                }),
                element('span', {
                    className: 'st-devtools-policy-result-count',
                    text: t('comparison.groupCount', { count: groups.length }),
                }),
                element('span', {
                    className: warnings.length
                        ? 'st-devtools-policy-result-count has-warning'
                        : 'st-devtools-policy-result-count',
                    text: t('comparison.warningCount', { count: warnings.length }),
                }),
            );
            content.appendChild(badges);
            const sourceById = new Map(
                (snapshot?.sources ?? []).map((source) => [source.id, source]),
            );
            const listSection = (titleKey, items, formatter, className = '') => {
                if (items.length === 0) return;
                const section = element('section', {
                    className: `st-devtools-policy-result-section ${className}`.trim(),
                });
                section.appendChild(element('h4', { text: t(titleKey) }));
                const list = element('ul');
                items.forEach((item) => {
                    list.appendChild(element('li', { text: formatter(item) }));
                });
                section.appendChild(list);
                content.appendChild(section);
            };
            listSection('comparison.suppressedTitle', suppressed, (item) => {
                const left = item?.leftId
                    ?? item?.leftSourceId
                    ?? item?.left
                    ?? item?.sourceIds?.[0];
                const right = item?.rightId
                    ?? item?.rightSourceId
                    ?? item?.right
                    ?? item?.sourceIds?.[1];
                const pair = t('comparison.itemPair', {
                    left: sourceReferenceLabel(left, sourceById),
                    right: sourceReferenceLabel(right, sourceById),
                });
                const suffix = [
                    item?.group,
                    item?.category,
                    item?.reason ? policyReasonLabel(item.reason) : null,
                ].filter(Boolean).join(' · ');
                return suffix ? `${pair} · ${suffix}` : pair;
            });
            if (suppressedTruncated) {
                content.appendChild(proseElement(
                    'p',
                    t('comparison.suppressedTruncated', {
                        total: suppressedTotal,
                        shown: suppressed.length,
                        omitted: suppressedOmitted,
                    }),
                    { className: 'st-devtools-policy-result-note' },
                ));
            }
            listSection('comparison.skippedTitle', skipped, (item) => {
                const label = sourceReferenceLabel(
                    item?.sourceId ?? item?.id ?? item,
                    sourceById,
                );
                return item?.reason ? `${label} · ${policyReasonLabel(item.reason)}` : label;
            });
            listSection('comparison.groupsTitle', groups, (item) => {
                const sourceIds = item?.sourceIds ?? item?.members ?? item?.sources ?? [];
                const activeSourceIds = item?.activeSourceIds ?? [];
                const options = item?.options ?? item?.activeOptions ?? [];
                return t('comparison.groupSummary', {
                    group: item?.group ?? item?.name ?? t('common.unknown'),
                    mode: policyModeLabel(item?.mode),
                    count: sourceIds.length,
                    active: activeSourceIds.length,
                    options: options.join(', ') || t('common.unknown'),
                });
            });
            listSection(
                'comparison.groupWarningsTitle',
                warnings,
                (item) => item?.message
                    ?? (item?.group
                        ? `${item.group} · ${t('comparison.groupWarningFallback')}`
                        : t('comparison.groupWarningFallback')),
                'has-warning',
            );
            if (
                suppressedTotal === 0
                && skipped.length === 0
                && groups.length === 0
                && warnings.length === 0
            ) {
                content.appendChild(proseElement('p', t('comparison.noPolicyEffects')));
            }
            return content;
        });
        return details;
    }

    renderInstructionModel(model) {
        const details = element('details', {
            className: 'st-devtools-instruction-model',
        });
        details.open = this.instructionModelOpen;
        details.addEventListener('toggle', () => {
            this.instructionModelOpen = details.open;
        });

        const summary = element('summary');
        summary.appendChild(explainedTitle(
            t('rules.v3.title'),
            t('rules.v3.description'),
        ));
        const stats = model?.stats ?? {};
        summary.append(
            element('span', {
                className: 'st-devtools-instruction-count',
                text: t('rules.v3.atomCount', { count: stats.atoms ?? 0 }),
            }),
            element('span', {
                className: 'st-devtools-instruction-count',
                text: t('rules.v3.relationCount', {
                    count: model?.relations?.length ?? 0,
                }),
            }),
        );
        if ((model?.alerts?.length ?? 0) > 0) {
            summary.appendChild(element('span', {
                className: 'st-devtools-instruction-count',
                text: t('rules.v3.alertCount', {
                    count: model.alerts.length,
                }),
            }));
        }
        details.appendChild(summary);

        const content = element('div', {
            className: 'st-devtools-instruction-content',
        });
        const overview = element('div', {
            className: 'st-devtools-instruction-overview',
        });
        overview.append(
            element('span', {
                text: t('rules.v3.instructionSources', {
                    count: stats.instructionSources ?? 0,
                }),
            }),
            element('span', {
                text: t('rules.v3.referenceSources', {
                    count: stats.referenceSources ?? 0,
                }),
            }),
            element('span', {
                className: 'determination-confirmed',
                text: `${t('rules.determination.confirmed')} ${
                    stats.confirmedRelations ?? 0
                }`,
            }),
            element('span', {
                className: 'determination-candidate',
                text: `${t('rules.determination.candidate')} ${
                    stats.candidateRelations ?? 0
                }`,
            }),
            element('span', {
                className: 'determination-insufficient-evidence',
                text: `${t('rules.determination.insufficient-evidence')} ${
                    stats.insufficientRelations ?? 0
                }`,
            }),
        );
        content.appendChild(overview);
        if (
            stats.atomsTruncated
            || stats.relationsTruncated
            || stats.alertsTruncated
        ) {
            content.appendChild(proseElement(
                'p',
                t('rules.v3.analysisLimited'),
                { className: 'st-devtools-instruction-limit' },
            ));
        }

        const capabilities = element('details', {
            className: 'st-devtools-instruction-section',
        });
        const capabilitySummary = element('summary');
        capabilitySummary.appendChild(explainedTitle(
            t('rules.v3.capabilityTitle'),
            t('rules.v3.capabilityDescription'),
            { titleTag: 'span' },
        ));
        capabilities.appendChild(capabilitySummary);
        const capabilityCounts = new Map();
        let inactiveCapabilityCount = 0;
        for (const capability of model?.capabilities ?? []) {
            const key = capability.kind ?? 'mixed';
            capabilityCounts.set(key, (capabilityCounts.get(key) ?? 0) + 1);
            if (!capability.active) inactiveCapabilityCount += 1;
        }
        const capabilityList = element('div', {
            className: 'st-devtools-instruction-capabilities',
        });
        for (const [kind, count] of capabilityCounts) {
            capabilityList.appendChild(element('span', {
                text: t('rules.v3.capabilityItem', {
                    kind: t(`rules.capability.${kind}`),
                    count,
                }),
            }));
        }
        if (inactiveCapabilityCount > 0) {
            capabilityList.appendChild(element('span', {
                text: t('rules.v3.capabilityItem', {
                    kind: t('rules.capability.inactive'),
                    count: inactiveCapabilityCount,
                }),
            }));
        }
        capabilities.appendChild(capabilityList);
        content.appendChild(capabilities);

        const atoms = element('details', {
            className: 'st-devtools-instruction-section',
        });
        atoms.open = this.instructionAtomsOpen;
        atoms.addEventListener('toggle', () => {
            this.instructionAtomsOpen = atoms.open;
        });
        const atomSummary = element('summary');
        atomSummary.appendChild(explainedTitle(
            `${t('rules.v3.atomTitle')} · ${model?.atoms?.length ?? 0}`,
            t('rules.v3.atomDescription'),
            { titleTag: 'span' },
        ));
        atoms.appendChild(atomSummary);
        attachLazyDetailsContent(atoms, () => {
            const atomList = element('div', {
                className: 'st-devtools-instruction-atoms',
            });
            if ((model?.atoms?.length ?? 0) === 0) {
                atomList.appendChild(proseElement('p', t('rules.v3.noAtoms')));
            }
            const visibleAtoms = (model?.atoms ?? []).slice(0, 100);
            if ((model?.atoms?.length ?? 0) > visibleAtoms.length) {
                atomList.appendChild(proseElement(
                    'p',
                    t('rules.v3.displayLimited', {
                        total: model.atoms.length,
                        shown: visibleAtoms.length,
                    }),
                    { className: 'st-devtools-instruction-limit' },
                ));
            }
            for (const atom of visibleAtoms) {
                const card = element('article', {
                    className: `st-devtools-instruction-atom determination-${
                        atom.status
                    }`,
                });
                const header = element('header');
                header.append(
                    element('strong', {
                        text: t('rules.v3.atomHeading', {
                            property: translatedValue(
                                `rules.property.${atom.property}`,
                                atom.property,
                            ),
                            value: atom.valueLabel ?? atom.value,
                        }),
                    }),
                    element('span', {
                        className: 'st-devtools-determination',
                        text: t(`rules.determination.${atom.status}`),
                    }),
                );
                const metadata = element('div', {
                    className: 'st-devtools-instruction-atom-meta',
                });
                metadata.append(
                    element('span', {
                        text: t('rules.v3.atomSource', {
                            source: atom.sourceLabel ?? atom.sourceId,
                        }),
                    }),
                    element('span', {
                        text: t('rules.v3.atomPolarity', {
                            polarity: t(`rules.polarity.${atom.polarity}`),
                            scope: translatedValue(
                                `rules.scope.${atom.scope}`,
                                atom.scope,
                            ),
                        }),
                    }),
                    element('span', {
                        text: t('rules.v3.atomContext', {
                            role: atom.sourceRole ?? t('common.unknown'),
                            position: atom.position ?? t('common.unknown'),
                            depth: atom.depth ?? t('common.unknown'),
                        }),
                    }),
                    element('span', {
                        text: t('rules.v3.atomTargetAction', {
                            target: translatedValue(
                                `rules.target.${atom.target}`,
                                atom.target,
                            ),
                            action: translatedValue(
                                `rules.action.${atom.action}`,
                                atom.action,
                            ),
                            priority: translatedValue(
                                `rules.priority.${atom.priority}`,
                                atom.priority,
                            ),
                        }),
                    }),
                    element('span', {
                        text: t('rules.v3.atomLocation', {
                            start: atom.localRange?.start ?? 0,
                            end: atom.localRange?.end ?? 0,
                            count: atom.finalRanges?.length ?? 0,
                            method: translatedValue(
                                `rules.range.${atom.rangeMethod}`,
                                atom.rangeMethod,
                            ),
                        }),
                    }),
                );
                card.append(header, metadata);
                if (atom.condition) {
                    card.appendChild(proseElement('p', t('rules.v3.condition', {
                        value: atom.condition,
                    })));
                }
                if (atom.exception) {
                    card.appendChild(proseElement('p', t('rules.v3.exception', {
                        value: atom.exception,
                    })));
                }
                card.appendChild(element('small', {
                    text: t('rules.v3.methodConfidence', {
                        method: atom.method,
                        confidence: Math.round((Number(atom.confidence) || 0) * 100),
                    }),
                }));
                const evidence = element('details', {
                    className: 'st-devtools-instruction-atom-evidence',
                });
                const evidenceSummary = element('summary');
                evidenceSummary.appendChild(explainedTitle(
                    t('rules.v3.atomEvidence'),
                    t('rules.v3.atomEvidenceDescription'),
                    { titleTag: 'span' },
                ));
                evidence.append(
                    evidenceSummary,
                    element('pre', { text: atom.text }),
                    element('small', {
                        text: t('rules.v3.atomSourceId', { id: atom.sourceId }),
                    }),
                );
                card.appendChild(evidence);
                atomList.appendChild(card);
            }
            return atomList;
        });
        content.appendChild(atoms);
        details.appendChild(content);
        return details;
    }

    findingReviewContext(snapshot) {
        const context = this.comparisonScopeContext(snapshot);
        return {
            scopeKeys: {
                preset: context.preset?.key ?? null,
                character: context.character?.key ?? null,
                chat: context.chat?.key ?? null,
            },
        };
    }

    findingIgnoreScopeProfiles(snapshot) {
        const applicable = this.applicableComparisonProfiles(snapshot);
        if (applicable.length > 0) return applicable;
        const global = this.comparisonProfiles().find(
            ({ enabled, scope }) => enabled && scope.kind === 'global',
        );
        return global ? [global] : [];
    }

    shouldStageFindingReview() {
        return Boolean(
            this.comparisonPolicyDirty
            || this.pendingImportedRuleSettings
            || this.pendingImportedReviews,
        );
    }

    updateFindingDecision(snapshot, finding, decision) {
        const staged = this.shouldStageFindingReview();
        const next = setFindingDecision(
            staged
                ? this.pendingImportedReviews ?? this.findingReviewDocument
                : this.findingReviewDocument,
            finding,
            snapshot?.sources ?? [],
            decision,
        );
        if (staged) {
            this.pendingImportedReviews = normalizeFindingReviewDocument(next);
            this.comparisonPolicyDirty = true;
            this.ruleReviewStatus = t('review.draftUpdated');
            this.ruleReviewStatusIsError = false;
        } else {
            const result = this.saveFindingReviewDocument(next);
            this.ruleReviewStatus = result.ok
                ? t(decision
                    ? `review.saved.${decision}`
                    : 'review.saved.cleared')
                : t('review.saveFailed', {
                    error: result.error?.message ?? t('common.unknown'),
                });
            this.ruleReviewStatusIsError = !result.ok;
        }
        this.render();
    }

    updateFindingIgnore(snapshot, finding, enabled, review = null, profile = null) {
        const selectedProfile = profile
            ?? this.findingIgnoreScopeProfiles(snapshot)[0]
            ?? null;
        const scope = review?.ignoreScope ?? selectedProfile?.scope?.kind ?? 'global';
        const scopeKey = review?.ignoreScopeKey ?? (
            scope === 'global' ? null : selectedProfile?.scope?.key
        );
        if (scope !== 'global' && !scopeKey) {
            this.ruleReviewStatus = t('review.scopeUnavailable');
            this.ruleReviewStatusIsError = true;
            this.render();
            return;
        }
        const staged = this.shouldStageFindingReview();
        const next = setFindingIgnore(
            staged
                ? this.pendingImportedReviews ?? this.findingReviewDocument
                : this.findingReviewDocument,
            finding,
            snapshot?.sources ?? [],
            {
                enabled,
                scope,
                scopeKey,
                label: selectedProfile?.label ?? null,
            },
        );
        if (staged) {
            this.pendingImportedReviews = normalizeFindingReviewDocument(next);
            this.comparisonPolicyDirty = true;
            this.ruleReviewStatus = t('review.draftUpdated');
            this.ruleReviewStatusIsError = false;
        } else {
            const result = this.saveFindingReviewDocument(next);
            this.ruleReviewStatus = result.ok
                ? t(enabled ? 'review.saved.ignored' : 'review.saved.ignoreRemoved')
                : t('review.saveFailed', {
                    error: result.error?.message ?? t('common.unknown'),
                });
            this.ruleReviewStatusIsError = !result.ok;
        }
        this.render();
    }

    renderFindingReviewControls(snapshot, finding) {
        const details = element('details', { className: 'st-devtools-finding-review' });
        details.appendChild(element('summary', { text: t('review.action.open') }));
        const fieldset = element('fieldset');
        fieldset.appendChild(element('legend', { text: t('review.decisionLegend') }));
        const decisionName = `finding-review-${finding.review.findingKey}`;
        for (const decision of ['valid', 'false-positive']) {
            const label = element('label');
            const input = element('input');
            input.type = 'radio';
            input.name = decisionName;
            input.value = decision;
            input.checked = finding.review.decision === decision;
            label.append(
                input,
                document.createTextNode(` ${t(`review.status.${decision}`)}`),
            );
            fieldset.appendChild(label);
        }
        const saveDecision = element('button', {
            className: 'menu_button',
            text: t('review.action.saveDecision'),
            type: 'button',
        });
        saveDecision.addEventListener('click', () => {
            const selected = fieldset.querySelector('input:checked')?.value;
            if (selected) this.updateFindingDecision(snapshot, finding, selected);
        });
        const clear = element('button', {
            className: 'menu_button',
            text: t('review.action.clear'),
            type: 'button',
        });
        clear.disabled = !finding.review.decision;
        clear.addEventListener('click', () => {
            this.updateFindingDecision(snapshot, finding, null);
        });
        const scopeProfiles = this.findingIgnoreScopeProfiles(snapshot);
        const ignoreScope = element('select');
        for (const profile of scopeProfiles) {
            const option = element('option', {
                text: `${t(`comparison.profile.scope.${profile.scope.kind}`)} · ${profile.label}`,
            });
            option.value = profile.id;
            ignoreScope.appendChild(option);
        }
        // Favor the narrowest applicable scope so an unopened global profile
        // cannot make a routine ignore action broader than the user expects.
        const preferredProfile = scopeProfiles[0];
        if (preferredProfile) ignoreScope.value = preferredProfile.id;
        const ignore = element('button', {
            className: 'menu_button',
            text: t('review.action.alwaysIgnore'),
            type: 'button',
        });
        ignore.disabled = scopeProfiles.length === 0;
        ignore.addEventListener('click', () => {
            const profile = scopeProfiles.find(({ id }) => id === ignoreScope.value)
                ?? scopeProfiles[0];
            if (!profile) return;
            if (!confirm(t('review.confirmAlwaysIgnore', {
                scope: t(`comparison.profile.scope.${
                    profile.scope.kind
                }`),
            }))) return;
            this.updateFindingIgnore(snapshot, finding, true, null, profile);
        });
        const hide = element('button', {
            className: 'menu_button',
            text: t('review.action.hideOnce'),
            type: 'button',
        });
        hide.addEventListener('click', () => {
            this.findingHiddenOnce.add(finding.review.findingKey);
            this.ruleReviewStatus = t('review.saved.hiddenOnce');
            this.ruleReviewStatusIsError = false;
            this.render();
        });
        const actions = element('div', {
            className: 'st-devtools-finding-review-actions',
        });
        actions.append(saveDecision, clear, ignore, hide);
        details.append(
            fieldset,
            this.policyField('review.ignoreScope', ignoreScope),
            actions,
        );
        return details;
    }

    renderReviewedFindings(snapshot, reviewResult) {
        const reviewed = reviewResult.all.filter(({ review }) => (
            review.decision === 'false-positive' || review.hidden
        ));
        const details = element('details', {
            className: 'st-devtools-disclosure st-devtools-reviewed-findings',
        });
        const summary = element('summary');
        summary.append(
            element('strong', { text: t('review.reviewedTitle') }),
            element('span', {
                className: 'st-devtools-disclosure-count',
                text: t('review.reviewedCount', { count: reviewed.length }),
            }),
        );
        details.appendChild(summary);
        attachLazyDetailsContent(details, () => {
            const content = element('div', { className: 'st-devtools-reviewed-list' });
            if (reviewed.length === 0) {
                content.appendChild(proseElement('p', t('review.none')));
                return content;
            }
            for (const finding of reviewed) {
                const card = element('article', {
                    className: 'st-devtools-reviewed-card',
                });
                const status = finding.review.hiddenOnce
                    ? 'hidden-once'
                    : finding.review.ignored
                        ? 'always-ignore'
                        : finding.review.decision;
                card.append(
                    element('strong', { text: finding.title }),
                    element('span', { text: t(`review.status.${status}`) }),
                );
                const restore = element('button', {
                    className: 'menu_button',
                    text: t('review.action.restore'),
                    type: 'button',
                });
                restore.addEventListener('click', () => {
                    if (finding.review.hiddenOnce) {
                        this.findingHiddenOnce.delete(finding.review.findingKey);
                        this.ruleReviewStatus = t('review.saved.restored');
                        this.ruleReviewStatusIsError = false;
                        this.render();
                    } else if (finding.review.ignored) {
                        this.updateFindingIgnore(snapshot, finding, false, finding.review);
                    } else {
                        this.updateFindingDecision(snapshot, finding, null);
                    }
                });
                card.appendChild(restore);
                content.appendChild(card);
            }
            return content;
        });
        return details;
    }

    renderRuleAuditLog() {
        const details = element('details', {
            className: 'st-devtools-disclosure st-devtools-rule-audit',
        });
        const reviewAudit = (
            this.pendingImportedReviews ?? this.findingReviewDocument
        ).audit ?? [];
        const policyAudit = this.ruleAuditLog.entries ?? [];
        const count = reviewAudit.length + policyAudit.length;
        const summary = element('summary');
        summary.append(
            element('strong', { text: t('audit.title') }),
            element('span', {
                className: 'st-devtools-disclosure-count',
                text: t('audit.count', { count }),
            }),
        );
        details.appendChild(summary);
        attachLazyDetailsContent(details, () => {
            const content = element('ol', { className: 'st-devtools-rule-audit-list' });
            const entries = [
                ...reviewAudit.map((entry) => ({
                    at: entry.at,
                    action: entry.action,
                    scope: entry.scope,
                })),
                ...policyAudit.map((entry) => ({
                    at: entry.at,
                    action: entry.action,
                    scope: null,
                })),
            ].sort((left, right) => String(right.at).localeCompare(String(left.at)));
            for (const entry of entries.slice(0, 200)) {
                content.appendChild(element('li', {
                    text: t('audit.entry', {
                        time: formatTimestamp(entry.at),
                        action: translatedValue(
                            `audit.action.${entry.action}`,
                            entry.action,
                        ),
                        scope: entry.scope
                            ? t(`comparison.profile.scope.${entry.scope}`)
                            : t('common.none'),
                    }),
                }));
            }
            if (entries.length === 0) {
                content.appendChild(element('li', { text: t('audit.none') }));
            }
            return content;
        });
        return details;
    }

    resetSemanticInspectionState(snapshotId = null) {
        const previous = this.semanticInspectionState;
        previous?.controller?.abort();
        this.closeSemanticConsent(false);
        this.semanticInspectionState = {
            snapshotId,
            analysisRevision: this.analysisRevision,
            targetIds: new Set(),
            status: 'idle',
            result: null,
            errorCode: null,
            sequence: (previous?.sequence ?? 0) + 1,
            controller: null,
        };
        this.refreshSemanticInspectorHost();
    }

    invalidateSemanticInspectionOutcome(state = this.semanticInspectionState) {
        if (!state) return;
        state.sequence += 1;
        state.controller?.abort();
        state.controller = null;
        state.analysisRevision = this.analysisRevision;
        state.status = 'idle';
        state.result = null;
        state.errorCode = null;
        this.closeSemanticConsent(false);
    }

    clearSemanticInspectorCache() {
        try {
            return this.semanticInspector?.clearCache?.() === true;
        } catch {
            return false;
        }
    }

    resetSemanticInspectionForSettingsChange(preferences = this.preferences) {
        this.cancelSemanticInspection();
        this.resetSemanticInspectionState();
        if (!preferences?.semanticInspectorEnabled) {
            this.clearSemanticInspectorCache();
        }
    }

    enableSemanticInspectorFromRules() {
        try {
            const preferences = this.saveUiPreferences({
                ...this.preferences,
                semanticInspectorEnabled: true,
            });
            this.resetSemanticInspectionForSettingsChange(preferences);
            if (this.semanticInspectorEnabledInput) {
                this.semanticInspectorEnabledInput.checked = true;
            }
            if (this.semanticConnectionProfileInput) {
                this.semanticConnectionProfileInput.disabled = false;
                this.semanticConnectionProfileInput
                    .closest('.st-devtools-semantic-profile')
                    ?.classList.remove('is-disabled');
            }
            if (this.semanticResponseTokenCapInput) {
                this.semanticResponseTokenCapInput.disabled = false;
                this.semanticResponseTokenCapInput
                    .closest('.st-devtools-semantic-cap')
                    ?.classList.remove('is-disabled');
            }
            globalThis.toastr?.success?.(t('semantic.enabled'), 'ST DevTools');
            this.render();
            return true;
        } catch (error) {
            console.error('[ST DevTools] Failed to enable semantic inspection.', error);
            globalThis.toastr?.error?.(t('semantic.enableFailed'), 'ST DevTools');
            return false;
        }
    }

    semanticSnapshotSupportsInspection(snapshot) {
        if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
            return false;
        }
        const schemaVersion = snapshot?.schemaVersion;
        if (
            schemaVersion != null
            && (
                !Number.isSafeInteger(schemaVersion)
                || schemaVersion < 1
                || schemaVersion > 7
            )
        ) {
            return false;
        }
        const privacy = snapshot.privacy;
        if (privacy == null) return schemaVersion !== 7;
        return typeof privacy === 'object'
            && !Array.isArray(privacy)
            && privacy.mode === 'full';
    }

    semanticTargetHasClosure(target, kind) {
        if (!target || typeof target !== 'object') return false;
        if (Array.isArray(target.sourceIds) && target.sourceIds.length > 0) {
            return true;
        }
        if (Array.isArray(target.atomIds) && target.atomIds.length > 0) {
            return true;
        }
        if (kind === 'cluster') {
            return Array.isArray(target.relationIds)
                && target.relationIds.length > 0;
        }
        return typeof target.relationId === 'string'
            && target.relationId.length > 0;
    }

    ensureSemanticInspectionSnapshot(snapshot) {
        if (this.semanticInspectionState.snapshotId !== snapshot?.id) {
            this.resetSemanticInspectionState(snapshot?.id ?? null);
        } else if (
            this.semanticInspectionState.analysisRevision !== this.analysisRevision
        ) {
            this.invalidateSemanticInspectionOutcome(this.semanticInspectionState);
        }
        return this.semanticInspectionState;
    }

    refreshSemanticInspectorHost() {
        if (
            this.semanticInspectorHost?.isConnected
            && typeof this.semanticInspectorHost.__stDevToolsSemanticRefresh
                === 'function'
        ) {
            this.semanticInspectorHost.__stDevToolsSemanticRefresh();
        }
    }

    cancelSemanticInspection() {
        const state = this.semanticInspectionState;
        if (!state) return;
        const active = ['preparing', 'awaiting-consent', 'running']
            .includes(state.status);
        if (!active) return;
        state.sequence += 1;
        state.controller?.abort();
        state.controller = null;
        state.status = 'cancelled';
        state.result = null;
        state.errorCode = null;
        this.closeSemanticConsent(false);
        this.refreshSemanticInspectorHost();
    }

    async startSemanticInspection(snapshot, analysis) {
        const state = this.ensureSemanticInspectionSnapshot(snapshot);
        if (
            !this.preferences.semanticInspectorEnabled
            || !this.semanticSnapshotSupportsInspection(snapshot)
            || typeof this.semanticInspector?.prepare !== 'function'
            || typeof this.semanticInspector?.inspect !== 'function'
            || state.targetIds.size === 0
        ) {
            return null;
        }
        state.controller?.abort();
        const sequence = state.sequence + 1;
        state.sequence = sequence;
        state.status = 'preparing';
        state.result = null;
        state.errorCode = null;
        state.controller = null;
        state.analysisRevision = this.analysisRevision;
        const analysisRevision = state.analysisRevision;
        this.refreshSemanticInspectorHost();
        try {
            const prepared = await this.semanticInspector.prepare({
                snapshot,
                analysis,
                targetIds: [...state.targetIds],
                provider: snapshotProvider(snapshot),
                model: snapshot?.model ?? null,
                responseTokenCap: this.preferences.semanticResponseTokenCap,
                pricingOverrides: this.pricingOverrides,
            });
            if (
                sequence !== state.sequence
                || state.snapshotId !== snapshot?.id
                || state.analysisRevision !== analysisRevision
            ) {
                return null;
            }
            state.status = 'awaiting-consent';
            this.refreshSemanticInspectorHost();
            const approved = await this.requestSemanticConsent(
                prepared?.preview ?? {},
            );
            if (
                sequence !== state.sequence
                || state.snapshotId !== snapshot?.id
                || state.analysisRevision !== analysisRevision
            ) {
                return null;
            }
            if (!approved) {
                state.status = 'cancelled';
                this.refreshSemanticInspectorHost();
                return null;
            }
            const controller = new AbortController();
            state.controller = controller;
            state.status = 'running';
            this.refreshSemanticInspectorHost();
            const result = await this.semanticInspector.inspect(prepared, {
                signal: controller.signal,
            });
            if (
                sequence !== state.sequence
                || controller.signal.aborted
                || state.snapshotId !== snapshot?.id
                || state.analysisRevision !== analysisRevision
            ) {
                return null;
            }
            state.controller = null;
            state.status = 'complete';
            state.result = result;
            state.errorCode = null;
            this.refreshSemanticInspectorHost();
            return result;
        } catch (error) {
            if (sequence !== state.sequence) return null;
            state.controller = null;
            const errorCode = String(error?.code ?? '');
            if (
                errorCode === 'SEMANTIC_ABORTED'
                || error?.name === 'AbortError'
            ) {
                state.status = 'cancelled';
                state.errorCode = null;
            } else {
                state.status = 'error';
                state.errorCode = /^[A-Z0-9_]{1,64}$/u.test(errorCode)
                    ? errorCode
                    : 'SEMANTIC_PROVIDER_ERROR';
            }
            state.result = null;
            this.refreshSemanticInspectorHost();
            return null;
        }
    }

    renderSemanticSuggestions(result) {
        const section = element('section', {
            className: 'st-devtools-semantic-results',
        });
        section.append(
            element('h3', { text: t('semantic.resultTitle') }),
            proseElement('p', t('semantic.resultDescription')),
        );
        const suggestions = Array.isArray(result?.suggestions)
            ? result.suggestions
            : [];
        if (suggestions.length === 0) {
            section.appendChild(proseElement('p', t('semantic.noSuggestions')));
            return section;
        }
        const list = element('div', {
            className: 'st-devtools-semantic-result-list',
        });
        for (const suggestion of suggestions) {
            const card = element('article', {
                className: 'st-devtools-semantic-result-card',
            });
            const header = element('header');
            header.append(
                element('span', {
                    className: `st-devtools-rule-severity severity-${
                        suggestion?.severity ?? 'info'
                    }`,
                    text: translatedValue(
                        `rules.severity.${suggestion?.severity}`,
                        suggestion?.severity ?? t('common.unknown'),
                    ),
                }),
                element('strong', {
                    text: suggestion?.title
                        ?? suggestion?.category
                        ?? t('semantic.suggestion'),
                }),
            );
            card.append(
                header,
                proseElement(
                    'p',
                    suggestion?.summary ?? t('semantic.suggestionNoSummary'),
                ),
            );
            if (typeof suggestion?.rationale === 'string') {
                const rationale = element('section', {
                    className: 'st-devtools-semantic-rationale',
                });
                rationale.append(
                    element('strong', { text: t('semantic.rationale') }),
                    proseElement('p', suggestion.rationale),
                );
                card.appendChild(rationale);
            }
            const metadata = element('div', {
                className: 'st-devtools-semantic-result-meta',
            });
            if (Number.isFinite(suggestion?.confidence)) {
                metadata.appendChild(element('small', {
                    text: t('semantic.suggestionConfidence', {
                        count: Math.round(suggestion.confidence * 100),
                    }),
                }));
            }
            const targets = Array.isArray(suggestion?.targetIds)
                ? suggestion.targetIds
                : [];
            if (targets.length > 0) {
                metadata.appendChild(element('small', {
                    text: t('semantic.suggestionTargets', {
                        count: targets.length,
                    }),
                }));
            }
            if (metadata.childElementCount > 0) card.appendChild(metadata);
            const evidenceItems = Array.isArray(suggestion?.evidence)
                ? suggestion.evidence
                : [];
            if (evidenceItems.length > 0) {
                const evidence = element('details', {
                    className: 'st-devtools-semantic-evidence st-devtools-disclosure',
                });
                const evidenceSummary = element('summary');
                evidenceSummary.append(
                    element('strong', { text: t('semantic.evidence') }),
                    element('span', {
                        className: 'st-devtools-disclosure-count',
                        text: String(evidenceItems.length),
                    }),
                );
                const evidenceList = element('div', {
                    className: 'st-devtools-semantic-evidence-list',
                });
                for (const item of evidenceItems) {
                    const evidenceCard = element('article');
                    evidenceCard.append(
                        element('small', {
                            text: t('semantic.evidenceLocation', {
                                source: item?.sourceId ?? t('common.unknown'),
                                start: normalizedCount(item?.start),
                                end: normalizedCount(item?.end),
                            }),
                        }),
                        element('pre', {
                            text: typeof item?.quote === 'string'
                                ? item.quote
                                : t('common.unknown'),
                        }),
                    );
                    evidenceList.appendChild(evidenceCard);
                }
                evidence.append(evidenceSummary, evidenceList);
                card.appendChild(evidence);
            }
            list.appendChild(card);
        }
        section.appendChild(list);
        return section;
    }

    renderSemanticInspector(snapshot, analysis, findings) {
        const state = this.ensureSemanticInspectionSnapshot(snapshot);
        const clusters = Array.isArray(analysis?.instructions?.clusters)
            ? analysis.instructions.clusters
            : [];
        const semanticFindings = findings.filter(
            (finding) => this.semanticTargetHasClosure(finding, 'finding'),
        );
        const semanticClusters = clusters.filter(
            (cluster) => this.semanticTargetHasClosure(cluster, 'cluster'),
        );
        const availableTargetIds = new Set([
            ...semanticFindings.map((finding) => `finding:${finding.id}`),
            ...semanticClusters.map((cluster) => `cluster:${cluster.id}`),
        ]);
        let prunedSelection = false;
        for (const targetId of state.targetIds) {
            if (!availableTargetIds.has(targetId)) {
                state.targetIds.delete(targetId);
                prunedSelection = true;
            }
        }
        if (prunedSelection) this.invalidateSemanticInspectionOutcome(state);
        const section = element('section', {
            className: 'st-devtools-semantic-inspector',
        });
        const heading = element('header', {
            className: 'st-devtools-semantic-heading',
        });
        heading.append(
            explainedTitle(
                t('semantic.title'),
                t('semantic.description'),
                { tag: 'h3', titleTag: 'span' },
            ),
            element('span', {
                className: 'st-devtools-semantic-optional',
                text: t('semantic.optional'),
            }),
        );
        section.appendChild(heading);
        if (!this.semanticSnapshotSupportsInspection(snapshot)) {
            section.appendChild(proseElement(
                'p',
                t('semantic.fullSnapshotOnly'),
            ));
            return section;
        }
        if (!this.preferences.semanticInspectorEnabled) {
            const enableCard = element('div', {
                className: 'st-devtools-semantic-enable-card',
            });
            const copy = element('div');
            copy.append(
                proseElement('p', t('semantic.disabledDescription')),
                proseElement('small', t('semantic.enableHint')),
            );
            const enable = element('button', {
                className: 'menu_button st-devtools-primary-button',
                text: t('semantic.enable'),
                type: 'button',
            });
            const status = element('p', {
                className: 'st-devtools-semantic-enable-status',
            });
            status.setAttribute('aria-live', 'polite');
            enable.addEventListener('click', () => {
                const enabled = this.enableSemanticInspectorFromRules();
                if (!enabled) {
                    status.textContent = t('semantic.enableFailed');
                    status.setAttribute('role', 'alert');
                }
            });
            enableCard.append(copy, enable, status);
            section.appendChild(enableCard);
            return section;
        }
        if (
            typeof this.semanticInspector?.prepare !== 'function'
            || typeof this.semanticInspector?.inspect !== 'function'
        ) {
            section.appendChild(proseElement(
                'p',
                t('semantic.unavailableDescription'),
            ));
            return section;
        }

        const selection = element('div', {
            className: 'st-devtools-semantic-selection',
        });
        selection.appendChild(proseElement(
            'p',
            t('semantic.selectionDescription'),
        ));
        const inputs = [];
        const targetLabel = (targetId, title, metadata) => {
            const label = element('label', {
                className: 'st-devtools-semantic-target',
            });
            const input = element('input');
            input.type = 'checkbox';
            input.checked = state.targetIds.has(targetId);
            input.dataset.semanticTargetId = targetId;
            input.addEventListener('change', () => {
                if (input.checked) state.targetIds.add(targetId);
                else state.targetIds.delete(targetId);
                this.invalidateSemanticInspectionOutcome(state);
                section.__stDevToolsSemanticRefresh?.();
            });
            label.append(
                input,
                element('span', { text: title }),
                element('small', { text: metadata }),
            );
            inputs.push(input);
            return label;
        };

        const findingDetails = element('details', {
            className: 'st-devtools-semantic-targets st-devtools-disclosure',
        });
        const findingSummary = element('summary');
        findingSummary.append(
            element('strong', { text: t('semantic.findingTargets') }),
            element('span', {
                className: 'st-devtools-disclosure-count',
                text: String(semanticFindings.length),
            }),
        );
        const findingList = element('div', {
            className: 'st-devtools-semantic-target-list',
        });
        for (const finding of semanticFindings) {
            findingList.appendChild(targetLabel(
                `finding:${finding.id}`,
                finding.title,
                t('semantic.findingMeta', {
                    severity: t(`rules.severity.${finding.severity}`),
                    determination: finding.determination
                        ? t(`rules.determination.${finding.determination}`)
                        : t('common.unknown'),
                }),
            ));
        }
        if (semanticFindings.length === 0) {
            findingList.appendChild(proseElement(
                'p',
                t('semantic.noFindingTargets'),
            ));
        }
        findingDetails.append(findingSummary, findingList);

        const clusterDetails = element('details', {
            className: 'st-devtools-semantic-targets st-devtools-disclosure',
        });
        const clusterSummary = element('summary');
        clusterSummary.append(
            element('strong', { text: t('semantic.clusterTargets') }),
            element('span', {
                className: 'st-devtools-disclosure-count',
                text: String(semanticClusters.length),
            }),
        );
        const clusterList = element('div', {
            className: 'st-devtools-semantic-target-list',
        });
        for (const cluster of semanticClusters) {
            clusterList.appendChild(targetLabel(
                `cluster:${cluster.id}`,
                translatedValue(
                    `rules.setting.${cluster.category}`,
                    cluster.category,
                ),
                t('semantic.clusterMeta', {
                    atoms: cluster.atomIds?.length ?? 0,
                    relations: cluster.relationIds?.length ?? 0,
                }),
            ));
        }
        if (semanticClusters.length === 0) {
            clusterList.appendChild(proseElement(
                'p',
                t('semantic.noClusterTargets'),
            ));
        }
        clusterDetails.append(clusterSummary, clusterList);
        selection.append(findingDetails, clusterDetails);

        const controls = element('div', {
            className: 'st-devtools-semantic-controls',
        });
        const selectedCount = element('span');
        const run = element('button', {
            className: 'menu_button',
            text: t('semantic.run'),
            type: 'button',
        });
        run.addEventListener('click', () => {
            void this.startSemanticInspection(snapshot, analysis);
        });
        controls.append(selectedCount, run);
        const dynamic = element('div', {
            className: 'st-devtools-semantic-state',
        });
        dynamic.setAttribute('aria-live', 'polite');
        section.append(selection, controls, dynamic);

        const refresh = () => {
            const busy = ['preparing', 'awaiting-consent', 'running']
                .includes(state.status);
            for (const input of inputs) input.disabled = busy;
            selectedCount.textContent = t('semantic.selectedCount', {
                count: state.targetIds.size,
            });
            run.disabled = busy || state.targetIds.size === 0;
            dynamic.replaceChildren();
            if (state.status === 'preparing') {
                dynamic.appendChild(proseElement(
                    'p',
                    t('semantic.preparing'),
                ));
            } else if (state.status === 'awaiting-consent') {
                dynamic.appendChild(proseElement(
                    'p',
                    t('semantic.awaitingConsent'),
                ));
            } else if (state.status === 'running') {
                dynamic.appendChild(proseElement(
                    'p',
                    t('semantic.running'),
                ));
            } else if (state.status === 'cancelled') {
                dynamic.appendChild(proseElement(
                    'p',
                    t('semantic.cancelled'),
                ));
            } else if (state.status === 'error') {
                const errorText = translatedValue(
                    `semantic.error.${state.errorCode}`,
                    t('semantic.error.generic'),
                );
                const error = proseElement('p', errorText, {
                    className: 'is-error',
                });
                error.setAttribute('role', 'alert');
                const retry = element('button', {
                    className: 'menu_button',
                    text: t('semantic.retry'),
                    type: 'button',
                });
                retry.addEventListener('click', () => {
                    void this.startSemanticInspection(snapshot, analysis);
                });
                dynamic.append(error, retry);
            } else if (state.status === 'complete') {
                dynamic.appendChild(
                    this.renderSemanticSuggestions(state.result),
                );
            } else {
                dynamic.appendChild(proseElement(
                    'p',
                    t('semantic.ready'),
                ));
            }
            if (busy) {
                const cancel = element('button', {
                    className: 'menu_button',
                    text: t('semantic.cancelRun'),
                    type: 'button',
                });
                cancel.addEventListener('click', () => {
                    this.cancelSemanticInspection();
                });
                dynamic.appendChild(cancel);
            }
        };
        section.__stDevToolsSemanticRefresh = refresh;
        this.semanticInspectorHost = section;
        refresh();
        return section;
    }

    renderSemanticInspectorDisclosure(snapshot, analysis, findings) {
        const details = element('details', {
            className: 'st-devtools-semantic-disclosure st-devtools-disclosure',
        });
        details.dataset.tourId = 'semantic-inspector';
        details.open = this.semanticInspectorOpen;
        details.addEventListener('toggle', () => {
            this.semanticInspectorOpen = details.open;
        });
        details.appendChild(element('summary', {
            text: t('rules.semanticDisclosureTitle'),
        }));
        attachLazyDetailsContent(details, () => this.renderSemanticInspector(
            snapshot,
            analysis,
            findings,
        ));
        return details;
    }

    renderDeferredRuleSettings() {
        const details = element('details', {
            className: 'st-devtools-rule-settings',
        });
        details.open = this.ruleSettingsOpen;
        details.addEventListener('toggle', () => {
            this.ruleSettingsOpen = details.open;
        });
        const summary = element('summary');
        summary.appendChild(explainedTitle(
            t('rules.settingsTitle'),
            t('rules.settingsDescription'),
        ));
        details.appendChild(summary);
        attachLazyDetailsContent(details, () => {
            const rendered = this.renderRuleSettings();
            const renderedSummary = rendered.firstElementChild;
            if (renderedSummary?.tagName === 'SUMMARY') renderedSummary.remove();
            const fragment = document.createDocumentFragment();
            fragment.append(...rendered.childNodes);
            return fragment;
        });
        return details;
    }

    renderDeferredComparisonPolicySettings(snapshot) {
        const details = element('details', {
            className: 'st-devtools-rule-settings st-devtools-policy-settings',
        });
        details.open = this.comparisonPolicyOpen;
        details.addEventListener('toggle', () => {
            this.comparisonPolicyOpen = details.open;
        });
        const summary = element('summary');
        summary.appendChild(explainedTitle(
            t('comparison.title'),
            [
                t('comparison.description'),
                t('comparison.precedence'),
            ].join(' '),
        ));
        details.appendChild(summary);
        attachLazyDetailsContent(details, () => {
            const rendered = this.renderComparisonPolicySettings(snapshot);
            const renderedSummary = rendered.firstElementChild;
            if (renderedSummary?.tagName === 'SUMMARY') renderedSummary.remove();
            const fragment = document.createDocumentFragment();
            fragment.append(...rendered.childNodes);
            return fragment;
        });
        return details;
    }

    renderRuleAdvancedAnalysis(snapshot, analysis) {
        const details = element('details', {
            className: 'st-devtools-rule-advanced st-devtools-disclosure',
        });
        details.appendChild(element('summary', {
            text: t('rules.advancedAnalysisTitle'),
        }));
        attachLazyDetailsContent(details, () => {
            const content = element('div', {
                className: 'st-devtools-rule-advanced-content',
            });
            content.append(
                this.renderComparisonAnalysis(snapshot, analysis?.comparison),
                this.renderInstructionModel(analysis?.instructions),
            );
            return content;
        });
        return details;
    }

    appendRuleSupportingSections(
        host,
        snapshot,
        analysis,
        findings,
        reviewResult,
    ) {
        host.append(
            this.renderSemanticInspectorDisclosure(snapshot, analysis, findings),
            this.renderRuleAdvancedAnalysis(snapshot, analysis),
            this.renderDeferredRuleSettings(),
            this.renderDeferredComparisonPolicySettings(snapshot),
            this.renderReviewedFindings(snapshot, reviewResult),
            this.renderRuleAuditLog(),
        );
        if (this.ruleReviewStatus) {
            const status = element('p', {
                className: this.ruleReviewStatusIsError
                    ? 'st-devtools-rule-review-status is-error'
                    : 'st-devtools-rule-review-status',
                text: this.ruleReviewStatus,
            });
            status.setAttribute('role', 'status');
            status.setAttribute('aria-live', 'polite');
            host.appendChild(status);
        }
    }

    renderRules(snapshot, providedAnalysis = undefined) {
        const page = element('div', { className: 'st-devtools-page' });
        page.appendChild(this.renderSnapshotPicker());
        const host = element('div', {
            className: 'st-devtools-rule-analysis-host',
        });
        host.dataset.tourId = 'rule-results';
        page.appendChild(host);
        const effectiveRuleSettings = this.pendingImportedRuleSettings
            ?? this.ruleSettings;
        if (
            providedAnalysis === undefined
            && this.shouldUseAsyncAnalysis('rules', [snapshot])
        ) {
            const status = element('p', {
                className: 'st-devtools-analysis-status',
                text: t('analysis.loading'),
            });
            status.setAttribute('role', 'status');
            status.setAttribute('aria-live', 'polite');
            host.appendChild(status);
            const controller = new AbortController();
            const revision = this.analysisRevision;
            const snapshotId = snapshot.id;
            void this.runUiAnalysis('rules', {
                snapshot: this.analysisRuleSnapshot(snapshot),
                ruleSettings: effectiveRuleSettings,
                comparisonSettings: this.comparisonPolicySettings,
            }, {
                snapshots: [snapshot],
                configuration: {
                    ruleSettings: effectiveRuleSettings,
                    comparisonSettings: this.comparisonPolicySettings,
                },
                controller,
            }).then((response) => {
                if (
                    controller.signal.aborted
                    || revision !== this.analysisRevision
                    || this.activeTab !== 'rules'
                    || this.selectedSnapshot()?.id !== snapshotId
                    || !page.isConnected
                ) {
                    return;
                }
                const completed = this.renderRules(
                    snapshot,
                    response.result,
                );
                const completedHost = completed.querySelector(
                    '.st-devtools-rule-analysis-host',
                );
                if (completedHost) {
                    host.replaceChildren(...[...completedHost.childNodes]);
                }
            }).catch((error) => {
                if (
                    controller.signal.aborted
                    || ['analysis-cancelled', 'analysis-stale'].includes(
                        error?.code,
                    )
                    || revision !== this.analysisRevision
                    || !page.isConnected
                ) {
                    return;
                }
                status.classList.add('is-error');
                status.textContent = this.analysisErrorText(error);
            });
            return page;
        }
        const analysis = providedAnalysis ?? analyzeSnapshotDetailed(
            snapshot,
            effectiveRuleSettings,
            this.comparisonPolicySettings,
        );
        const reviewResult = applyFindingReviews(
            analysis?.findings ?? [],
            snapshot?.sources ?? [],
            this.pendingImportedReviews ?? this.findingReviewDocument,
            this.findingReviewContext(snapshot),
            this.findingHiddenOnce,
        );
        const findings = reviewResult.visible.filter(
            ({ review }) => review.decision !== 'false-positive',
        );
        const counts = findings.reduce((result, item) => {
            if (Object.prototype.hasOwnProperty.call(result, item.severity)) {
                result[item.severity] += 1;
            }
            return result;
        }, { critical: 0, warning: 0, info: 0 });
        const determinations = findings.reduce((result, item) => {
            if (item.determination && Object.prototype.hasOwnProperty.call(
                result,
                item.determination,
            )) {
                result[item.determination] += 1;
            }
            return result;
        }, {
            confirmed: 0,
            candidate: 0,
            'insufficient-evidence': 0,
        });

        const summary = element('div', { className: 'st-devtools-rule-summary' });
        summary.append(
            element('span', {
                className: 'st-devtools-rule-count severity-critical',
                text: `${t('rules.severity.critical')} ${counts.critical}`,
            }),
            element('span', {
                className: 'st-devtools-rule-count severity-warning',
                text: `${t('rules.severity.warning')} ${counts.warning}`,
            }),
            element('span', {
                className: 'st-devtools-rule-count severity-info',
                text: `${t('rules.severity.info')} ${counts.info}`,
            }),
            element('span', {
                className: 'st-devtools-rule-count review-reviewed',
                text: t('review.summaryReviewed', {
                    count: reviewResult.counts.valid
                        + reviewResult.counts.falsePositive,
                }),
            }),
            element('span', {
                className: 'st-devtools-rule-count review-hidden',
                text: t('review.summaryHidden', {
                    count: reviewResult.all.filter(({ review }) => (
                        review.hidden || review.decision === 'false-positive'
                    )).length,
                }),
            }),
        );
        host.appendChild(summary);
        if (Object.values(determinations).some((count) => count > 0)) {
            const determinationSummary = element('div', {
                className: 'st-devtools-rule-determination-summary',
            });
            for (const [status, count] of Object.entries(determinations)) {
                determinationSummary.appendChild(element('span', {
                    className: `st-devtools-determination determination-${status}`,
                    text: `${t(`rules.determination.${status}`)} ${count}`,
                }));
            }
            host.appendChild(determinationSummary);
        }

        if (findings.length === 0) {
            const empty = element('div', { className: 'st-devtools-rule-empty' });
            const anyEnabled = Object.values(effectiveRuleSettings.enabled).some(Boolean);
            empty.append(
                element('i', {
                    className: anyEnabled
                        ? 'fa-solid fa-circle-check'
                        : 'fa-solid fa-circle-pause',
                }),
                element('strong', {
                    text: t(anyEnabled ? 'rules.cleanTitle' : 'rules.disabledTitle'),
                }),
                proseElement(
                    'p',
                    t(anyEnabled ? 'rules.cleanDescription' : 'rules.disabledDescription'),
                ),
            );
            host.appendChild(empty);
            this.appendRuleSupportingSections(
                host,
                snapshot,
                analysis,
                findings,
                reviewResult,
            );
            return page;
        }

        const list = element('div', { className: 'st-devtools-rule-list' });
        const clusterById = new Map(
            (analysis?.instructions?.clusters ?? []).map(
                (cluster) => [cluster.id, cluster],
            ),
        );
        for (const item of findings) {
            const card = element('article', {
                className: `st-devtools-rule-card severity-${item.severity}`,
            });
            card.dataset.findingId = item.review?.findingKey ?? item.id;
            card.dataset.ruleId = item.ruleId;
            const header = element('header');
            header.append(
                element('span', {
                    className: 'st-devtools-rule-severity',
                    text: t(`rules.severity.${item.severity}`),
                }),
                element('strong', { text: item.title }),
            );
            if (item.determination) {
                header.appendChild(element('span', {
                    className: `st-devtools-determination determination-${
                        item.determination
                    }`,
                    text: t(`rules.determination.${item.determination}`),
                }));
            }
            if (item.review?.decision === 'valid') {
                header.appendChild(element('span', {
                    className: 'st-devtools-review-badge is-valid',
                    text: t('review.status.valid'),
                }));
            }
            card.append(header, proseElement('p', item.message));
            if (item.determination) {
                const metadata = element('div', {
                    className: 'st-devtools-rule-finding-meta',
                });
                metadata.appendChild(element('small', {
                    text: t('rules.v3.findingMeta', {
                        determination: t(
                            `rules.determination.${item.determination}`,
                        ),
                        method: item.method,
                        confidence: Math.round(
                            (Number(item.confidence) || 0) * 100,
                        ),
                    }),
                }));
                if (item.clusterId) {
                    const cluster = clusterById.get(item.clusterId);
                    metadata.appendChild(element('small', {
                        text: cluster
                            ? t('rules.v3.cluster', {
                                category: translatedValue(
                                    `rules.setting.${cluster.category}`,
                                    cluster.category,
                                ),
                                atoms: cluster.atomIds.length,
                                relations: cluster.relationIds.length,
                            })
                            : item.clusterId,
                    }));
                }
                card.appendChild(metadata);
            }
            if (item.evidence) {
                const evidence = element('details', { className: 'st-devtools-rule-evidence' });
                const evidenceTitle = t(item.ruleId === 'unmatched'
                    ? 'rules.unmatched.evidence'
                    : 'rules.evidence');
                const evidenceSummary = element('summary');
                evidenceSummary.appendChild(explainedTitle(
                    evidenceTitle,
                    t('rules.evidenceDescription'),
                    { titleTag: 'span' },
                ));
                evidence.append(
                    evidenceSummary,
                    element('pre', { text: item.evidence }),
                );
                card.appendChild(evidence);
            }
            const actions = element('div', { className: 'st-devtools-rule-actions' });
            if (item.sourceIds?.length > 0) {
                const sources = element('button', {
                    className: 'menu_button',
                    text: t('action.viewRelatedSources', { count: item.sourceIds.length }),
                    type: 'button',
                });
                sources.addEventListener('click', () => {
                    this.openExplorerForFinding(snapshot, item, 'sources');
                });
                actions.appendChild(sources);
            }
            if (item.finalRanges?.length > 0) {
                const finalEvidence = element('button', {
                    className: 'menu_button',
                    text: t('action.viewFinalEvidence'),
                    type: 'button',
                });
                finalEvidence.addEventListener('click', () => {
                    this.openExplorerForFinding(snapshot, item, 'final');
                });
                actions.appendChild(finalEvidence);
            }
            if (actions.childElementCount > 0) card.appendChild(actions);
            card.appendChild(this.renderFindingReviewControls(snapshot, item));
            list.appendChild(card);
        }
        host.appendChild(list);
        this.appendRuleSupportingSections(
            host,
            snapshot,
            analysis,
            findings,
            reviewResult,
        );
        return page;
    }

    renderSearch(snapshot) {
        const page = element('div', { className: 'st-devtools-page' });
        page.appendChild(this.renderSnapshotPicker());
        const controls = element('div', { className: 'st-devtools-search-controls' });
        const input = element('input');
        input.type = 'search';
        input.placeholder = t('search.placeholder');
        input.maxLength = SEARCH_QUERY_MAX_LENGTH;
        const regexLabel = element('label');
        const regex = element('input');
        regex.type = 'checkbox';
        regexLabel.append(regex, document.createTextNode(t('search.regex')));
        const caseLabel = element('label');
        const caseSensitive = element('input');
        caseSensitive.type = 'checkbox';
        caseLabel.append(caseSensitive, document.createTextNode(t('search.matchCase')));
        const options = element('details', {
            className: 'st-devtools-search-options st-devtools-disclosure',
        });
        const optionsSummary = element('summary');
        optionsSummary.appendChild(explainedTitle(
            t('search.optionsTitle'),
            t('search.optionsDescription'),
            { className: 'st-devtools-search-options-title' },
        ));
        const optionsBody = element('div', {
            className: 'st-devtools-search-options-body',
        });
        optionsBody.append(regexLabel, caseLabel);
        options.append(optionsSummary, optionsBody);
        controls.append(input, options);
        const status = element('p', { className: 'st-devtools-search-status' });
        const statusId = `st-devtools-search-status-${++fieldSequence}`;
        status.id = statusId;
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        input.setAttribute('aria-describedby', statusId);
        const results = element('div', { className: 'st-devtools-search-results' });
        let debounceTimer = null;
        let activeSearch = null;
        let searchSequence = 0;

        const searchErrorText = (error) => {
            const code = error?.code ?? error?.message;
            const knownCodes = new Set([
                'invalid-regex',
                'unsafe-regex',
                'regex-too-long',
                'query-too-long',
                'regex-timeout',
                'regex-worker-unavailable',
                'search-worker-failed',
                'analysis-timeout',
                'analysis-worker-unavailable',
                'analysis-worker-failed',
                'analysis-input-too-large',
            ]);
            if (knownCodes.has(code) && code.startsWith('analysis-')) {
                return this.analysisErrorText(error);
            }
            return knownCodes.has(code)
                ? t(`search.error.${code}`, {
                    regexMax: USER_REGEX_MAX_LENGTH,
                    queryMax: SEARCH_QUERY_MAX_LENGTH,
                })
                : t('search.error.unknown');
        };
        const run = async () => {
            const sequence = ++searchSequence;
            activeSearch?.abort();
            activeSearch = new AbortController();
            results.replaceChildren();
            status.textContent = '';
            const query = input.value;
            if (!query) return;
            status.textContent = t('search.searching');
            try {
                const searchOptions = {
                    regex: regex.checked,
                    caseSensitive: caseSensitive.checked,
                };
                if (searchOptions.regex) {
                    const validation = validateUserRegex(query);
                    if (!validation.ok) {
                        throw Object.assign(new Error(validation.code), {
                            code: validation.code,
                        });
                    }
                }
                const response = await this.runUiAnalysis('search', {
                    snapshot: {
                        sources: snapshot.sources ?? [],
                    },
                    query,
                    options: searchOptions,
                }, {
                    snapshots: [snapshot],
                    configuration: {
                        query,
                        options: searchOptions,
                    },
                    controller: activeSearch,
                    timeoutMs: searchOptions.regex ? 800 : undefined,
                });
                const matches = response.result ?? [];
                if (sequence !== searchSequence || !page.isConnected) return;
                status.textContent = matches.length === 200
                    ? t('search.matchesLimited', { count: matches.length })
                    : t('search.matches', { count: matches.length });
                for (const match of matches) {
                    const item = element('button', { className: 'st-devtools-search-result', type: 'button' });
                    item.append(
                        element('strong', { text: match.sourceLabel }),
                        element('span', { text: match.snippet }),
                    );
                    item.addEventListener('click', () => {
                        this.activeTab = 'explorer';
                        localStorage.setItem(LAST_TAB_KEY, this.activeTab);
                        this.render();
                        this.jumpToSourceCard(match.sourceId);
                        const source = [...this.window.querySelectorAll(
                            '.st-devtools-source',
                        )].find(
                            (entry) => entry.dataset.sourceId === match.sourceId,
                        );
                        source?.classList.add('search-focus');
                        setTimeout(
                            () => source?.classList.remove('search-focus'),
                            1500,
                        );
                    });
                    results.appendChild(item);
                }
            } catch (error) {
                if (
                    ['search-cancelled', 'analysis-cancelled', 'analysis-stale']
                        .includes(error?.code)
                    || sequence !== searchSequence
                ) return;
                status.textContent = searchErrorText(error);
            }
        };
        const schedule = (delay = SEARCH_DEBOUNCE_MS) => {
            if (debounceTimer != null) clearTimeout(debounceTimer);
            activeSearch?.abort();
            searchSequence += 1;
            results.replaceChildren();
            if (!input.value) {
                status.textContent = '';
                return;
            }
            status.textContent = t('search.waiting');
            debounceTimer = setTimeout(run, delay);
        };
        input.addEventListener('input', () => schedule());
        regex.addEventListener('change', () => {
            input.maxLength = regex.checked
                ? USER_REGEX_MAX_LENGTH
                : SEARCH_QUERY_MAX_LENGTH;
            schedule(0);
        });
        caseSensitive.addEventListener('change', () => schedule(0));
        page.append(controls, status, results);
        return page;
    }
}
