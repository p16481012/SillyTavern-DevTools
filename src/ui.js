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
    searchSnapshot,
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
import { inferPanelThemeFromTextColor } from './theme.js';

const STORAGE_PREFIX = 'st-devtools:';
const RULE_SETTINGS_KEY = `${STORAGE_PREFIX}rule-settings:v1`;
const COMPARISON_POLICY_SETTINGS_KEY = `${STORAGE_PREFIX}comparison-policy:v1`;
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

function element(tag, options = {}) {
    const node = document.createElement(tag);
    if (options.className) node.className = options.className;
    if (options.text != null) node.textContent = String(options.text);
    if (options.title) node.title = options.title;
    if (options.type) node.type = options.type;
    return node;
}

function descriptionParagraphs(text) {
    return String(text ?? '')
        .trim()
        .split(/\n\s*\n|\s+(?=(?:ì˜ˆ(?:ì‹œ)?\s*:|ex\.\s|e\.g\.\s))/giu)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean);
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
 ßyòÚ$z{-®éÜj×–ÆB‡F†—2ç&VæFW$ÖçVÄ76–væÖVçD6&B†76–væÖVçBÂ–æFW‚’“°¢Ò“°¢ÖçVÄ6öçFVçBæVæB†76–væÖVçDÆ—7BÂF†—2ç&VæFW$ÖçVÄ76–væÖVçD7&VF÷"‡6æ6†÷B’“° ¢6öç7B7F–öç2ÒVÆVÖVçB‚vF—brÂ°¢6Æ74æÖS¢w7BÖFWgFööÇ2×'VÆR×6WGF–ærÖ7F–öç27BÖFWgFööÇ2×öÆ–7’Ö7F–öç2rÀ¢Ò“°¢6öç7B6fRÒVÆVÖVçB‚v'WGFöârÂ°¢6Æ74æÖS¢vÖVçUö'WGFöârÀ¢FW‡C¢B‚v7F–öâæÇ•6WGF–æw2r’À¢G—S¢v'WGFöârÀ¢Ò“°¢6fRæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°¢F†—2ç6fT6ö×&—6öåöÆ–7•6WGF–æw2‚“°¢F†—2æ6ö×&—6öåöÆ–7”÷VâÒG'VS°¢F†—2ç&VæFW"‚“°¢vÆö&ÅF†—2çFö7G#òæ–æfóòâ‡B‚v6ö×&—6öâç6WGF–æw56fVBr’Âu5BFWeFööÇ2r“°¢Ò“°¢6öç7B&W6WBÒVÆVÖVçB‚v'WGFöârÂ°¢6Æ74æÖS¢vÖVçUö'WGFöârÀ¢FW‡C¢B‚v7F–öâç&W6WE6WGF–æw2r’À¢G—S¢v'WGFöârÀ¢Ò“°¢&W6WBæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°¢F†—2ç6fT6ö×&—6öåöÆ–7•6WGF–æw2„DTdTÅEô4ôÕ$•4ôåõôÄ”5•õ4UED”äu2“°¢F†—2æ6ö×&—6öåöÆ–7”÷VâÒG'VS°¢F†—2ç&VæFW"‚“°¢vÆö&ÅF†—2çFö7G#òæ–æfóòâ‡B‚v6ö×&—6öâç6WGF–æw5&W6WBr’Âu5BFWeFööÇ2r“°¢Ò“°¢7F–öç2æVæB‡6fRÂ&W6WB“°¢6öçFVçBæVæB€¢'VÆU6V7F–öâÀ¢ÖçVÅ6V7F–öâÀ¢F†—2ç&VæFW$6ö×&—6öå&Wf–Wr‡6æ6†÷B’À¢7F–öç2À¢“°¢FWF–Ç2æVæD6†–ÆB†6öçFVçB“°¢&WGW&âFWF–Ç3°¢Ğ ¢&VæFW$6ö×&—6öäæÇ—6—2‡6æ6†÷BÂ6ö×&—6öâÒ·Ò’°¢6öç7B7W&W76VBÒ6ö×&—6öâç7W&W76VD6ö×&—6öç2óòµÓ°¢6öç7B6¶—VBÒ6ö×&—6öâç6¶—VE6÷W&6W2óòµÓ°¢6öç7Bw&÷W2Ò6ö×&—6öâæw&÷W2óòµÓ°¢6öç7Bv&æ–æw2Ò6ö×&—6öâæw&÷Wv&æ–æw2óòµÓ°¢6öç7BFWF–Ç2ÒVÆVÖVçB‚vFWF–Ç2rÂ²6Æ74æÖS¢w7BÖFWgFööÇ2×öÆ–7’×&W7VÇG2rÒ“°¢–b‡v&æ–æw2æÆVæwF‚â’FWF–Ç2æ÷VâÒG'VS° ¢6öç7B7VÖÖ'’ÒVÆVÖVçB‚w7VÖÖ'’r“°¢7VÖÖ'’æVæB€¢W‡Æ–æVEF—FÆR€¢B‚v6ö×&—6öâç&W7VÇE7VÖÖ'’r’À¢B‚v6ö×&—6öâç&W7VÇDFW67&—F–öâr’À¢’À¢VÆVÖVçB‚w7ârÂ°¢6Æ74æÖS¢w7BÖFWgFööÇ2×öÆ–7’×&W7VÇBÖ6÷VçBrÀ¢FW‡C¢B‚v6ö×&—6öâç7W&W76VD6÷VçBrÂ²6÷VçC¢7W&W76VBæÆVæwF‚Ò’À¢Ò’À¢“°¢FWF–Ç2æVæD6†–ÆB‡7VÖÖ'’“° ¢6öç7B6öçFVçBÒVÆVÖVçB‚vF—brÂ²6Æ74æÖS¢w7BÖFWgFööÇ2×öÆ–7’×&W7VÇBÖ6öçFVçBrÒ“°¢6öç7B&FvW2ÒVÆVÖVçB‚vF—brÂ²6Æ74æÖS¢w7BÖFWgFööÇ2×'VÆR×7VÖÖ'’rÒ“°¢&FvW2æVæB€¢VÆVÖVçB‚w7ârÂ°¢6Æ74æÖS¢w7BÖFWgFööÇ2×öÆ–7’×&W7VÇBÖ6÷VçBrÀ¢FW‡C¢B‚v6ö×&—6öâç6¶—VD6÷VçBrÂ²6÷VçC¢6¶—VBæÆVæwF‚Ò’À¢Ò’À¢VÆVÖVçB‚w7ârÂ°¢6Æ74æÖS¢w7BÖFWgFööÇ2×öÆ–7’×&W7VÇBÖ6÷VçBrÀ¢FW‡C¢B‚v6ö×&—6öâæw&÷W6÷VçBrÂ²6÷VçC¢w&÷W2æÆVæwF‚Ò’À¢Ò’À¢VÆVÖVçB‚w7ârÂ°¢6Æ74æÖS¢v&æ–æw2æÆVæwF€¢òw7BÖFWgFööÇ2×öÆ–7’×&W7VÇBÖ6÷VçB†2×v&æ–ærp¢¢w7BÖFWgFööÇ2×öÆ–7’×&W7VÇBÖ6÷VçBrÀ¢FW‡C¢B‚v6ö×&—6öâçv&æ–æt6÷VçBrÂ²6÷VçC¢v&æ–æw2æÆVæwF‚Ò’À¢Ò’À¢“°¢6öçFVçBæVæD6†–ÆB†&FvW2“°¢6öç7B6÷W&6T'”–BÒæWrÖ‚‡6æ6†÷Còç6÷W&6W2óòµÒ’æÖ‚‡6÷W&6R’Óâ·6÷W&6Ræ–BÂ6÷W&6UÒ’“°¢6öç7BÆ—7E6V7F–öâÒ‡F—FÆT¶W’Â—FV×2Âf÷&ÖGFW"Â6Æ74æÖRÒrr’Óâ°¢–b†—FV×2æÆVæwF‚ÓÓÒ’&WGW&ã°¢6öç7B6V7F–öâÒVÆVÖVçB‚w6V7F–öârÂ°¢6Æ74æÖS¢7BÖFWgFööÇ2×öÆ–7’×&W7VÇB×6V7F–öâG¶6Æ74æÖWÖçG&–Ò‚’À¢Ò“°¢6V7F–öâæVæD6†–ÆB†VÆVÖVçB‚vƒBrÂ²FW‡C¢B‡F—FÆT¶W’’Ò’“°¢6öç7BÆ—7BÒVÆVÖVçB‚wVÂr“°¢—FV×2æf÷$V6‚‚†—FVÒ’Óâ°¢Æ—7BæVæD6†–ÆB†VÆVÖVçB‚vÆ’rÂ²FW‡C¢f÷&ÖGFW"†—FVÒ’Ò’“°¢Ò“°¢6V7F–öâæVæD6†–ÆB†Æ—7B“°¢6öçFVçBæVæD6†–ÆB‡6V7F–öâ“°¢Ó°¢Æ—7E6V7F–öâ‚v6ö×&—6öâç7W&W76VEF—FÆRrÂ7W&W76VBÂ†—FVÒ’Óâ°¢6öç7BÆVgBÒ—FVÓòæÆVgD–Bóò—FVÓòæÆVgE6÷W&6T–Bóò—FVÓòæÆVgBóò—FVÓòç6÷W&6T–G3òå³Ó°¢6öç7B&–v‡BÒ—FVÓòç&–v‡D–Bóò—FVÓòç&–v‡E6÷W&6T–Bóò—FVÓòç&–v‡Bóò—FVÓòç6÷W&6T–G3òå³Ó°¢6öç7B—"ÒB‚v6ö×&—6öâæ—FVÕ—"rÂ°¢ÆVgC¢6÷W&6U&VfW&Væ6TÆ&VÂ†ÆVgBÂ6÷W&6T'”–B’À¢&–v‡C¢6÷W&6U&VfW&Væ6TÆ&VÂ‡&–v‡BÂ6÷W&6T'”–B’À¢Ò“°¢6öç7B7Vff—‚Ò°¢—FVÓòæw&÷WÀ¢—FVÓòæ6FVv÷'’À¢—FVÓòç&V6öâòöÆ–7•&V6öäÆ&VÂ†—FVÒç&V6öâ’¢çVÆÂÀ¢Òæf–ÇFW"„&ööÆVâ’æ¦ö–â‚r+rr“°¢&WGW&â7Vff—‚òG·—'Ò+rG·7Vff—‡Ö¢—#°¢Ò“°¢Æ—7E6V7F–öâ‚v6ö×&—6öâç6¶—VEF—FÆRrÂ6¶—VBÂ†—FVÒ’Óâ°¢6öç7BÆ&VÂÒ6÷W&6U&VfW&Væ6TÆ&VÂ†—FVÓòç6÷W&6T–Bóò—FVÓòæ–Bóò—FVÒÂ6÷W&6T'”–B“°¢&WGW&â—FVÓòç&V6öâòG¶Æ&VÇÒ+rG·öÆ–7•&V6öäÆ&VÂ†—FVÒç&V6öâ—Ö¢Æ&VÃ°¢Ò“°¢Æ—7E6V7F–öâ‚v6ö×&—6öâæw&÷W5F—FÆRrÂw&÷W2Â†—FVÒ’Óâ°¢6öç7B6÷W&6T–G2Ò—FVÓòç6÷W&6T–G2óò—FVÓòæÖVÖ&W'2óò—FVÓòç6÷W&6W2óòµÓ°¢6öç7B7F—fU6÷W&6T–G2Ò—FVÓòæ7F—fU6÷W&6T–G2óòµÓ°¢6öç7B÷F–öç2Ò—FVÓòæ÷F–öç2óò—FVÓòæ7F—fT÷F–öç2óòµÓ°¢&WGW&âB‚v6ö×&—6öâæw&÷W7VÖÖ'’rÂ°¢w&÷W¢—FVÓòæw&÷Wóò—FVÓòææÖRóòB‚v6öÖÖöâçVæ¶æ÷vâr’À¢ÖöFS¢öÆ–7”ÖöFTÆ&VÂ†—FVÓòæÖöFR’À¢6÷VçC¢6÷W&6T–G2æÆVæwF‚À¢7F—fS¢7F—fU6÷W&6T–G2æÆVæwF‚À¢÷F–öç3¢÷F–öç2æ¦ö–â‚rÂr’ÇÂB‚v6öÖÖöâçVæ¶æ÷vâr’À¢Ò“°¢Ò“°¢Æ—7E6V7F–öâ€¢v6ö×&—6öâæw&÷Wv&æ–æw5F—FÆRrÀ¢v&æ–æw2À¢†—FVÒ’Óâ—FVÓòæÖW76vP¢óò†—FVÓòæw&÷W ¢òG¶—FVÒæw&÷WÒ+rG·B‚v6ö×&—6öâæw&÷Wv&æ–ætfÆÆ&6²r—Ö ¢¢B‚v6ö×&—6öâæw&÷Wv&æ–ætfÆÆ&6²r’’À¢v†2×v&æ–ærrÀ¢“°¢–b€¢7W&W76VBæÆVæwF‚ÓÓÒ ¢bb6¶—VBæÆVæwF‚ÓÓÒ ¢bbw&÷W2æÆVæwF‚ÓÓÒ ¢bbv&æ–æw2æÆVæwF‚ÓÓÒ ¢’°¢6öçFVçBæVæD6†–ÆB†VÆVÖVçB‚wrÂ²FW‡C¢B‚v6ö×&—6öâææõöÆ–7”VffV7G2r’Ò’“°¢Ğ¢FWF–Ç2æVæD6†–ÆB†6öçFVçB“°¢&WGW&âFWF–Ç3°¢Ğ ¢&VæFW%'VÆW2‡6æ6†÷B’°¢6öç7BvRÒVÆVÖVçB‚vF—brÂ²6Æ74æÖS¢w7BÖFWgFööÇ2×vRrÒ“°¢vRæVæB€¢F†—2ç&VæFW%6æ6†÷E–6¶W"‚’À¢F†—2ç&VæFW%'VÆU6WGF–æw2‚’À¢F†—2ç&VæFW$6ö×&—6öåöÆ–7•6WGF–æw2‡6æ6†÷B’À¢“°¢6öç7BæÇ—6—2ÒæÇ—¦U6æ6†÷DFWF–ÆVB€¢6æ6†÷BÀ¢F†—2ç'VÆU6WGF–æw2À¢F†—2æ6ö×&—6öåöÆ–7•6WGF–æw2À¢“°¢6öç7Bf–æF–æw2ÒæÇ—6—3òæf–æF–æw2óòµÓ°¢vRæVæD6†–ÆB‡F†—2ç&VæFW$6ö×&—6öäæÇ—6—2‡6æ6†÷BÂæÇ—6—3òæ6ö×&—6öâ’“°¢6öç7B6÷VçG2Òf–æF–æw2ç&VGV6R‚‡&W7VÇBÂ—FVÒ’Óâ°¢–b„ö&¦V7Bç&÷F÷G—Ræ†4÷vå&÷W'G’æ6ÆÂ‡&W7VÇBÂ—FVÒç6WfW&—G’’’°¢&W7VÇE¶—FVÒç6WfW&—G•Ò³Ò°¢Ğ¢&WGW&â&W7VÇC°¢ÒÂ²7&—F–6Ã¢Âv&æ–æs¢Â–æfó¢Ò“° ¢6öç7B7VÖÖ'’ÒVÆVÖVçB‚vF—brÂ²6Æ74æÖS¢w7BÖFWgFööÇ2×'VÆR×7VÖÖ'’rÒ“°¢7VÖÖ'’æVæB€¢VÆVÖVçB‚w7ârÂ°¢6Æ74æÖS¢w7BÖFWgFööÇ2×'VÆRÖ6÷VçB6WfW&—G’Ö7&—F–6ÂrÀ¢FW‡C¢G·B‚w'VÆW2ç6WfW&—G’æ7&—F–6Âr—ÒG¶6÷VçG2æ7&—F–6ÇÖÀ¢Ò’À¢VÆVÖVçB‚w7ârÂ°¢6Æ74æÖS¢w7BÖFWgFööÇ2×'VÆRÖ6÷VçB6WfW&—G’×v&æ–ærrÀ¢FW‡C¢G·B‚w'VÆW2ç6WfW&—G’çv&æ–ærr—ÒG¶6÷VçG2çv&æ–æwÖÀ¢Ò’À¢VÆVÖVçB‚w7ârÂ°¢6Æ74æÖS¢w7BÖFWgFööÇ2×'VÆRÖ6÷VçB6WfW&—G’Ö–æfòrÀ¢FW‡C¢G·B‚w'VÆW2ç6WfW&—G’æ–æfòr—ÒG¶6÷VçG2æ–æf÷ÖÀ¢Ò’À¢“°¢vRæVæD6†–ÆB‡7VÖÖ'’“° ¢–b†f–æF–æw2æÆVæwF‚ÓÓÒ’°¢6öç7BV×G’ÒVÆVÖVçB‚vF—brÂ²6Æ74æÖS¢w7BÖFWgFööÇ2×'VÆRÖV×G’rÒ“°¢6öç7Bç”Væ&ÆVBÒö&¦V7BçfÇVW2‡F†—2ç'VÆU6WGF–æw2æVæ&ÆVB’ç6öÖR„&ööÆVâ“°¢V×G’æVæB€¢VÆVÖVçB‚v’rÂ°¢6Æ74æÖS¢ç”Væ&ÆV@¢òvf×6öÆ–BfÖ6—&6ÆRÖ6†V6²p¢¢vf×6öÆ–BfÖ6—&6ÆR×W6RrÀ¢Ò’À¢VÆVÖVçB‚w7G&öærrÂ°¢FW‡C¢B†ç”Væ&ÆVBòw'VÆW2æ6ÆVåF—FÆRr¢w'VÆW2æF—6&ÆVEF—FÆRr’À¢Ò’À¢VÆVÖVçB‚wrÂ°¢FW‡C¢B†ç”Væ&ÆVBòw'VÆW2æ6ÆVäFW67&—F–öâr¢w'VÆW2æF—6&ÆVDFW67&—F–öâr’À¢Ò’À¢“°¢vRæVæD6†–ÆB†V×G’“°¢&WGW&âvS°¢Ğ ¢6öç7BÆ—7BÒVÆVÖVçB‚vF—brÂ²6Æ74æÖS¢w7BÖFWgFööÇ2×'VÆRÖÆ—7BrÒ“°¢f÷"†6öç7B—FVÒöbf–æF–æw2’°¢6öç7B6&BÒVÆVÖVçB‚v'F–6ÆRrÂ°¢6Æ74æÖS¢7BÖFWgFööÇ2×'VÆRÖ6&B6WfW&—G’ÒG¶—FVÒç6WfW&—G—ÖÀ¢Ò“°¢6&BæFF6WBæf–æF–æt–BÒ—FVÒæ–C°¢6&BæFF6WBç'VÆT–BÒ—FVÒç'VÆT–C°¢6öç7B†VFW"ÒVÆVÖVçB‚v†VFW"r“°¢†VFW"æVæB€¢VÆVÖVçB‚w7ârÂ°¢6Æ74æÖS¢w7BÖFWgFööÇ2×'VÆR×6WfW&—G’rÀ¢FW‡C¢B†'VÆW2ç6WfW&—G’âG¶—FVÒç6WfW&—G—Ö’À¢Ò’À¢VÆVÖVçB‚w7G&öærrÂ²FW‡C¢—FVÒçF—FÆRÒ’À¢“°¢6&BæVæB††VFW"ÂVÆVÖVçB‚wrÂ²FW‡C¢—FVÒæÖW76vRÒ’“°¢–b†—FVÒæWf–FVæ6R’°¢6öç7BWf–FVæ6RÒVÆVÖVçB‚vFWF–Ç2rÂ²6Æ74æÖS¢w7BÖFWgFööÇ2×'VÆRÖWf–FVæ6RrÒ“°¢6öç7BWf–FVæ6UF—FÆRÒB†—FVÒç'VÆT–BÓÓÒwVæÖF6†VBp¢òw'VÆW2çVæÖF6†VBæWf–FVæ6Rp¢¢w'VÆW2æWf–FVæ6Rr“°¢6öç7BWf–FVæ6U7VÖÖ'’ÒVÆVÖVçB‚w7VÖÖ'’r“°¢Wf–FVæ6U7VÖÖ'’æVæD6†–ÆB†W‡Æ–æVEF—FÆR€¢Wf–FVæ6UF—FÆRÀ¢B‚w'VÆW2æWf–FVæ6TFW67&—F–öâr’À¢²F—FÆUFs¢w7ârÒÀ¢’“°¢Wf–FVæ6RæVæB€¢Wf–FVæ6U7VÖÖ'’À¢VÆVÖVçB‚w&RrÂ²FW‡C¢—FVÒæWf–FVæ6RÒ’À¢“°¢6&BæVæD6†–ÆB†Wf–FVæ6R“°¢Ğ¢6öç7B7F–öç2ÒVÆVÖVçB‚vF—brÂ²6Æ74æÖS¢w7BÖFWgFööÇ2×'VÆRÖ7F–öç2rÒ“°¢–b†—FVÒç6÷W&6T–G3òæÆVæwF‚â’°¢6öç7B6÷W&6W2ÒVÆVÖVçB‚v'WGFöârÂ°¢6Æ74æÖS¢vÖVçUö'WGFöârÀ¢FW‡C¢B‚v7F–öâçf–Wu&VÆFVE6÷W&6W2rÂ²6÷VçC¢—FVÒç6÷W&6T–G2æÆVæwF‚Ò’À¢G—S¢v'WGFöârÀ¢Ò“°¢6÷W&6W2æFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°¢F†—2æ÷VäW‡Æ÷&W$f÷$f–æF–ær‡6æ6†÷BÂ—FVÒÂw6÷W&6W2r“°¢Ò“°¢7F–öç2æVæD6†–ÆB‡6÷W&6W2“°¢Ğ¢–b†—FVÒæf–æÅ&ævW3òæÆVæwF‚â’°¢6öç7Bf–æÄWf–FVæ6RÒVÆVÖVçB‚v'WGFöârÂ°¢6Æ74æÖS¢vÖVçUö'WGFöârÀ¢FW‡C¢B‚v7F–öâçf–Wtf–æÄWf–FVæ6Rr’À¢G—S¢v'WGFöârÀ¢Ò“°¢f–æÄWf–FVæ6RæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°¢F†—2æ÷VäW‡Æ÷&W$f÷$f–æF–ær‡6æ6†÷BÂ—FVÒÂvf–æÂr“°¢Ò“°¢7F–öç2æVæD6†–ÆB†f–æÄWf–FVæ6R“°¢Ğ¢–b†7F–öç2æ6†–ÆDVÆVÖVçD6÷VçBâ’6&BæVæD6†–ÆB†7F–öç2“°¢Æ—7BæVæD6†–ÆB†6&B“°¢Ğ¢vRæVæD6†–ÆB†Æ—7B“°¢&WGW&âvS°¢Ğ ¢&VæFW%6V&6‚‡6æ6†÷B’°¢6öç7BvRÒVÆVÖVçB‚vF—brÂ²6Æ74æÖS¢w7BÖFWgFööÇ2×vRrÒ“°¢vRæVæD6†–ÆB‡F†—2ç&VæFW%6æ6†÷E–6¶W"‚’“°¢6öç7B6öçG&öÇ2ÒVÆVÖVçB‚vF—brÂ²6Æ74æÖS¢w7BÖFWgFööÇ2×6V&6‚Ö6öçG&öÇ2rÒ“°¢6öç7B–çWBÒVÆVÖVçB‚v–çWBr“°¢–çWBçG—RÒw6V&6‚s°¢–çWBçÆ6V†öÆFW"ÒB‚w6V&6‚çÆ6V†öÆFW"r“°¢6öç7B&VvW„Æ&VÂÒVÆVÖVçB‚vÆ&VÂr“°¢6öç7B&VvW‚ÒVÆVÖVçB‚v–çWBr“°¢&VvW‚çG—RÒv6†V6¶&÷‚s°¢&VvW„Æ&VÂæVæB‡&VvW‚ÂFö7VÖVçBæ7&VFUFW‡DæöFR‡B‚w6V&6‚ç&VvW‚r’’“°¢6öç7B66TÆ&VÂÒVÆVÖVçB‚vÆ&VÂr“°¢6öç7B66U6Vç6—F—fRÒVÆVÖVçB‚v–çWBr“°¢66U6Vç6—F—fRçG—RÒv6†V6¶&÷‚s°¢66TÆ&VÂæVæB†66U6Vç6—F—fRÂFö7VÖVçBæ7&VFUFW‡DæöFR‡B‚w6V&6‚æÖF6„66Rr’’“°¢6öç7B÷F–öç2ÒVÆVÖVçB‚vF—brÂ²6Æ74æÖS¢w7BÖFWgFööÇ2×6V&6‚Ö÷F–öç2rÒ“°¢÷F–öç2æVæB€¢W‡Æ–æVEF—FÆR€¢B‚w6V&6‚æ÷F–öç5F—FÆRr’À¢B‚w6V&6‚æ÷F–öç4FW67&—F–öâr’À¢²6Æ74æÖS¢w7BÖFWgFööÇ2×6V&6‚Ö÷F–öç2×F—FÆRrÒÀ¢’À¢&VvW„Æ&VÂÀ¢66TÆ&VÂÀ¢“°¢6öçG&öÇ2æVæB†–çWBÂ÷F–öç2“°¢6öç7B7FGW2ÒVÆVÖVçB‚wrÂ²6Æ74æÖS¢w7BÖFWgFööÇ2×6V&6‚×7FGW2rÒ“°¢6öç7B&W7VÇG2ÒVÆVÖVçB‚vF—brÂ²6Æ74æÖS¢w7BÖFWgFööÇ2×6V&6‚×&W7VÇG2rÒ“° ¢6öç7B'VâÒ‚’Óâ°¢&W7VÇG2ç&WÆ6T6†–ÆG&Vâ‚“°¢7FGW2çFW‡D6öçFVçBÒrs°¢–b‚–çWBçfÇVR’&WGW&ã°¢G'’°¢6öç7BÖF6†W2Ò6V&6…6æ6†÷B‡6æ6†÷BÂ–çWBçfÇVRÂ°¢&VvWƒ¢&VvW‚æ6†V6¶VBÀ¢66U6Vç6—F—fS¢66U6Vç6—F—fRæ6†V6¶VBÀ¢Ò“°¢7FGW2çFW‡D6öçFVçBÒÖF6†W2æÆVæwF‚ÓÓÒ# ¢òB‚w6V&6‚æÖF6†W4Æ–Ö—FVBrÂ²6÷VçC¢ÖF6†W2æÆVæwF‚Ò¢¢B‚w6V&6‚æÖF6†W2rÂ²6÷VçC¢ÖF6†W2æÆVæwF‚Ò“°¢f÷"†6öç7BÖF6‚öbÖF6†W2’°¢6öç7B—FVÒÒVÆVÖVçB‚v'WGFöârÂ²6Æ74æÖS¢w7BÖFWgFööÇ2×6V&6‚×&W7VÇBrÂG—S¢v'WGFöârÒ“°¢—FVÒæVæB€¢VÆVÖVçB‚w7G&öærrÂ²FW‡C¢ÖF6‚ç6÷W&6TÆ&VÂÒ’À¢VÆVÖVçB‚w7ârÂ²FW‡C¢ÖF6‚ç6æ—WBÒ’À¢“°¢—FVÒæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°¢F†—2æ7F—fUF"ÒvW‡Æ÷&W"s°¢Æö6Å7F÷&vRç6WD—FVÒ†Gµ5Dõ$tUõ$Td•‡ÖÆ7B×F&ÂF†—2æ7F—fUF"“°¢F†—2ç&VæFW"‚“°¢6öç7B6÷W&6RÒ²ââçF†—2çv–æF÷rçVW'•6VÆV7F÷$ÆÂ‚rç7BÖFWgFööÇ2×6÷W&6Rr•Ğ¢æf–æB‚†VçG'’’ÓâVçG'’æFF6WBç6÷W&6T–BÓÓÒÖF6‚ç6÷W&6T–B“°¢–b‚6÷W&6R’&WGW&ã°¢6÷W&6Ræ6Æ÷6W7B‚rç7BÖFWgFööÇ2×6÷W&6RÖw&÷Wr“òç6WDGG&–'WFR‚v÷VârÂrr“°¢6÷W&6Ræ÷VâÒG'VS°¢6÷W&6Rç67&öÆÄ–çFõf–Wr‡²&Æö6³¢v6VçFW"rÒ“°¢6÷W&6Ræ6Æ74Æ—7BæFB‚w6V&6‚Öfö7W2r“°¢6WEF–ÖV÷WB‚‚’Óâ6÷W&6Sòæ6Æ74Æ—7Bç&VÖ÷fR‚w6V&6‚Öfö7W2r’ÂS“°¢Ò“°¢&W7VÇG2æVæD6†–ÆB†—FVÒ“°¢Ğ¢Ò6F6‚†W'&÷"’°¢7FGW2çFW‡D6öçFVçBÒB‚w6V&6‚æ–çfÆ–E&VvW‚rÂ²ÖW76vS¢W'&÷"æÖW76vRÒ“°¢Ğ¢Ó°¢–çWBæFDWfVçDÆ—7FVæW"‚v–çWBrÂ'Vâ“°¢&VvW‚æFDWfVçDÆ—7FVæW"‚v6†ævRrÂ'Vâ“°¢66U6Vç6—F—fRæFDWfVçDÆ—7FVæW"‚v6†ævRrÂ'Vâ“°¢vRæVæB†6öçG&öÇ2Â7FGW2Â&W7VÇG2“°¢&WGW&âvS°¢Ğ§Ğ