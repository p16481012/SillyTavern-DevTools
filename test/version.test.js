import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const expectedVersion = '0.16.9';

test('manifest, package and runtime versions stay aligned', () => {
    const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
    const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const indexSource = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');

    assert.equal(manifest.version, expectedVersion);
    assert.equal(packageJson.version, expectedVersion);
    assert.match(indexSource, new RegExp(`VERSION = ['"]${expectedVersion.replaceAll('.', '\\.')}['"]`));
    assert.match(
        indexSource,
        new RegExp(`from ['"]\\./src/ui\\.js\\?v=${expectedVersion.replaceAll('.', '\\.')}['"]`),
    );
    assert.doesNotMatch(indexSource, /from ['"]\.\/src\/ui\.js['"]/);
});
