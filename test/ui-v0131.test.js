import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
    copyText,
    semanticSuggestionCopyText,
} from '../src/ui.js';

function replaceGlobal(name, value) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {
        configurable: true,
        writable: true,
        value,
    });
    return () => {
        if (previous) Object.defineProperty(globalThis, name, previous);
        else delete globalThis[name];
    };
}

test('clipboard copy preserves exact text through the Clipboard API', async () => {
    const writes = [];
    const restoreNavigator = replaceGlobal('navigator', {
        clipboard: {
            async writeText(value) {
                writes.push(value);
            },
        },
    });
    try {
        assert.equal(await copyText('  {{char}}\n원문 그대로  '), 'clipboard-api');
        assert.deepEqual(writes, ['  {{char}}\n원문 그대로  ']);
    } finally {
        restoreNavigator();
    }
});

test('clipboard denial falls back to the hidden textarea path', async () => {
    const state = {
        appended: false,
        selected: false,
        removed: false,
        copied: false,
        textarea: null,
    };
    const textarea = {
        value: '',
        style: {},
        setAttribute() {},
        select() {
            state.selected = true;
        },
        remove() {
            state.removed = true;
        },
    };
    state.textarea = textarea;
    const restoreNavigator = replaceGlobal('navigator', {
        clipboard: {
            async writeText() {
                throw new Error('permission-denied');
            },
        },
    });
    const restoreDocument = replaceGlobal('document', {
        body: {
            appendChild(node) {
                assert.equal(node, textarea);
                state.appended = true;
            },
        },
        createElement(tag) {
            assert.equal(tag, 'textarea');
            return textarea;
        },
        execCommand(command) {
            assert.equal(command, 'copy');
            state.copied = true;
            return true;
        },
    });
    try {
        assert.equal(await copyText('fallback 원문'), 'exec-command');
        assert.equal(textarea.value, 'fallback 원문');
        assert.deepEqual(
            [state.appended, state.selected, state.copied, state.removed],
            [true, true, true, true],
        );
    } finally {
        restoreDocument();
        restoreNavigator();
    }
});

test('v0.13.1 exposes clearly named copy actions without an edit path', async () => {
    const [ui, css, i18n] = await Promise.all([
        readFile(new URL('../src/ui.js', import.meta.url), 'utf8'),
        readFile(new URL('../style.css', import.meta.url), 'utf8'),
        readFile(new URL('../src/i18n.js', import.meta.url), 'utf8'),
    ]);
    const explorer = ui.slice(
        ui.indexOf('    renderExplorer('),
        ui.indexOf('    renderMappedFinalPrompt('),
    );
    const semantic = ui.slice(
        ui.indexOf('    renderSemanticSuggestions('),
        ui.indexOf('    renderSemanticInspector('),
    );

    assert.match(explorer, /hasRawPromptContent\(snapshot\)/u);
    assert.match(explorer, /'action\.copySource'/u);
    assert.match(explorer, /'action\.copyContent'/u);
    assert.match(semantic, /'action\.copySuggestion'/u);
    assert.match(i18n, /'action\.copySource': '원문 복사'/u);
    assert.match(i18n, /'action\.copySuggestion': '제안 설명 복사'/u);
    assert.match(css, /\.st-devtools-window \.st-devtools-copy-button/u);
    assert.match(css, /width: auto !important/u);
});

test('AI suggestion copy text distinguishes advice from a rewritten prompt', () => {
    assert.equal(semanticSuggestionCopyText({
        title: '충돌 가능성',
        summary: '두 지시의 우선순위를 확인하세요.',
        rationale: '둘 다 같은 응답에 적용됩니다.',
    }), [
        '충돌 가능성',
        '두 지시의 우선순위를 확인하세요.',
        '판단 이유\n둘 다 같은 응답에 적용됩니다.',
    ].join('\n\n'));
});
