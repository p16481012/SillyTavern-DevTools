import assert from 'node:assert/strict';
import test from 'node:test';

import {
    ONBOARDING_GROUPS,
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

test('onboarding defines six immutable groups and a detailed immutable walkthrough', () => {
    assert.equal(ONBOARDING_VERSION, 2);
    assert.equal(ONBOARDING_STORAGE_KEY, 'st-devtools:onboarding:v2');
    assert.equal(Object.isFrozen(ONBOARDING_GROUPS), true);
    assert.deepEqual(
        ONBOARDING_GROUPS.map(({ id }) => id),
        ['capture', 'explorer', 'rules', 'timeline', 'diff', 'search'],
    );
    for (const group of ONBOARDING_GROUPS) {
        assert.equal(Object.isFrozen(group), true);
        assert.match(group.icon, /^fa-[a-z-]+$/u);
    }

    const expectedCounts = {
        capture: 3,
        explorer: 10,
        rules: 7,
        timeline: 6,
        diff: 7,
        search: 5,
    };
    const validGroups = new Set(ONBOARDING_GROUPS.map(({ id }) => id));
    const validTabs = new Set(['explorer', 'rules', 'timeline', 'diff', 'search']);
    const validEvents = new Set(['click', 'change', 'input', 'toggle', 'panel']);
    const counts = Object.fromEntries([...validGroups].map((group) => [group, 0]));

    assert.equal(Object.isFrozen(ONBOARDING_STEPS), true);
    assert.ok(ONBOARDING_STEPS.length >= 35);
    assert.equal(new Set(ONBOARDING_STEPS.map(({ id }) => id)).size, ONBOARDING_STEPS.length);

    let actionCount = 0;
    for (const step of ONBOARDING_STEPS) {
        assert.equal(Object.isFrozen(step), true);
        assert.equal(typeof step.id, 'string');
        assert.ok(step.id.length > 0);
        assert.equal(validGroups.has(step.group), true);
        assert.equal(validTabs.has(step.tabId), true);
        assert.equal(step.target === null || (typeof step.target === 'string' && step.target.length > 0), true);
        assert.match(step.icon, /^fa-[a-z-]+$/u);
        counts[step.group] += 1;

        const group = ONBOARDING_GROUPS.find(({ id }) => id === step.group);
        assert.equal(step.tabId, group.tabId);
        assert.equal(step.icon, group.icon);

        if (step.interaction) {
            actionCount += 1;
            assert.equal(Object.isFrozen(step.interaction), true);
            assert.equal(validEvents.has(step.interaction.event), true);
            assert.equal(typeof step.interaction.selector, 'string');
            assert.ok(step.interaction.selector.length > 0);
            assert.deepEqual(
                Object.keys(step.interaction).every((key) => ['event', 'selector', 'value', 'state'].includes(key)),
                true,
            );
        }
    }

    assert.deepEqual(counts, expectedCounts);
    assert.equal(Object.values(counts).every((count) => count > 1), true);
    assert.ok(actionCount >= 15);
});

test('new, malformed, and v1 onboarding state offer the v2 invitation safely', () => {
    for (const value of [
        null,
        {},
        { disposition: 'arbitrary' },
        { schemaVersion: 99, tourVersion: 99, disposition: 'completed' },
        { schemaVersion: 1, tourVersion: 1, disposition: 'completed' },
    ]) {
        const state = normalizeOnboardingState(value);
        assert.deepEqual(state, {
            schemaVersion: 1,
            tourVersion: 2,
            disposition: 'new',
        });
        assert.equal(Object.isFrozen(state), true);
    }

    const malformed = memoryStorage({
        [ONBOARDING_STORAGE_KEY]: '{not-json',
    });
    assert.equal(readOnboardingState(malformed).disposition, 'new');
    assert.equal(shouldAutoStartOnboarding(readOnboardingState(malformed)), true);

    const v1InCurrentKey = memoryStorage({
        [ONBOARDING_STORAGE_KEY]: JSON.stringify({
            schemaVersion: 1,
            tourVersion: 1,
            disposition: 'completed',
        }),
    });
    assert.equal(readOnboardingState(v1InCurrentKey).disposition, 'new');

    const oldKeyOnly = memoryStorage({
        'st-devtools:onboarding:v1': JSON.stringify({
            schemaVersion: 1,
            tourVersion: 1,
            disposition: 'completed',
        }),
    });
    assert.equal(readOnboardingState(oldKeyOnly).disposition, 'new');
});

test('only skip or completion persists one bounded global disposition', () => {
    for (const disposition of ['skipped', 'completed']) {
        const storage = memoryStorage();
        const state = saveOnboardingState(disposition, { storage });
        assert.deepEqual(state, {
            schemaVersion: 1,
            tourVersion: 2,
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
