import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
    DEFAULT_UI_PREFERENCES,
    MAX_SEMANTIC_RESPONSE_TOKEN_CAP,
    MIN_SEMANTIC_RESPONSE_TOKEN_CAP,
    normalizeUiPreferences,
} from '../src/preferences.js';
import { DevToolsWindow } from '../src/ui.js';

function emptyPricing() {
    return { version: 1, entries: [] };
}

function snapshot() {
    return {
        id: 'semantic-snapshot',
        provider: 'openai',
        model: 'gpt-semantic',
        promptType: 'chat-completion',
        sources: [{
            id: 'source-1',
            label: 'System',
            content: '정확히 전송될 원문',
            included: true,
        }],
    };
}

function createUi(semanticInspector, requestConsent = async () => false) {
    const ui = Object.create(DevToolsWindow.prototype);
    ui.semanticInspector = semanticInspector;
    ui.analysisRevision = 0;
    ui.analysisControllers = new Set();
    ui.analysisCache = { clear() {} };
    ui.preferences = normalizeUiPreferences({
        ...DEFAULT_UI_PREFERENCES,
        semanticInspectorEnabled: true,
    });
    ui.pricingOverrides = emptyPricing();
    ui.semanticPromptSettings = {
        version: 1,
        userPrompt: '',
        assistantPrefill: '',
    };
    ui.semanticInspectionState = {
        snapshotId: 'semantic-snapshot',
        analysisRevision: 0,
        targetIds: new Set(['finding:finding-1']),
        status: 'idle',
        result: null,
        errorCode: null,
        errorReason: null,
        sequence: 0,
        controller: null,
    };
    ui.semanticInspectorHost = null;
    ui.semanticConsentOverlay = null;
    ui.semanticConsentPanel = null;
    ui.semanticConsentResolve = null;
    ui.requestSemanticConsent = requestConsent;
    return ui;
}

test('semantic inspection preferences are off by default and response cap is bounded', () => {
    assert.equal(DEFAULT_UI_PREFERENCES.semanticInspectorEnabled, false);
    assert.equal(DEFAULT_UI_PREFERENCES.semanticResponseTokenCap, 512);
    assert.equal(normalizeUiPreferences({
        semanticInspectorEnabled: 'true',
        semanticResponseTokenCap: 1,
    }).semanticInspectorEnabled, false);
    assert.equal(normalizeUiPreferences({
        semanticResponseTokenCap: 1,
    }).semanticResponseTokenCap, MIN_SEMANTIC_RESPONSE_TOKEN_CAP);
    assert.equal(normalizeUiPreferences({
        semanticResponseTokenCap: Number.MAX_SAFE_INTEGER,
    }).semanticResponseTokenCap, MAX_SEMANTIC_RESPONSE_TOKEN_CAP);
});

test('rules can enable semantic inspection locally without contacting a provider', () => {
    const previousToastr = globalThis.toastr;
    const previousConsoleError = console.error;
    let prepareCount = 0;
    let inspectCount = 0;
    const inspector = {
        prepare() {
            prepareCount += 1;
        },
        inspect() {
            inspectCount += 1;
        },
    };
    const statuses = [];
    globalThis.toastr = {
        info(message) {
            statuses.push(['info', message]);
        },
        error(message) {
            statuses.push(['error', message]);
        },
    };
    console.error = () => {};
    try {
        const enabledUi = createUi(inspector);
        enabledUi.preferences = normalizeUiPreferences({
            ...DEFAULT_UI_PREFERENCES,
            semanticInspectorEnabled: false,
        });
        let resetCount = 0;
        let renderCount = 0;
        enabledUi.saveUiPreferences = (value) => {
            enabledUi.preferences = normalizeUiPreferences(value);
            return enabledUi.preferences;
        };
        enabledUi.resetSemanticInspectionForSettingsChange = () => {
            resetCount += 1;
        };
        enabledUi.render = () => {
            renderCount += 1;
        };

        assert.equal(enabledUi.enableSemanticInspectorFromRules(), true);
        assert.equal(enabledUi.preferences.semanticInspectorEnabled, true);
        assert.equal(enabledUi.ruleViewMode, 'ai');
        assert.equal(resetCount, 1);
        assert.equal(renderCount, 1);

        const failedUi = createUi(inspector);
        failedUi.preferences = normalizeUiPreferences({
            ...DEFAULT_UI_PREFERENCES,
            semanticInspectorEnabled: false,
        });
        let failedRenderCount = 0;
        failedUi.render = () => {
            failedRenderCount += 1;
        };
        failedUi.saveUiPreferences = () => {
            throw Object.assign(new Error('blocked'), {
                code: 'settings-storage-write-failed',
            });
        };

        assert.equal(failedUi.enableSemanticInspectorFromRules(), false);
        assert.equal(failedUi.preferences.semanticInspectorEnabled, false);
        assert.equal(failedRenderCount, 0);
        assert.equal(prepareCount, 0);
        assert.equal(inspectCount, 0);
        assert.deepEqual(statuses.map(([kind]) => kind), ['info', 'error']);
    } finally {
        globalThis.toastr = previousToastr;
        console.error = previousConsoleError;
    }
});

test('cancelling the consent preview never calls the semantic provider', async () => {
    let prepareCount = 0;
    let inspectCount = 0;
    const ui = createUi({
        async prepare(options) {
            prepareCount += 1;
            assert.deepEqual(options.targetIds, ['finding:finding-1']);
            return {
                preview: {
                    includedSources: [],
                    excludedSources: [],
                },
            };
        },
        async inspect() {
            inspectCount += 1;
            return { suggestions: [] };
        },
    }, async () => false);

    const result = await ui.startSemanticInspection(snapshot(), {
        findings: [{ id: 'finding-1' }],
    });

    assert.equal(result, null);
    assert.equal(prepareCount, 1);
    assert.equal(inspectCount, 0);
    assert.equal(ui.semanticInspectionState.status, 'cancelled');
});

test('protected and invalid-version snapshots never enter semantic preparation', async () => {
    let prepareCount = 0;
    const ui = createUi({
        async prepare() {
            prepareCount += 1;
            throw new Error('must not prepare');
        },
        async inspect() {
            throw new Error('must not inspect');
        },
    }, async () => true);

    const protectedSnapshots = [
        ...['redacted', 'metadata'].map((mode) => ({
            ...snapshot(),
            id: `semantic-${mode}`,
            privacy: { mode },
        })),
        {
            ...snapshot(),
            id: 'semantic-v7-missing-privacy',
            schemaVersion: 7,
        },
        {
            ...snapshot(),
            id: 'semantic-invalid-version',
            schemaVersion: 8,
            privacy: { mode: 'full' },
        },
    ];
    for (const protectedSnapshot of protectedSnapshots) {
        ui.semanticInspectionState.snapshotId = protectedSnapshot.id;
        ui.semanticInspectionState.targetIds = new Set(['finding:finding-1']);
        await ui.startSemanticInspection(protectedSnapshot, {});
    }

    assert.equal(prepareCount, 0);
});

test('semantic UI eligibility mirrors inspector privacy and target-closure boundaries', () => {
    const ui = createUi(null);

    assert.equal(ui.semanticSnapshotSupportsInspection(snapshot()), true);
    assert.equal(ui.semanticSnapshotSupportsInspection({
        ...snapshot(),
        schemaVersion: 7,
        privacy: { mode: 'full' },
    }), true);
    assert.equal(ui.semanticSnapshotSupportsInspection({
        ...snapshot(),
        schemaVersion: 7,
    }), false);
    assert.equal(ui.semanticSnapshotSupportsInspection({
        ...snapshot(),
        schemaVersion: 8,
        privacy: { mode: 'full' },
    }), false);
    assert.equal(ui.semanticSnapshotSupportsInspection({
        ...snapshot(),
        schemaVersion: 6,
        privacy: {},
    }), false);
    assert.equal(ui.semanticSnapshotSupportsInspection(null), false);
    assert.equal(ui.semanticTargetHasClosure({
        sourceIds: ['source-1'],
    }, 'finding'), true);
    assert.equal(ui.semanticTargetHasClosure({
        atomIds: ['atom-1'],
    }, 'finding'), true);
    assert.equal(ui.semanticTargetHasClosure({
        relationId: 'relation-1',
    }, 'finding'), true);
    assert.equal(ui.semanticTargetHasClosure({
        relationIds: ['relation-1'],
    }, 'cluster'), true);
    assert.equal(ui.semanticTargetHasClosure({
        id: 'context-only',
        sourceIds: [],
        atomIds: [],
    }, 'finding'), false);
});

test('selection changes invalidate an old AI result without clearing selection', () => {
    const ui = createUi(null);
    ui.semanticInspectionState.status = 'complete';
    ui.semanticInspectionState.result = {
        kind: 'ai-semantic-suggestions',
        suggestions: [{ id: 'stale-result' }],
    };
    const sequence = ui.semanticInspectionState.sequence;

    ui.invalidateSemanticInspectionOutcome(ui.semanticInspectionState);

    assert.deepEqual(
        [...ui.semanticInspectionState.targetIds],
        ['finding:finding-1'],
    );
    assert.equal(ui.semanticInspectionState.status, 'idle');
    assert.equal(ui.semanticInspectionState.result, null);
    assert.equal(ui.semanticInspectionState.errorCode, null);
    assert.equal(ui.semanticInspectionState.sequence, sequence + 1);
});

test('analysis revision changes invalidate progress and results while preserving targets', () => {
    const ui = createUi(null);
    const controller = new AbortController();
    ui.semanticInspectionState.status = 'running';
    ui.semanticInspectionState.result = {
        kind: 'ai-semantic-suggestions',
        suggestions: [{ id: 'stale-result' }],
    };
    ui.semanticInspectionState.controller = controller;

    ui.invalidateAnalysisState();

    assert.equal(controller.signal.aborted, true);
    assert.equal(ui.analysisRevision, 1);
    assert.equal(ui.semanticInspectionState.analysisRevision, 1);
    assert.deepEqual(
        [...ui.semanticInspectionState.targetIds],
        ['finding:finding-1'],
    );
    assert.equal(ui.semanticInspectionState.status, 'idle');
    assert.equal(ui.semanticInspectionState.result, null);
    assert.equal(ui.semanticInspectionState.controller, null);
});

test('changing the selected snapshot aborts stale AI work exactly once', () => {
    const ui = createUi(null);
    const controller = new AbortController();
    ui.selectedId = 'snapshot-a';
    ui.semanticInspectionState.status = 'running';
    ui.semanticInspectionState.controller = controller;

    assert.equal(ui.setSelectedSnapshotId('snapshot-b'), true);
    assert.equal(ui.selectedId, 'snapshot-b');
    assert.equal(controller.signal.aborted, true);
    assert.equal(ui.semanticInspectionState.status, 'idle');
    assert.equal(ui.analysisRevision, 1);

    assert.equal(ui.setSelectedSnapshotId('snapshot-b'), false);
    assert.equal(ui.analysisRevision, 1);
});

test('switching tabs does not cancel an in-flight semantic inspection', () => {
    const previousStorage = globalThis.localStorage;
    globalThis.localStorage = {
        setItem() {},
    };
    try {
        const ui = createUi(null);
        const controller = new AbortController();
        ui.activeTab = 'rules';
        ui.content = { scrollTop: 10 };
        ui.root = { hidden: true };
        ui.semanticInspectionState.status = 'running';
        ui.semanticInspectionState.controller = controller;
        ui.render = () => {};

        ui.selectTab('explorer');

        assert.equal(controller.signal.aborted, false);
        assert.equal(ui.analysisRevision, 0);
        assert.equal(ui.semanticInspectionState.status, 'running');
    } finally {
        globalThis.localStorage = previousStorage;
    }
});

test('semantic settings changes always reset state and OFF also clears memory cache', () => {
    let clearCount = 0;
    const ui = createUi({
        clearCache() {
            clearCount += 1;
            return true;
        },
    });
    const controller = new AbortController();
    ui.semanticInspectionState.status = 'running';
    ui.semanticInspectionState.controller = controller;
    ui.semanticInspectionState.result = {
        kind: 'ai-semantic-suggestions',
        suggestions: [{ id: 'stale-result' }],
    };

    ui.resetSemanticInspectionForSettingsChange({
        semanticInspectorEnabled: true,
    });

    assert.equal(controller.signal.aborted, true);
    assert.equal(clearCount, 0);
    assert.equal(ui.semanticInspectionState.status, 'idle');
    assert.equal(ui.semanticInspectionState.result, null);
    assert.equal(ui.semanticInspectionState.targetIds.size, 0);

    ui.resetSemanticInspectionForSettingsChange({
        semanticInspectorEnabled: false,
    });
    assert.equal(clearCount, 1);
});

test('saving semantic prompt settings immediately refreshes an interrupted inspection', () => {
    const previousStorage = globalThis.localStorage;
    const previousToastr = globalThis.toastr;
    const memory = new Map();
    globalThis.localStorage = {
        getItem(key) {
            return memory.get(key) ?? null;
        },
        setItem(key, value) {
            memory.set(key, value);
        },
    };
    globalThis.toastr = { success() {} };
    try {
        let clearCount = 0;
        let refreshCount = 0;
        const controller = new AbortController();
        const ui = createUi({
            clearCache() {
                clearCount += 1;
                return true;
            },
        });
        ui.semanticInspectionState.status = 'running';
        ui.semanticInspectionState.controller = controller;
        ui.refreshSemanticInspectorHost = () => {
            refreshCount += 1;
        };

        assert.equal(ui.saveSemanticPromptCustomization({
            userPrompt: '충돌 검사를 더 엄격하게 수행하세요.',
            assistantPrefill: '{',
        }), true);
        assert.equal(controller.signal.aborted, true);
        assert.equal(ui.semanticInspectionState.status, 'idle');
        assert.equal(ui.semanticInspectionState.controller, null);
        assert.equal(clearCount, 1);
        assert.equal(refreshCount, 1);
    } finally {
        globalThis.localStorage = previousStorage;
        globalThis.toastr = previousToastr;
    }
});

test('local data clearing purges semantic memory first even when storage is blocked', () => {
    const previousStorage = globalThis.localStorage;
    try {
        let blockedClearCount = 0;
        const blockedUi = createUi({
            clearCache() {
                blockedClearCount += 1;
                return true;
            },
        });
        blockedUi.store = {};
        globalThis.localStorage = {
            get length() {
                throw new Error('storage blocked');
            },
            getItem() {
                throw new Error('storage blocked');
            },
        };

        assert.throws(
            () => blockedUi.clearLocalData(),
            /storage blocked/u,
        );
        assert.equal(blockedClearCount, 1);
        assert.equal(blockedUi.semanticInspectionState.status, 'idle');
        assert.equal(blockedUi.semanticInspectionState.targetIds.size, 0);

        let normalClearCount = 0;
        const normalUi = createUi({
            clearCache() {
                normalClearCount += 1;
                return true;
            },
        });
        normalUi.store = {};
        const values = new Map([['st-devtools:test-setting', 'value']]);
        globalThis.localStorage = {
            get length() {
                return values.size;
            },
            key(index) {
                return [...values.keys()][index] ?? null;
            },
            getItem(key) {
                return values.get(key) ?? null;
            },
            removeItem(key) {
                values.delete(key);
            },
        };

        assert.equal(normalUi.clearLocalData(), 1);
        assert.equal(normalClearCount, 1);
        assert.equal(values.size, 0);
        assert.equal(normalUi.preferences.semanticInspectorEnabled, false);
    } finally {
        globalThis.localStorage = previousStorage;
    }
});

test('retry prepares a new preview and requests a new consent', async () => {
    let prepareCount = 0;
    let consentCount = 0;
    const inspectedPreparedIds = [];
    const ui = createUi({
        async prepare() {
            prepareCount += 1;
            return {
                id: prepareCount,
                preview: {
                    includedSources: [],
                    excludedSources: [],
                },
            };
        },
        async inspect(prepared) {
            inspectedPreparedIds.push(prepared.id);
            if (prepared.id === 1) {
                throw Object.assign(new Error('provider failed'), {
                    code: 'SEMANTIC_PROVIDER_ERROR',
                });
            }
            return {
                kind: 'ai-semantic-suggestions',
                suggestions: [],
            };
        },
    }, async () => {
        consentCount += 1;
        return true;
    });

    await ui.startSemanticInspection(snapshot(), {});
    assert.equal(ui.semanticInspectionState.status, 'error');
    await ui.startSemanticInspection(snapshot(), {});

    assert.equal(prepareCount, 2);
    assert.equal(consentCount, 2);
    assert.deepEqual(inspectedPreparedIds, [1, 2]);
    assert.equal(ui.semanticInspectionState.status, 'complete');
});

test('semantic UI keeps only stable provider diagnostic codes and bounded reasons', async () => {
    const ui = createUi({
        async prepare() {
            return {
                preview: {
                    includedSources: [],
                    excludedSources: [],
                },
            };
        },
        async inspect() {
            throw Object.assign(new Error('private provider response'), {
                code: 'SEMANTIC_RATE_LIMITED',
                reason: 'provider-rate-limited',
            });
        },
    }, async () => true);

    await ui.startSemanticInspection(snapshot(), {});

    assert.equal(ui.semanticInspectionState.status, 'error');
    assert.equal(ui.semanticInspectionState.errorCode, 'SEMANTIC_RATE_LIMITED');
    assert.equal(
        ui.semanticInspectionState.errorReason,
        'provider-rate-limited',
    );

    const unknown = createUi({
        async prepare() {
            return { preview: { includedSources: [], excludedSources: [] } };
        },
        async inspect() {
            throw Object.assign(new Error('private provider response'), {
                code: 'PRIVATE_PROVIDER_FAILURE',
            });
        },
    }, async () => true);
    await unknown.startSemanticInspection(snapshot(), {});
    assert.equal(
        unknown.semanticInspectionState.errorCode,
        'SEMANTIC_PROVIDER_ERROR',
    );
});

test('logical cancellation aborts an in-flight semantic inspection', async () => {
    let started;
    const startedPromise = new Promise((resolve) => {
        started = resolve;
    });
    let observedAbort = false;
    const ui = createUi({
        async prepare() {
            return {
                preview: {
                    includedSources: [],
                    excludedSources: [],
                },
            };
        },
        async inspect(_prepared, { signal }) {
            started();
            return new Promise((resolve, reject) => {
                signal.addEventListener('abort', () => {
                    observedAbort = true;
                    reject(Object.assign(new Error('aborted'), {
                        code: 'SEMANTIC_ABORTED',
                    }));
                }, { once: true });
            });
        },
    }, async () => true);

    const pending = ui.startSemanticInspection(snapshot(), {});
    await startedPromise;
    ui.cancelSemanticInspection();
    await pending;

    assert.equal(observedAbort, true);
    assert.equal(ui.semanticInspectionState.status, 'cancelled');
    assert.equal(ui.semanticInspectionState.result, null);
});

test('v0.11 semantic UI keeps consent, results, and persistence boundaries explicit', async () => {
    const [ui, i18n, css] = await Promise.all([
        readFile(new URL('../src/ui.js', import.meta.url), 'utf8'),
        readFile(new URL('../src/i18n.js', import.meta.url), 'utf8'),
        readFile(new URL('../style.css', import.meta.url), 'utf8'),
    ]);
    const semanticStart = ui.indexOf('\n    resetSemanticInspectionState(');
    const semanticMethods = ui.slice(
        semanticStart,
        ui.indexOf('\n    renderRules(', semanticStart),
    );

    assert.match(ui, /semanticInspector = null/);
    assert.match(ui, /this\.semanticInspector\.prepare\(\{/);
    assert.match(ui, /this\.semanticInspector\.inspect\(prepared, \{/);
    assert.match(ui, /this\.semanticConsentCheckbox\.checked = false/);
    assert.match(ui, /this\.semanticConsentConfirmButton\.disabled = true/);
    assert.match(ui, /if \(!approved\)[\s\S]*?state\.status = 'cancelled'/);
    assert.match(ui, /semanticConsentOverlay[\s\S]*?closeSemanticConsent\(false\)/);
    assert.match(ui, /event\.key === 'Escape'[\s\S]*?closeSemanticConsent\(false\)/);
    assert.match(ui, /semanticConsentPanel[\s\S]*?settingsPanel/);
    assert.match(ui, /semanticSnapshotSupportsInspection\(snapshot\)/);
    assert.match(
        ui,
        /updateSemanticInspectorPreferences\([\s\S]*?if \(changed\) \{\s*this\.resetSemanticInspectionForSettingsChange\(preferences\);/,
    );
    assert.match(
        ui,
        /clearLocalData\(\) \{\s*this\.resetSemanticInspectionForSettingsChange\(\{\s*semanticInspectorEnabled: false,/,
    );
    assert.match(ui, /if \(!availableTargetIds\.has\(targetId\)\)/);
    assert.match(ui, /this\.semanticTargetHasClosure\(finding, 'finding'\)/);
    assert.match(ui, /className: 'st-devtools-semantic-enable-card'/);
    assert.match(ui, /className: 'st-devtools-semantic-enable-status'/);
    assert.match(ui, /text: t\('semantic\.enable'\)/);
    assert.match(ui, /t\('semantic\.enableHint'\)/);
    assert.match(ui, /setAttribute\('role', 'alert'\)/);
    assert.match(ui, /t\('semantic\.enableFailed'\)/);
    assert.match(ui, /details\.open = this\.semanticInspectorOpen/);
    assert.match(ui, /this\.semanticInspectorOpen = details\.open/);
    assert.match(ui, /typeof source\?\.content === 'string'/);
    assert.doesNotMatch(ui, /source\?\.contentPreview/);
    assert.doesNotMatch(semanticMethods, /localStorage|saveFinding|setFinding|saveComparison/);
    assert.doesNotMatch(semanticMethods, /innerHTML/);
    assert.match(semanticMethods, /suggestion\?\.rationale/);
    assert.match(semanticMethods, /suggestion\?\.evidence/);
    assert.match(semanticMethods, /text:\s*typeof item\?\.quote === 'string'/);
    assert.match(i18n, /AI 제안 — 자동 적용되지 않음/);
    assert.match(i18n, /이번 1회 전송에 동의합니다/);
    assert.match(ui, /SEMANTIC_INSPECTOR_ERROR_CODES\.includes\(errorCode\)/);
    assert.match(ui, /semantic\.errorDiagnosticWithReason/);
    assert.match(i18n, /진단 코드: \{code\}/u);
    assert.match(i18n, /SEMANTIC_AUTHENTICATION_ERROR/u);
    assert.match(i18n, /SEMANTIC_RATE_LIMITED/u);
    assert.match(i18n, /SEMANTIC_NETWORK_ERROR/u);
    assert.match(i18n, /SEMANTIC_PROVIDER_UNAVAILABLE/u);
    assert.match(css, /@media \(max-width: 430px\)[\s\S]*?st-devtools-semantic-consent-panel/);
    assert.match(css, /\.st-devtools-semantic-results/);
    assert.match(css, /\.st-devtools-semantic-enable-card/);
    for (const key of [
        'semantic.enable',
        'semantic.enableHint',
        'semantic.enabled',
        'semantic.enableFailed',
    ]) {
        assert.equal(i18n.includes(`'${key}':`), true, `missing i18n key: ${key}`);
    }
});
