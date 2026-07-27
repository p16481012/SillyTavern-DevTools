import {
    attributionDisplayLabel,
    generationTypeDisplayLabel,
    promptTypeDisplayLabel,
    sourceDisplayLabel,
    t,
} from './i18n.js';
import { serializeTimelineDiagnostics } from './diagnostics.js';
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
    analyzeSnapshot,
    normalizeRuleSettings,
} from './rules.js';
import { inferPanelThemeFromTextColor } from './theme.js';

const STORAGE_PREFIX = 'st-devtools:';
const RULE_SETTINGS_KEY = `${STORAGE_PREFIX}rule-settings:v1`;
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
        this.previouslyFocused = null;
        this.capture.addEventListener('snapshot', (event) => this.onSnapshot(event.detail));
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
        if (snapshot.chatId !== this.currentChatId()) return;
        this.timeline = [...this.timeline.filter((item) => item.id !== snapshot.id), snapshot]
            .sort((left, right) => left.timestamp - right.timestamp);
        this.selectedId = snapshot.id;
        if (this.root && !this.root.hidden) this.render();
    }

    async refresh() {
        this.timeline = await this.store.getTimeline(this.currentChatId());
        if (!this.timeline.some((snapshot) => snapshot.id === this.selectedId)) {
            this.selectedId = this.timeline.at(-1)?.id ?? null;
        }
        this.render();
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
        return [...this.window.querySelectorAll(
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
            this.close();
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
        if (!this.window.contains(active)) {
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
        localStorage.setItem(`${STORAGE_PREFIX}last-tab`, this.activeTab);
        this.render();
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

    renderEmpty() {
        const empty = element('div', { className: 'st-devtools-empty' });
        empty.append(
            element('i', { className: 'fa-solid fa-wave-square' }),
            element('h3', { text: t('empty.title') }),
            element('p', { text: t('empty.description') }),
        );
        return empty;
    }

    renderSnapshotPicker(labelText = t('snapshot.label')) {
        const wrapper = element('label', { className: 'st-devtools-picker' });
        wrapper.appendChild(element('span', { text: labelText }));
        const select = element('select');
        for (const snapshot of [...this.timeline].reverse()) {
            const option = element('option', {
                text: `${formatTimestamp(snapshot.timestamp)} · ${snapshot.api} · ${t('snapshot.tokens', { count: snapshot.stats.totalTokens })}`,
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
        page.appendChild(this.renderSnapshotPicker());
        const sourceList = element('div', { className: 'st-devtools-source-list' });
        const sourceById = new Map(snapshot.sources.map((source) => [source.id, source]));

        for (const source of snapshot.sources) {
            const details = element('details', { className: 'st-devtools-source' });
            if (source.type === 'final') details.open = true;
            details.dataset.sourceId = source.id;
            details.dataset.sourceType = source.type;
            details.style.setProperty('--source-color', source.color);
            const summary = element('summary');
            const name = element('span', { className: 'st-devtools-source-name', text: sourceDisplayLabel(source) });
            const badges = element('span', { className: 'st-devtools-badges' });
            badges.append(
                element('span', {
                    className: 'st-devtools-badge',
                    text: t(
                        source.type === 'multimodal'
                            ? 'snapshot.placeholderTokens'
                            : 'snapshot.tokens',
                        { count: source.tokenCount },
                    ),
                }),
                element('span', {
                    className: `st-devtools-badge attribution-${source.attribution}`,
                    text: attributionDisplayLabel(source.attribution),
                }),
            );
            if (source.ranges?.length) {
                badges.appendChild(element('span', {
                    className: 'st-devtools-badge',
                    text: t('capture.rangeCount', { count: source.ranges.length }),
                }));
            }
            summary.append(name, badges);
            if (source.type !== 'final' && source.ranges?.length) {
                const jump = element('button', {
                    className: 'st-devtools-range-jump',
                    text: '↗',
                    title: t('action.jumpToFinal'),
                    type: 'button',
                });
                jump.setAttribute('aria-label', `${sourceDisplayLabel(source)}: ${t('action.jumpToFinal')}`);
                jump.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    this.jumpToFinalRange(source.id);
                });
                summary.appendChild(jump);
            }
            const pre = source.type === 'final'
                ? this.renderMappedFinalPrompt(source.content, snapshot.sources, sourceById)
                : element('pre', { text: source.content });
            details.append(summary, pre);
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
        page.appendChild(sourceList);
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
        const range = [...this.window.querySelectorAll('.st-devtools-final-range')]
            .find((node) => this.rangeSourceIds(node).includes(sourceId));
        if (!range) return;
        this.highlightSourceMapping([sourceId]);
        range.scrollIntoView({ block: 'center', behavior: 'smooth' });
        range.focus({ preventScroll: true });
    }

    jumpToSourceCard(sourceId) {
        const card = [...this.window.querySelectorAll('.st-devtools-source')]
            .find((node) => node.dataset.sourceId === sourceId);
        if (!card) return;
        card.open = true;
        this.highlightSourceMapping([sourceId]);
        card.scrollIntoView({ block: 'center', behavior: 'smooth' });
        card.querySelector('summary')?.focus({ preventScroll: true });
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
        localStorage.setItem(`${STORAGE_PREFIX}last-tab`, this.activeTab);
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
            card.open = true;
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
        const matches = this.highlightFinalEvidence(finalRanges);
        const first = matches[0];
        if (first) {
            first.scrollIntoView({ block: 'center', behavior: 'smooth' });
            first.focus({ preventScroll: true });
            return;
        }
        const finalCard = [...this.window.querySelectorAll('.st-devtools-source')]
            .find((node) => node.dataset.sourceType === 'final');
        if (!finalCard) return;
        finalCard.open = true;
        finalCard.classList.add('rule-focus');
        finalCard.scrollIntoView({ block: 'center', behavior: 'smooth' });
        finalCard.querySelector('summary')?.focus({ preventScroll: true });
    }

    renderTimeline() {
        const page = element('div', { className: 'st-devtools-page' });
        const analyses = buildTimelineAnalysis(this.timeline, { includeSourceChanges: false });
        const toolbar = element('div', { className: 'st-devtools-toolbar' });
        toolbar.appendChild(element('span', {
            text: t('snapshot.retained', { count: this.timeline.length }),
        }));
        toolbar.append(
            this.renderTimelineDiagnosticButton('json'),
            this.renderTimelineDiagnosticButton('markdown'),
        );
        const clear = element('button', { className: 'menu_button', text: t('action.clearTimeline'), type: 'button' });
        clear.disabled = this.timeline.length === 0;
        clear.addEventListener('click', async () => {
            if (!confirm(t('timeline.deleteConfirm'))) return;
            await this.store.clearTimeline(this.currentChatId());
            this.timeline = [];
            this.selectedId = null;
            this.render();
        });
        toolbar.appendChild(clear);
        page.appendChild(toolbar);
        page.appendChild(element('small', {
            className: 'st-devtools-timeline-diagnostic-note',
            text: t('timeline.diagnosticDescription'),
        }));

        if (this.timeline.length === 0) {
            page.appendChild(this.renderEmpty());
            return page;
        }

        page.appendChild(this.renderGrowthChart(analyses));
        const list = element('div', { className: 'st-devtools-timeline' });
        for (const analysis of [...analyses].reverse()) {
            const { snapshot, previous, tokenDelta, lore } = analysis;
            const entry = element('article', { className: 'st-devtools-timeline-entry' });
            entry.classList.toggle('active', snapshot.id === this.selectedId);
            const button = element('button', { className: 'st-devtools-timeline-item', type: 'button' });
            const heading = element('strong', { text: formatTimestamp(snapshot.timestamp) });
            const metadata = element('span', {
                text: `${snapshot.api} · ${snapshot.model ?? t('timeline.unknownModel')} · ${t('snapshot.tokens', { count: snapshot.stats.totalTokens })}`,
            });
            const loreMetadata = element('small', {
                text: `${promptTypeDisplayLabel(snapshot.promptType)} · ${t('timeline.loreCount', { count: snapshot.lorebookEntries?.length ?? 0 })} · ${generationTypeDisplayLabel(snapshot.generationType)}`,
            });
            const changes = element('span', { className: 'st-devtools-timeline-changes' });
            changes.appendChild(element('span', {
                className: `st-devtools-change-pill${tokenDelta > 0 ? ' increased' : tokenDelta < 0 ? ' decreased' : ''}`,
                text: previous
                    ? t('timeline.tokenDelta', { delta: formatDelta(tokenDelta) })
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
                const deleted = await this.store.deleteSnapshot(this.currentChatId(), snapshot.id);
                if (!deleted) return;
                this.timeline = this.timeline.filter((item) => item.id !== snapshot.id);
                if (this.selectedId === snapshot.id) {
                    this.selectedId = this.timeline.at(-1)?.id ?? null;
                }
                this.render();
            });
            entry.append(button, remove);

            if (
                snapshot.id === this.selectedId
                && (lore.activated.length || lore.removed.length)
            ) {
                entry.appendChild(this.renderLoreChangeList(lore));
            }
            list.appendChild(entry);
        }
        page.appendChild(list);
        return page;
    }

    renderTimelineDiagnosticButton(format) {
        const label = format === 'markdown' ? 'Markdown' : format.toUpperCase();
        const button = element('button', {
            className: 'menu_button',
            text: t('action.exportDiagnostics', { format: label }),
            type: 'button',
        });
        button.disabled = this.timeline.length === 0;
        button.addEventListener('click', () => {
            const extension = format === 'markdown' ? 'md' : format;
            const mime = format === 'json' ? 'application/json' : 'text/markdown';
            const date = new Date().toISOString().replaceAll(':', '-');
            downloadText(
                `st-devtools-timeline-diagnostics-${date}.${extension}`,
                serializeTimelineDiagnostics(this.timeline, format),
                mime,
            );
        });
        return button;
    }

    renderGrowthChart(analyses) {
        const figure = element('figure', { className: 'st-devtools-growth' });
        const values = analyses.map(({ snapshot }) => Number(snapshot.stats?.totalTokens) || 0);
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

        const caption = element('figcaption');
        const captionText = element('span');
        captionText.append(
            element('strong', { text: t('timeline.growthTitle') }),
            element('small', {
                text: t('timeline.growthDescription', { count: analyses.length }),
            }),
        );
        caption.append(
            captionText,
            element('span', {
                className: 'st-devtools-growth-maximum',
                text: t('timeline.maximumTokens', { count: maximum }),
            }),
        );

        const svg = svgElement('svg', {
            viewBox: `0 0 ${width} ${height}`,
            role: 'img',
            'aria-label': t('timeline.growthDescription', { count: analyses.length }),
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
        points.forEach(({ x, y }, index) => {
            const snapshot = analyses[index].snapshot;
            const label = `${formatTimestamp(snapshot.timestamp)} · ${t('snapshot.tokens', { count: values[index] })}`;
            const point = svgElement('circle', {
                class: 'st-devtools-growth-point',
                cx: x,
                cy: y,
                r: 4,
                tabindex: 0,
                role: 'button',
                'aria-label': label,
                'aria-current': snapshot.id === this.selectedId ? 'true' : 'false',
                'data-point-index': index,
            });
            point.appendChild(svgElement('title'));
            point.firstChild.textContent = label;
            const openSnapshot = () => {
                this.selectedId = snapshot.id;
                this.selectTab('explorer');
            };
            point.addEventListener('click', openSnapshot);
            point.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openSnapshot();
                    return;
                }
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                let nextIndex = index;
                if (event.key === 'ArrowLeft') nextIndex = Math.max(0, index - 1);
                if (event.key === 'ArrowRight') nextIndex = Math.min(points.length - 1, index + 1);
                if (event.key === 'Home') nextIndex = 0;
                if (event.key === 'End') nextIndex = points.length - 1;
                svg.querySelector(`[data-point-index="${nextIndex}"]`)?.focus();
            });
            svg.appendChild(point);
        });
        figure.append(caption, svg);
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
            page.appendChild(element('p', { text: t('diff.minimum') }));
            return page;
        }

        const selectors = element('div', { className: 'st-devtools-diff-selectors' });
        const baseSelect = this.createTimelineSelect(this.timeline.at(-2).id, t('diff.base'));
        const compareSelect = this.createTimelineSelect(this.selectedSnapshot()?.id ?? this.timeline.at(-1).id, t('diff.compare'));
        selectors.append(baseSelect.wrapper, compareSelect.wrapper);
        const diffOutput = element('pre', { className: 'st-devtools-diff-output' });
        const sourceSection = element('section', { className: 'st-devtools-diff-section' });
        const loreSection = element('section', { className: 'st-devtools-diff-section' });
        const renderDiff = () => {
            const base = this.timeline.find((snapshot) => snapshot.id === baseSelect.select.value);
            const compare = this.timeline.find((snapshot) => snapshot.id === compareSelect.select.value);
            diffOutput.replaceChildren();
            sourceSection.replaceChildren();
            loreSection.replaceChildren();
            if (!base || !compare) return;

            this.appendDiffMarkup(diffOutput, base.finalText, compare.finalText);
            this.renderSourceChanges(sourceSection, base, compare);
            this.renderLoreChanges(loreSection, base, compare);
        };
        baseSelect.select.addEventListener('change', renderDiff);
        compareSelect.select.addEventListener('change', renderDiff);
        page.append(selectors, diffOutput, sourceSection, loreSection);
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
        section.appendChild(element('h3', { text: t('diff.sourceChanges') }));
        const changes = compareSnapshotSources(base, compare);
        if (!changes.length) {
            section.appendChild(element('p', { text: t('diff.noSourceChanges') }));
            return;
        }

        const list = element('div', { className: 'st-devtools-source-change-list' });
        for (const change of changes) {
            const card = element('article', {
                className: `st-devtools-source-change status-${change.status}`,
            });
            const header = element('header');
            header.append(
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
            card.append(header, content);
            list.appendChild(card);
        }
        section.appendChild(list);
    }

    renderLoreChanges(section, base, compare) {
        section.appendChild(element('h3', { text: t('diff.loreChanges') }));
        const changes = compareLoreEntries(
            base.lorebookEntries ?? [],
            compare.lorebookEntries ?? [],
        );
        if (!changes.activated.length && !changes.removed.length) {
            section.appendChild(element('p', { text: t('diff.noLoreChanges') }));
            return;
        }
        section.appendChild(this.renderLoreChangeList(changes));
    }

    createTimelineSelect(selectedId, labelText) {
        const wrapper = element('label', { className: 'st-devtools-picker' });
        wrapper.appendChild(element('span', { text: labelText }));
        const select = element('select');
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
        const captureCard = element('section', { className: 'st-devtools-capture-boundary' });
        const captureHeader = element('header');
        captureHeader.append(
            element('strong', { text: t('capture.title') }),
            element('span', {
                className: `st-devtools-capture-stage${capture.fallback ? ' fallback' : ''}`,
                text: t(`capture.stage.${capture.stage ?? 'prompt-ready'}`),
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
        captureCard.append(
            captureHeader,
            element('p', { text: captureDescription }),
            element('small', {
                text: t('capture.event', { event: capture.eventName ?? t('common.unknown') }),
            }),
            element('small', {
                text: t('capture.correlationDescription', {
                    method: t(`capture.correlation.${capture.correlationMethod ?? 'unknown'}`),
                }),
            }),
        );
        if (snapshot.request?.redactedPaths?.length) {
            captureCard.appendChild(element('small', {
                className: 'st-devtools-capture-redacted',
                text: t('capture.redacted', { count: snapshot.request.redactedPaths.length }),
            }));
        }
        if (snapshot.request?.omittedMediaPaths?.length) {
            captureCard.appendChild(element('small', {
                className: 'st-devtools-capture-redacted',
                text: t('capture.mediaOmitted', { count: snapshot.request.omittedMediaPaths.length }),
            }));
        }

        const stats = element('div', { className: 'st-devtools-stats' });
        const structured = snapshot.stats?.structured ?? {};
        const statValues = [
            [t('stat.promptTokens'), snapshot.stats.totalTokens],
            [t('stat.contextLimit'), snapshot.stats.maxContext ?? t('common.unknown')],
            [t('stat.reservedOutput'), snapshot.stats.maxOutput ?? t('common.unknown')],
            [t('stat.remaining'), snapshot.stats.remainingContext ?? t('common.unknown')],
            [t('stat.contextUsage'), snapshot.stats.contextUsage == null ? t('common.unknown') : `${(snapshot.stats.contextUsage * 100).toFixed(1)}%`],
            [
                t('stat.largestSource'),
                [...snapshot.sources]
                    .filter((source) => source.type !== 'final')
                    .sort((a, b) => b.tokenCount - a.tokenCount)[0],
            ],
            [t('stat.toolSchemas'), structured.toolSchemas ?? 0],
            [t('stat.toolCalls'), structured.toolCalls ?? 0],
            [t('stat.toolResults'), structured.toolResults ?? 0],
            [t('stat.multimodalParts'), structured.multimodalParts ?? 0],
        ];
        for (const [label, value] of statValues) {
            const card = element('div', { className: 'st-devtools-stat' });
            const displayValue = typeof value === 'object' && value
                ? sourceDisplayLabel(value)
                : value ?? t('common.unknown');
            card.append(element('small', { text: label }), element('strong', { text: displayValue }));
            stats.appendChild(card);
        }

        const toolbar = element('div', { className: 'st-devtools-toolbar' });
        const copy = element('button', { className: 'menu_button', text: t('action.copy'), type: 'button' });
        copy.addEventListener('click', async () => {
            await copyText(snapshot.finalText);
            globalThis.toastr?.info?.(t('action.promptCopied'), 'ST DevTools');
        });
        toolbar.append(copy, this.renderExportButton(snapshot, 'json'), this.renderExportButton(snapshot, 'txt'), this.renderExportButton(snapshot, 'markdown'));

        const payload = element('pre', {
            className: 'st-devtools-context-payload',
            text: snapshot.promptType === 'chat-completion'
                ? JSON.stringify(snapshot.payload, null, 2)
                : snapshot.finalText,
        });
        const settingsDetails = element('details', { className: 'st-devtools-context-details' });
        settingsDetails.append(
            element('summary', { text: t('context.requestSettings') }),
            element('pre', {
                text: JSON.stringify(snapshot.request?.settings ?? {}, null, 2),
            }),
        );
        const requestDetails = element('details', { className: 'st-devtools-context-details' });
        requestDetails.append(
            element('summary', { text: t('context.requestBody') }),
            snapshot.request?.body
                ? element('pre', { text: JSON.stringify(snapshot.request.body, null, 2) })
                : element('p', { text: t('context.notCaptured') }),
        );
        const payloadHeading = element('strong', {
            className: 'st-devtools-context-heading',
            text: t('context.promptPayload'),
        });
        page.append(
            captureCard,
            stats,
            toolbar,
            settingsDetails,
            requestDetails,
            payloadHeading,
            payload,
        );
        return page;
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
            const mime = format === 'json' ? 'application/json' : 'text/plain';
            downloadText(`st-devtools-${snapshot.id}.${extension}`, serializeSnapshot(snapshot, format), mime);
        });
        return button;
    }

    renderRuleSettings() {
        const details = element('details', { className: 'st-devtools-rule-settings' });
        details.open = this.ruleSettingsOpen;
        details.addEventListener('toggle', () => {
            this.ruleSettingsOpen = details.open;
        });
        details.append(
            element('summary', { text: t('rules.settingsTitle') }),
            element('p', { text: t('rules.settingsDescription') }),
        );

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

    renderRules(snapshot) {
        const page = element('div', { className: 'st-devtools-page' });
        page.append(this.renderSnapshotPicker(), this.renderRuleSettings());
        const findings = analyzeSnapshot(snapshot, this.ruleSettings);
        const counts = findings.reduce((result, item) => {
            result[item.severity] += 1;
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
                element('p', {
                    text: t(anyEnabled ? 'rules.cleanDescription' : 'rules.disabledDescription'),
                }),
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
            card.append(header, element('p', { text: item.message }));
            if (item.evidence) {
                const evidence = element('details', { className: 'st-devtools-rule-evidence' });
                evidence.append(
                    element('summary', { text: t('rules.evidence') }),
                    element('pre', { text: item.evidence }),
                );
                card.appendChild(evidence);
            }
            const actions = element('div', { className: 'st-devtools-rule-actions' });
            if (item.sourceIds.length > 0) {
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
            const finalEvidence = element('button', {
                className: 'menu_button',
                text: t('action.viewFinalEvidence'),
                type: 'button',
            });
            finalEvidence.addEventListener('click', () => {
                this.openExplorerForFinding(snapshot, item, 'final');
            });
            actions.appendChild(finalEvidence);
            card.appendChild(actions);
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
        const regexLabel = element('label');
        const regex = element('input');
        regex.type = 'checkbox';
        regexLabel.append(regex, document.createTextNode(` ${t('search.regex')}`));
        const caseLabel = element('label');
        const caseSensitive = element('input');
        caseSensitive.type = 'checkbox';
        caseLabel.append(caseSensitive, document.createTextNode(` ${t('search.matchCase')}`));
        controls.append(input, regexLabel, caseLabel);
        const status = element('p', { className: 'st-devtools-search-status' });
        const results = element('div', { className: 'st-devtools-search-results' });

        const run = () => {
            results.replaceChildren();
            status.textContent = '';
            if (!input.value) return;
            try {
                const matches = searchSnapshot(snapshot, input.value, {
                    regex: regex.checked,
                    caseSensitive: caseSensitive.checked,
                });
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
                        localStorage.setItem(`${STORAGE_PREFIX}last-tab`, this.activeTab);
                        this.render();
                        const source = this.window.querySelectorAll('.st-devtools-source');
                        const sourceIndex = snapshot.sources.findIndex((entry) => entry.id === match.sourceId);
                        if (sourceIndex >= 0) {
                            source[sourceIndex].open = true;
                            source[sourceIndex].scrollIntoView({ block: 'center' });
                            source[sourceIndex].classList.add('search-focus');
                            setTimeout(() => source[sourceIndex]?.classList.remove('search-focus'), 1500);
                        }
                    });
                    results.appendChild(item);
                }
            } catch (error) {
                status.textContent = t('search.invalidRegex', { message: error.message });
            }
        };
        input.addEventListener('input', run);
        regex.addEventListener('change', run);
        caseSensitive.addEventListener('change', run);
        page.append(controls, status, results);
        return page;
    }
}
