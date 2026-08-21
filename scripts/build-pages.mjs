// Assembles the static GitHub Pages bundle: the unmodified Ptrainer frontend
// and server, plus the browser shims that let the server run inside the page.
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = join(root, 'app');
const dist = join(root, 'dist');
const pglite = join(app, 'node_modules', '@electric-sql', 'pglite', 'dist');

const SERVER_SOURCES = ['server.mjs', 'exercise-catalog.mjs', 'food-lookup.mjs'];
const STATIC_SOURCES = ['app.js', 'styles.css'];

// Node builtins are rewritten to shim paths at build time rather than mapped
// with an import map: an inline <script type="importmap"> would need a CSP
// exception, and unmapped node: specifiers are then treated as script URLs.
const BUILTIN_SHIMS = {
  'node:http': './browser/shims/node-http.mjs',
  'node:fs/promises': './browser/shims/node-fs-promises.mjs',
  'node:crypto': './browser/shims/node-crypto.mjs',
  'node:util': './browser/shims/node-util.mjs',
  'node:path': './browser/shims/node-path.mjs',
  'node:url': './browser/shims/node-url.mjs'
};

// GitHub Pages cannot send headers, so the policy the Node server normally
// sets as a Content-Security-Policy header is declared in the document.
// wasm-unsafe-eval is required by PGlite, the page contacts Open Food Facts
// directly because no server is left to proxy the lookup, and the app applies
// inline style attributes while rendering.
const POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "connect-src 'self' https://world.openfoodfacts.org",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'"
].join('; ');

function rewriteBuiltins(source, label) {
  let out = source;
  for (const [specifier, replacement] of Object.entries(BUILTIN_SHIMS)) {
    out = out.split(`'${specifier}'`).join(`'${replacement}'`);
  }
  const leftover = out.match(/from ['"]node:[^'"]+['"]/g);
  if (leftover) throw new Error(`${label} imports unshimmed builtins: ${leftover.join(', ')}`);
  return out;
}

async function buildIndex() {
  const html = await readFile(join(app, 'index.html'), 'utf8');
  const appTag = /<script src="app\.js[^"]*"><\/script>/;
  if (!appTag.test(html)) throw new Error('Could not find the app.js script tag in index.html');

  const head = [
    `  <meta http-equiv="Content-Security-Policy" content="${POLICY}">`,
    '  <script src="./browser/fetch-bridge.js"></script>'
  ].join('\n');

  const original = html.match(appTag)[0];
  return html
    .replace('</head>', `${head}\n</head>`)
    .replace(appTag, `${original}\n  <script type="module" src="./browser/boot.mjs"></script>`);
}

async function main() {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });

  await writeFile(join(dist, 'index.html'), await buildIndex());
  for (const name of STATIC_SOURCES) await cp(join(app, name), join(dist, name));
  for (const name of SERVER_SOURCES) {
    await writeFile(join(dist, name), rewriteBuiltins(await readFile(join(app, name), 'utf8'), name));
  }
  await cp(join(app, 'assets'), join(dist, 'assets'), { recursive: true });

  // The browser database module takes the place of the Node one.
  await cp(join(app, 'browser'), join(dist, 'browser'), { recursive: true });
  await rm(join(dist, 'browser', 'database.browser.mjs'));
  await cp(join(app, 'browser', 'database.browser.mjs'), join(dist, 'database.mjs'));

  const migrations = (await readdir(join(app, 'migrations'))).filter(name => name.endsWith('.sql')).sort();
  if (!migrations.length) throw new Error('No migrations found');
  await mkdir(join(dist, 'migrations'), { recursive: true });
  for (const name of migrations) await cp(join(app, 'migrations', name), join(dist, 'migrations', name));
  await writeFile(join(dist, 'migrations', 'manifest.json'), JSON.stringify(migrations, null, 2));

  // PGlite's browser build: entry, chunks, and the WebAssembly payload.
  const vendor = join(dist, 'vendor', 'pglite');
  await mkdir(vendor, { recursive: true });
  const wanted = (await readdir(pglite)).filter(name =>
    (name.endsWith('.js') && !name.endsWith('.map')) || name === 'pglite.wasm' || name === 'pglite.data');
  if (!wanted.includes('pglite.wasm')) throw new Error(`PGlite build not found in ${pglite} — run pnpm install in app/ first`);
  for (const name of wanted) await cp(join(pglite, name), join(vendor, name));

  // Stop GitHub Pages from running the output through Jekyll.
  await writeFile(join(dist, '.nojekyll'), '');

  console.log(`Built static bundle in ${dist}`);
  console.log(`  migrations: ${migrations.length}`);
  console.log(`  pglite files: ${wanted.length}`);
}

await main();
