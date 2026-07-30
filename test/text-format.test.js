import test from 'node:test';
import assert from 'node:assert/strict';
import { descriptionParagraphs } from '../src/text-format.js';

test('description paragraphs break after every sentence-ending period', () => {
    assert.deepEqual(
        descriptionParagraphs(
            '첫 번째 설명입니다. 두 번째 설명입니다. 마지막 설명에는 마침표가 없습니다',
        ),
        [
            '첫 번째 설명입니다.',
            '두 번째 설명입니다.',
            '마지막 설명에는 마침표가 없습니다',
        ],
    );
});

test('examples stay intact and always begin an independent paragraph', () => {
    assert.deepEqual(
        descriptionParagraphs(
            '설명 뒤에 마침표가 없습니다 예: {group} | {option}. 다음 설명입니다.',
        ),
        [
            '설명 뒤에 마침표가 없습니다',
            '예: {group} | {option}.',
            '다음 설명입니다.',
        ],
    );
    assert.deepEqual(
        descriptionParagraphs('설명입니다 ex. alpha option. e.g. beta option.'),
        [
            '설명입니다',
            'ex. alpha option.',
            'e.g. beta option.',
        ],
    );
});

test('version numbers, decimals, and URL dots are not treated as sentence endings', () => {
    assert.deepEqual(
        descriptionParagraphs(
            'v0.8.6에서 임계값 1.5를 사용합니다. https://example.com/v1.2/docs와 config.json, foo@example.com도 유지합니다.',
        ),
        [
            'v0.8.6에서 임계값 1.5를 사용합니다.',
            'https://example.com/v1.2/docs와 config.json, foo@example.com도 유지합니다.',
        ],
    );
});

test('common abbreviations and closing punctuation stay with their sentence', () => {
    assert.deepEqual(
        descriptionParagraphs(
            'Dr. Smith가 설명합니다. “완료했습니다.” 다음 문장입니다. ex. Use JSON. Then continue.',
        ),
        [
            'Dr. Smith가 설명합니다.',
            '“완료했습니다.”',
            '다음 문장입니다.',
            'ex. Use JSON.',
            'Then continue.',
        ],
    );
});

test('initialisms and parenthesized abbreviations do not create false paragraphs', () => {
    assert.deepEqual(
        descriptionParagraphs(
            'U.S. API와 A.I. systems를 a.m. 기준으로 비교합니다. A vs. B를 확인합니다. (e.g. JSON) 형식입니다.',
        ),
        [
            'U.S. API와 A.I. systems를 a.m. 기준으로 비교합니다.',
            'A vs. B를 확인합니다.',
            '(e.g. JSON) 형식입니다.',
        ],
    );
});

test('explicit blank lines remain paragraph boundaries', () => {
    assert.deepEqual(
        descriptionParagraphs('첫 문단\n\n두 번째 문단'),
        ['첫 문단', '두 번째 문단'],
    );
});
