import {
    attributionDisplayLabel,
    generationTypeDisplayLabel,
    promptTypeDisplayLabel,
    sourceDisplayLabel,
    t,
} from './i18n.js';
import { searchSnapshot, serializeSnapshot } from './model.js';
import { analyzeSnapshot } from './rules.js';
import { inferPanelThemeFromTextColor } from './theme.js';

const STORAGE_PREFIX = 'st-devtools:';
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

    async open() {
        if (!this.root) {
            this.build();
        }
        this.syncOpaqueTheme();
        this.root.hidden = false;
        await this.refresh();
        this.window.focus();
    }

    close() {
        if (this.root) {
            this.root.hidden = true;
        }
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
            button.setAttribute('role', 'tab');
            button.addEventListener('click', () => this.selectTab(id));
            tabList.appendChild(button);
        }

        this.content = element('main', { className: 'st-devtools-content' });
        this.window.append(header, tabList, this.content);
        this.root.appendChild(this.window);
        document.body.appendChild(this.root);
        this.syncOpaqueTheme();

        this.root.addEventListener('pointerdown', (event) => {
            if (event.target === this.root) this.close();
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !this.root.hidden) this.close();
        });
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

    selectTab(id) {
        this.activeTab = TABS.some(([tabId]) => tabId === id) ? id : 'explorer';
        localStorage.setItem(`${STORAGE_PREFIX}last-tab`, this.activeTab);
        this.render();
    }

    render() {
        if (!this.content) return;
        this.syncOpaqueTheme();
        for (const button of this.window.querySelectorAll('.st-devtools-tab')) {
            const active = button.dataset.tab === this.activeTab;
            button.classList.toggle('active', active);
            button.setAttribute('aria-selected', String(active));
        }
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

        for (const source of snapshot.sources) {
            const details = element('details', { className: 'st-devtools-source' });
            if (source.type === 'final') details.open = true;
            details.style.setProperty('--source-color', source.color);
            const summary = element('summary');
            const name = element('span', { className: 'st-devtools-source-name', text: sourceDisplayLabel(source) });
            const badges = element('span', { className: 'st-devtools-badges' });
            badges.append(
                element('span', {
                    className: 'st-devtools-badge',
                    text: t('snapshot.tokens', { count: source.tokenCount }),
                }),
                element('span', {
                    className: `st-devtools-badge attribution-${source.attribution}`,
                    text: attributionDisplayLabel(source.attribution),
                }),
            );
            summary.append(name, badges);
            const pre = element('pre', { text: source.content });
            details.append(summary, pre);
            sourceList.appendChild(details);
        }
        page.appendChild(sourceList);
        return page;
    }

    renderTimeline() {
        const page = element('div', { className: 'st-devtools-page' });
        const toolbar = element('div', { className: 'st-devtools-toolbar' });
        toolbar.appendChild(element('span', {
            text: t('snapshot.retained', { count: this.timeline.length }),
        }));
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

        if (this.timeline.length === 0) {
            page.appendChild(this.renderEmpty());
            return page;
        }

        const list = element('div', { className: 'st-devtools-timeline' });
        for (const snapshot of [...this.timeline].reverse()) {
            const button = element('button', { className: 'st-devtools-timeline-item', type: 'button' });
            button.classList.toggle('active', snapshot.id === this.selectedId);
            const heading = element('strong', { text: formatTimestamp(snapshot.timestamp) });
            const metadata = element('span', {
                text: `${snapshot.api} · ${snapshot.model ?? t('timeline.unknownModel')} · ${t('snapshot.tokens', { count: snapshot.stats.totalTokens })}`,
            });
            const lore = element('small', {
                text: `${promptTypeDisplayLabel(snapshot.promptType)} · ${t('timeline.loreCount', { count: snapshot.lorebookEntries.length })} · ${generationTypeDisplayLabel(snapshot.generationType)}`,
            });
            button.append(heading, metadata, lore);
            button.addEventListener('click', () => {
                this.selectedId = snapshot.id;
                this.selectTab('explorer');
            });
            list.appendChild(button);
        }
        page.appendChild(list);
        return page;
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
        const renderDiff = () => {
            const base = this.timeline.find((snapshot) => snapshot.id === baseSelect.select.value);
            const compare = this.timeline.find((snapshot) => snapshot.id === compareSelect.select.value);
            diffOutput.replaceChildren();
            if (!base || !compare) return;

            const DiffMatchPatch = globalThis.SillyTavern?.libs?.DiffMatchPatch;
            if (!DiffMatchPatch) {
                diffOutput.textContent = `${base.finalText}\n\n--- ${t('diff.compare')} ---\n\n${compare.finalText}`;
                return;
            }
            const dmp = new DiffMatchPatch();
            dmp.Diff_Timeout = 1;
            const changes = dmp.diff_main(base.finalText, compare.finalText);
            dmp.diff_cleanupSemantic(changes);
            for (const [operation, text] of changes) {
                const span = element('span', { text });
                span.className = operation === 1 ? 'diff-added' : operation === -1 ? 'diff-removed' : 'diff-equal';
                diffOutput.appendChild(span);
            }
        };
        baseSelect.select.addEventListener('change', renderDiff);
        compareSelect.select.addEventListener('change', renderDiff);
        page.append(selectors, diffOutput);
        renderDiff();
        return page;
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
        const stats = element('div', { className: 'st-devtools-stats' });
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
        page.append(stats, toolbar, payload);
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

    renderRules(snapshot) {
        const page = element('div', { className: 'st-devtools-page' });
        page.appendChild(this.renderSnapshotPicker());
        const findings = analyzeSnapshot(snapshot);
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
            empty.append(
                element('i', { className: 'fa-solid fa-circle-check' }),
                element('strong', { text: t('rules.cleanTitle') }),
                element('p', { text: t('rules.cleanDescription') }),
            );
            page.appendChild(empty);
            return page;
        }

        const list = element('div', { className: 'st-devtools-rule-list' });
        for (const item of findings) {
            const card = element('article', {
                className: `st-devtools-rule-card severity-${item.severity}`,
            });
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
