import assert from 'node:assert/strict';
import test from 'node:test';

import {
    ONBOARDING_STEPS,
    ONBOARDING_STORAGE_KEY,
    ONBOARDING_VERSION,
    normalizeOnboardingState,
    readOnboardingState,
    saveOnboardingState,
    shouldAutoStartOnboarding,
} from '../src/onboarding.js';

function memoryStorage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        getItem(key) {
            return values.get(key) ?? null;
        },
        setItem(key, value) {
            values.set(key, String(value));
        },
        value(key) {
            return values.get(key) ?? null;
        },
    };
}

test('onboarding defines one immutable capture step and the five product functions', () => {
    assert.equal(ONBOARDING_VERSION, 1);
    assert.equal(Object.isFrozen(ONBOARDING_STEPS), true);
    assert.deepEqual(
        ONBOARDING_STEPS.map(({ id }) => id),
        ['capture', 'explorer', 'rules', 'timeline', 'diff', 'search'],
    );
    assert.equal(new Set(ONBOARDING_STEPS.map(({ id }) => id)).size, 6);
    for (const step of ONBOARDING_STEPS) {
        assert.equal(Object.isFrozen(step), true);
        assert.match(step.target, /^(?:\[data-tour-id=|\.st-devtools-app-nav-item)/u);
        assert.match(step.icon, /^fa-[a-z-]+$/u);
        assert.equal(step.demo, step.id === 'capture' ? 'capture' : step.id);
    }
});

test('new, malformed, and old onboarding state offer the invitation safely', () => {
    for (const value of [
        null,
        {},
        { disposition: 'arbitrary' },
        { schemaVersion: 99, tourVersion: 99, disposition: 'completed' },
    ]) {
        const state = normalizeOnboardingState(value);
        assert.deepEqual(state, {
            schemaVersion: 1,
            tourVersion: 1,
            disposition: 'new',
        });
        assert.equal(Object.isFrozen(state), true);
    }

    const malformed = memoryStorage({
        [ONBOARDING_STORAGE_KEY]: '{not-json',
    });
    assert.equal(readOnboardingState(malformed).disposition, 'new');
    assert.equal(shouldAutoStartOnboarding(readOnboardingState(malformed)), true);

    const old = memoryStorage({
        [ONBOARDING_STORAGE_KEY]: JSON.stringify({
            schemaVersion: 1,
            tourVersion: 0,
            disposition: 'completed',
        }),
    });
    assert.equal(readOnboardingState(old).disposition, 'new');
});

test('only skip or completion persists one bounded global disposition', () => {
    for (const disposition of ['skipped', 'completed']) {
        const storage = memoryStorage();
        const state = saveOnboardingState(disposition, { storage });
        assert.deepEqual(state, {
            schemaVersion: 1,
            tourVersion: 1,
            disposition,
        });
        assert.equal(shouldAutoStartOnboarding(state), false);
        assert.equal(storage.value(ONBOARDING_STORAGE_KEY), JSON.stringify(state));
        assert.deepEqual(
            Object.keys(JSON.parse(storage.value(ONBOARDING_STORAGE_KEY))).sort(),
            ['disposition', 'schemaVersion', 'tourVersion'],
        );
    }

    const storage = memoryStorage();
    assert.equal(saveOnboardingState('in-progress', { storage }), null);
    assert.equal(storage.value(ONBOARDING_STORAGE_KEY), null);
});

test('storage denial never blocks the in-memory onboarding flow', () => {
    const denied = {
        getItem() {
            throw new Error('denied');
        },
        setItem() {
            throw new Error('denied');
        },
    };
    assert.equal(readOnboardingState(denied).disposition, 'new');
    assert.equal(saveOnboardingState('completed', { storage: denied }), null);
});
