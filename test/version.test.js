import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const expectedVersion = '0.17.3';

test('manifest, package and runtime versions stay aligned', () => {
    const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
    const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const indexSource = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const onboardingFixtureSource = fs.readFileSync(
        new URL('../src/onboarding-fixture.js', import.meta.url),
        'utf8',
    );
    const sandboxIndexSource = fs.readFileSync(
        new URL('../sandbox/index.html', import.meta.url),
        'utf8',
    );
    const sandboxHarnessHtmlSource = fs.readFileSync(
        new URL('../sandbox/ui-harness.html', import.meta.url),
        'utf8',
    );
    const sandboxHarnessSource = fs.readFileSync(
        new URL('../sandbox/ui-harness.js', import.meta.url),
        'utf8',
    );
    const escapedVersion = expectedVersion.replaceAll('.', '\\.');

    assert.equal(manifest.version, expectedVersion);
    assert.equal(packageJson.version, expectedVersion);
    assert.match(indexSource, new RegExp(`VERSION = ['"]${escapedVersion}['"]`));
    assert.match(
        indexSource,
        new RegExp(`from ['"]\\./src/ui\\.js\\?v=${escapedVersion}['"]`),
    );
    assert.doesNotMatch(indexSource, /from ['"]\.\/src\/ui\.js['"]/);
    assert.match(
        onboardingFixtureSource,
        new RegExp(`extensionVersion:\\s*['"]${escapedVersion}['"]`),
    );
    for (const source of [sandboxIndexSource, sandboxHarnessHtmlSource]) {
        assert.match(source, new RegExp(`ST DevTools v${escapedVersion} UI Sandbox`));
        assert.match(source, new RegExp(`style\\.css\\?v=${escapedVersion}`));
        assert.match(source, new RegExp(`ui-harness\\.js\\?v=${escapedVersion}`));
    }
    assert.match(
        sandboxHarnessSource,
        new RegExp(`from ['"]\\.\\./src/ui\\.js\\?v=${escapedVersion}['"]`),
    );
    assert.match(
        sandboxHarnessSource,
        new RegExp(`extensionVersion:\\s*['"]${escapedVersion}['"]`),
    );
    assert.match(
        sandboxHarnessSource,
        new RegExp(`version:\\s*['"]${escapedVersion}['"]`),
    );
});
