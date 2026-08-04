import assert from 'node:assert/strict';
import test from 'node:test';
import {
    HELP_CATEGORIES,
    HELP_LABS,
    HELP_RECENT_LIMIT,
    HELP_TOPICS,
    createHelpLabSession,
    helpTopicById,
    helpTopicsFor,
    normalizeRecentHelpTopics,
    rememberHelpTopic,
    updateHelpLabSession,
} from '../src/help-center.js';

test('help registry keeps unique valid categories, topics and lab links', () => {
    const categoryIds = HELP_CATEGORIES.map(({ id }) => id);
    const topicIds = HELP_TOPICS.map(({ id }) => id);
    const labIds = new Set(HELP_LABS.map(({ id }) => id));
    assert.equal(new Set(categoryIds).size, categoryIds.length);
    assert.equal(new Set(topicIds).size, topicIds.length);
    assert.equal(HELP_TOPICS.length >= 12, true);
    for (const topic of HELP_TOPICS) {
        assert.equal(categoryIds.includes(topic.category), true, topic.id);
        assert.equal(topic.title.length > 0, true, topic.id);
        assert.equal(topic.summary.length > 0, true, topic.id);
        assert.equal(topic.sections.length > 0, true, topic.id);
        if (topic.labId) assert.equal(labIds.has(topic.labId), true, topic.id);
    }
});

test('help lookup supports current-screen filtering and Korean search', () => {
    assert.equal(helpTopicById('comparison-policy')?.labId, 'comparison-policy');
    assert.equal(helpTopicById('missing'), null);
    assert.equal(
        helpTopicsFor({ tabId: 'diff' }).every(({ tabId }) => tabId === 'diff'),
        true,
    );
    assert.deepEqual(
        helpTopicsFor({ query: '대안 그룹' }).map(({ id }) => id),
        ['comparison-policy', 'diff-statuses'],
    );
    assert.deepEqual(
        helpTopicsFor({ query: '정규식' }).map(({ id }) => id),
        ['search-overview'],
    );
});

test('recent help topics are bounded, unique and limited to registered topics', () => {
    const recent = normalizeRecentHelpTopics([
        'diff-overview',
        'missing',
        'diff-overview',
        'semantic-ai',
        'comparison-policy',
        'capture-status',
    ]);
    assert.deepEqual(recent, [
        'diff-overview',
        'semantic-ai',
        'comparison-policy',
    ]);
    assert.equal(recent.length, HELP_RECENT_LIMIT);
    assert.deepEqual(
        rememberHelpTopic(recent, 'capture-status'),
        ['capture-status', 'diff-overview', 'semantic-ai'],
    );
});

test('comparison policy lab is deterministic and isolated from product state', () => {
    const initial = createHelpLabSession('comparison-policy');
    assert.deepEqual(initial.isolation, {
        dummyData: true,
        writesStorage: false,
        sendsProviderRequest: false,
        incursCost: false,
    });
    const named = updateHelpLabSession(initial, {
        type: 'choose-matcher',
        value: '{group} | {option}',
    });
    const grouped = updateHelpLabSession(named, {
        type: 'choose-mode',
        value: 'alternative',
    });
    const previewed = updateHelpLabSession(grouped, { type: 'preview' });
    const completed = updateHelpLabSession(previewed, { type: 'finish' });
    assert.equal(initial.step, 0);
    assert.equal(previewed.status, 'previewed');
    assert.equal(completed.completed, true);
    assert.deepEqual(
        updateHelpLabSession(completed, { type: 'reset' }),
        initial,
    );
});

test('AI semantic lab requires preview and consent but never exposes a provider path', () => {
    const initial = createHelpLabSession('semantic-ai');
    const selected = updateHelpLabSession(initial, {
        type: 'select-finding',
        value: 'language-conflict',
    });
    const previewed = updateHelpLabSession(selected, { type: 'preview' });
    const blocked = updateHelpLabSession(previewed, { type: 'run' });
    const consented = updateHelpLabSession(previewed, {
        type: 'consent',
        value: true,
    });
    const running = updateHelpLabSession(consented, { type: 'run' });
    const completed = updateHelpLabSession(running, { type: 'complete' });
    assert.equal(blocked, previewed);
    assert.equal(running.status, 'running');
    assert.equal(completed.status, 'complete');
    assert.equal(completed.completed, true);
    assert.equal(completed.isolation.sendsProviderRequest, false);
    assert.equal(completed.isolation.incursCost, false);
});
