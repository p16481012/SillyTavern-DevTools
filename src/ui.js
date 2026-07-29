import {
    attributionDisplayLabel,
    generationTypeDisplayLabel,
    promptTypeDisplayLabel,
    sourceDisplayLabel,
    t,
} from './i18n.js';
import {
    parseTimelineDiagnostics,
    serializeAllTimelineDiagnostics,
    serializeTimelineDiagnostics,
} from './diagnostics.js';
import { searchSnapshot, serializeSnapshot } from './model.js';
import {
    buildRangeSegments,
    buildTimelineAnalysis,
    compareLoreEntries,
    compareSnapshotSources,
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
import { inferPanelThemeFromTextColor } from './theme.js';

const STORAGE_PREFIX = 'st-devtools:';
const RULE_SETTINGS_KEY = `${STORAGE_PREFIX}rule-settings:v1`;
const COMPARISON_POLICY_SETTINGS_KEY = `${STORAGE_PREFIX}comparison-policy:v1`;
const COMPARISON_MODES = ['alternative', 'ignore', 'normal'];
const COMPARISON_TARGETS = ['configured', 'all'];
const COMPARISON_RULE_KINDS = ['template', 'regex'];
const TABS = [
    ['explorer', 'tab.explorer'],
    ['timeline', 'tab.timeline'],
    ['diff', 'tab.diff'],
    ['context', 'tab.context'],
    ['rules', 'tab.rules'],
    ['search', 'tab.search'],
];

function element(tag, options = {}) {
    const node = document.createElement(tag);
    if (options.className) node.className = options.className;
    if (options.text != null) node.textContent = String(options.text);
    if (options.title) node.title = options.title;
    if (options.type) node.type = options.type;
    return node;
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
        try {
            new RegExp(pattern, 'u');
        } catch {
            return t('comparison.invalid.regex');
        }
        return null;
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
        this.selectedId = null;
        this.activeTab = localStorage.getItem(`${STORAGE_PREFIX}last-tab`) || 'explorer';
        this.ruleSettings = this.loadRuleSettings();
        this.ruleSettingsOpen = false;
        this.comparisonPolicySettings = this.loadComparisonPolicySettings();
        this.comparisonPolicyOpen = false;
        this.previouslyFocused = null;
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
        const refresh = element('button', { className: 'menu_button', title: t('action.refresh'), type: 'button' });
        refresh.appendChild(element('i', { className: 'fa-solid fa-rotate' }));
        refresh.addEventListener('click', () => this.refresh());
        const close = element('button', { className: 'menu_button', title: t('action.close'), type: 'button' });
        close.appendChild(element('i', { className: 'fa-solid fa-xmark' }));
        close.addEventListener('click', () => this.close());
        headerActions.append(refresh, close);
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
        this.window.append(header, tabList, this.content);
        this.root.appendChild(this.window);
        document.body.appendChild(this.root);
        this.syncOpaqueTheme();

        this.root.addEventListener('pointerdown', (event) => {
            if (event.target === this.root) this.close();
        });
        document.addEventListener('keydown', (event) => this.handleDialogKeydown(event));
        this.enableDragging(header);
        this.observeGeometry();
        this.selectTab(this.activeTab);
    }

    syncOpaqueTheme() {
        if (!this.root) return;
        const probe = element('span');
        probe.style.cssText = 'position:fixed;pointer-events:none;visibility:hidden;color:var(--SmartThemeBodyColor, #eeeeee)';
        document.body.appendChild(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        const darkTheme = inferPanelThemeFromTextColor(color) === 'dark';
        this.root.classList.toggle('st-devtools-theme-dark', darkTheme);
        this.root.classList.toggle('st-devtools-theme-light', !darkTheme);
    }

    restoreGeometry() {
        try {
            const geometry = JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}geometry`));
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
            localStorage.setItem(`${STORAGE_PREFIX}geometry`, JSON.stringify({
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
      Û½6òÚ$z{-®éÜj×TÆ—7BæVæD6†–ÆB‡F†—2ç&VæFW$6ö×&—6öå'VÆT6&B‡'VÆRÂ–æFW‚’“°¢Ò“°¢Ð¢'VÆU6V7F–öâæVæB‡'VÆTÆ—7BÂF†—2ç&VæFW$6ö×&—6öå'VÆT7&VF÷"‚’“° ¢6öç7BÖçVÅ6V7F–öâÒVÆVÖVçB‚w6V7F–öârÂ²6Æ74æÖS¢w7BÖFWgFööÇ2×öÆ–7’×6V7F–öârÒ“°¢ÖçVÅ6V7F–öâæVæB€¢VÆVÖVçB‚vƒBrÂ²FW‡C¢B‚v6ö×&—6öâæÖçVÅF—FÆRr’Ò’À¢VÆVÖVçB‚wrÂ²FW‡C¢B‚v6ö×&—6öâæÖçVÄFW67&—F–öâr’Ò’À¢“°¢6öç7B76–væÖVçDÆ—7BÒVÆVÖVçB‚vF—brÂ²6Æ74æÖS¢w7BÖFWgFööÇ2×öÆ–7’Ö76–væÖVçBÖÆ—7BrÒ“°¢F†—2æ6ö×&—6öäÖçVÄ76–væÖVçG2‚’æf÷$V6‚‚†76–væÖVçBÂ–æFW‚’Óâ°¢76–væÖVçDÆ—7BæVæD6†–ÆB‡F†—2ç&VæFW$ÖçVÄ76–væÖVçD6&B†76–væÖVçBÂ–æFW‚’“°¢Ò“°¢ÖçVÅ6V7F–öâæVæB†76–væÖVçDÆ—7BÂF†—2ç&VæFW$ÖçVÄ76–væÖVçD7&VF÷"‡6æ6†÷B’“° ¢6öç7B7F–öç2ÒVÆVÖVçB‚vF—brÂ°¢6Æ74æÖS¢w7BÖFWgFööÇ2×'VÆR×6WGF–ærÖ7F–öç27BÖFWgFööÇ2×öÆ–7’Ö7F–öç2rÀ¢Ò“°¢6öç7B6fRÒVÆVÖVçB‚v'WGFöârÂ°¢6Æ74æÖS¢vÖVçUö'WGFöârÀ¢FW‡C¢B‚v7F–öâæÇ•6WGF–æw2r’À¢G—S¢v'WGFöârÀ¢Ò“°¢6fRæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°¢F†—2ç6fT6ö×&—6öåöÆ–7•6WGF–æw2‚“°¢F†—2æ6ö×&—6öåöÆ–7”÷VâÒG'VS°¢F†—2ç&VæFW"‚“°¢vÆö&ÅF†—2çFö7G#òæ–æfóòâ‡B‚v6ö×&—6öâç6WGF–æw56fVBr’Âu5BFWeFööÇ2r“°¢Ò“°¢6öç7B&W6WBÒVÆVÖVçB‚v'WGFöârÂ°¢6Æ74æÖS¢vÖVçUö'WGFöârÀ¢FW‡C¢B‚v7F–öâç&W6WE6WGF–æw2r’À¢G—S¢v'WGFöârÀ¢Ò“°¢&W6WBæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°¢F†—2ç6fT6ö×&—6öåöÆ–7•6WGF–æw2„DTdTÅEô4ôÕ$•4ôåõôÄ”5•õ4UED”äu2“°¢F†—2æ6ö×&—6öåöÆ–7”÷VâÒG'VS°¢F†—2ç&VæFW"‚“°¢vÆö&ÅF†—2çFö7G#òæ–æfóòâ‡B‚v6ö×&—6öâç6WGF–æw5&W6WBr’Âu5BFWeFööÇ2r“°¢Ò“°¢7F–öç2æVæB‡6fRÂ&W6WB“°¢6öçFVçBæVæB€¢'VÆU6V7F–öâÀ¢ÖçVÅ6V7F–öâÀ¢F†—2ç&VæFW$6ö×&—6öå&Wf–Wr‡6æ6†÷B’À¢7F–öç2À¢“°¢FWF–Ç2æVæD6†–ÆB†6öçFVçB“°¢&WGW&âFWF–Ç3°¢Ð ¢&VæFW$6ö×&—6öäæÇ—6—2‡6æ6†÷BÂ6ö×&—6öâÒ·Ò’°¢6öç7B7W&W76VBÒ6ö×&—6öâç7W&W76VD6ö×&—6öç2óòµÓ°¢6öç7B6¶—VBÒ6ö×&—6öâç6¶—VE6÷W&6W2óòµÓ°¢6öç7Bw&÷W2Ò6ö×&—6öâæw&÷W2óòµÓ°¢6öç7Bv&æ–æw2Ò6ö×&—6öâæw&÷Wv&æ–æw2óòµÓ°¢6öç7BFWF–Ç2ÒVÆVÖVçB‚vFWF–Ç2rÂ²6Æ74æÖS¢w7BÖFWgFööÇ2×öÆ–7’×&W7VÇG2rÒ“°¢–b‡v&æ–æw2æÆVæwF‚â’FWF–Ç2æ÷VâÒG'VS° ¢6öç7B7VÖÖ'’ÒVÆVÖVçB‚w7VÖÖ'’r“°¢7VÖÖ'’æVæB€¢VÆVÖVçB‚w7G&öærrÂ²FW‡C¢B‚v6ö×&—6öâç&W7VÇE7VÖÖ'’r’Ò’À¢VÆVÖVçB‚w7ârÂ°¢6Æ74æÖS¢w7BÖFWgFööÇ2×öÆ–7’×&W7VÇBÖ6÷VçBrÀ¢FW‡C¢B‚v6ö×&—6öâç7W&W76VD6÷VçBrÂ²6÷VçC¢7W&W76VBæÆVæwF‚Ò’À¢Ò’À¢“°¢FWF–Ç2æVæD6†–ÆB‡7VÖÖ'’“° ¢6öç7B6öçFVçBÒVÆVÖVçB‚vF—brÂ²6Æ74æÖS¢w7BÖFWgFööÇ2×öÆ–7’×&W7VÇBÖ6öçFVçBrÒ“°¢6öç7B&FvW2ÒVÆVÖVçB‚vF—brÂ²6Æ74æÖS¢w7BÖFWgFööÇ2×'VÆR×7VÖÖ'’rÒ“°¢&FvW2æVæB€¢VÆVÖVçB‚w7ârÂ°¢6Æ74æÖS¢w7BÖFWgFööÇ2×öÆ–7’×&W7VÇBÖ6÷VçBrÀ¢FW‡C¢B‚v6ö×&—6öâç6¶—VD6÷VçBrÂ²6÷VçC¢6¶—VBæÆVæwF‚Ò’À¢Ò’À¢VÆVÖVçB‚w7ârÂ°¢6Æ74æÖS¢w7BÖFWgFööÇ2×öÆ–7’×&W7VÇBÖ6÷VçBrÀ¢FW‡C¢B‚v6ö×&—6öâæw&÷W6÷VçBrÂ²6÷VçC¢w&÷W2æÆVæwF‚Ò’À¢Ò’À¢VÆVÖVçB‚w7ârÂ°¢6Æ74æÖS¢v&æ–æw2æÆVæwF€¢òw7BÖFWgFööÇ2×öÆ–7’×&W7VÇBÖ6÷VçB†2×v&æ–ærp¢¢w7BÖFWgFööÇ2×öÆ–7’×&W7VÇBÖ6÷VçBrÀ¢FW‡C¢B‚v6ö×&—6öâçv&æ–æt6÷VçBrÂ²6÷VçC¢v&æ–æw2æÆVæwF‚Ò’À¢Ò’À¢“°¢6öçFVçBæVæD6†–ÆB†&FvW2“°¢6öç7B6÷W&6T'”–BÒæWrÖ‚‡6æ6†÷Còç6÷W&6W2óòµÒ’æÖ‚‡6÷W&6R’Óâ·6÷W&6Ræ–BÂ6÷W&6UÒ’“°¢6öç7BÆ—7E6V7F–öâÒ‡F—FÆT¶W’Â—FV×2Âf÷&ÖGFW"Â6Æ74æÖRÒrr’Óâ°¢–b†—FV×2æÆVæwF‚ÓÓÒ’&WGW&ã°¢6öç7B6V7F–öâÒVÆVÖVçB‚w6V7F–öârÂ°¢6Æ74æÖS¢7BÖFWgFööÇ2×öÆ–7’×&W7VÇB×6V7F–öâG¶6Æ74æÖWÖçG&–Ò‚’À¢Ò“°¢6V7F–öâæVæD6†–ÆB†VÆVÖVçB‚vƒBrÂ²FW‡C¢B‡F—FÆT¶W’’Ò’“°¢6öç7BÆ—7BÒVÆVÖVçB‚wVÂr“°¢—FV×2æf÷$V6‚‚†—FVÒ’Óâ°¢Æ—7BæVæD6†–ÆB†VÆVÖVçB‚vÆ’rÂ²FW‡C¢f÷&ÖGFW"†—FVÒ’Ò’“°¢Ò“°¢6V7F–öâæVæD6†–ÆB†Æ—7B“°¢6öçFVçBæVæD6†–ÆB‡6V7F–öâ“°¢Ó°¢Æ—7E6V7F–öâ‚v6ö×&—6öâç7W&W76VEF—FÆRrÂ7W&W76VBÂ†—FVÒ’Óâ°¢6öç7BÆVgBÒ—FVÓòæÆVgD–Bóò—FVÓòæÆVgE6÷W&6T–Bóò—FVÓòæÆVgBóò—FVÓòç6÷W&6T–G3òå³Ó°¢6öç7B&–v‡BÒ—FVÓòç&–v‡D–Bóò—FVÓòç&–v‡E6÷W&6T–Bóò—FVÓòç&–v‡Bóò—FVÓòç6÷W&6T–G3òå³Ó°¢6öç7B—"ÒB‚v6ö×&—6öâæ—FVÕ—"rÂ°¢ÆVgC¢6÷W&6U&VfW&Væ6TÆ&VÂ†ÆVgBÂ6÷W&6T'”–B’À¢&–v‡C¢6÷W&6U&VfW&Væ6TÆ&VÂ‡&–v‡BÂ6÷W&6T'”–B’À¢Ò“°¢6öç7B7Vff—‚Ò°¢—FVÓòæw&÷WÀ¢—FVÓòæ6FVv÷'’À¢—FVÓòç&V6öâòöÆ–7•&V6öäÆ&VÂ†—FVÒç&V6öâ’¢çVÆÂÀ¢Òæf–ÇFW"„&ööÆVâ’æ¦ö–â‚r+rr“°¢&WGW&â7Vff—‚òG·—'Ò+rG·7Vff—‡Ö¢—#°¢Ò“°¢Æ—7E6V7F–öâ‚v6ö×&—6öâç6¶—VEF—FÆRrÂ6¶—VBÂ†—FVÒ’Óâ°¢6öç7BÆ&VÂÒ6÷W&6U&VfW&Væ6TÆ&VÂ†—FVÓòç6÷W&6T–Bóò—FVÓòæ–Bóò—FVÒÂ6÷W&6T'”–B“°¢&WGW&â—FVÓòç&V6öâòG¶Æ&VÇÒ+rG·öÆ–7•&V6öäÆ&VÂ†—FVÒç&V6öâ—Ö¢Æ&VÃ°¢Ò“°¢Æ—7E6V7F–öâ‚v6ö×&—6öâæw&÷W5F—FÆRrÂw&÷W2Â†—FVÒ’Óâ°¢6öç7B6÷W&6T–G2Ò—FVÓòç6÷W&6T–G2óò—FVÓòæÖVÖ&W'2óò—FVÓòç6÷W&6W2óòµÓ°¢6öç7B7F—fU6÷W&6T–G2Ò—FVÓòæ7F—fU6÷W&6T–G2óòµÓ°¢6öç7B÷F–öç2Ò—FVÓòæ÷F–öç2óò—FVÓòæ7F—fT÷F–öç2óòµÓ°¢&WGW&âB‚v6ö×&—6öâæw&÷W7VÖÖ'’rÂ°¢w&÷W¢—FVÓòæw&÷Wóò—FVÓòææÖRóòB‚v6öÖÖöâçVæ¶æ÷vâr’À¢ÖöFS¢öÆ–7”ÖöFTÆ&VÂ†—FVÓòæÖöFR’À¢6÷VçC¢6÷W&6T–G2æÆVæwF‚À¢7F—fS¢7F—fU6÷W&6T–G2æÆVæwF‚À¢÷F–öç3¢÷F–öç2æ¦ö–â‚rÂr’ÇÂB‚v6öÖÖöâçVæ¶æ÷vâr’À¢Ò“°¢Ò“°¢Æ—7E6V7F–öâ€¢v6ö×&—6öâæw&÷Wv&æ–æw5F—FÆRrÀ¢v&æ–æw2À¢†—FVÒ’Óâ—FVÓòæÖW76vP¢óò†—FVÓòæw&÷W ¢òG¶—FVÒæw&÷WÒ+rG·B‚v6ö×&—6öâæw&÷Wv&æ–ætfÆÆ&6²r—Ö ¢¢B‚v6ö×&—6öâæw&÷Wv&æ–ætfÆÆ&6²r’’À¢v†2×v&æ–ærrÀ¢“°¢–b€¢7W&W76VBæÆVæwF‚ÓÓÒ ¢bb6¶—VBæÆVæwF‚ÓÓÒ ¢bbw&÷W2æÆVæwF‚ÓÓÒ ¢bbv&æ–æw2æÆVæwF‚ÓÓÒ ¢’°¢6öçFVçBæVæD6†–ÆB†VÆVÖVçB‚wrÂ²FW‡C¢B‚v6ö×&—6öâææõöÆ–7”VffV7G2r’Ò’“°¢Ð¢FWF–Ç2æVæD6†–ÆB†6öçFVçB“°¢&WGW&âFWF–Ç3°¢Ð ¢&VæFW%'VÆW2‡6æ6†÷B’°¢6öç7BvRÒVÆVÖVçB‚vF—brÂ²6Æ74æÖS¢w7BÖFWgFööÇ2×vRrÒ“°¢vRæVæB€¢F†—2ç&VæFW%6æ6†÷E–6¶W"‚’À¢F†—2ç&VæFW%'VÆU6WGF–æw2‚’À¢F†—2ç&VæFW$6ö×&—6öåöÆ–7•6WGF–æw2‡6æ6†÷B’À¢“°¢6öç7BæÇ—6—2ÒæÇ—¦U6æ6†÷DFWF–ÆVB€¢6æ6†÷BÀ¢F†—2ç'VÆU6WGF–æw2À¢F†—2æ6ö×&—6öåöÆ–7•6WGF–æw2À¢“°¢6öç7Bf–æF–æw2ÒæÇ—6—3òæf–æF–æw2óòµÓ°¢vRæVæD6†–ÆB‡F†—2ç&VæFW$6ö×&—6öäæÇ—6—2‡6æ6†÷BÂæÇ—6—3òæ6ö×&—6öâ’“°¢6öç7B6÷VçG2Òf–æF–æw2ç&VGV6R‚‡&W7VÇBÂ—FVÒ’Óâ°¢–b„ö&¦V7Bç&÷F÷G—Ræ†4÷vå&÷W'G’æ6ÆÂ‡&W7VÇBÂ—FVÒç6WfW&—G’’’°¢&W7VÇE¶—FVÒç6WfW&—G•Ò³Ò°¢Ð¢&WGW&â&W7VÇC°¢ÒÂ²7&—F–6Ã¢Âv&æ–æs¢Â–æfó¢Ò“°Ð Ð¢6öç7B7VÖÖ'’ÒVÆVÖVçB‚vF—brÂ²6Æ74æÖS¢w7BÖFWgFööÇ2×'VÆR×7VÖÖ'’rÒ“°Ð¢7VÖÖ'’æVæB€Ð¢VÆVÖVçB‚w7ârÂ°Ð¢6Æ74æÖS¢w7BÖFWgFööÇ2×'VÆRÖ6÷VçB6WfW&—G’Ö7&—F–6ÂrÀÐ¢FW‡C¢G·B‚w'VÆW2ç6WfW&—G’æ7&—F–6Âr—ÒG¶6÷VçG2æ7&—F–6ÇÖÀÐ¢Ò’ÀÐ¢VÆVÖVçB‚w7ârÂ°Ð¢6Æ74æÖS¢w7BÖFWgFööÇ2×'VÆRÖ6÷VçB6WfW&—G’×v&æ–ærrÀÐ¢FW‡C¢G·B‚w'VÆW2ç6WfW&—G’çv&æ–ærr—ÒG¶6÷VçG2çv&æ–æwÖÀÐ¢Ò’ÀÐ¢VÆVÖVçB‚w7ârÂ°Ð¢6Æ74æÖS¢w7BÖFWgFööÇ2×'VÆRÖ6÷VçB6WfW&—G’Ö–æfòrÀÐ¢FW‡C¢G·B‚w'VÆW2ç6WfW&—G’æ–æfòr—ÒG¶6÷VçG2æ–æf÷ÖÀÐ¢Ò’ÀÐ¢“°Ð¢vRæVæD6†–ÆB‡7VÖÖ'’“°Ð Ð¢–b†f–æF–æw2æÆVæwF‚ÓÓÒ’°Ð¢6öç7BV×G’ÒVÆVÖVçB‚vF—brÂ²6Æ74æÖS¢w7BÖFWgFööÇ2×'VÆRÖV×G’rÒ“°Ð¢6öç7Bç”Væ&ÆVBÒö&¦V7BçfÇVW2‡F†—2ç'VÆU6WGF–æw2æVæ&ÆVB’ç6öÖR„&ööÆVâ“°Ð¢V×G’æVæB€Ð¢VÆVÖVçB‚v’rÂ°Ð¢6Æ74æÖS¢ç”Væ&ÆV@Ð¢òvf×6öÆ–BfÖ6—&6ÆRÖ6†V6²pÐ¢¢vf×6öÆ–BfÖ6—&6ÆR×W6RrÀÐ¢Ò’ÀÐ¢VÆVÖVçB‚w7G&öærrÂ°Ð¢FW‡C¢B†ç”Væ&ÆVBòw'VÆW2æ6ÆVåF—FÆRr¢w'VÆW2æF—6&ÆVEF—FÆRr’ÀÐ¢Ò’ÀÐ¢VÆVÖVçB‚wrÂ°Ð¢FW‡C¢B†ç”Væ&ÆVBòw'VÆW2æ6ÆVäFW67&—F–öâr¢w'VÆW2æF—6&ÆVDFW67&—F–öâr’ÀÐ¢Ò’ÀÐ¢“°Ð¢vRæVæD6†–ÆB†V×G’“°Ð¢&WGW&âvS°Ð¢ÐÐ Ð¢6öç7BÆ—7BÒVÆVÖVçB‚vF—brÂ²6Æ74æÖS¢w7BÖFWgFööÇ2×'VÆRÖÆ—7BrÒ“°Ð¢f÷"†6öç7B—FVÒöbf–æF–æw2’°Ð¢6öç7B6&BÒVÆVÖVçB‚v'F–6ÆRrÂ°Ð¢6Æ74æÖS¢7BÖFWgFööÇ2×'VÆRÖ6&B6WfW&—G’ÒG¶—FVÒç6WfW&—G—ÖÀÐ¢Ò“°Ð¢6&BæFF6WBæf–æF–æt–BÒ—FVÒæ–C°Ð¢6&BæFF6WBç'VÆT–BÒ—FVÒç'VÆT–C°Ð¢6öç7B†VFW"ÒVÆVÖVçB‚v†VFW"r“°Ð¢†VFW"æVæB€Ð¢VÆVÖVçB‚w7ârÂ°Ð¢6Æ74æÖS¢w7BÖFWgFööÇ2×'VÆR×6WfW&—G’rÀÐ¢FW‡C¢B†'VÆW2ç6WfW&—G’âG¶—FVÒç6WfW&—G—Ö’ÀÐ¢Ò’ÀÐ¢VÆVÖVçB‚w7G&öærrÂ²FW‡C¢—FVÒçF—FÆRÒ’ÀÐ¢“°Ð¢6&BæVæB††VFW"ÂVÆVÖVçB‚wrÂ²FW‡C¢—FVÒæÖW76vRÒ’“°Ð¢–b†—FVÒæWf–FVæ6R’°Ð¢6öç7BWf–FVæ6RÒVÆVÖVçB‚vFWF–Ç2rÂ²6Æ74æÖS¢w7BÖFWgFööÇ2×'VÆRÖWf–FVæ6RrÒ“°Ð¢Wf–FVæ6RæVæB€Ð¢VÆVÖVçB‚w7VÖÖ'’rÂ²FW‡C¢B‚w'VÆW2æWf–FVæ6Rr’Ò’ÀÐ¢VÆVÖVçB‚w&RrÂ²FW‡C¢—FVÒæWf–FVæ6RÒ’ÀÐ¢“°Ð¢6&BæVæD6†–ÆB†Wf–FVæ6R“°Ð¢Ð¢6öç7B7F–öç2ÒVÆVÖVçB‚vF—brÂ²6Æ74æÖS¢w7BÖFWgFööÇ2×'VÆRÖ7F–öç2rÒ“°¢–b†—FVÒç6÷W&6T–G3òæÆVæwF‚â’°¢6öç7B6÷W&6W2ÒVÆVÖVçB‚v'WGFöârÂ°¢6Æ74æÖS¢vÖVçUö'WGFöârÀ¢FW‡C¢B‚v7F–öâçf–Wu&VÆFVE6÷W&6W2rÂ²6÷VçC¢—FVÒç6÷W&6T–G2æÆVæwF‚Ò’À¢G—S¢v'WGFöârÀÐ¢Ò“°Ð¢6÷W&6W2æFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ð¢F†—2æ÷VäW‡Æ÷&W$f÷$f–æF–ær‡6æ6†÷BÂ—FVÒÂw6÷W&6W2r“°Ð¢Ò“°¢7F–öç2æVæD6†–ÆB‡6÷W&6W2“°¢Ð¢–b†—FVÒæf–æÅ&ævW3òæÆVæwF‚â’°¢6öç7Bf–æÄWf–FVæ6RÒVÆVÖVçB‚v'WGFöârÂ°¢6Æ74æÖS¢vÖVçUö'WGFöârÀ¢FW‡C¢B‚v7F–öâçf–Wtf–æÄWf–FVæ6Rr’À¢G—S¢v'WGFöârÀ¢Ò“°¢f–æÄWf–FVæ6RæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°¢F†—2æ÷VäW‡Æ÷&W$f÷$f–æF–ær‡6æ6†÷BÂ—FVÒÂvf–æÂr“°¢Ò“°¢7F–öç2æVæD6†–ÆB†f–æÄWf–FVæ6R“°¢Ð¢–b†7F–öç2æ6†–ÆDVÆVÖVçD6÷VçBâ’6&BæVæD6†–ÆB†7F–öç2“°¢Æ—7BæVæD6†–ÆB†6&B“°¢Ð¢vRæVæD6†–ÆB†Æ—7B“°Ð¢&WGW&âvS°Ð¢ÐÐ Ð¢&VæFW%6V&6‚‡6æ6†÷B’°Ð¢6öç7BvRÒVÆVÖVçB‚vF—brÂ²6Æ74æÖS¢w7BÖFWgFööÇ2×vRrÒ“°Ð¢vRæVæD6†–ÆB‡F†—2ç&VæFW%6æ6†÷E–6¶W"‚’“°Ð¢6öç7B6öçG&öÇ2ÒVÆVÖVçB‚vF—brÂ²6Æ74æÖS¢w7BÖFWgFööÇ2×6V&6‚Ö6öçG&öÇ2rÒ“°Ð¢6öç7B–çWBÒVÆVÖVçB‚v–çWBr“°Ð¢–çWBçG—RÒw6V&6‚s°Ð¢–çWBçÆ6V†öÆFW"ÒB‚w6V&6‚çÆ6V†öÆFW"r“°Ð¢6öç7B&VvW„Æ&VÂÒVÆVÖVçB‚vÆ&VÂr“°Ð¢6öç7B&VvW‚ÒVÆVÖVçB‚v–çWBr“°Ð¢&VvW‚çG—RÒv6†V6¶&÷‚s°Ð¢&VvW„Æ&VÂæVæB‡&VvW‚ÂFö7VÖVçBæ7&VFUFW‡DæöFR†G·B‚w6V&6‚ç&VvW‚r—Ö’“°Ð¢6öç7B66TÆ&VÂÒVÆVÖVçB‚vÆ&VÂr“°Ð¢6öç7B66U6Vç6—F—fRÒVÆVÖVçB‚v–çWBr“°Ð¢66U6Vç6—F—fRçG—RÒv6†V6¶&÷‚s°Ð¢66TÆ&VÂæVæB†66U6Vç6—F—fRÂFö7VÖVçBæ7&VFUFW‡DæöFR†G·B‚w6V&6‚æÖF6„66Rr—Ö’“°Ð¢6öçG&öÇ2æVæB†–çWBÂ&VvW„Æ&VÂÂ66TÆ&VÂ“°Ð¢6öç7B7FGW2ÒVÆVÖVçB‚wrÂ²6Æ74æÖS¢w7BÖFWgFööÇ2×6V&6‚×7FGW2rÒ“°Ð¢6öç7B&W7VÇG2ÒVÆVÖVçB‚vF—brÂ²6Æ74æÖS¢w7BÖFWgFööÇ2×6V&6‚×&W7VÇG2rÒ“°Ð Ð¢6öç7B'VâÒ‚’Óâ°Ð¢&W7VÇG2ç&WÆ6T6†–ÆG&Vâ‚“°Ð¢7FGW2çFW‡D6öçFVçBÒrs°Ð¢–b‚–çWBçfÇVR’&WGW&ã°Ð¢G'’°Ð¢6öç7BÖF6†W2Ò6V&6…6æ6†÷B‡6æ6†÷BÂ–çWBçfÇVRÂ°Ð¢&VvWƒ¢&VvW‚æ6†V6¶VBÀÐ¢66U6Vç6—F—fS¢66U6Vç6—F—fRæ6†V6¶VBÀÐ¢Ò“°Ð¢7FGW2çFW‡D6öçFVçBÒÖF6†W2æÆVæwF‚ÓÓÒ# Ð¢òB‚w6V&6‚æÖF6†W4Æ–Ö—FVBrÂ²6÷VçC¢ÖF6†W2æÆVæwF‚ÒÐ¢¢B‚w6V&6‚æÖF6†W2rÂ²6÷VçC¢ÖF6†W2æÆVæwF‚Ò“°Ð¢f÷"†6öç7BÖF6‚öbÖF6†W2’°Ð¢6öç7B—FVÒÒVÆVÖVçB‚v'WGFöârÂ²6Æ74æÖS¢w7BÖFWgFööÇ2×6V&6‚×&W7VÇBrÂG—S¢v'WGFöârÒ“°Ð¢—FVÒæVæB€Ð¢VÆVÖVçB‚w7G&öærrÂ²FW‡C¢ÖF6‚ç6÷W&6TÆ&VÂÒ’ÀÐ¢VÆVÖVçB‚w7ârÂ²FW‡C¢ÖF6‚ç6æ—WBÒ’ÀÐ¢“°Ð¢—FVÒæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ð¢F†—2æ7F—fUF"ÒvW‡Æ÷&W"s°Ð¢Æö6Å7F÷&vRç6WD—FVÒ†Gµ5Dõ$tUõ$Td•‡ÖÆ7B×F&ÂF†—2æ7F—fUF"“°Ð¢F†—2ç&VæFW"‚“°Ð¢6öç7B6÷W&6RÒF†—2çv–æF÷rçVW'•6VÆV7F÷$ÆÂ‚rç7BÖFWgFööÇ2×6÷W&6Rr“°Ð¢6öç7B6÷W&6T–æFW‚Ò6æ6†÷Bç6÷W&6W2æf–æD–æFW‚‚†VçG'’’ÓâVçG'’æ–BÓÓÒÖF6‚ç6÷W&6T–B“°Ð¢–b‡6÷W&6T–æFW‚ãÒ’°Ð¢6÷W&6U·6÷W&6T–æFW…Òæ÷VâÒG'VS°Ð¢6÷W&6U·6÷W&6T–æFW…Òç67&öÆÄ–çFõf–Wr‡²&Æö6³¢v6VçFW"rÒ“°Ð¢6÷W&6U·6÷W&6T–æFW…Òæ6Æ74Æ—7BæFB‚w6V&6‚Öfö7W2r“°Ð¢6WEF–ÖV÷WB‚‚’Óâ6÷W&6U·6÷W&6T–æFW…Óòæ6Æ74Æ—7Bç&VÖ÷fR‚w6V&6‚Öfö7W2r’ÂS“°Ð¢ÐÐ¢Ò“°Ð¢&W7VÇG2æVæD6†–ÆB†—FVÒ“°Ð¢ÐÐ¢Ò6F6‚†W'&÷"’°Ð¢7FGW2çFW‡D6öçFVçBÒB‚w6V&6‚æ–çfÆ–E&VvW‚rÂ²ÖW76vS¢W'&÷"æÖW76vRÒ“°Ð¢ÐÐ¢Ó°Ð¢–çWBæFDWfVçDÆ—7FVæW"‚v–çWBrÂ'Vâ“°Ð¢&VvW‚æFDWfVçDÆ—7FVæW"‚v6†ævRrÂ'Vâ“°Ð¢66U6Vç6—F—fRæFDWfVçDÆ—7FVæW"‚v6†ævRrÂ'Vâ“°Ð¢vRæVæB†6öçG&öÇ2Â7FGW2Â&W7VÇG2“°Ð¢&WGW&âvS°Ð¢ÐÐ§ÐÐ