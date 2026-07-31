import assert from 'node:assert/strict';
import test from 'node:test';
import {
    appendAuditEntry,
    configurationDigest,
    normalizeAuditLog,
} from '../src/audit-log.js';

test('configuration digests are deterministic and do not expose prompt text', () => {
    const value = { profiles: [{ label: 'secret prompt label', count: 2 }] };
    const digest = configurationDigest(value);
    assert.equal(digest, configurationDigest(structuredClone(value)));
    assert.match(digest, /^config:v1:[0-9a-f]{16}$/u);
    assert.equal(digest.includes('secret'), false);
});

test('audit entries retain only bounded metadata and digests', () => {
    const log = appendAuditEntry({}, {
        action: 'policy.apply',
        before: { prompt: 'private before' },
        after: { prompt: 'private after' },
        summary: {
            profiles: 2,
            matcher: 4,
            invalid_key: 'discarded',
            note: 'safe count only',
        },
        at: '2026-07-31T00:00:00.000Z',
    });
    assert.equal(log.entries[0].action, 'policy.apply');
    assert.equal(log.entries[0].summary.profiles, 2);
    assert.equal('invalid_key' in log.entries[0].summary, false);
    assert.equal(JSON.stringify(log).includes('private'), false);
});

test('audit normalization caps records and rejects malformed actions', () => {
    const entries = Array.from({ length: 240 }, (_, index) => ({
        at: new Date(2026, 0, 1, 0, 0, index).toISOString(),
        action: index === 4 ? '<script>' : 'policy.apply',
        before: configurationDigest(index),
        after: configurationDigest(index + 1),
        summary: { index },
    }));
    const log = normalizeAuditLog({ version: 99, entries });
    assert.equal(log.version, 1);
    assert.equal(log.entries.length, 200);
    assert.equal(log.entries.some(({ action }) => action === '<script>'), false);
});
