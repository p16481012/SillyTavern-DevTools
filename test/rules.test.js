import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceDisplayLabel } from '../src/i18n.js';
import { analyzeSnapshot } from '../src/rules.js';

function snapshot(overrides = {}) {
    return {
        finalText: '',
        stats: {
            totalTokens: 2000,
            contextUsage: 0.2,
        },
        sources: [],
        ...overrides,
    };
}

test('legacy source labels are displayed in Korean', () => {
    assert.equal(sourceDisplayLabel({ label: 'Character Description' }), '캐릭터 설명');
    assert.equal(sourceDisplayLabel({ label: 'Lorebook entry 7' }), '로어북 항목 7');
});

test('rule inspector reports critical context and language conflicts', () => {
    const findings = analyzeSnapshot(snapshot({
        finalText: 'Always respond in English. 반드시 한국어로 답변하세요.',
        stats: { totalTokens: 3800, contextUsage: 0.95 },
    }));

    assert.equal(findings.find((item) => item.id === 'context-critical')?.severity, 'critical');
    assert.equal(findings.find((item) => item.id === 'language-conflict')?.severity, 'critical');
});

test('rule inspector detects duplicate sentences across sources', () => {
    const repeated = 'Always keep every response concise and use exactly one paragraph.';
    const findings = analyzeSnapshot(snapshot({
        finalText: repeated,
        sources: [
            { id: 'a', type: 'system', label: 'A', content: repeated, tokenCount: 20, attribution: 'exact' },
            { id: 'b', type: 'extension', label: 'B', content: repeated, tokenCount: 20, attribution: 'exact' },
        ],
    }));

    const duplicate = findings.find((item) => item.id.startsWith('duplicate:'));
    assert.equal(duplicate?.severity, 'warning');
    assert.deepEqual(duplicate?.sourceIds, ['a', 'b']);
});

test('rule inspector flags incompatible output formats and large sources', () => {
    const findings = analyzeSnapshot(snapshot({
        finalText: 'Return JSON only. Respond using XML only.',
        stats: { totalTokens: 2000, contextUsage: 0.3 },
        sources: [{
            id: 'large',
            type: 'system',
            label: 'Large',
            content: 'Return JSON only. Respond using XML only.',
            tokenCount: 1200,
            attribution: 'exact',
        }],
    }));

    assert.equal(findings.find((item) => item.id === 'format-conflict')?.severity, 'warning');
    assert.equal(findings.find((item) => item.id === 'large-source:large')?.severity, 'warning');
});
