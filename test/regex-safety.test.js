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
    assert.equal(validateUserRegex('출력언어\\s*[|:]\\s*(?<option>\\S.*)').ok, true);
    assert.equal(
        validateUserRegex('(?<group>[^:]+)::(?<option>.+)').ok,
        true,
    );
    assert.equal(validateUserRegex('^\\d+\\.\\d+$').ok, true);
    assert.equal(validateUserRegex('^a+b+c+$').ok, true);
    assert.equal(validateUserRegex('\\(\\?=literal').ok, true);
    assert.equal(validateUserRegex('^\\\\b+$').ok, true);
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
        '(?:(?:a+))+$',
        '((a+))+$',
        '(?:(?:a|aa))+$',
        '(?:a?b?c?d?e?f?g?)*$',
        'a*a*a*a*a*a*a*a*a*a*b',
        '.*prefix.*suffix.*',
        '(?<value>.+)\\1',
    ]) {
        assert.equal(validateUserRegex(pattern).code, 'unsafe-regex', pattern);
    }
});

test('ambiguous adjacent repetitions and every lookaround are rejected', () => {
    for (const pattern of [
        '^a+a+a+a+a+a+$',
        '^a+a+$',
        '^\\w+\\w+$',
        '^[^:]+[^:]+$',
        '^(a+)(a+)(a+)(a+)(a+)(a+)$',
        '^(?:a+)(?:a+)(?:a+)(?:a+)(?:a+)(?:a+)$',
        '^(a|aa)(a|aa)(a|aa)(a|aa)(a|aa)(a|aa)$',
        '^(ab)+(ab)+$',
        '^[a]+a+[a]+a+[a]+a+$',
        '^a+[a]+a+[a]+a+[a]+$',
        '^\\p{L}+a+\\p{L}+a+\\p{L}+a+$',
        '^\\x61+a+$',
        '^\\u0061+a+$',
        '^\\u{61}+a+$',
        '^\\t+\\x09+\\t+\\x09+\\t+\\x09+$',
        '^\\n+\\x0a+\\n+\\x0a+\\n+\\x0a+$',
        '^\\0+\\x00+\\0+\\x00+\\0+\\x00+$',
        '^a?a?a?a?a?a?a?a?a?a?a?a?a?a?a?a?a?a?a?a?a?a?a?a?b$',
        '^a{0,2}a{0,2}a{0,2}a{0,2}a{0,2}a{0,2}b$',
        '^a+\\Ba+\\Ba+\\Ba+\\Ba+\\Ba+$',
        '^😀+😀+😀+😀+😀+😀+$',
        '^\\uD83D\\uDE00+\\uD83D\\uDE00+\\uD83D\\uDE00+$',
        '^\\s*.+X$',
        '^(?i:a+)(?i:a+)(?i:a+)(?i:a+)(?i:a+)(?i:a+)$',
        '^a+b{0}a+b{0}a+b{0}a+b{0}a+b{0}a+$',
        '^a+b{0,0}a+b{0,0}a+b{0,0}a+b{0,0}a+$',
        '^s+ſ+s+ſ+s+ſ+$',
        '^σ+ς+σ+ς+σ+ς+$',
        '(?=prefix)prefix.+',
        '(?!private).+',
        '(?<=:)value',
        '(?<!:)value',
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
