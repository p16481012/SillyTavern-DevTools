import assert from 'node:assert/strict';
import test from 'node:test';
import {
    USER_REGEX_MAX_GROUPS,
    USER_REGEX_MAX_LENGTH,
    compileUserRegex,
    validateUserRegex,
} from '../src/regex-safety.js';

test('safe user regular expressions compile with requested flags', () => {
    const expression = compileUserRegex('(?<group>[^|]+)\\|(?<option>.+)', 'giu');
    assert.equal(expression.global, true);
    assert.equal(expression.ignoreCase, true);
    assert.equal(validateUserRegex('출력언어\\s*[|:]\\s*(?<option>.+)').ok, true);
});

test('user regular expressions reject excessive and high-risk patterns', () => {
    assert.deepEqual(validateUserRegex(''), { ok: false, code: 'empty-pattern' });
    assert.equal(
        validateUserRegex('a'.repeat(USER_REGEX_MAX_LENGTH + 1)).code,
        'regex-too-long',
    );
    assert.equal(
        validateUserRegex(
            Array.from({ length: USER_REGEX_MAX_GROUPS + 1 }, (_, index) => (
                `(?<g${index}>a)`
            )).join(''),
        ).code,
        'unsafe-regex',
    );
    for (const pattern of [
        '(a+)+$',
        '(a|aa)+$',
        '.*prefix.*suffix.*',
        '(?<value>.+)\\1',
    ]) {
        assert.equal(validateUserRegex(pattern).code, 'unsafe-regex', pattern);
    }
});

test('invalid syntax remains distinguishable from unsafe syntax', () => {
    assert.equal(validateUserRegex('([').code, 'invalid-regex');
    assert.throws(
        () => compileUserRegex('(['),
        (error) => error.code === 'invalid-regex',
    );
});

test('bounded fuzz patterns always validate without throwing', () => {
    const alphabet = 'abc()[]{}*+?|.^$\\0123456789';
    let state = 0x5eed1234;
    for (let sample = 0; sample < 2000; sample += 1) {
        let pattern = '';
        const length = 1 + (sample % 96);
        for (let index = 0; index < length; index += 1) {
            state = ((state * 1664525) + 1013904223) >>> 0;
            pattern += alphabet[state % alphabet.length];
        }
        const result = validateUserRegex(pattern);
        assert.equal(typeof result.ok, 'boolean');
        assert.equal(result.ok || typeof result.code === 'string', true);
    }
});
