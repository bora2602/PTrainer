# Running Ptrainer entirely on GitHub Pages

GitHub Pages serves static files and nothing else — no Node process, no
PostgreSQL, no place for `server.mjs` to listen. This build removes the need for
a host by moving the whole stack into the visitor's browser tab.

## Build and preview locally

```
cd app && pnpm install        # PGlite's WebAssembly build is copied from node_modules
cd .. && node scripts/build-pages.mjs
node scripts/preview-pages.mjs
```

The preview serves `dist/` at `http://127.0.0.1:4180` with the same MIME types
GitHub Pages uses. To rehearse a project-site subpath:

```
BASE_PATH=/PTrainer/ PORT=4181 node scripts/preview-pages.mjs
```

## Enabling it on GitHub

`.github/workflows/pages.yml` builds the bundle and deploys it on every push to
`github-pages-test`. In **Settings → Pages**, set **Source** to **GitHub
Actions** once; the workflow handles the rest.

## How it works

The frontend is untouched: `index.html`, `app.js`, and `styles.css` ship exactly
as they are, and `app.js` still calls `/api/...` through its usual `fetch`
helper. What changes is where those requests land.

1. `browser/fetch-bridge.js` loads as a classic script before `app.js` and
   replaces `window.fetch`. Requests for `/api/*`, `/healthz`, `/readyz`, and
   `/metrics` are answered in-page; everything else goes to the network
   unchanged. Calls made before the backend has booted wait on a promise.
2. `browser/boot.mjs` installs `Buffer` and `process` globals, then imports the
   real `server.mjs`.
3. `server.mjs` runs unmodified apart from its import specifiers. `node:http`,
   `node:crypto`, `node:path`, `node:url`, `node:util`, and `node:fs/promises`
   are rewritten at build time to point at small shims in `browser/shims/`. The
   `node:http` shim captures the request handler instead of opening a socket.
4. The bridge builds a fake `req`/`res` pair for each call and hands it to that
   handler, so routing, sessions, CSRF checks, rate limiting, role
   authorization, and audit writes all run the same code as the server.
5. `database.mjs` is swapped for `browser/database.browser.mjs`, which runs
   PGlite — PostgreSQL compiled to WebAssembly — against IndexedDB and applies
   the same `migrations/*.sql` files, fetched over HTTP.

The result is the real application, seeded with the demo trainer and trainee,
running with no backend at all.

## What differs from the hosted build

- **Password hashing.** `scrypt` has no WebCrypto equivalent, so the browser
  build derives hashes with PBKDF2-SHA256. Hashes are created and verified
  inside one browser profile and never leave it, so this stays self-consistent,
  but a database seeded by the Node server is not password-compatible.
- **Security headers.** Pages cannot send headers, so the policy `server.mjs`
  normally sets as `Content-Security-Policy` is declared as a `<meta>` tag
  instead. `frame-ancestors` and `Strict-Transport-Security` have no `<meta>`
  equivalent and are lost. `style-src` additionally allows `unsafe-inline`
  because the app sets inline style attributes while rendering.
- **First load** transfers roughly 14 MB, almost all of it PGlite's WebAssembly
  and data files. They are cached afterwards, and boot takes about 5-8 seconds.
- **Open Food Facts** barcode lookups are made by the page directly rather than
  proxied by the server, so the request is visible to that third party as coming
  from the visitor's browser.

## Limitations worth understanding before sharing the link

- **Every visitor gets a private database.** There is no shared server, so data
  written in one browser is invisible to every other browser and device.
  Trainer/trainee collaboration — invitations, assignment, messaging — only
  works between the two demo accounts *within a single browser profile*. This is
  a demonstration of the product, not a usable multi-user deployment.
- **Reloading signs you out.** Sessions live in a `Map` inside `server.mjs`, and
  a reload restarts that module. The database survives in IndexedDB; the session
  does not, so sign in again after refreshing.
- **Nothing here is a security boundary.** The database and every check run
  inside the visitor's tab, where they can be inspected or altered at will. Do
  not put real client or health information into a Pages deployment.
- **Clearing site data deletes the database**, and the demo seed is recreated on
  the next load.
