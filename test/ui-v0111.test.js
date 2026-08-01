import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { CaptureController } from '../src/capture.js';
import { DevToolsWindow } from '../src/ui.js';

const UI_SOURCE_URL = new URL('../src/ui.js', import.meta.url);
const I18N_SOURCE_URL = new URL('../src/i18n.js', import.meta.url);

const EXPECTED_TABS = [
    'context',
    'diff',
    'explorer',
    'rules',
    'search',
    'timeline',
];

const UI_CAPTURE_STATES = [
    'waiting',
    'capturing',
    'processing',
    'saved',
    'failed',
    'excluded-semantic',
    'skipped-safety',
];

function memoryLocalStorage() {
    const values = new Map();
    return {
        get length() {
            return values.size;
        },
        key(index) {
            return [...values.keys()][index] ?? null;
        },
        getItem(key) {
            return values.get(key) ?? null;
        },
        setItem(key, value) {
            values.set(key, String(value));
        },
        removeItem(key) {
            values.delete(key);
        },
    };
}

class CaptureEventHarness {
    constructor() {
        this.listeners = new Map();
    }

    addEventListener(type, listener) {
        const listeners = this.listeners.get(type) ?? [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
    }

    emit(type, detail) {
        for (const listener of this.listeners.get(type) ?? []) {
            listener({ detail });
        }
    }
}

function sourceBlock(source, start, end) {
    const startIndex = source.indexOf(start);
    assert.notEqual(startIndex, -1, `missing source block start: ${start}`);
    const endIndex = source.indexOf(end, startIndex + start.length);
    assert.notEqual(endIndex, -1, `missing source block end: ${end}`);
    return source.slice(startIndex, endIndex);
}

test('capture status producer emits only bounded public metadata', () => {
    const controller = new CaptureController({
        getContext: () => ({}),
        store: {},
        version: '0.11.4-test',
    });
    const emitted = [];
    controller.addEventListener('capture-status', (event) => {
        emitted.push(event.detail);
    });

    const detail = controller.dispatchCaptureStatus('saved', {
        promptType: 'chat-completion',
        stage: 'backend-request-ready',
        prompt: 'must never be exposed',
    });

    assert.deepEqual(Object.keys(detail).sort(), [
        'at',
        'promptType',
        'stage',
        'state',
    ]);
    assert.equal(detail.state, 'saved');
    assert.equal(detail.promptType, 'chat-completion');
    assert.equal(detail.stage, 'backend-request-ready');
    assert.equal(Object.isFrozen(detail), true);
    assert.doesNotMatch(JSON.stringify(detail), /must never be exposed/u);
    assert.equal(emitted.length, 1);

    assert.equal(controller.dispatchCaptureStatus('unknown-state'), null);
    assert.equal(emitted.length, 1);

    const bounded = controller.dispatchCaptureStatus('failed', {
        promptType: 'unsupported-provider',
        stage: 'x'.repeat(65),
    });
    assert.deepEqual(Object.keys(bounded).sort(), ['at', 'state']);
});

test('beginner UI consumes only the capture-status whitelist', () => {
    const previousStorage = globalThis.localStorage;
    globalThis.localStorage = memoryLocalStorage();
    const capture = new CaptureEventHarness();
    try {
        const ui = new DevToolsWindow({
            getContext: () => ({ chatId: 'beginner-chat' }),
            store: {},
            capture,
            version: '0.11.4-test',
        });

        assert.equal(capture.listeners.has('capture-status'), true);
        for (const [index, state] of UI_CAPTURE_STATES.entries()) {
            capture.emit('capture-status', {
                state,
                at: index,
                promptType: 'chat-completion',
                stage: 'prompt-ready',
                rawPrompt: `private-${state}`,
            });
            assert.deepEqual(ui.captureStatus, {
                state,
                at: index,
                promptType: 'chat-completion',
                stage: 'prompt-ready',
            });
        }

        capture.emit('capture-status', {
            state: 'processing',
            at: 99,
            promptType: 'chat-completion',
            stage: 'prompt-ready',
            phase: 'storage-verify',
            rawPrompt: 'private-processing-phase',
        });
        assert.deepEqual(ui.captureStatus, {
            state: 'processing',
            at: 99,
            promptType: 'chat-completion',
            stage: 'prompt-ready',
            phase: 'storage-verify',
        });

        capture.emit('capture-status', {
            state: 'processing',
            at: 100,
            phase: 'private-arbitrary-phase',
        });
        assert.deepEqual(ui.captureStatus, {
            state: 'processing',
            at: 100,
        });

        const beforeInvalid = structuredClone(ui.captureStatus);
        capture.emit('capture-status', {
            state: 'arbitrary-provider-state',
            rawPrompt: 'private-invalid-state',
        });
        assert.deepEqual(ui.captureStatus, beforeInvalid);
        assert.doesNotMatch(JSON.stringify(ui.captureStatus), /private-/u);
    } finally {
        globalThis.localStorage = previousStorage;
    }
});

test('privacy pipeline failures are explained as capture errors without a fake retry', () => {
    const previousStorage = globalThis.localStorage;
    const previousToastr = globalThis.toastr;
    const toasts = [];
    globalThis.localStorage = memoryLocalStorage();
    globalThis.toastr = {
        error(message) {
            toasts.push(message);
        },
    };
    const capture = new CaptureEventHarness();
    try {
        const ui = new DevToolsWindow({
            getContext: () => ({ chatId: 'capture-error-chat' }),
            store: {},
            capture,
            version: '0.11.4-test',
        });
        const error = new Error('invalid-value');
        error.code = 'invalid-value';

        capture.emit('capture-error', {
            operation: 'transformPrivacy',
            snapshot: null,
            error,
        });

        assert.equal(ui.storageErrors.length, 1);
        assert.equal(ui.storageErrors[0].kind, 'capture');
        assert.equal(ui.storageErrors[0].retry, null);
        assert.match(ui.storageErrors[0].message, /개인정보 보호 설정/u);
        assert.match(ui.storageErrors[0].message, /invalid-value/u);
        assert.deepEqual(toasts, [
            '이번 요청을 저장하지 못했습니다. 다음 일반 메시지는 자동으로 다시 캡처합니다.',
        ]);
    } finally {
        globalThis.localStorage = previousStorage;
        globalThis.toastr = previousToastr;
    }
});

test('four task-oriented navigation groups cover every legacy tab exactly once', async () => {
    const ui = await readFile(UI_SOURCE_URL, 'utf8');
    const navigation = sourceBlock(
        ui,
        'const NAV_GROUPS = [',
        'const CAPTURE_STATUS_STATES',
    );
    const rows = [...navigation.matchAll(
        /\[\s*'([^']+)',\s*'(nav\.[^']+)',\s*\[([^\]]*)\],\s*'([^']+)'\s*\]/gu,
    )].map((match) => ({
        id: match[1],
        labelKey: match[2],
        tabs: [...match[3].matchAll(/'([^']+)'/gu)].map((tab) => tab[1]),
        defaultTab: match[4],
    }));

    assert.equal(rows.length, 4);
    assert.equal(new Set(rows.map(({ id }) => id)).size, 4);
    const flattened = rows.flatMap(({ tabs }) => tabs);
    assert.equal(new Set(flattened).size, flattened.length);
    assert.deepEqual([...flattened].sort(), EXPECTED_TABS);
    for (const row of rows) {
        assert.equal(row.tabs.includes(row.defaultTab), true);
        assert.match(row.labelKey, /^nav\./u);
    }

    const icons = sourceBlock(
        ui,
        'const NAV_GROUP_ICONS = Object.freeze({',
        'const CAPTURE_STATUS_STATES',
    );
    const iconGroups = [...icons.matchAll(/^\s*([a-z]+):\s*'fa-[^']+'/gmu)]
        .map((match) => match[1])
        .sort();
    assert.deepEqual(iconGroups, rows.map(({ id }) => id).sort());
    assert.match(ui, /icon\.setAttribute\('aria-hidden', 'true'\)/u);
    assert.match(ui, /element\('span', \{ text: t\(labelKey\) \}\)/u);
});

test('header actions and capture status expose explicit accessible names', async () => {
    const ui = await readFile(UI_SOURCE_URL, 'utf8');
    const build = sourceBlock(ui, '\n    build() {', '\n    buildCaptureStatus() {');

    for (const action of ['settings', 'refresh', 'close']) {
        assert.match(
            build,
            new RegExp(
                `${action}\\.setAttribute\\('aria-label',\\s*t\\('action\\.${action}'\\)\\)`,
                'u',
            ),
        );
    }
    assert.doesNotMatch(build, /action\.help|openHelp|st-devtools-help-overlay/u);
    assert.match(build, /primaryTabs\.setAttribute\('aria-label',\s*t\('nav\.label'\)\)/u);
    assert.match(build, /tabList\.setAttribute\('aria-label',\s*t\('nav\.secondaryLabel'\)\)/u);
    assert.match(
        build,
        /this\.captureStatusRegion = this\.buildCaptureStatus\(\);[\s\S]*?title\.append\([\s\S]*?this\.captureStatusRegion/u,
    );
    const primaryRegions = sourceBlock(
        build,
        'this.primaryRegions = [',
        '];',
    );
    const windowChildren = sourceBlock(
        build,
        'this.window.append(',
        ');',
    );
    assert.doesNotMatch(primaryRegions, /this\.captureStatusRegion/u);
    assert.doesNotMatch(windowChildren, /this\.captureStatusRegion/u);

    const captureStatus = sourceBlock(
        ui,
        '\n    buildCaptureStatus() {',
        '\n    onCaptureStatus(detail) {',
    );
    assert.match(captureStatus, /dataset\.tourId = 'capture-status'/u);
    assert.match(captureStatus, /setAttribute\('role', 'status'\)/u);
    assert.match(captureStatus, /setAttribute\('aria-live', 'polite'\)/u);
    assert.match(captureStatus, /setAttribute\('aria-atomic', 'true'\)/u);
    assert.match(captureStatus, /setAttribute\('aria-hidden', 'true'\)/u);

    const updateStatus = sourceBlock(
        ui,
        '\n    updateCaptureStatus() {',
        '\n    renderQuickStart(',
    );
    assert.match(updateStatus, /capture\.status\.short\.\$\{keySuffix\}/u);
    assert.match(updateStatus, /t\('capture\.status\.accessible'/u);
    assert.match(updateStatus, /setAttribute\('aria-label', accessibleStatus\)/u);
    assert.match(updateStatus, /\.title = accessibleStatus/u);
});

test('empty state provides concise quick start and recovery actions', async () => {
    const ui = await readFile(UI_SOURCE_URL, 'utf8');
    const empty = sourceBlock(
        ui,
        '\n    renderEmpty() {',
        '\n    renderSnapshotPicker(',
    );
    assert.match(empty, /this\.renderQuickStart\(\{ showHeading: true \}\)/u);
    assert.match(empty, /className: 'st-devtools-empty-actions'/u);
    assert.match(empty, /text: t\('action\.returnToChat'\)/u);
    assert.match(empty, /back\.addEventListener\('click', \(\) => this\.close\(\)\)/u);
    assert.match(empty, /text: t\('action\.refresh'\)/u);
    assert.match(empty, /refresh\.addEventListener\('click', \(\) => this\.refresh\(\)\)/u);

    const quickStart = sourceBlock(
        ui,
        '\n    renderQuickStart(',
        '\n    syncOpaqueTheme() {',
    );
    assert.doesNotMatch(quickStart, /for \(const index of \[1, 2, 3\]\)/u);
    assert.doesNotMatch(quickStart, /className: 'st-devtools-quick-start-step'/u);
    assert.doesNotMatch(quickStart, /help\.semanticNote/u);
    assert.match(quickStart, /className: 'st-devtools-quick-start-next'/u);
    assert.match(quickStart, /className: 'st-devtools-quick-start-icon'/u);
    assert.match(quickStart, /nextStepIcon\.setAttribute\('aria-hidden', 'true'\)/u);
    assert.match(quickStart, /help\.step1Title/u);
    assert.match(quickStart, /help\.step1Description/u);
    assert.match(quickStart, /className: 'st-devtools-empty-diagnostics/u);
});

test('rule results have an explicit async host before lazily-mounted supporting sections', async () => {
    const ui = await readFile(UI_SOURCE_URL, 'utf8');
    const semanticDisclosure = sourceBlock(
        ui,
        '\n    renderSemanticInspectorDisclosure(',
        '\n    renderRuleAdvancedAnalysis(',
    );
    const semanticInspector = sourceBlock(
        ui,
        '\n    renderSemanticInspector(snapshot, analysis, findings) {',
        '\n    renderSemanticInspectorDisclosure(',
    );
    const advancedDisclosure = sourceBlock(
        ui,
        '\n    renderRuleAdvancedAnalysis(',
        '\n    appendRuleSupportingSections(',
    );
    const deferredSettings = sourceBlock(
        ui,
        '\n    renderDeferredRuleSettings(',
        '\n    renderDeferredComparisonPolicySettings(',
    );
    const deferredPolicy = sourceBlock(
        ui,
        '\n    renderDeferredComparisonPolicySettings(',
        '\n    renderRuleAdvancedAnalysis(',
    );
    const supporting = sourceBlock(
        ui,
        '\n    appendRuleSupportingSections(',
        '\n    renderRules(',
    );
    const rules = sourceBlock(ui, '\n    renderRules(', '\n    renderSearch(');

    assert.match(semanticDisclosure, /element\('details'/u);
    assert.match(semanticDisclosure, /attachLazyDetailsContent\(details/u);
    assert.match(semanticDisclosure, /details\.open = this\.semanticInspectorOpen/u);
    assert.match(
        semanticDisclosure,
        /this\.semanticInspectorOpen = details\.open/u,
    );
    assert.match(semanticInspector, /className: 'st-devtools-semantic-enable-card'/u);
    assert.match(semanticInspector, /t\('semantic\.enableHint'\)/u);
    assert.match(semanticInspector, /text: t\('semantic\.enable'\)/u);
    assert.match(semanticInspector, /this\.enableSemanticInspectorFromRules\(\)/u);
    assert.match(
        semanticInspector,
        /className: 'st-devtools-semantic-enable-status'/u,
    );
    assert.match(semanticInspector, /setAttribute\('role', 'alert'\)/u);
    assert.match(semanticInspector, /t\('semantic\.enableFailed'\)/u);
    assert.match(advancedDisclosure, /element\('details'/u);
    assert.match(advancedDisclosure, /attachLazyDetailsContent\(details/u);
    assert.doesNotMatch(advancedDisclosure, /details\.open\s*=\s*true/u);
    assert.match(deferredSettings, /attachLazyDetailsContent\(details/u);
    assert.match(deferredSettings, /this\.renderRuleSettings\(\)/u);
    assert.match(deferredPolicy, /attachLazyDetailsContent\(details/u);
    assert.match(
        deferredPolicy,
        /this\.renderComparisonPolicySettings\(snapshot\)/u,
    );

    assert.match(rules, /className: 'st-devtools-rule-analysis-host'/u);
    assert.match(rules, /host\.dataset\.tourId = 'rule-results'/u);
    assert.match(rules, /completed\.querySelector\(\s*'\.st-devtools-rule-analysis-host'/u);
    assert.doesNotMatch(rules, /childNodes\.slice\s*\(/u);
    assert.match(
        rules,
        /host\.appendChild\(empty\);[\s\S]*?this\.appendRuleSupportingSections\(/u,
    );
    assert.match(
        rules,
        /host\.appendChild\(list\);\s*this\.appendRuleSupportingSections\(/u,
    );
    assert.match(
        supporting,
        /renderSemanticInspectorDisclosure[\s\S]*?renderRuleAdvancedAnalysis[\s\S]*?renderDeferredRuleSettings[\s\S]*?renderDeferredComparisonPolicySettings[\s\S]*?renderReviewedFindings[\s\S]*?renderRuleAuditLog/u,
    );
});

test('search regex and case options stay collapsed behind a native disclosure', async () => {
    const ui = await readFile(UI_SOURCE_URL, 'utf8');
    const search = ui.slice(ui.indexOf('\n    renderSearch('));

    assert.match(
        search,
        /const options = element\('details', \{\s*className: 'st-devtools-search-options st-devtools-disclosure'/u,
    );
    assert.match(search, /const optionsSummary = element\('summary'\)/u);
    assert.match(search, /className: 'st-devtools-search-options-body'/u);
    assert.match(search, /options\.append\(optionsSummary, optionsBody\)/u);
    assert.doesNotMatch(search, /options\.open\s*=\s*true/u);
});

test('beginner UI labels cover navigation, quick start, capture, and recovery states', async () => {
    const i18n = await readFile(I18N_SOURCE_URL, 'utf8');
    const keys = [
        'action.returnToChat',
        'nav.label',
        'nav.secondaryLabel',
        'nav.prompt',
        'nav.inspect',
        'nav.history',
        'nav.tools',
        'empty.quickStartTitle',
        'help.step1Title',
        'help.step1Description',
        'help.troubleshootTitle',
        'help.troubleshootDescription',
        'capture.status.waiting',
        'capture.status.capturing',
        'capture.status.processing',
        'capture.status.processing.finalizing',
        'capture.status.processing.privacy',
        'capture.status.processing.storage',
        'capture.status.processing.storage-verify',
        'capture.status.saved',
        'capture.status.failed',
        'capture.status.failed.finalizing',
        'capture.status.failed.privacy',
        'capture.status.failed.storage',
        'capture.status.failed.storage-verify',
        'capture.status.excludedSemantic',
        'capture.status.skippedSafety',
        'capture.status.accessible',
        'capture.status.short.waiting',
        'capture.status.short.capturing',
        'capture.status.short.processing',
        'capture.status.short.saved',
        'capture.status.short.failed',
        'capture.status.short.excludedSemantic',
        'capture.status.short.skippedSafety',
    ];
    for (const key of keys) {
        assert.equal(i18n.includes(`'${key}':`), true, `missing i18n key: ${key}`);
    }
    for (const removedKey of ['action.help', 'help.title', 'help.description']) {
        assert.equal(
            i18n.includes(`'${removedKey}':`),
            false,
            `removed header help key remains: ${removedKey}`,
        );
    }
});
