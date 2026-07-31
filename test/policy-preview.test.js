import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPolicyChangePreview } from '../src/policy-preview.js';
import { DEFAULT_RULE_SETTINGS } from '../src/rules.js';

function source(identifier, label, content) {
    return {
        id: `utility:${identifier}`,
        type: 'utility',
        label,
        content,
        tokenCount: 10,
        attribution: 'exact',
        included: true,
        configuredEnabled: true,
        ranges: [],
        metadata: {
            sourceKind: 'configuredPrompt',
            identifier,
            name: label,
            enabled: true,
            configuredEnabled: true,
        },
    };
}

function snapshot() {
    const sources = [
        source('ko', '출력언어 | 한국어', '항상 한국어로 답하세요.'),
        source('en', '출력언어 | 영어', 'Always respond in English.'),
    ];
    let cursor = 0;
    for (const item of sources) {
        item.ranges = [{ start: cursor, end: cursor + item.content.length }];
        cursor += item.content.length + 1;
    }
    return {
        chatId: 'chat',
        finalText: sources.map(({ content }) => content).join('\n'),
        stats: { totalTokens: 100, contextUsage: 0.95 },
        sources,
    };
}

test('policy preview reports stable finding and assignment deltas', () => {
    const current = snapshot();
    const afterPolicy = {
        nameRules: [{
            id: 'language',
            kind: 'template',
            pattern: '{group} | {option}',
            mode: 'alternative',
            categories: ['language'],
        }],
    };
    const preview = buildPolicyChangePreview(current, undefined, {}, afterPolicy);
    assert.equal(preview.findingDelta.added > 0, true);
    assert.equal(preview.assignmentChanges.length, 2);

    const unchanged = buildPolicyChangePreview(
        current,
        undefined,
        afterPolicy,
        structuredClone(afterPolicy),
    );
    assert.deepEqual(unchanged.findingDelta, {
        added: 0,
        removed: 0,
        unchanged: unchanged.before.findings,
    });
    assert.equal(unchanged.assignmentChanges.length, 0);
});

test('policy preview compares saved and imported rule settings independently', () => {
    const current = snapshot();
    const disabled = {
        ...DEFAULT_RULE_SETTINGS,
        enabled: Object.fromEntries(
            Object.keys(DEFAULT_RULE_SETTINGS.enabled).map((id) => [id, false]),
        ),
    };
    const preview = buildPolicyChangePreview(
        current,
        DEFAULT_RULE_SETTINGS,
        {},
        {},
        disabled,
    );

    assert.equal(preview.before.findings > 0, true);
    assert.equal(preview.after.findings, 0);
    assert.equal(preview.findingDelta.removed, preview.before.findings);
});
