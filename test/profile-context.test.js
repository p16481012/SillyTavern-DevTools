import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createProfileContext,
    normalizeProfileContext,
    scopeFingerprint,
} from '../src/profile-context.js';

test('profile context stores versioned fingerprints instead of raw scope identifiers', () => {
    const context = createProfileContext({
        chatId: 'private-chat-123',
        preset: { id: 'preset-id', name: 'My preset' },
        character: { avatar: 'alice.png', name: 'Alice' },
        characterId: 3,
    });

    assert.equal(context.version, 1);
    assert.equal(context.global.key, '*');
    assert.match(context.chat.key, /^scope-v1:/u);
    assert.match(context.preset.key, /^scope-v1:/u);
    assert.match(context.character.key, /^scope-v1:/u);
    assert.equal(JSON.stringify(context).includes('private-chat-123'), true);
    assert.equal(context.chat.key.includes('private-chat-123'), false);
    assert.equal(context.preset.label, 'My preset');
    assert.equal(context.character.label, 'Alice');
});

test('scope fingerprints normalize Unicode and whitespace deterministically', () => {
    assert.equal(
        scopeFingerprint('preset', 'Ａ  B'),
        scopeFingerprint('preset', 'a b'),
    );
    assert.notEqual(
        scopeFingerprint('preset', 'same'),
        scopeFingerprint('chat', 'same'),
    );
    assert.equal(
        scopeFingerprint('preset', 'I İ'),
        'scope-v1:32:d90ca8a8144899ac',
    );
});

test('preset scope includes its API namespace when available', () => {
    const openAi = createProfileContext({
        preset: { id: 'default', name: 'Default' },
        presetNamespace: 'openai',
    });
    const textCompletion = createProfileContext({
        preset: { id: 'default', name: 'Default' },
        presetNamespace: 'textgenerationwebui',
    });
    const repeated = createProfileContext({
        preset: { id: 'default', name: 'Renamed display label' },
        presetNamespace: 'openai',
    });

    assert.notEqual(openAi.preset.key, textCompletion.preset.key);
    assert.equal(openAi.preset.key, repeated.preset.key);
});

test('chat scope includes its character or group owner without changing ownerless fallback', () => {
    const ownerless = createProfileContext({ chatId: 'shared-chat' });
    const alice = createProfileContext({
        chatId: 'shared-chat',
        character: { avatar: 'alice.png', name: 'Alice' },
        characterId: 1,
    });
    const bob = createProfileContext({
        chatId: 'shared-chat',
        character: { avatar: 'bob.png', name: 'Bob' },
        characterId: 2,
    });
    const firstGroup = createProfileContext({
        chatId: 'shared-chat',
        group: { id: 'group-a', name: 'A' },
        groupId: 'group-a',
    });
    const secondGroup = createProfileContext({
        chatId: 'shared-chat',
        group: { id: 'group-b', name: 'B' },
        groupId: 'group-b',
    });

    assert.equal(ownerless.chat.key, scopeFingerprint('chat', 'shared-chat'));
    assert.notEqual(alice.chat.key, bob.chat.key);
    assert.notEqual(firstGroup.chat.key, secondGroup.chat.key);
    assert.notEqual(firstGroup.chat.key, alice.chat.key);
    assert.equal(
        firstGroup.chat.key,
        createProfileContext({
            chatId: 'shared-chat',
            groupId: 'group-a',
            character: { avatar: 'different-member.png' },
        }).chat.key,
    );
});

test('profile context normalization rejects malformed entries and bounds labels', () => {
    const normalized = normalizeProfileContext({
        preset: { key: '', label: 'ignored' },
        chat: { key: 'scope-v1:key', label: 'x'.repeat(500) },
    });
    assert.equal(normalized.preset, null);
    assert.equal(normalized.chat.label.length, 120);
});
