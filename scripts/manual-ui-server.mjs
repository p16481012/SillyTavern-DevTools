import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mimeTypes = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
};

createServer(async (request, response) => {
    const requestPath = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const relativePath = requestPath === '/' ? 'sandbox/index.html' : requestPath.slice(1);
    const filePath = path.resolve(root, relativePath);
    if (!filePath.startsWith(`${root}${path.sep}`)) {
        response.writeHead(403).end('Forbidden');
        return;
    }
    try {
        if (!(await stat(filePath)).isFile()) throw new Error('Not a file');
        response.writeHead(200, {
            'Content-Type': mimeTypes[path.extname(filePath)] ?? 'application/octet-stream',
            'Cache-Control': 'no-store',
        });
        createReadStream(filePath).pipe(response);
    } catch {
        response.writeHead(404).end('Not found');
    }
}).listen(8766, '127.0.0.1', () => {
    console.log('ST DevTools UI sandbox: http://127.0.0.1:8766/sandbox/index.html');
});
