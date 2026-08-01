import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('v0.12.4 keeps mobile settings compact without shrinking disclosure targets', async () => {
    const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
    const mobile = css.slice(css.indexOf('@media (max-width: 430px)'));

    assert.match(
        mobile,
        /\.st-devtools-settings-form\s*\{[^}]*padding:\s*0\.45rem 0\.75rem 0\.75rem/u,
    );
    assert.match(
        mobile,
        /\.st-devtools-settings-group-content\s*\{[^}]*padding:\s*0\.25rem 0\.35rem 0\.45rem/u,
    );
    assert.match(
        mobile,
        /\.st-devtools-settings-field\s*\{[^}]*padding:\s*0\.4rem 0/u,
    );
    assert.match(
        mobile,
        /\.st-devtools-settings-group\.st-devtools-disclosure > summary\s*\{[^}]*min-height:\s*44px/u,
    );
});
