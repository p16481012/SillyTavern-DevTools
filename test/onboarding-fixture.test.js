import assert from 'node:assert/strict';
import test from 'node:test';
import {
    ONBOARDING_CAPTURE_SNAPSHOT,
    ONBOARDING_FIXTURE,
    ONBOARDING_FIXTURE_SNAPSHOTS,
    ONBOARDING_INITIAL_SNAPSHOTS,
    createOnboardingSession,
} from '../src/onboarding-fixture.js';
import { searchSnapshot } from '../src/model.js';
import { compareSnapshotSources } from '../src/pipeline-analysis.js';
import { analyzeSnapshot } from '../src/rules.js';

function assertDeepFrozen(value, seen = new WeakSet()) {
    if (value === null || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    assert.equal(Object.isFrozen(value), true);
    for (const key of Reflect.ownKeys(value)) {
        assertDeepFrozen(value[key], seen);
    }
}

function collectStrings(value, result = [], seen = new WeakSet()) {
    if (typeof value === 'string') {
        result.push(value);
        return result;
    }
    if (value === null || typeof value !== 'object' || seen.has(value)) return result;
    seen.add(value);
    for (const child of Object.values(value)) collectStrings(child, result, seen);
    return result;
}

test('onboarding fixture is deeply frozen, deterministic, and sessions remain mutable', () => {
    assertDeepFrozen(ONBOARDING_FIXTURE);
    assertDeepFrozen(ONBOARDING_FIXTURE_SNAPSHOTS);
    assertDeepFrozen(ONBOARDING_INITIAL_SNAPSHOTS);
    assertDeepFrozen(ONBOARDING_CAPTURE_SNAPSHOT);

    const serialized = JSON.stringify(ONBOARDING_FIXTURE);
    assert.equal(JSON.stringify(ONBOARDING_FIXTURE), serialized);

    const first = createOnboardingSession();
    const second = createOnboardingSession();
    assert.notEqual(first, second);
    assert.notEqual(first.timeline, second.timeline);
    assert.notEqual(first.availableTimeline, second.availableTimeline);
    assert.notEqual(first.openSourceIds, second.openSourceIds);
    assert.notEqual(first.completedActions, second.completedActions);
    assert.equal(Object.isFrozen(first), false);

    first.tabId = 'rules';
    first.timeline.push(ONBOARDING_CAPTURE_SNAPSHOT);
    first.openSourceIds.add('tutorial:source:main');
    first.completedActions.add('tutorial:capture');
    assert.equal(second.tabId, 'explorer');
    assert.equal(second.timeline.length, 2);
    assert.equal(second.openSourceIds.size, 0);
    assert.equal(second.completedActions.size, 0);
});

test('onboarding snapshots contain exact ranges, provenance, request data, and full privacy flags', () => {
    assert.equal(ONBOARDING_FIXTURE_SNAPSHOTS.length, 3);
    assert.deepEqual(
        ONBOARDING_FIXTURE_SNAPSHOTS.map((snapshot) => snapshot.stats.totalTokens),
        [920, 1080, 1248],
    );

    for (const snapshot of ONBOARDING_FIXTURE_SNAPSHOTS) {
        assert.match(snapshot.id, /^tutorial:/u);
        assert.match(snapshot.chatId, /^tutorial:/u);
        assert.match(snapshot.requestId, /^tutorial:/u);
        assert.equal(snapshot.provider, 'vertexai');
        assert.equal(snapshot.model, 'gemini-3.1-pro-preview');
        assert.equal(
            snapshot.payload.length,
            snapshot.sources.filter((source) => (
                source.type !== 'final' && source.included === true
            )).length,
        );
        assert.equal(snapshot.request.body.messages, snapshot.payload);
        assert.deepEqual(snapshot.privacy, {
            schemaVersion: 1,
            mode: 'full',
            digestAlgorithm: 'SHA-256',
            rawPromptContentIncluded: true,
            rawChatIdIncluded: true,
            rawRequestIdIncluded: true,
            originalSchemaVersion: 7,
        });

        const promptSources = snapshot.sources.filter((source) => (
            source.type !== 'final' && source.included === true
        ));
        assert.equal(
            promptSources.reduce((sum, source) => sum + source.tokenCount, 0),
            snapshot.stats.totalTokens,
        );

        for (const source of promptSources) {
            assert.match(source.id, /^tutorial:/u);
            assert.equal(source.ranges.length, 1);
            assert.equal(source.provenance.locations.length, 1);
            const range = source.ranges[0];
            assert.equal(snapshot.finalText.slice(range.start, range.end), source.content);
            assert.deepEqual(source.provenance.locations[0].finalRange, range);
        }

        const disabled = snapshot.sources.find(
            ({ id }) => id === 'tutorial:source:disabled-language',
        );
        assert.equal(disabled?.included, false);
        assert.equal(disabled?.configuredEnabled, false);
        assert.deepEqual(disabled?.ranges, []);

        const finalSource = snapshot.sources.at(-1);
        assert.match(finalSource.id, /^tutorial:/u);
        assert.equal(finalSource.type, 'final');
        assert.equal(finalSource.content, snapshot.finalText);
        assert.deepEqual(finalSource.ranges, [{ start: 0, end: snapshot.finalText.length }]);
        assert.deepEqual(
            finalSource.provenance.locations[0].finalRange,
            finalSource.ranges[0],
        );
    }
});

test('latest onboarding snapshot exercises the real static format-conflict rule', () => {
    const findings = analyzeSnapshot(ONBOARDING_CAPTURE_SNAPSHOT);
    const formatFinding = findings.find((finding) => (
        finding.ruleId === 'format' || finding.id === 'format-conflict'
    ));

    assert.ok(formatFinding);
    assert.equal(formatFinding.sourceIds.includes('tutorial:source:main'), true);
    assert.equal(formatFinding.sourceIds.includes('tutorial:source:output'), true);
});

test('practice capture produces added, changed, and removed source differences', () => {
    const differences = compareSnapshotSources(
        ONBOARDING_INITIAL_SNAPSHOTS[1],
        ONBOARDING_CAPTURE_SNAPSHOT,
    );
    const bySourceId = new Map(differences.map((difference) => [
        difference.source.id,
        difference,
    ]));

    assert.equal(bySourceId.get('tutorial:source:emotion')?.status, 'added');
    assert.equal(bySourceId.get('tutorial:source:output')?.status, 'changed');
    assert.equal(bySourceId.get('tutorial:source:summary')?.status, 'removed');
    assert.deepEqual(
        [...new Set(differences.map(({ status }) => status))].sort(),
        ['added', 'changed', 'removed'],
    );
});

test('Korean search term finds the Main Prompt through the product search path', () => {
    const results = searchSnapshot(ONBOARDING_CAPTURE_SNAPSHOT, '한국어');
    assert.equal(
        results.some(({ sourceId }) => sourceId === 'tutorial:source:main'),
        true,
    );
});

test('fixture contains no external URL, credential, or synthetic PII-shaped value', () => {
    const text = collectStrings(ONBOARDING_FIXTURE).join('\n');
    const forbidden = [
        /https?:\/\//iu,
        /www\./iu,
        /[\w.+-]+@[\w.-]+\.[a-z]{2,}/iu,
        /\b(?:\d{1,3}\.){3}\d{1,3}\b/u,
        /\b01[016789][ -]?\d{3,4}[ -]?\d{4}\b/u,
        /\b(?:api[_-]?key|authorization|bearer|password|secret)\b/iu,
        /-----BEGIN [A-Z ]+PRIVATE KEY-----/u,
    ];

    for (const expression of forbidden) assert.doesNotMatch(text, expression);
});

test('session reveals two snapshots initially and the third after practice capture', () => {
    const session = createOnboardingSession();
    assert.deepEqual(
        session.timeline.map(({ id }) => id),
        ['tutorial:snapshot:1', 'tutorial:snapshot:2'],
    );
    assert.deepEqual(
        session.availableTimeline.map(({ id }) => id),
        ['tutorial:snapshot:1', 'tutorial:snapshot:2', 'tutorial:snapshot:3'],
    );
    assert.equal(session.selectedId, 'tutorial:snapshot:2');
    assert.equal(session.captureState, 'waiting');

    session.timeline.push(ONBOARDING_CAPTURE_SNAPSHOT);
    session.selectedId = ONBOARDING_CAPTURE_SNAPSHOT.id;
    session.captureState = 'saved';
    session.completedActions.add('tutorial:capture');

    assert.equal(session.timeline.length, 3);
    assert.equal(session.selectedId, 'tutorial:snapshot:3');
    assert.equal(session.captureState, 'saved');
    assert.equal(session.completedActions.has('tutorial:capture'), true);
});

test('section checkpoints expose only the safe prerequisite state', () => {
    const expected = new Map([
        ['timeline', 'tutorial:snapshot:3'],
        ['rules', 'tutorial:snapshot:3'],
        ['advanced', 'tutorial:snapshot:3'],
        ['diff', 'tutorial:snapshot:2'],
        ['search', 'tutorial:snapshot:2'],
    ]);
    for (const [checkpoint, selectedId] of expected) {
        const session = createOnboardingSession({ checkpoint });
        assert.equal(session.timeline.length, 3);
        assert.equal(session.selectedId, selectedId);
        assert.equal(session.captureState, 'saved');
        assert.equal(session.capturePhase, 'complete');
        assert.equal(session.completedActions.size, 0);
        assert.equal(session.skippedActions.size, 0);
    }
    const full = createOnboardingSession({ checkpoint: 'full' });
    assert.equal(full.timeline.length, 2);
    assert.equal(full.captureState, 'waiting');
    assert.equal(full.capturePhase, 'awaiting-practice');
});
