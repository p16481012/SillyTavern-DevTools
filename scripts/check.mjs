import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function collectJavaScript(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        if (entry.name === 'node_modules') continue;
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...await collectJavaScript(fullPath));
        if (entry.isFile() && /\.(?:js|mjs)$/.test(entry.name)) files.push(fullPath);
    }
    return files;
}

const files = await collectJavaScript(root);
for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}

console.log(`Syntax check passed for ${files.length} JavaScript files.`);
