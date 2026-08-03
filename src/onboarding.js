export const ONBOARDING_VERSION = 2;
export const ONBOARDING_STORAGE_KEY = 'st-devtools:onboarding:v2';

const VALID_STATUSES = new Set(['new', 'skipped', 'completed']);
const SCHEMA_VERSION = 1;

export const ONBOARDING_GROUPS = Object.freeze([
    Object.freeze({ id: 'capture', tabId: 'explorer', icon: 'fa-circle-dot' }),
    Object.freeze({ id: 'explorer', tabId: 'explorer', icon: 'fa-layer-group' }),
    Object.freeze({ id: 'rules', tabId: 'rules', icon: 'fa-shield-halved' }),
    Object.freeze({ id: 'timeline', tabId: 'timeline', icon: 'fa-clock-rotate-left' }),
    Object.freeze({ id: 'diff', tabId: 'diff', icon: 'fa-code-compare' }),
    Object.freeze({ id: 'search', tabId: 'search', icon: 'fa-magnifying-glass' }),
]);

const GROUP_BY_ID = new Map(ONBOARDING_GROUPS.map((group) => [group.id, group]));

function defineInteraction(event, selector, { value, state } = {}) {
    return Object.freeze({
        event,
        selector,
        ...(value === undefined ? {} : { value }),
        ...(state === undefined ? {} : { state }),
    });
}

function defineStep(groupId, id, target, interaction) {
    const group = GROUP_BY_ID.get(groupId);
    return Object.freeze({
        id,
        group: group.id,
        tabId: group.tabId,
        target,
        icon: group.icon,
        ...(interaction ? { interaction } : {}),
    });
}

export const ONBOARDING_STEPS = Object.freeze([
    // 캡처가 무엇인지 이해하고, 안전한 연습 요청을 캡처한 뒤 결과를 확인합니다.
    defineStep('capture', 'capture-purpose', '[data-tour-id="capture-status"]'),
    defineStep(
        'capture',
        'capture-practice',
        '[data-tour-id="capture-status"]',
        defineInteraction('panel', '[data-onboarding-action="run-capture-demo"]', { value: 'run' }),
    ),
    defineStep('capture', 'capture-result', '[data-tour-id="capture-status"]'),

    // 캡처된 요청이 원본 소스에서 최종 payload까지 이어지는 흐름을 살펴봅니다.
    defineStep(
        'explorer',
        'explorer-tab',
        '.st-devtools-app-nav-item[data-tab="explorer"]',
        defineInteraction('click', '.st-devtools-app-nav-item[data-tab="explorer"]'),
    ),
    defineStep(
        'explorer',
        'explorer-snapshot-3',
        '[data-tour-id="snapshot-picker"] select',
        defineInteraction('change', '[data-tour-id="snapshot-picker"] select', {
            value: 'tutorial:snapshot:3',
        }),
    ),
    defineStep('explorer', 'explorer-overview', '.st-devtools-overview-card'),
    defineStep(
        'explorer',
        'explorer-included-filter',
        '.st-devtools-explorer-filter .st-devtools-switch-button',
        defineInteraction('click', '.st-devtools-explorer-filter .st-devtools-switch-button', {
            state: 'checked',
        }),
    ),
    defineStep(
        'explorer',
        'explorer-configured-group',
        '.st-devtools-source-group[data-group="configured"]',
        defineInteraction('toggle', '.st-devtools-source-group[data-group="configured"]', {
            state: 'open',
        }),
    ),
    defineStep(
        'explorer',
        'explorer-format-source',
        '.st-devtools-source[data-source-id="tutorial:source:output"]',
        defineInteraction(
            'toggle',
            '.st-devtools-source[data-source-id="tutorial:source:output"]',
            { state: 'open' },
        ),
    ),
    defineStep(
        'explorer',
        'explorer-provenance',
        '.st-devtools-source[data-source-id="tutorial:source:output"] .st-devtools-provenance-details',
        defineInteraction(
            'toggle',
            '.st-devtools-source[data-source-id="tutorial:source:output"] .st-devtools-provenance-details',
            { state: 'open' },
        ),
    ),
    defineStep(
        'explorer',
        'explorer-final-group',
        '.st-devtools-source-group[data-group="final"]',
        defineInteraction('toggle', '.st-devtools-source-group[data-group="final"]', { state: 'open' }),
    ),
    defineStep(
        'explorer',
        'explorer-final-source',
        '.st-devtools-source[data-source-id="tutorial:source:final:3"]',
        defineInteraction(
            'toggle',
            '.st-devtools-source[data-source-id="tutorial:source:final:3"]',
            { state: 'open' },
        ),
    ),
    defineStep(
        'explorer',
        'explorer-payload',
        '.st-devtools-prompt-request-data',
        defineInteraction('toggle', '.st-devtools-prompt-request-data', { state: 'open' }),
    ),

    // 로컬 규칙 결과에서 근거와 관련 소스로 이동하는 경로를 연습합니다.
    defineStep(
        'rules',
        'rules-tab',
        '.st-devtools-app-nav-item[data-tab="rules"]',
        defineInteraction('click', '.st-devtools-app-nav-item[data-tab="rules"]'),
    ),
    defineStep('rules', 'rules-summary', '.st-devtools-rule-summary'),
    defineStep('rules', 'rules-finding', '.st-devtools-rule-card[data-rule-id="format"]'),
    defineStep(
        'rules',
        'rules-evidence',
        '.st-devtools-rule-card[data-rule-id="format"] .st-devtools-rule-evidence',
        defineInteraction(
            'toggle',
            '.st-devtools-rule-card[data-rule-id="format"] .st-devtools-rule-evidence',
            { state: 'open' },
        ),
    ),
    defineStep(
        'rules',
        'rules-related-sources',
        '.st-devtools-rule-card[data-rule-id="format"] .st-devtools-rule-actions button:first-child',
        defineInteraction(
            'click',
            '.st-devtools-rule-card[data-rule-id="format"] .st-devtools-rule-actions button:first-child',
        ),
    ),
    defineStep(
        'rules',
        'rules-return',
        '.st-devtools-app-nav-item[data-tab="rules"]',
        defineInteraction('click', '.st-devtools-app-nav-item[data-tab="rules"]'),
    ),
    defineStep('rules', 'rules-ai-explanation', '.st-devtools-ai-mode-button'),

    // 성장 그래프와 목록을 오가며 스냅샷의 시계열 맥락을 확인합니다.
    defineStep(
        'timeline',
        'timeline-tab',
        '.st-devtools-app-nav-item[data-tab="timeline"]',
        defineInteraction('click', '.st-devtools-app-nav-item[data-tab="timeline"]'),
    ),
    defineStep('timeline', 'timeline-growth', '.st-devtools-growth'),
    defineStep(
        'timeline',
        'timeline-point-snapshot-2',
        '.st-devtools-growth-hit[data-snapshot-id="tutorial:snapshot:2"]',
        defineInteraction(
            'click',
            '.st-devtools-growth-hit[data-snapshot-id="tutorial:snapshot:2"]',
        ),
    ),
    defineStep(
        'timeline',
        'timeline-open-snapshot',
        '.st-devtools-growth-detail .menu_button',
        defineInteraction('click', '.st-devtools-growth-detail .menu_button'),
    ),
    defineStep(
        'timeline',
        'timeline-return',
        '.st-devtools-app-nav-item[data-tab="timeline"]',
        defineInteraction('click', '.st-devtools-app-nav-item[data-tab="timeline"]'),
    ),
    defineStep(
        'timeline',
        'timeline-list',
        '.st-devtools-timeline-snapshots',
        defineInteraction('toggle', '.st-devtools-timeline-snapshots', { state: 'open' }),
    ),

    // 첫 번째와 세 번째 연습 스냅샷을 비교하며 변경 유형을 확인합니다.
    defineStep(
        'diff',
        'diff-tab',
        '.st-devtools-app-nav-item[data-tab="diff"]',
        defineInteraction('click', '.st-devtools-app-nav-item[data-tab="diff"]'),
    ),
    defineStep(
        'diff',
        'diff-base-snapshot-2',
        '.st-devtools-diff-selectors [data-diff-role="base"] select',
        defineInteraction('change', '.st-devtools-diff-selectors [data-diff-role="base"] select', {
            value: 'tutorial:snapshot:2',
        }),
    ),
    defineStep(
        'diff',
        'diff-compare-snapshot-3',
        '.st-devtools-diff-selectors [data-diff-role="compare"] select',
        defineInteraction(
            'change',
            '.st-devtools-diff-selectors [data-diff-role="compare"] select',
            { value: 'tutorial:snapshot:3' },
        ),
    ),
    defineStep(
        'diff',
        'diff-added',
        '.st-devtools-source-change.status-added',
        defineInteraction(
            'toggle',
            '.st-devtools-source-change.status-added',
            { state: 'open' },
        ),
    ),
    defineStep(
        'diff',
        'diff-changed',
        '.st-devtools-source-change.status-changed',
        defineInteraction(
            'toggle',
            '.st-devtools-source-change.status-changed',
            { state: 'open' },
        ),
    ),
    defineStep(
        'diff',
        'diff-removed',
        '.st-devtools-source-change.status-removed',
        defineInteraction(
            'toggle',
            '.st-devtools-source-change.status-removed',
            { state: 'open' },
        ),
    ),
    defineStep(
        'diff',
        'diff-full',
        '.st-devtools-full-diff',
        defineInteraction('toggle', '.st-devtools-full-diff', { state: 'open' }),
    ),

    // 세 번째 연습 스냅샷에서 한국어를 찾아 원본 소스로 이동하고 마칩니다.
    defineStep(
        'search',
        'search-tab',
        '.st-devtools-app-nav-item[data-tab="search"]',
        defineInteraction('click', '.st-devtools-app-nav-item[data-tab="search"]'),
    ),
    defineStep(
        'search',
        'search-snapshot-3',
        '[data-tour-id="snapshot-picker"] select',
        defineInteraction('change', '[data-tour-id="snapshot-picker"] select', {
            value: 'tutorial:snapshot:3',
        }),
    ),
    defineStep(
        'search',
        'search-query-korean',
        '.st-devtools-search-controls input[data-tour-id="search-input"]',
        defineInteraction('input', '.st-devtools-search-controls input[data-tour-id="search-input"]', {
            value: '한국어',
        }),
    ),
    defineStep(
        'search',
        'search-result-main-source',
        '.st-devtools-search-result[data-source-id="tutorial:source:main"]',
        defineInteraction(
            'click',
            '.st-devtools-search-result[data-source-id="tutorial:source:main"]',
        ),
    ),
    defineStep('search', 'search-finish', null),
]);

export function normalizeOnboardingState(value) {
    const hasExplicitVersion = value != null && (
        Object.hasOwn(value, 'schemaVersion')
        || Object.hasOwn(value, 'tourVersion')
    );
    const versionMatches = !hasExplicitVersion || (
        Number(value?.schemaVersion) === SCHEMA_VERSION
        && Number(value?.tourVersion) === ONBOARDING_VERSION
    );
    const disposition = versionMatches && VALID_STATUSES.has(value?.disposition)
        ? value.disposition
        : 'new';
    return Object.freeze({
        schemaVersion: SCHEMA_VERSION,
        tourVersion: ONBOARDING_VERSION,
        disposition,
    });
}

export function readOnboardingState(storage = globalThis.localStorage) {
    try {
        const stored = JSON.parse(storage?.getItem?.(ONBOARDING_STORAGE_KEY) ?? 'null');
        if (
            Number(stored?.schemaVersion) !== SCHEMA_VERSION
            || Number(stored?.tourVersion) !== ONBOARDING_VERSION
        ) {
            return normalizeOnboardingState(null);
        }
        return normalizeOnboardingState(stored);
    } catch {
        return normalizeOnboardingState(null);
    }
}

export function shouldAutoStartOnboarding(state) {
    return normalizeOnboardingState(state).disposition === 'new';
}

export function saveOnboardingState(
    disposition,
    {
        storage = globalThis.localStorage,
    } = {},
) {
    if (!['skipped', 'completed'].includes(disposition)) return null;
    const state = normalizeOnboardingState({
        disposition,
    });
    try {
        const serialized = JSON.stringify(state);
        storage?.setItem?.(ONBOARDING_STORAGE_KEY, serialized);
        if (storage?.getItem?.(ONBOARDING_STORAGE_KEY) !== serialized) return null;
        return state;
    } catch {
        return null;
    }
}
