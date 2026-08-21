// Serves the built dist/ bundle for checking the Pages build locally.
// Mirrors GitHub Pages closely enough for the in-browser server to run:
// correct MIME types (notably application/wasm) and no special headers.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist');
const port = Number(process.env.PORT || 4180);
const base = process.env.BASE_PATH || '/';

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm', '.data': 'application/octet-stream', '.sql': 'text/plain; charset=utf-8'
};

createServer(async (req, res) => {
  let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (base !== '/' && pathname.startsWith(base)) pathname = pathname.slice(base.length - 1) || '/';
  const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
  const safe = requested.split(/[/]+/).filter(part => part && part !== '.' && part !== '..');
  const file = join(dist, safe.join(sep));
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Content-Length': body.length });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`Preview of dist/ at http://127.0.0.1:${port}${base}`));
