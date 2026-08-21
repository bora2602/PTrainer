# Ptrainer

Responsive fitness coaching pilot with trainer/trainee roles, workout templates and assignment, a 198-movement exercise catalog, progress tracking, nutrition journaling, messaging, and versioned privacy consent.

## Quick start

```
docker compose up --build
```

Then open `http://127.0.0.1:4173`.

That is the entire setup — Compose builds the app, starts PostgreSQL 16, waits for it to become healthy, and applies migrations at startup. No `.env` file and no local Node or pnpm install are needed.

Demo accounts:

- Trainer: `trainer@ptrainer.local` / `DemoTrainer1!`
- Trainee: `trainee@ptrainer.local` / `DemoTrainee1!`

## Run with no server at all

Ptrainer can also be built as a static bundle that runs entirely in the browser
— the frontend, `server.mjs`, and a WebAssembly PostgreSQL — with GitHub Pages
as the only host:

```
cd app && pnpm install
cd .. && node scripts/build-pages.mjs && node scripts/preview-pages.mjs
```

Every visitor gets their own private in-browser database, so this is a
demonstration rather than a multi-user deployment. See
[the GitHub Pages notes](docs/github-pages.md) for how it works and what it
cannot do.

## Layout

- [app/](app/) — application source, `Dockerfile`, migrations, and [full documentation](app/README.md)
- [compose.yaml](compose.yaml) — the app, PostgreSQL, and an optional Caddy edge profile
- [.env.example](.env.example) — optional overrides; every value has a working default
- [docs/](docs/) — architecture decisions and the privacy launch checklist
