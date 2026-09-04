# Ptrainer

Responsive fitness coaching pilot with trainer/trainee roles, workout templates and scheduled assignment, a month calendar of scheduled work, set-level workout logging with resumable drafts, a 198-movement exercise library trainers can extend, coaching notes, email verification, progress tracking with unit conversion, nutrition journaling, messaging, and versioned privacy consent.

## Quick start

```
node scripts/up.mjs
```

Starts the whole stack and opens `http://127.0.0.1:4173` in your browser once
the app answers. It opens that local address whether or not the Cloudflare
tunnel came up, so a tunnel problem never costs you the app on this machine.

- Local-only is the default: the Cloudflare tunnel sits behind a compose
  profile, so nothing is published until you ask. `--public` turns it on.
  (`--local` is still accepted and now does nothing.)
- `--no-open` skips the tab.
- Any other flag goes straight through to compose.

`docker compose up --build` still works exactly as before — the wrapper exists
only because a container has no way to reach the browser on your desktop, so
something on the host has to open it. Either way, then open
`http://127.0.0.1:4173`.

That is the entire setup — Compose builds the app, starts PostgreSQL 16, waits for it to become healthy, and applies migrations at startup. No `.env` file and no local Node or pnpm install are needed.

Demo accounts:

- Trainer: `trainer@ptrainer.local` / `DemoTrainer1!`
- Trainee: `trainee@ptrainer.local` / `DemoTrainee1!`

## Hosting it from one computer

`docker compose up --build` starts Postgres and the app on this machine only —
both bind to `127.0.0.1`, so nothing is reachable from outside. Publishing is
opt-in, and worth reading "Before you publish" below before you do it:

```
docker compose --profile tunnel up -d --build
```

That prints the public address people should use:

```
======================================================================
 Ptrainer is ready. Share this address:

   https://reported-address.trycloudflare.com
======================================================================
```

No router port is opened — the tunnel dials out. Data lives in a named Docker
volume and survives `docker compose down` and rebuilds; inspect it with
`node scripts/db.mjs`.

### Before you publish

**Set `NODE_ENV=production` in `.env` before sharing the address.** Development
mode is not merely "less strict" — it is unsafe to expose, in ways that are easy
to miss:

- `POST /api/auth/forgot-password` returns the password-reset token **in the
  response body**. Anyone who knows a registered email address can take over
  that account. Email verification tokens leak the same way.
- The seeded demo accounts are enabled and their passwords are in this
  repository, so anyone with the link can sign in and read the seeded data.
- The sign-in rate limit is 5000 per 15 minutes instead of 8, so passwords can
  be brute-forced.
- The session cookie is issued without the `Secure` flag.
- The `/api/test/*` helper endpoints are mounted.

Production mode closes all of these, and refuses to start until the rest of the
configuration is real — database, `https://` origin, metrics token, privacy
contact, storage region, and a mail transport that actually delivers. It also
needs a **stable** `APP_ORIGIN`, which a quick tunnel cannot give you: use a
named tunnel. See [the hosting runbook](docs/hosting-on-one-computer.md) for a
fixed hostname, database inspection, and how to verify the lockdown.

That printed `*.trycloudflare.com` address is random, changes on every restart,
and Chrome frequently marks it as deceptive — the hostname is shared with every
other free tunnel, phishing kits included. To get a stable name like
`ptrainer.your-domain.com` and no warning, point a domain you own at a named
tunnel: [Why the browser says "Dangerous"](docs/hosting-on-one-computer.md#why-the-browser-says-dangerous-on-a-quick-tunnel).

## Layout

- [app/](app/) — application source, `Dockerfile`, migrations, and [full documentation](app/README.md)
- [compose.yaml](compose.yaml) — the app, PostgreSQL, and an optional Caddy edge profile
- [.env.example](.env.example) — optional overrides; every value has a working default
- [docs/](docs/) — architecture decisions and the privacy launch checklist
