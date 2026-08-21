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

## Layout

- [app/](app/) — application source, `Dockerfile`, migrations, and [full documentation](app/README.md)
- [compose.yaml](compose.yaml) — the app, PostgreSQL, and an optional Caddy edge profile
- [.env.example](.env.example) — optional overrides; every value has a working default
- [docs/](docs/) — architecture decisions and the privacy launch checklist
