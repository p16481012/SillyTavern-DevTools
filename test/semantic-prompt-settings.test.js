import assert from 'node:assert/strict';
import test from 'node:test';

import {
    DEFAULT_SEMANTIC_PROMPT_SETTINGS,
    MAX_SEMANTIC_PREFILL_LENGTH,
    MAX_SEMANTIC_USER_PROMPT_LENGTH,
    SEMANTIC_PROMPT_SETTINGS_KEY,
    normalizeSemanticPromptSettings,
    readSemanticPromptSettings,
    saveSemanticPromptSettings,
} from '../src/semantic-prompt-settings.js';

function storage({ dropWrites = false } = {}) {
    const values = new Map();
    return {
        getItem: (key) => values.get(key) ?? null,
        setItem(key, value) {
            if (!dropWrites) values.set(key, String(value));
        },
    };
}

test('semantic prompt settings normalize newlines and remain locally round-trippable', () => {
    const local = storage();
    const saved = saveSemanticPromptSettings({
        userPrompt: '관점 A\r\n관점 B',
        assistantPrefill: '{"version":1,',
    }, local);

    assert.equal(saved.userPrompt, '관점 A\n관점 B');
    assert.deepEqual(readSemanticPromptSettings(local), saved);
    assert.match(local.getItem(SEMANTIC_PROMPT_SETTINGS_KEY), /관점 A/);
});

test('semantic prompt settings reject controls, oversized values, and silent writes', () => {
    assert.throws(() => normalizeSemanticPromptSettings({
        userPrompt: 'x'.repeat(MAX_SEMANTIC_USER_PROMPT_LENGTH + 1),
    }));
    assert.throws(() => normalizeSemanticPromptSettings({
        assistantPrefill: 'x'.repeat(MAX_SEMANTIC_PREFILL_LENGTH + 1),
    }));
    assert.throws(() => normalizeSemanticPromptSettings({ userPrompt: 'bad\u0000' }));
    assert.throws(() => saveSemanticPromptSettings({}, storage({ dropWrites: true })));
});

test('malformed persisted prompt settings fail closed to defaults', () => {
    const blocked = {
        getItem() {
            throw new Error('blocked');
        },
    };
    assert.deepEqual(readSemanticPromptSettings(blocked), DEFAULT_SEMANTIC_PROMPT_SETTINGS);
});
