# Ptrainer operations runbook

Backups, restore drills, and error monitoring. The architecture decisions
document says backups must be "tested through restoration drills" and the plan
asks for error monitoring before a pilot; neither had a procedure until now.

## Backups

```sh
node scripts/db.mjs backup      # writes backups/ptrainer-<timestamp>.sql
node scripts/db.mjs summary     # row counts per table
```

`backups/` is gitignored. The dump is plain SQL from `pg_dump` inside the
Postgres container, so it is only as protected as the disk it lands on —
encrypt it before it leaves this machine, and store it somewhere other than the
machine running the database.

**A backup nobody has restored is not a backup.** Run the drill below on a
schedule and after any change to the schema.

## Restore drill

Restores into a throwaway database, so it never touches the running one.

```sh
# 1. Take a fresh dump and note the row counts you expect to see back.
node scripts/db.mjs backup
node scripts/db.mjs summary

# 2. Create a scratch database alongside the real one.
docker compose exec -T postgres createdb -U ptrainer ptrainer_restore_test

# 3. Restore the dump into it.
docker compose exec -T postgres psql -U ptrainer -d ptrainer_restore_test \
  < backups/<the-file-you-just-wrote>.sql

# 4. Compare. The counts must match step 1.
docker compose exec -T postgres psql -U ptrainer -d ptrainer_restore_test -c \
  "SELECT table_name AS table,
          (xpath('/row/cnt/text()', query_to_xml(format('select count(*) as cnt from %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint AS rows
   FROM information_schema.tables WHERE table_schema='public' ORDER BY rows DESC, table_name;"

# 5. Prove the application can actually run against it, not just that rows exist.
docker compose exec -T postgres psql -U ptrainer -d ptrainer_restore_test -c \
  "SELECT count(*) FROM schema_migrations;"

# 6. Throw the scratch database away.
docker compose exec -T postgres dropdb -U ptrainer ptrainer_restore_test
```

Record the date, the dump restored, and whether counts matched. A drill whose
result nobody wrote down did not happen.

## Error monitoring

The application emits structured JSON to stdout — one object per request and per
error, carrying a request id, route, status and duration, and deliberately never
message bodies, nutrition values, passwords or tokens. Nothing collects it yet.

Before a pilot, point stdout at a collector and alert on:

| Signal | Why |
|---|---|
| `event: request_error` | Any unhandled exception. Should be zero. |
| `status >= 500` rate | The `/metrics` endpoint exposes `ptrainer_http_errors_total`. |
| `event: email_send_failed` | Verification and reset links are not arriving. |
| `event: audit_write_failed` | An audited action completed without its audit record. |
| `event: retention_sweep_failed` | Expiry and cleanup have stopped running. |
| `/readyz` failing | The database is unreachable. |

Any collector that reads container stdout works (the hosting platform's own log
drain, Loki, a hosted service). Choose one, then record it in the privacy
checklist as a provider — it processes personal data in the form of request
metadata.

## Metrics

`/metrics` serves Prometheus text. In production it requires
`Authorization: Bearer $METRICS_TOKEN`; outside production it answers any request
that reached the process directly. Do not expose it publicly.

## Retention

A sweep runs at startup and every `RETENTION_INTERVAL_HOURS` (default 6). It
marks lapsed invitations `EXPIRED`, deletes spent password-reset and
email-verification tokens after `TOKEN_RETENTION_DAYS` (default 7), and removes
session rows idle beyond `SESSION_RETENTION_HOURS` (default 24).

`AUDIT_RETENTION_DAYS` defaults to **0, meaning audit events are never deleted**.
How long they may be kept is a question for privacy counsel, not a default this
repository should pick. See the privacy launch checklist.

## A note on `.env`

`.env` is gitignored and starts as a byte-identical copy of `.env.example`,
placeholders included. It is not a configured file. Production startup refuses
placeholder values for the privacy fields, the metrics token, the origin and the
mail transport — which is the intended behaviour, not a bug to work around.
