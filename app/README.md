# Ptrainer

Responsive fitness coaching pilot with trainer/trainee roles, invitations, searchable workout templates, a 198-movement offline exercise catalog with custom-name support, direct workout creation and pre-logging edits, workout assignment and logging, progress tracking, nutrition journaling, notifications, messaging, profiles, versioned privacy consent, personal-data awareness/export/deletion, and test-mode subscriptions.

## Run locally

Install dependencies, then run `pnpm start`. With no `DATABASE_URL`, Ptrainer uses its persisted local PostgreSQL-compatible database in `data/`. The app opens at `http://127.0.0.1:4173`.

Demo accounts:

- Trainer: `trainer@ptrainer.local` / `DemoTrainer1!`
- Trainee: `trainee@ptrainer.local` / `DemoTrainee1!`

Run the full smoke suite with `pnpm test`. Liveness is available at `/healthz`, database readiness at `/readyz`, and local Prometheus metrics at `/metrics`.

## PostgreSQL and containers

Copy `.env.example` to `.env`, replace the local database password, then run `docker compose up --build`. Migrations run automatically at startup. To enable the Caddy HTTPS/reverse-proxy layer, set `PTRAINER_DOMAIN` and run `docker compose --profile edge up --build`.

For production, set `NODE_ENV=production`, a managed PostgreSQL `DATABASE_URL`, `HOST=0.0.0.0`, an HTTPS `APP_ORIGIN`, a 32+ character `METRICS_TOKEN`, `PRIVACY_ORGANIZATION`, `PRIVACY_CONTACT_EMAIL`, and `DATA_STORAGE_REGION`. Ptrainer refuses production startup when privacy operator/contact/storage values are left as local placeholders. Terminate TLS at Caddy or the hosting platform. Demo accounts and demo password-reset tokens are disabled in production mode.

The current pilot supports one app replica. Before enabling Kubernetes or a load balancer with multiple replicas, move sessions, rate limits, idempotency state, and mutable domain caches to PostgreSQL or Redis. See [architecture decisions](../docs/architecture-decisions.md).

## Pilot limitations

- Checkout is intentionally test-only and never charges a card.
- Password-reset delivery needs a transactional email provider before public launch.
- The Terms text remains a pilot summary and is not final legal advice.
- The detailed Privacy Notice is a controlled-pilot draft. Complete the [privacy launch checklist](../docs/privacy-launch-checklist.md) and obtain Canadian legal review before collecting real client information.
- Run a privacy/legal review and configure backups, monitoring, and retention before handling real health information.
