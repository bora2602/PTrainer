# Ptrainer

Responsive fitness coaching pilot with trainer/trainee roles, invitations, direct workout creation and pre-logging edits, workout assignment and logging, progress tracking, nutrition journaling, notifications, messaging, profiles, personal-data export, and test-mode subscriptions.

## Run locally

Install dependencies, then run `pnpm start`. With no `DATABASE_URL`, Ptrainer uses its persisted local PostgreSQL-compatible database in `data/`. The app opens at `http://127.0.0.1:4173`.

Demo accounts:

- Trainer: `trainer@ptrainer.local` / `DemoTrainer1!`
- Trainee: `trainee@ptrainer.local` / `DemoTrainee1!`

Run the full smoke suite with `pnpm test`. Liveness is available at `/healthz`, database readiness at `/readyz`, and local Prometheus metrics at `/metrics`.

## PostgreSQL and containers

Copy `.env.example` to `.env`, replace the local database password, then run `docker compose up --build`. Migrations run automatically at startup. To enable the Caddy HTTPS/reverse-proxy layer, set `PTRAINER_DOMAIN` and run `docker compose --profile edge up --build`.

For production, set `NODE_ENV=production`, a managed PostgreSQL `DATABASE_URL`, `HOST=0.0.0.0`, an HTTPS `APP_ORIGIN`, and a 32+ character `METRICS_TOKEN`. Terminate TLS at Caddy or the hosting platform. Demo accounts and demo password-reset tokens are disabled in production mode.

The current pilot supports one app replica. Before enabling Kubernetes or a load balancer with multiple replicas, move sessions, rate limits, idempotency state, and mutable domain caches to PostgreSQL or Redis. See [architecture decisions](../docs/architecture-decisions.md).

## Pilot limitations

- Checkout is intentionally test-only and never charges a card.
- Password-reset delivery needs a transactional email provider before public launch.
- The included privacy and terms text is a pilot summary, not final legal advice.
- Run a privacy/legal review and configure backups, monitoring, and retention before handling real health information.
