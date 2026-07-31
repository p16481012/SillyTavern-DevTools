import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const expectedVersion = '0.9.0';

test('manifest, package and runtime versions stay aligned', () => {
    const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
    const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const indexSource = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');

    assert.equal(manifest.version, expectedVersion);
    assert.equal(packageJson.version, expectedVersion);
    assert.match(indexSource, new RegExp(`VERSION = ['"]${expectedVersion.replaceAll('.', '\\.')}['"]`));
});
