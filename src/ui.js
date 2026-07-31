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
    DEFAULT_COMPARISON_POLICY_SETTINGS,
    annotateSourcesWithPolicies,
    normalizeComparisonPolicySettings,
} from './comparison-policy.js';
import { resolvePanelTheme } from './theme.js';
import { descriptionParagraphs } from './text-format.js';
import {
    USER_REGEX_MAX_LENGTH,
    validateUserRegex,
} from './regex-safety.js';
import {
    SEARCH_DEBOUNCE_MS,
    searchSnapshotSafely,
} from './search-runtime.js';
import { snapshotExportPreview } from './export-preview.js';
import {
    DEFAULT_UI_PREFERENCES,
    LEGACY_UI_PREFERENCES_KEY,
    MAX_TIMELINE_RETENTION_LIMIT,
    MAX_TIMELINE_READ_LIMIT,
    MIN_TIMELINE_RETENTION_LIMIT,
    MIN_TIMELINE_READ_LIMIT,
    PANEL_THEME_MODES,
    UI_PREFERENCES_KEY,
    migrateLegacyUiPreferences,
    normalizeUiPreferences,
} from './preferences.js';

const STORAGE_PREFIX = 'st-devtools:';
const RULE_SETTINGS_KEY = `${STORAGE_PREFIX}rule-settings:v1`;
const COMPARISON_POLICY_SETTINGS_KEY = `${STORAGE_PREFIX}comparison-policy:v1`;
const LAST_TAB_KEY = `${STORAGE_PREFIX}last-tab`;
const GEOMETRY_KEY = `${STORAGE_PREFIX}geometry`;
const KNOWN_LOCAL_DATA_KEYS = [
    RULE_SETTINGS_KEY,
    COMPARISON_POLICY_SETTINGS_KEY,
    LAST_TAB_KEY,
    GEOMETRY_KEY,
    UI_PREFERENCES_KEY,
    LEGACY_UI_PREFERENCES_KEY,
];
const COMPARISON_MODES = ['alternative', 'ignore', 'normal'];
const COMPARISON_TARGETS = ['configured', 'all'];
const COMPARISON_RULE_KINDS = ['template', 'regex'];
const GROWTH_CHART_POINT_LIMIT = 10;
const TABS = [
    ['explorer', 'tab.explorer'],
    ['timeline', 'tab.timeline'],
    ['diff', 'tab.diff'],
    ['context', 'tab.context'],
    ['rules', 'tab.rules'],
    ['search', 'tab.search'],
];
let tooltipSequence = 0;
let fieldSequence = 0;

function element(tag, options = {}) {
    const node = document.createElement(tag);
    if (options.className) node.className = options.className;
    if (options.text != null) node.textContent = String(options.text);
    if (options.title) node.title = options.title;
    if (options.type) node.type = options.type;
    return node;
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
    constructor({ getContext, store, capture, version }) {
        this.getContext = getContext;
        this.store = store;
        this.capture = capture;
        this.version = version;
        this.root = null;
        this.window = null;
        this.content = null;
        this.timeline = [];
        this.timelineTotalCount = 0;
        this.selectedId = null;
        this.selectedTimelineIds = new Set();
        this.timelineSelectionChatId = null;
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
        this.store.setMaxSnapshotsPerChat?.(this.preferences.timelineRetentionLimit);
        this.activeTab = localStorage.getItem(LAST_TAB_KEY) || 'explorer';
        this.ruleSettings = this.loadRuleSettings();
        this.ruleSettingsOpen = false;
        this.comparisonPolicySettings = this.loadComparisonPolicySettings();
        this.comparisonPolicyOpen = false;
        this.comparisonPolicySectionOpen = {
            rules: false,
            manual: false,
            preview: false,
        };
        this.timelineSnapshotsOpen = false;
        this.previouslyFocused = null;
        this.settingsPreviouslyFocused = null;
        this.settingsOverlay = null;
        this.settingsPanel = null;
        this.themeModeInput = null;
        this.timelineRetentionLimitInput = null;
        this.timelineReadLimitInput = null;
        this.primaryRegions = [];
        this.storageErrors = [];
        this.importedDiagnostics = null;
        this.diagnosticImportError = null;
        this.capture.addEventListener('snapshot', (event) => this.onSnapshot(event.detail));
        this.capture.addEventListener('capture-error', (event) => this.onCaptureError(event.detail));
    }

    currentChatId() {
        const context = this.getContext();
        return context.getCurrentChatId?.() ?? context.chatId ?? '__global__';
    }

    selectedSnapshot() {
        return this.timeline.find((snapshot) => snapshot.id === this.selectedId)
            ?? this.timeline.at(-1)
            ?? null;
    }

    async readTimelinePage(chatId) {
        const limit = this.preferences.timelineReadLimit;
        if (typeof this.store.getTimelinePage === 'function') {
            const page = await this.store.getTimelinePage(chatId, { limit });
            const snapshots = Array.isArray(page?.snapshots) ? page.snapshots : [];
            return {
                snapshots,
                loadedCount: snapshots.length,
                totalCount: Math.max(
                    snapshots.length,
                    Number.isFinite(page?.totalCount)
                        ? Math.trunc(page.totalCount)
                        : snapshots.length,
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
            limit,
        };
    }

    loadUiPreferences() {
        try {
            const stored = JSON.parse(localStorage.getItem(UI_PREFERENCES_KEY) ?? 'null');
            if (stored) return normalizeUiPreferences(stored);

            const legacy = JSON.parse(
                localStorage.getItem(LEGACY_UI_PREFERENCES_KEY) ?? 'null',
            );
            if (legacy) {
                const migrated = migrateLegacyUiPreferences(legacy);
                localStorage.setItem(UI_PREFERENCES_KEY, JSON.stringify(migrated));
                localStorage.removeItem(LEGACY_UI_PREFERENCES_KEY);
                return migrated;
            }
            return normalizeUiPreferences(DEFAULT_UI_PREFERENCES);
        } catch {
            return normalizeUiPreferences(DEFAULT_UI_PREFERENCES);
        }
    }

    saveUiPreferences(value) {
        this.preferences = normalizeUiPreferences(value);
        try {
            localStorage.setItem(UI_PREFERENCES_KEY, JSON.stringify(this.preferences));
            localStorage.removeItem(LEGACY_UI_PREFERENCES_KEY);
        } catch {
            // The current browser may not allow persistent local storage.
        }
        return this.preferences;
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
            className: 'menu_button',
            title: t('action.cancel'),
            type: 'button',
        });
        close.setAttribute('aria-label', t('action.cancel'));
        close.appendChild(element('i', { className: 'fa-solid fa-xmark' }));
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
            syncReadLimit();
            retentionInput.focus();
        });
        const cancel = element('button', {
            className: 'menu_button',
            text: t('action.cancel'),
            type: 'button',
        });
        cancel.addEventListener('click', () => this.closeSettings());
        const apply = element('button', {
            className: 'menu_button',
            text: t('action.applySettings'),
            type: 'submit',
        });
        actions.append(reset, cancel, apply);
        form.append(themeField, retentionField, readField, actions);
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (apply.disabled) return;
            apply.disabled = true;
            const requested = normalizeUiPreferences({
                themeMode: themeSelect.value,
                timelineRetentionLimit: retentionInput.value,
                timelineReadLimit: readInput.value,
            });
            try {
                const previousRetention = Number(this.store.maxSnapshotsPerChat)
                    || this.preferences.timelineRetentionLimit;
                let pruneResult = {
                    snapshotCount: 0,
                    affectedChatCount: 0,
                    approximateBytes: 0,
                };
                const isLoweringRetention = (
                    requested.timelineRetentionLimit < previousRetention
                );
                if (
                    isLoweringRetention
                    && typeof this.store.getRetentionPrunePreview === 'function'
                    && typeof this.store.applyRetentionLimit === 'function'
                ) {
                    while (true) {
                        const preview = await this.store.getRetentionPrunePreview(
                            requested.timelineRetentionLimit,
                        );
                        if (
                            preview.snapshotCount > 0
                            && !confirm(t('settings.timelineRetentionDecreaseConfirm', {
                                limit: requested.timelineRetentionLimit,
                                chats: preview.affectedChatCount,
                                count: preview.snapshotCount,
                                size: formatBytes(preview.approximateBytes),
                            }))
                        ) {
                            return;
                        }
                        try {
                            pruneResult = await this.store.applyRetentionLimit(
                                requested.timelineRetentionLimit,
                                { expectedRevision: preview.revision },
                            );
                            break;
                        } catch (error) {
                            if (error?.code === 'retention-preview-stale') continue;
                            throw error;
                        }
                    }
                } else if (typeof this.store.applyRetentionLimit === 'function') {
                    pruneResult = await this.store.applyRetentionLimit(
                        requested.timelineRetentionLimit,
                    );
                } else {
                    this.store.setMaxSnapshotsPerChat?.(
                        requested.timelineRetentionLimit,
                    );
                }
                this.storageSummaryGeneration += 1;
                this.storageSummaryRebuildScheduled = false;
                this.storageSummaryRefreshPromise = null;
                const preferences = this.saveUiPreferences(requested);
                themeSelect.value = preferences.themeMode;
                retentionInput.value = String(preferences.timelineRetentionLimit);
                readInput.value = String(preferences.timelineReadLimit);
                syncReadLimit();
                this.syncOpaqueTheme();
                this.closeSettings();
                await this.refresh();
                globalThis.toastr?.success?.(
                    pruneResult.snapshotCount > 0
                        ? t('settings.savedWithPrune', {
                            count: pruneResult.snapshotCount,
                        })
                        : t('settings.saved'),
                    'ST DevTools',
                );
            } catch (error) {
                console.error('[ST DevTools] Failed to apply storage settings.', error);
                globalThis.toastr?.error?.(
                    t('settings.saveFailed'),
                    'ST DevTools',
                );
            } finally {
                apply.disabled = false;
            }
        });

        panel.append(heading, form);
        overlay.appendChild(panel);
        this.settingsOverlay = overlay;
        this.settingsPanel = panel;
        this.themeModeInput = themeSelect;
        this.timelineRetentionLimitInput = retentionInput;
        this.timelineReadLimitInput = readInput;
        return overlay;
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
        this.window.setAttribute('aria-modal', 'false');
        for (const region of this.primaryRegions) {
            region.inert = true;
            region.setAttribute('aria-hidden', 'true');
        }
        this.settingsOverlay.hidden = false;
        queueMicrotask(() => {
            this.timelineRetentionLimitInput?.focus();
            this.timelineRetentionLimitInput?.select();
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

    loadRuleSettings() {
        try {
            const stored = JSON.parse(localStorage.getItem(RULE_SETTINGS_KEY) ?? 'null');
            return normalizeRuleSettings(stored ?? DEFAULT_RULE_SETTINGS);
        } catch {
            return normalizeRuleSettings(DEFAULT_RULE_SETTINGS);
        }
    }

    saveRuleSettings(settings) {
        this.ruleSettings = normalizeRuleSettings(settings);
        try {
            localStorage.setItem(RULE_SETTINGS_KEY, JSON.stringify(this.ruleSettings));
        } catch {
            // The current browser may not allow persistent local storage.
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
        this.activeTabButton()?.focus();
    }

    close() {
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
        title.append(
            titleIcon,
            element('strong', { text: 'ST DevTools' }),
            element('small', { text: `v${this.version}` }),
            element('span', { className: 'st-devtools-readonly-badge', text: t('app.readOnly') }),
        );

        const headerActions = element('div', { className: 'st-devtools-header-actions' });
        const settings = element('button', {
            className: 'menu_button',
            title: t('action.settings'),
            type: 'button',
        });
        settings.setAttribute('aria-label', t('action.settings'));
        settings.appendChild(element('i', { className: 'fa-solid fa-gear' }));
        settings.addEventListener('click', () => this.openSettings());
        const refresh = element('button', { className: 'menu_button', title: t('action.refresh'), type: 'button' });
        refresh.appendChild(element('i', { className: 'fa-solid fa-rotate' }));
        refresh.addEventListener('click', () => this.refresh());
        const close = element('button', { className: 'menu_button', title: t('action.close'), type: 'button' });
        close.appendChild(element('i', { className: 'fa-solid fa-xmark' }));
        close.addEventListener('click', () => this.close());
        headerActions.append(settings, refresh, close);
        header.append(title, headerActions);

        const tabList = element('nav', { className: 'st-devtools-tabs' });
        tabList.setAttribute('role', 'tablist');
        for (const [id, labelKey] of TABS) {
            const button = element('button', { className: 'st-devtools-tab', text: t(labelKey), type: 'button' });
            button.dataset.tab = id;
            button.id = this.tabElementId(id);
            button.setAttribute('role', 'tab');
            button.setAttribute('aria-controls', this.panelElementId(id));
            button.addEventListener('click', () => this.selectTab(id));
            button.addEventListener('keydown', (event) => this.handleTabKeydown(event, id));
            tabList.appendChild(button);
        }

        this.content = element('main', { className: 'st-devtools-content' });
        this.content.setAttribute('role', 'tabpanel');
        this.primaryRegions = [header, tabList, this.content];
        this.window.append(
            header,
            tabList,
            this.content,
            this.buildSettingsPanel(),
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
        try {
            const geometry = JSON.parse(localStorage.getItem(GEOMETRY_KEY));
            if (!geometry) return;
            this.window.style.width = `${geometry.width}px`;
            this.window.style.height = `${geometry.height}px`;
            this.window.style.left = `${geometry.left}px`;
            this.window.style.top = `${geometry.top}px`;
            this.window.style.transform = 'none';
        } catch {
            // Ignore invalid settings.
        }
    }

    observeGeometry() {
        const save = () => {
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

    async onSnapshot(snapshot) {
        this.storageErrors = this.storageErrors.filter((item) => item.snapshotId !== snapshot.id);
        const panelVisible = Boolean(this.root && !this.root.hidden);
        if (snapshot.chatId === this.currentChatId()) {
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
            error: detail?.error,
            retry: snapshot ? () => this.capture.retrySnapshot(snapshot) : null,
        });
        globalThis.toastr?.error?.(t('storage.captureFailed'), 'ST DevTools');
    }

    addStorageError({ id, snapshotId = null, error, retry = null }) {
        const item = {
            id,
            snapshotId,
            message: error?.message || t('storage.unknownError'),
            retry,
            pending: false,
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
            let summary;
            if (typeof this.store.getStorageSummary === 'function') {
                summary = await this.store.getStorageSummary();
            } else {
                summary = {
                    ...this.storageSummary,
                    ...(this.store.getStatus?.() ?? {}),
                };
            }
            const snapshotApproximateBytes = Number.isFinite(summary.snapshotApproximateBytes)
                ? summary.snapshotApproximateBytes
                : Number.isFinite(summary.approximateBytes)
                    ? summary.approximateBytes
                    : null;
            return {
                ...summary,
                localSettingCount: localData.count,
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
        this.comparisonPolicyOpen = false;
        this.comparisonPolicySectionOpen = {
            rules: false,
            manual: false,
            preview: false,
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
        return this.window?.querySelector(`.st-devtools-tab[data-tab="${this.activeTab}"]`) ?? null;
    }

    focusableElements() {
        if (!this.window) return [];
        const scope = this.settingsOverlay && !this.settingsOverlay.hidden
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
            if (this.settingsOverlay && !this.settingsOverlay.hidden) {
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
        const focusScope = this.settingsOverlay && !this.settingsOverlay.hidden
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
            const stored = JSON.parse(
                localStorage.getItem(COMPARISON_POLICY_SETTINGS_KEY) ?? 'null',
            );
            return normalizeComparisonPolicySettings(
                stored ?? DEFAULT_COMPARISON_POLICY_SETTINGS,
            );
        } catch {
            return normalizeComparisonPolicySettings(DEFAULT_COMPARISON_POLICY_SETTINGS);
        }
    }

    setComparisonPolicySettings(settings) {
        this.comparisonPolicySettings = normalizeComparisonPolicySettings(settings);
    }

    saveComparisonPolicySettings(settings = this.comparisonPolicySettings) {
        this.setComparisonPolicySettings(settings);
        try {
            localStorage.setItem(
                COMPARISON_POLICY_SETTINGS_KEY,
                JSON.stringify(this.comparisonPolicySettings),
            );
        } catch {
            // The current browser may not allow persistent local storage.
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
        this.syncOpaqueTheme();
        for (const button of this.window.querySelectorAll('.st-devtools-tab')) {
            const active = button.dataset.tab === this.activeTab;
            button.classList.toggle('active', active);
            button.setAttribute('aria-selected', String(active));
            button.tabIndex = active ? 0 : -1;
        }
        this.content.id = this.panelElementId(this.activeTab);
        this.content.setAttribute('aria-labelledby', this.tabElementId(this.activeTab));
        this.content.replaceChildren();
        if (this.storageErrors.length > 0) {
            this.content.appendChild(this.renderStorageErrors());
        }

        const snapshot = this.selectedSnapshot();
        if (!snapshot && this.activeTab !== 'timeline') {
            this.content.appendChild(this.renderEmpty());
            return;
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

    renderStorageErrors() {
        const region = element('section', { className: 'st-devtools-storage-errors' });
        region.setAttribute('role', 'alert');
        region.setAttribute('aria-live', 'assertive');
        region.appendChild(element('strong', { text: t('storage.errorTitle') }));
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
        );
        return empty;
    }

    renderSnapshotPicker(labelText = t('snapshot.label')) {
        const wrapper = element('div', { className: 'st-devtools-picker' });
        wrapper.appendChild(element('span', {
            className: 'st-devtools-picker-label',
            text: labelText,
        }));
        const select = element('select');
        select.setAttribute('aria-label', labelText);
        for (const snapshot of [...this.timeline].reverse()) {
            const option = element('option', {
                text: `${formatTimestamp(snapshot.timestamp)} · ${snapshotProviderDisplay(snapshot)} · ${t('snapshot.tokens', { count: snapshot.stats.totalTokens })}`,
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

    renderExplorer(snapshot) {
        const page = element('div', { className: 'st-devtools-page' });
        const sourceGroups = explorerSourceGroups(snapshot.sources);
        const configuredGroup = sourceGroups.find((group) => group.key === 'configured');
        const promptManagerOrder = configuredGroup?.promptManagerOrder ?? false;
        page.append(this.renderSnapshotPicker());
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
            for (const source of groupData.sources) {
                const details = element('details', { className: 'st-devtools-source' });
                details.dataset.sourceId = source.id;
                details.dataset.sourceType = source.type;
                details.style.setProperty('--source-color', source.color);
                const summary = element('summary');
                const heading = element('span', { className: 'st-devtools-source-heading' });
                if (isConfiguredPromptSource(source)) {
                    const promptOrder = Number(source.metadata?.promptOrder);
                    heading.appendChild(element('span', {
                        className: 'st-devtools-source-order',
                        text: t('explorer.promptOrder', {
                            count: Number.isFinite(promptOrder)
                                ? promptOrder + 1
                                : groupData.sources.indexOf(source) + 1,
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
                sourceList.appendChild(details);
            }
            group.append(groupSummary, sourceList);
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
        const card = [...this.window.querySelectorAll('.st-devtools-source')]
            .find((node) => node.dataset.sourceId === sourceId);
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
        const cards = [...this.window.querySelectorAll('.st-devtools-source')]
            .filter((node) => selected.has(node.dataset.sourceId));
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
        page.appendChild(element('p', {
            className: 'st-devtools-section-intro',
            text: this.timelineTotalCount > this.timeline.length
                ? t('snapshot.loadedSubset', {
                    loaded: this.timeline.length,
                    total: this.timelineTotalCount,
                })
                : t('snapshot.loadedAll', { count: this.timeline.length }),
        }));
        page.appendChild(this.renderStorageOverview());

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
        page.appendChild(toolbox);
        const diagnosticStatus = this.renderDiagnosticImportStatus();
        if (diagnosticStatus) page.appendChild(diagnosticStatus);

        if (this.timeline.length === 0) {
            page.appendChild(this.renderEmpty());
            return page;
        }

        page.appendChild(this.renderGrowthChart(analyses, this.timelineTotalCount));
        const list = element('div', { className: 'st-devtools-timeline' });
        for (const analysis of [...analyses].reverse()) {
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
                text: `${snapshotProviderDisplay(snapshot)} · ${snapshot.model ?? t('timeline.unknownModel')} · ${t('snapshot.tokens', { count: snapshot.stats.totalTokens })}`,
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
                if (!lore.activated.length && !lore.removed.length) {
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
                && (lore.activated.length || lore.removed.length)
            ) {
                entry.appendChild(this.renderLoreChangeList(lore));
            }
            list.appendChild(entry);
        }
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
        const selectionToolbar = this.renderTimelineSelectionToolbar();
        snapshots.append(snapshotsSummary, selectionToolbar, list);
        page.appendChild(snapshots);
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
                    'storage.approximateSize',
                    'storage.approximateSizePending',
                    'storage.approximateSizeUnknown',
                    'size',
                ),
            }),
        );
        status.append(heading, metrics);
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
        chatId = snapshot.chatId || this.currentChatId(),
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

    renderLoreChangeList(lore) {
        const wrapper = element('div', { className: 'st-devtools-lore-change-list' });
        const appendGroup = (labelKey, entries, className) => {
            if (!entries.length) return;
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
        const renderDiff = () => {
            selectedBase = this.timeline.find(
                (snapshot) => snapshot.id === baseSelect.select.value,
            );
            selectedCompare = this.timeline.find(
                (snapshot) => snapshot.id === compareSelect.select.value,
            );
            selectionRevision += 1;
            sourceSection.replaceChildren();
            loreSection.replaceChildren();
            if (!selectedBase || !selectedCompare) return;

            this.renderSourceChanges(sourceSection, selectedBase, selectedCompare);
            this.renderLoreChanges(loreSection, selectedBase, selectedCompare);
            if (fullDiff.open) renderFullDiff();
        };
        baseSelect.select.addEventListener('change', renderDiff);
        compareSelect.select.addEventListener('change', renderDiff);
        page.append(selectors, sourceSection, loreSection, fullDiff);
        renderDiff();
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

    renderSourceChanges(section, base, compare) {
        section.appendChild(explainedTitle(
            t('diff.sourceChanges'),
            t('diff.description'),
            { tag: 'h3', titleTag: 'span' },
        ));
        const changes = compareSnapshotSources(base, compare);
        if (!changes.length) {
            section.appendChild(proseElement('p', t('diff.noSourceChanges')));
            return;
        }

        const list = element('div', { className: 'st-devtools-source-change-list' });
        for (const change of changes) {
            const card = element('details', {
                className: `st-devtools-source-change status-${change.status}`,
            });
            const summary = element('summary');
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
            );
            card.appendChild(summary);
            attachLazyDetailsContent(card, () => {
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
                return content;
            });
            list.appendChild(card);
        }
        section.appendChild(list);
    }

    renderLoreChanges(section, base, compare) {
        section.appendChild(explainedTitle(
            t('diff.loreChanges'),
            t('diff.loreDescription'),
            { tag: 'h3', titleTag: 'span' },
        ));
        const changes = compareLoreEntries(
            base.lorebookEntries ?? [],
            compare.lorebookEntries ?? [],
        );
        if (!changes.activated.length && !changes.removed.length) {
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
            [t('stat.promptTokens'), snapshot.stats.totalTokens],
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
        page.append(
            coreStats,
            captureCard,
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
            input.checked = this.ruleSettings.enabled[definition.id];
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
                Math.round(this.ruleSettings.contextWarning * 100),
                10,
                98,
            ),
            numberField(
                'contextCritical',
                'rules.setting.contextCritical',
                Math.round(this.ruleSettings.contextCritical * 100),
                11,
                100,
            ),
            numberField(
                'largeSourceTokens',
                'rules.setting.largeSourceTokens',
                this.ruleSettings.largeSourceTokens,
                1,
                1_000_000,
            ),
            numberField(
                'largeSourceShare',
                'rules.setting.largeSourceShare',
                Math.round(this.ruleSettings.largeSourceShare * 100),
                1,
                100,
            ),
            numberField(
                'minimumSentenceLength',
                'rules.setting.minimumSentenceLength',
                this.ruleSettings.minimumSentenceLength,
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
            this.saveRuleSettings(DEFAULT_RULE_SETTINGS);
            this.ruleSettingsOpen = true;
            this.render();
            globalThis.toastr?.info?.(t('rules.settingsReset'), 'ST DevTools');
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
            this.saveRuleSettings({
                enabled,
                contextWarning: numberValue('contextWarning', 100),
                contextCritical: numberValue('contextCritical', 100),
                largeSourceTokens: numberValue('largeSourceTokens'),
                largeSourceShare: numberValue('largeSourceShare', 100),
                minimumSentenceLength: numberValue('minimumSentenceLength'),
            });
            this.ruleSettingsOpen = true;
            this.render();
            globalThis.toastr?.info?.(t('rules.settingsSaved'), 'ST DevTools');
        });
        details.appendChild(form);
        return details;
    }

    comparisonNameRules() {
        return Array.isArray(this.comparisonPolicySettings?.nameRules)
            ? this.comparisonPolicySettings.nameRules
            : [];
    }

    comparisonManualAssignments() {
        return Array.isArray(this.comparisonPolicySettings?.manualAssignments)
            ? this.comparisonPolicySettings.manualAssignments
            : [];
    }

    replaceComparisonNameRules(nameRules) {
        this.setComparisonPolicySettings({
            ...this.comparisonPolicySettings,
            nameRules,
        });
    }

    replaceManualAssignments(manualAssignments) {
        this.setComparisonPolicySettings({
            ...this.comparisonPolicySettings,
            manualAssignments,
        });
    }

    renderComparisonRuleCard(rule, index) {
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
        return card;
    }

    renderComparisonRuleCreator() {
        const form = element('form', { className: 'st-devtools-policy-creator' });
        const field = (labelKey, control, descriptionKey = null) => {
            if (descriptionKey) {
                return describedControlField(
                    t(labelKey),
                    control,
                    t(descriptionKey),
                );
            }
            const label = element('label');
            label.append(element('span', { text: t(labelKey) }), control);
            return label;
        };

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
        const mode = element('select');
        mode.name = 'mode';
        for (const value of COMPARISON_MODES) {
            const option = element('option', { text: policyModeLabel(value) });
            option.value = value;
            mode.appendChild(option);
        }
        const categories = element('input');
        categories.name = 'categories';
        categories.value = '*';
        categories.placeholder = t('comparison.categoriesPlaceholder');
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
            field('comparison.ruleKind', kind),
            field('comparison.pattern', pattern),
            field('comparison.fixedGroup', fixedGroup),
            field('comparison.mode', mode, 'comparison.behaviorDescription'),
            field('comparison.categories', categories),
            field('comparison.target', target),
            proseElement('small', t('comparison.categoriesHint')),
            submit,
            status,
        );
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            const rule = {
                id: policyId('name-rule'),
                enabled: true,
                kind: kind.value,
                pattern: pattern.value.trim(),
                fixedGroup: fixedGroup.value.trim() || null,
                mode: mode.value,
                categories: categoriesFromInput(categories.value),
                target: target.value,
            };
            const validationError = comparisonRuleError(rule);
            if (validationError) {
                status.textContent = t('comparison.invalidRule', { message: validationError });
                return;
            }
            this.replaceComparisonNameRules([...this.comparisonNameRules(), rule]);
            this.comparisonPolicyOpen = true;
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
            element('small', { text: identity }),
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

        const form = element('form', { className: 'st-devtools-policy-manual-form' });
        const field = (labelKey, control, descriptionKey = null) => {
            if (descriptionKey) {
                return describedControlField(
                    t(labelKey),
                    control,
                    t(descriptionKey),
                );
            }
            const label = element('label');
            label.append(element('span', { text: t(labelKey) }), control);
            return label;
        };
        const sourceSelect = element('select');
        for (const source of configuredSources) {
            const option = element('option', { text: policySourceLabel(source) });
            option.value = source.id;
            sourceSelect.appendChild(option);
        }
        const group = element('input');
        group.required = true;
        group.placeholder = t('comparison.groupPlaceholder');
        const optionName = element('input');
        optionName.required = true;
        optionName.placeholder = t('comparison.optionPlaceholder');
        const mode = element('select');
        for (const value of COMPARISON_MODES) {
            const option = element('option', { text: policyModeLabel(value) });
            option.value = value;
            mode.appendChild(option);
        }
        const categories = element('input');
        categories.value = '*';
        categories.placeholder = t('comparison.categoriesPlaceholder');
        const submit = element('button', {
            className: 'menu_button',
            text: t('action.addManualAssignment'),
            type: 'submit',
        });
        form.append(
            field('comparison.manualSource', sourceSelect),
            field('comparison.group', group),
            field('comparison.option', optionName),
            field('comparison.mode', mode, 'comparison.behaviorDescription'),
            field('comparison.categories', categories),
            proseElement('small', t('comparison.categoriesHint')),
            submit,
        );
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            const source = configuredSources.find((item) => item.id === sourceSelect.value);
            if (!source) return;
            const assignment = {
                id: policyId('manual'),
                sourceIdentifier: source.metadata?.identifier ?? null,
                sourceLabel: source.label ?? null,
                sourceId: source.id,
                group: group.value.trim(),
                option: optionName.value.trim(),
                mode: mode.value,
                categories: categoriesFromInput(categories.value),
            };
            const identityMatches = (item) => (
                Boolean(
                    assignment.sourceIdentifier
                    && item.sourceIdentifier === assignment.sourceIdentifier
                )
                || Boolean(assignment.sourceId && item.sourceId === assignment.sourceId)
                || Boolean(
                    assignment.sourceLabel
                    && item.sourceLabel === assignment.sourceLabel
                )
            );
            this.replaceManualAssignments([
                ...this.comparisonManualAssignments().filter((item) => !identityMatches(item)),
                assignment,
            ]);
            this.comparisonPolicyOpen = true;
            this.render();
        });
        return form;
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

    renderComparisonPreview(snapshot) {
        const { details: section, content } = this.createComparisonPolicySection(
            'preview',
            t('comparison.previewTitle'),
            t('comparison.previewDescription'),
        );
        try {
            const annotated = annotateSourcesWithPolicies(
                snapshot?.sources ?? [],
                this.comparisonPolicySettings,
            );
            const entries = Array.isArray(annotated)
                ? annotated
                : annotated?.sources ?? annotated?.annotatedSources ?? [];
            const rows = entries
                .map((entry) => ({
                    source: entry?.source ?? entry,
                    policy: entry?.policy
                        ?? entry?.comparisonPolicy
                        ?? entry?.metadata?.comparisonPolicy
                        ?? null,
                }))
                .filter(({ source }) => (
                    source?.type !== 'final'
                    && source?.type !== 'chat_history'
                    && source?.content?.trim()
                ));
            if (rows.length === 0) {
                content.appendChild(proseElement('p', t('comparison.previewEmpty')));
                return section;
            }

            const tableWrapper = element('div', { className: 'st-devtools-policy-table-wrapper' });
            const table = element('table', { className: 'st-devtools-policy-table' });
            const head = element('thead');
            const headingRow = element('tr');
            for (const key of [
                'comparison.previewName',
                'comparison.previewPolicy',
                'comparison.previewState',
            ]) {
                headingRow.appendChild(element('th', { text: t(key) }));
            }
            head.appendChild(headingRow);
            const body = element('tbody');
            for (const { source, policy } of rows) {
                const row = element('tr');
                const name = element('td');
                name.appendChild(element('strong', { text: policySourceLabel(source) }));
                if (source.metadata?.identifier) {
                    name.appendChild(element('small', {
                        text: t('comparison.manualIdentifier', {
                            identifier: source.metadata.identifier,
                        }),
                    }));
                }
                const policyCell = element('td');
                if (policy?.groupKey || policy?.group) {
                    const group = policy.group ?? policy.groupKey;
                    policyCell.append(
                        element('strong', {
                            text: `${group} · ${policy.option || t('common.unknown')}`,
                        }),
                        element('small', { text: policyModeLabel(policy.mode) }),
                    );
                    const origin = policy.origin ?? policy.matchType ?? policy.source;
                    if (origin) {
                        policyCell.appendChild(element('small', {
                            text: t('comparison.previewMatched', {
                                origin: origin === 'manual'
                                    ? t('comparison.previewManual')
                                    : t('comparison.previewRule'),
                            }),
                        }));
                    }
                } else {
                    policyCell.textContent = t('comparison.previewNoPolicy');
                }
                const state = element('td');
                const configuredEnabled = source.configuredEnabled
                    ?? source.metadata?.configuredEnabled
                    ?? source.metadata?.enabled;
                state.append(
                    element('span', {
                        text: configuredEnabled === true
                            ? t('comparison.previewEnabled')
                            : configuredEnabled === false
                                ? t('comparison.previewDisabled')
                                : t('comparison.previewEnabledUnknown'),
                    }),
                    element('span', {
                        text: source.included === true
                            ? t('comparison.previewIncluded')
                            : source.included === false
                                ? t('comparison.previewNotIncluded')
                                : t('comparison.previewIncludedUnknown'),
                    }),
                );
                row.append(name, policyCell, state);
                body.appendChild(row);
            }
            table.append(head, body);
            tableWrapper.appendChild(table);
            content.appendChild(tableWrapper);
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
                ruleList.appendChild(this.renderComparisonRuleCard(rule, index));
            });
        }
        ruleContent.append(ruleList, this.renderComparisonRuleCreator());

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

        const actions = element('div', {
            className: 'st-devtools-rule-setting-actions st-devtools-policy-actions',
        });
        const save = element('button', {
            className: 'menu_button',
            text: t('action.applySettings'),
            type: 'button',
        });
        save.addEventListener('click', () => {
            this.saveComparisonPolicySettings();
            this.comparisonPolicyOpen = true;
            this.render();
            globalThis.toastr?.info?.(t('comparison.settingsSaved'), 'ST DevTools');
        });
        const reset = element('button', {
            className: 'menu_button',
            text: t('action.resetSettings'),
            type: 'button',
        });
        reset.addEventListener('click', () => {
            this.saveComparisonPolicySettings(DEFAULT_COMPARISON_POLICY_SETTINGS);
            this.comparisonPolicyOpen = true;
            this.render();
            globalThis.toastr?.info?.(t('comparison.settingsReset'), 'ST DevTools');
        });
        actions.append(save, reset);
        content.append(
            ruleSection,
            manualSection,
            this.renderComparisonPreview(snapshot),
            actions,
        );
        details.appendChild(content);
        return details;
    }

    renderComparisonAnalysis(snapshot, comparison = {}) {
        const suppressed = comparison.suppressedComparisons ?? [];
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
                text: t('comparison.suppressedCount', { count: suppressed.length }),
            }),
        );
        details.appendChild(summary);

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
        const sourceById = new Map((snapshot?.sources ?? []).map((source) => [source.id, source]));
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
            const left = item?.leftId ?? item?.leftSourceId ?? item?.left ?? item?.sourceIds?.[0];
            const right = item?.rightId ?? item?.rightSourceId ?? item?.right ?? item?.sourceIds?.[1];
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
        listSection('comparison.skippedTitle', skipped, (item) => {
            const label = sourceReferenceLabel(item?.sourceId ?? item?.id ?? item, sourceById);
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
            suppressed.length === 0
            && skipped.length === 0
            && groups.length === 0
            && warnings.length === 0
        ) {
            content.appendChild(proseElement('p', t('comparison.noPolicyEffects')));
        }
        details.appendChild(content);
        return details;
    }

    renderRules(snapshot) {
        const page = element('div', { className: 'st-devtools-page' });
        page.append(
            this.renderSnapshotPicker(),
            this.renderRuleSettings(),
            this.renderComparisonPolicySettings(snapshot),
        );
        const analysis = analyzeSnapshotDetailed(
            snapshot,
            this.ruleSettings,
            this.comparisonPolicySettings,
        );
        const findings = analysis?.findings ?? [];
        page.appendChild(this.renderComparisonAnalysis(snapshot, analysis?.comparison));
        const counts = findings.reduce((result, item) => {
            if (Object.prototype.hasOwnProperty.call(result, item.severity)) {
                result[item.severity] += 1;
            }
            return result;
        }, { critical: 0, warning: 0, info: 0 });

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
        );
        page.appendChild(summary);

        if (findings.length === 0) {
            const empty = element('div', { className: 'st-devtools-rule-empty' });
            const anyEnabled = Object.values(this.ruleSettings.enabled).some(Boolean);
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
            page.appendChild(empty);
            return page;
        }

        const list = element('div', { className: 'st-devtools-rule-list' });
        for (const item of findings) {
            const card = element('article', {
                className: `st-devtools-rule-card severity-${item.severity}`,
            });
            card.dataset.findingId = item.id;
            card.dataset.ruleId = item.ruleId;
            const header = element('header');
            header.append(
                element('span', {
                    className: 'st-devtools-rule-severity',
                    text: t(`rules.severity.${item.severity}`),
                }),
                element('strong', { text: item.title }),
            );
            card.append(header, proseElement('p', item.message));
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
            list.appendChild(card);
        }
        page.appendChild(list);
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
        const options = element('div', { className: 'st-devtools-search-options' });
        options.append(
            explainedTitle(
                t('search.optionsTitle'),
                t('search.optionsDescription'),
                { className: 'st-devtools-search-options-title' },
            ),
            regexLabel,
            caseLabel,
        );
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
            ]);
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
                const matches = await searchSnapshotSafely(snapshot, query, {
                    regex: regex.checked,
                    caseSensitive: caseSensitive.checked,
                }, {
                    signal: activeSearch.signal,
                });
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
                        const source = [...this.window.querySelectorAll('.st-devtools-source')]
                            .find((entry) => entry.dataset.sourceId === match.sourceId);
                        if (!source) return;
                        source.closest('.st-devtools-source-group')?.setAttribute('open', '');
                        source.open = true;
                        mountDetailsContent(source);
                        source.scrollIntoView({ block: 'center' });
                        source.classList.add('search-focus');
                        setTimeout(() => source?.classList.remove('search-focus'), 1500);
                    });
                    results.appendChild(item);
                }
            } catch (error) {
                if (error?.code === 'search-cancelled' || sequence !== searchSequence) return;
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
