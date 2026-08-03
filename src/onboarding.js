export const ONBOARDING_VERSION = 1;
export const ONBOARDING_STORAGE_KEY = 'st-devtools:onboarding:v1';

const VALID_STATUSES = new Set(['new', 'skipped', 'completed']);

export const ONBOARDING_STEPS = Object.freeze([
    Object.freeze({
        id: 'capture',
        tabId: 'explorer',
        target: '[data-tour-id="capture-status"]',
        icon: 'fa-circle-dot',
        demo: 'capture',
    }),
    Object.freeze({
        id: 'explorer',
        tabId: 'explorer',
        target: '.st-devtools-app-nav-item[data-tab="explorer"]',
        icon: 'fa-layer-group',
        demo: 'explorer',
    }),
    Object.freeze({
        id: 'rules',
        tabId: 'rules',
        target: '.st-devtools-app-nav-item[data-tab="rules"]',
        icon: 'fa-shield-halved',
        demo: 'rules',
    }),
    Object.freeze({
        id: 'timeline',
        tabId: 'timeline',
        target: '.st-devtools-app-nav-item[data-tab="timeline"]',
        icon: 'fa-clock-rotate-left',
        demo: 'timeline',
    }),
    Object.freeze({
        id: 'diff',
        tabId: 'diff',
        target: '.st-devtools-app-nav-item[data-tab="diff"]',
        icon: 'fa-code-compare',
        demo: 'diff',
    }),
    Object.freeze({
        id: 'search',
        tabId: 'search',
        target: '.st-devtools-app-nav-item[data-tab="search"]',
        icon: 'fa-magnifying-glass',
        demo: 'search',
    }),
]);

export function normalizeOnboardingState(value) {
    const hasExplicitVersion = value != null && (
        Object.hasOwn(value, 'schemaVersion')
        || Object.hasOwn(value, 'tourVersion')
    );
    const versionMatches = !hasExplicitVersion || (
        Number(value?.schemaVersion) === 1
        && Number(value?.tourVersion) === ONBOARDING_VERSION
    );
    const disposition = versionMatches && VALID_STATUSES.has(value?.disposition)
        ? value.disposition
        : 'new';
    return Object.freeze({
        schemaVersion: 1,
        tourVersion: ONBOARDING_VERSION,
        disposition,
    });
}

export function readOnboardingState(storage = globalThis.localStorage) {
    try {
        const stored = JSON.parse(storage?.getItem?.(ONBOARDING_STORAGE_KEY) ?? 'null');
        if (
            Number(stored?.schemaVersion) !== 1
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
