import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
    listSemanticConnectionProfiles,
    normalizeSemanticConnectionProfileId,
    resolveSemanticConnectionProfile,
} from '../src/semantic-connection-profiles.js';

test('profile discovery fails closed when the public Connection Manager API is unavailable', () => {
    for (const context of [null, {}, {
        get ConnectionManagerRequestService() {
            throw new Error('unavailable');
        },
    }, {
        ConnectionManagerRequestService: {
            get getSupportedProfiles() {
                throw new Error('unavailable');
            },
        },
    }]) {
        const result = listSemanticConnectionProfiles(context);
        assert.deepEqual(result, { status: 'unavailable', profiles: [] });
        assert.equal(Object.isFrozen(result), true);
        assert.equal(Object.isFrozen(result.profiles), true);
    }
});

test('profile discovery exposes only bounded display fields and never reads secrets', () => {
    let secretReads = 0;
    const profile = {
        id: 'profile-chat',
        mode: 'cc',
        name: '분석 전용',
        api: 'openai',
        model: 'semantic-model',
        get 'secret-id'() {
            secretReads += 1;
            throw new Error('must not be read');
        },
        get 'api-url'() {
            secretReads += 1;
            throw new Error('must not be read');
        },
    };
    const service = {
        getSupportedProfiles: () => [profile],
        validateProfile: () => ({
            selected: 'openai',
            source: 'openrouter',
        }),
        sendRequest: async () => ({ content: '{}' }),
    };
    const result = listSemanticConnectionProfiles({
        ConnectionManagerRequestService: service,
        get extensionSettings() {
            throw new Error('private settings must not be traversed');
        },
    });

    assert.deepEqual(result, {
        status: 'available',
        profiles: [{
            id: 'profile-chat',
            name: '분석 전용',
            provider: 'openrouter',
            model: 'semantic-model',
            completionType: 'chat-completion',
        }],
    });
    assert.equal(secretReads, 0);
    assert.deepEqual(Object.keys(result.profiles[0]).sort(), [
        'completionType',
        'id',
        'model',
        'name',
        'provider',
    ]);
    assert.equal(Object.isFrozen(result.profiles[0]), true);
});

test('older public services can use profile mode and invalid or duplicate ids are filtered', () => {
    const service = {
        getSupportedProfiles: () => [
            {
                id: 'text-profile',
                mode: 'tc',
                name: 'Text',
                api: 'aphrodite',
                model: 'text-model',
            },
            {
                id: 'text-profile',
                mode: 'tc',
                name: 'Duplicate',
                api: 'aphrodite',
            },
            {
                id: 'bad\nprofile',
                mode: 'cc',
                api: 'openai',
            },
        ],
        sendRequest: async () => ({ content: '{}' }),
    };
    const context = { ConnectionManagerRequestService: service };
    const result = listSemanticConnectionProfiles(context);

    assert.deepEqual(result, {
        status: 'available',
        profiles: [{
            id: 'text-profile',
            name: 'Text',
            provider: 'aphrodite',
            model: 'text-model',
            completionType: 'text-completion',
        }],
    });
    const resolved = resolveSemanticConnectionProfile(context, 'text-profile');
    assert.equal(resolved.service, service);
    assert.deepEqual(resolved.profile, result.profiles[0]);
    assert.equal(Object.hasOwn(resolved, 'rawProfile'), false);
});

test('opaque ids are exact, bounded, and missing selections do not resolve', () => {
    assert.equal(normalizeSemanticConnectionProfileId(' profile '), ' profile ');
    assert.equal(normalizeSemanticConnectionProfileId(null), null);
    assert.equal(normalizeSemanticConnectionProfileId('x'.repeat(257)), null);
    assert.equal(resolveSemanticConnectionProfile({}, 'missing'), null);
});

test('profile integration uses the public service instead of private settings or transports', async () => {
    const source = await readFile(
        new URL('../src/semantic-connection-profiles.js', import.meta.url),
        'utf8',
    );
    assert.doesNotMatch(source, /extensionSettings|connectionManager|\bfetch\s*\(/u);
    assert.doesNotMatch(source, /secret-id|api-url|proxy_password|api[_-]?key/iu);
});
