# Ptrainer API reference

Same-origin REST over JSON. Every route below `/api/` except the ones marked
**public** requires a session cookie, and every state-changing request requires
`X-CSRF-Token` (from `GET /api/session`), `Content-Type: application/json`, and
an `Origin` the server accepts.

Errors always take the shape `{ "error": { "code", "message", "field"? } }`.
Codes are stable; messages are for people and may change.

## Authorization

Two checks run on every protected route, in the service layer and backed by
database constraints — never by hiding a control in the interface:

1. **Role.** Trainer-only routes reject a trainee with `403`.
2. **Relationship, and the permission it grants.** A trainer reaches a trainee's
   records only through an `ACTIVE` relationship *and* the specific flag the
   action needs. `view_progress` and `view_nutrition` default on; `log_on_behalf`
   defaults off. Only the trainee can change them.

Changing an identifier in a URL never exposes another account's records; the
`work/cross-account-check.mjs` probe exists to keep that true.

## Pagination

List endpoints that grow without bound use **keyset (cursor) pagination**, not
offset. An offset re-scans what it skips and can repeat or drop rows at a page
boundary when something is written between requests.

Pass `?limit=` (bounded per endpoint) and `?cursor=`. Responses carry
`nextCursor`, which is `null` on the last page. The cursor is opaque: it encodes
the sort key of the last row returned, and its shape is not a contract. A cursor
that does not parse is ignored rather than treated as an error.

Paginated: `progress-entries`, `nutrition-entries`, `messages`, `notifications`,
`assigned-workouts`.

## Routes

### Public

| Route | Notes |
|---|---|
| `GET /healthz` | Liveness. |
| `GET /readyz` | Database readiness. |
| `GET /metrics` | Prometheus text. Requires `METRICS_TOKEN` in production. |
| `GET /api/session` | Issues the CSRF token. Reports `demoMode`. |
| `GET /api/privacy` | Notice version, operator, contact, storage region. |

### Authentication

| Route | Notes |
|---|---|
| `POST /api/auth/register` | Requires acceptance of the current notice version. Issues a verification email. |
| `POST /api/auth/login` | Rotates the session. |
| `POST /api/auth/logout` | Ends this session. |
| `POST /api/auth/logout-others` | Ends every other session for the account. Returns `endedCount`. |
| `POST /api/auth/forgot-password` | Always `202`, whether or not the address exists. |
| `POST /api/auth/reset-password` | Consumes the token and ends every session. |
| `POST /api/auth/verify-email` | Single use; a token only verifies the address it was issued for. |

### Account

`GET /api/me`, `PATCH /api/me/profile`, `GET /api/me/privacy`,
`POST /api/me/resend-verification`, `GET /api/me/sessions` (fingerprints only —
never the session identifier), `GET /api/me/audit-events`,
`GET /api/me/export` (full personal-data export),
`DELETE /api/me/account` (anonymizes identity **and** deletes measurements, meal
journal, workout and set logs, coaching notes and notifications; returns the
counts purged).

### Coaching

`GET /api/dashboard` · `GET /api/relationships` ·
`GET /api/invitations` (the trainer's own; the token is never returned) ·
`DELETE /api/invitations/:id` (withdraw a pending one) ·
`PATCH /api/relationships/:trainerId/:traineeId` (status and permissions are
independent edits; permissions are trainee-only) · `POST /api/invitations` ·
`POST /api/invitations/:token/accept` · `GET|POST /api/trainer-notes` ·
`PATCH|DELETE /api/trainer-notes/:id`

### Exercises and workouts

`GET|POST /api/exercises` · `PATCH|DELETE /api/exercises/:id` (own movements
only) · `GET|POST /api/workout-templates` ·
`PATCH|DELETE /api/workout-templates/:id` ·
`POST /api/workout-templates/:id/duplicate` ·
`POST /api/assigned-workouts` (one or several trainees; `frequency` with
`startDate`/`endDate` expands into dated occurrences sharing a `seriesId`) ·
`POST /api/assigned-workouts/custom` ·
`PATCH /api/assigned-workouts/:id` (locked once logging starts) ·
`GET|POST|PATCH /api/assigned-workouts/:id/logs`

**Workout logs.** `POST` finalizes and requires an `Idempotency-Key` header
matching `[A-Za-z0-9_-]{16,100}`; replaying a key returns the original result
rather than writing a second log. `PATCH` saves a resumable draft — one per
author per assignment, rewritten in place. A draft is visible only to its author;
finished logs are visible to both parties. Set rows are rejected if they name an
exercise index the assignment never prescribed.

### Progress and nutrition

`GET /api/progress-metrics` · `GET|POST /api/progress-entries` ·
`PATCH|DELETE /api/progress-entries/:id` (author only) ·
`GET|POST /api/nutrition-entries` · `PATCH|DELETE /api/nutrition-entries/:id`
(author only) · `PATCH /api/nutrition-target` (trainer guidance) ·
`GET /api/food-products/:barcode` · `GET /api/food-search`

**Units.** A measurement is stored exactly as entered, in `value` and `unit`. A
normalized pair (`value_normalized`, `normalized_unit`) is derived for charting
and comparison. A known metric fixes its dimension, so a waist in kilograms is
rejected rather than charted wrongly.

### Other

`GET|POST /api/messages` · `GET /api/notifications` ·
`POST /api/notifications/:id/read` · `GET /api/subscription` ·
`POST /api/billing/test-checkout` (test mode; never charges a card).

### Development only

`/api/test/*` exists solely so time-based behaviour can be tested without waiting
days. The whole block is skipped when `NODE_ENV=production`, so those paths `404`
as if they had never been written, and they still require a session — the
unauthenticated exposure probe covers them like any other route.

## Rate limits

Registration, sign-in, password reset, invitations, messages, barcode and food
lookups, progress writes, nutrition writes, workout-log writes, and verification
resends are all limited. The limiter is process-local, so it is correct for one
application instance only. Registration and sign-in ceilings are relaxed outside
production so the test suite can run repeatedly; production keeps the tight
numbers.
