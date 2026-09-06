# Ptrainer architecture decisions

This document records which infrastructure concepts are appropriate for the current Ptrainer pilot, which are deferred, and why. Adding every technology would create more failure modes without improving the product.

## Implemented now

| Capability | Decision |
|---|---|
| Database design | PostgreSQL schema with foreign keys, checks, unique constraints, versioned workout snapshots, migrations, and targeted indexes. Trainer edits update only an unstarted assignment snapshot, preserving templates and workout history. PGlite is used only for persistent local development. |
| ACID | Multi-step invitation acceptance, direct workout creation, workout snapshot updates, workout log/status updates, and account anonymization use database transactions. |
| REST | The browser uses a same-origin REST API with consistent JSON errors. List endpoints that grow without bound (progress, nutrition, messages, notifications, assigned workouts) use keyset (cursor) pagination rather than offset: an offset re-scans what it skips and can repeat or drop rows at a page boundary when something is written between requests. The cursor is opaque and encodes the sort key of the last row returned. |
| Exercise catalog | A built-in, deduplicated exercise catalog keeps workout building fast and available offline. Trainers can search by movement, muscle group, or equipment and can still enter a custom movement. External catalogs are deferred until their availability and per-entry licenses can be enforced reliably. |
| Authentication | Scrypt password hashing, rotating sessions stored in PostgreSQL so a restart or deploy does not sign everyone out, CSRF tokens, secure cookies in production, role checks, relationship checks, password reset expiry, login rate limiting, and a sign-out-other-devices control. Anonymous sessions stay in memory: they hold only a CSRF token, and persisting one row per unauthenticated request would trade a memory leak for a table that grows just as fast. |
| Privacy consent and transparency | Registration requires acceptance of the current notice version. The version and timestamp are stored transactionally, included in personal-data exports, shown in Settings, and marked withdrawn during account deletion. Public privacy configuration exposes the responsible organization, contact, notice version, and configured storage region without exposing infrastructure secrets. |
| Rate limiting | Authentication, registration, invitations, password resets, messages, barcode and food lookups, progress, nutrition, and workout-log writes are limited. The limiter is process-local and suitable for one application instance. Ceilings for registration and sign-in are relaxed outside production so the test suite can run repeatedly; production keeps the tight numbers. |
| Encryption | HTTPS is terminated by Caddy; production requires an HTTPS origin. Passwords are one-way hashed. Database volumes, managed database storage, object storage, and backups must have provider-side encryption enabled. Secrets are environment variables and must not be committed. |
| Reverse proxy | Caddy provides HTTPS, compression, security headers, access logs, and upstream health checks. |
| Account and relationship reads | Read from the table on every request. The mirrors these replaced were a correctness problem before a memory one: a second replica holding a stale copy would keep letting a suspended account in, or keep honouring a revoked relationship. Accounts are cached for five seconds to keep the hot path off the database, which is short enough that a status change takes effect in seconds rather than never. |
| Caching | Static assets use ETags and a short browser cache; HTML and authenticated API responses use `no-store`. Every in-process cache (sessions, rate-limit buckets, idempotency replays, reset tokens, food lookups) is a bounded LRU with a TTL and a periodic prune, so none of them grows with uptime or traffic. |
| Polling | Notifications and the open conversation refresh every 20 seconds only while the tab is visible. This is simpler and more reliable than WebSockets for the pilot. |
| Error logging | JSON request/error logs include a request ID, route, status, and duration without logging message, nutrition, password, or token content. |
| Food-name lookup | Authenticated, rate-limited (`60/min`) server search that answers from a bundled generic-food table first and adds Open Food Facts matches; the typed name is never logged, results are cached for 30 minutes, and an unreachable Open Food Facts degrades to reference foods only. Implausible crowd-sourced entries (calories that cannot be reconciled with their own macros) are dropped. The client auto-fills only while the macro fields still hold what a lookup wrote. |
| Packaged-food lookup | Authenticated, rate-limited server proxy to Open Food Facts v3; only the barcode is sent, successful lookups are cached for six hours, and logged nutrition stores a product snapshot. Compatible browsers decode camera frames locally with the native Barcode Detector API; manual UPC/EAN/GTIN entry remains available. |
| Calendar | A read-only month view of assignments that already exist. `GET /api/assigned-workouts` takes a `from`/`to` window, capped at a year, and still pages by cursor inside it; unscheduled work belongs to no window. Nothing is created or edited here - assigning stays in Workouts - so the view adds no writable surface, no new table and no third-party dependency. `DATE` columns are read back with `to_char` because node-postgres and PGlite disagree about what a bare date means, and a calendar that moves a workout a day is worse than no calendar. |
| Calendar export | A subscribable ICS feed at `/api/calendar/:token.ics` that Google Calendar and Apple Calendar poll, plus a one-off `.ics` download at `/api/me/calendar.ics`. The feed is the only route that answers without a session, because a calendar client can send neither a cookie nor a CSRF token; the URL carries its own credential instead, stored as a digest, revocable, collapsed out of the request log, and carrying event names and dates only. Reasoning and the risks accepted are below. |
| Monitoring and observability | `/healthz`, `/readyz`, protected production `/metrics`, request counts, error counts, latency average, database readiness, and audit events. |
| CI/CD | Pull requests and `main` run migrations, API/security tests, and a container build. Version tags publish an immutable image to GitHub Container Registry. |
| Deployment | Docker image, PostgreSQL Compose service, optional Caddy edge profile, environment validation, and graceful shutdown. |
| Git | Repository metadata and ignore rules protect local databases, dependencies, logs, and secrets. |

## Add when the product needs it

| Capability | Trigger |
|---|---|
| S3-compatible object storage | Add before profile images, progress photos, or exercise videos. Use private buckets, short-lived signed URLs, upload size/type checks, malware scanning, lifecycle retention, and encryption. |
| CDN | Add for versioned static assets and public exercise media after a public deployment. Never cache authenticated API responses. |
| WebSockets | Add when measured polling latency or request volume becomes a problem for messaging. Keep polling as a fallback. |
| Managed message queue (SQS or RabbitMQ) | Add for email delivery, media processing, exports, and retryable background work. Pick one provider; do not run SQS and RabbitMQ for the same workload. |
| Circuit breaker | Add around real payment, email, media, or wearable integrations. There is currently no mandatory external runtime dependency to protect. |
| Serverless compute | Consider for isolated background jobs such as image processing or scheduled reminders, not for the core coaching API. |
| Load balancer and multiple replicas | Sessions, accounts and coaching relationships are all read from PostgreSQL now, so the checks that decide access are correct across processes. Remaining process-local state: rate-limit buckets, the idempotency replay cache, and mirrors of workout templates and assignments. None of those can grant access that was revoked - the worst case is a duplicate submission slipping through or a limit counted per replica - so a second replica is no longer a correctness risk, only an imprecision. Measure before adding one. |
| Kubernetes | Add when multiple services/replicas, autoscaling, rolling deployments, and a platform team justify it. A one-replica Kubernetes deployment would add operational cost without availability gains. |
| API gateway | Add when several independently deployed APIs need common authentication, quotas, routing, or version management. Caddy is sufficient for the modular monolith. |
| Elasticsearch/OpenSearch | Add only when PostgreSQL full-text/trigram search is measured and proven insufficient. |
| Database partitioning | Consider time-based partitioning after progress, audit, or workout log tables reach tens of millions of rows and query plans show a need. |
| Database sharding | Consider only when a single well-tuned PostgreSQL cluster cannot meet measured storage or throughput requirements. Tenant-based sharding would be the likely boundary. |
| Distributed cache | Add Redis when multiple app replicas require shared sessions, rate limits, idempotency state, or hot-read caching. |

## Not selected for the current product

- Kafka: unnecessary until Ptrainer has high-volume event streams, many independent consumers, and replay requirements.
- DynamoDB: PostgreSQL transactions and relational ownership rules fit the domain better.
- GraphQL: the current screens do not suffer from REST over-fetching or complex client-defined query needs.
- TensorFlow: there is no validated machine-learning feature or training dataset.
- SFTP: object storage with signed HTTPS URLs is safer and easier to audit for future media transfer.
- Forward proxy: Ptrainer needs an inbound reverse proxy, not a client egress proxy.
- Microservices and sidecars: the modular monolith should remain until team ownership or scaling boundaries are proven.

## Scope exceptions awaiting a decision

Two shipped features sit outside the plan document's MVP boundary. Recording
them here rather than quietly treating them as in scope:

| Feature | Status |
|---|---|
| In-app messaging | Built and in use. Plan section 2 lists it under later releases, and the open decisions list defaults it to *out*. Needs the maintainer either to move it into scope in the plan document, or to mark it a pilot-only extra to be removed before a wider release. |
| Test-mode billing | Built, never charges a card. Same question. It is the thinnest possible placeholder: no provider integration, no stored payment details. |

Neither should be extended until that decision is made.

**Where the calendar sits, and where it stops.** Plan section 2 lists "calendar
and appointments" under later releases. What shipped is deliberately narrower
than that phrase: a month view of assignments the MVP already creates, because
"assignment, scheduling" is in the recommended MVP and the trainer dashboard is
already specified to show upcoming assignments. It reads data that existed
before it and writes none.

**The export feed, and the risk that was accepted with it.** An iCal/webcal feed
was declined here for a while, on the grounds that it needs a new revocable
credential and that anyone holding the URL reads the workout names on it. That
reading was right, and the maintainer has since taken the feature anyway,
because a schedule a trainee cannot see beside the rest of their week is a
schedule they work around rather than with. What shipped answers the original
objection point by point rather than waiving it:

- **The URL is a credential, so it is treated as one.** Only a SHA-256 digest of
  the token is stored, exactly like invitation, reset and verification tokens; the
  full URL is shown once, at the moment it is issued, and there is nowhere to read
  it back from. One live link per person, enforced by a partial unique index.
  Issuing and revoking are audited; a poll is not, because one audit row per
  subscriber per refresh would bury the events that matter.
- **The token never reaches a log.** `routeLabel()` collapses the path before the
  request line is written. A subscribed client asks for that URL on a schedule
  forever, so this is the difference between one secret and a permanent one.
- **The events carry a name and a day and nothing else.** No description, no
  exercise list, no sets, reps or loads. A calendar is often shared onward, and
  the programming is the part that should stay behind an authorization check.
- **A trainer's feed follows the relationship.** Only actively coached clients
  appear, so ending a relationship empties those days on the next refresh.

Two things named by the same later-release line remain out, and each was
considered and declined rather than overlooked:

- **Google or Outlook calendar sync.** OAuth, a stored refresh token per user, a
  third runtime dependency, and personal health-adjacent data leaving the
  deployment - which section 10 of the plan puts behind legal review. The
  subscribable feed reaches both Google and Apple without any of that; what it
  cannot do is control how often Google polls, which is commonly a day. The
  one-off `.ics` download covers somebody who needs a change reflected now.
- **Appointments and booking.** A different domain from workout assignment
  (availability, duration, cancellation, no-shows) with its own tables.

Either of the two needs the plan updated first.

## Where the pilot is hosted, and why

The pilot runs on a single Always Free Arm VM in Oracle Cloud's Toronto region,
using the `edge` compose profile: Caddy, the app, and PostgreSQL on one machine.
Walkthrough in [hosting in the cloud](hosting-in-the-cloud.md).

A managed platform would have been the lighter choice, and it was rejected for
one reason: **no free managed tier has a Canadian region.** Render offers Oregon,
Ohio, Virginia, Frankfurt and Singapore; Neon offers eight AWS regions, none of
them Canadian. `DATA_STORAGE_REGION` is rendered into the privacy notice as a
factual claim about where health-adjacent data lives, so the region is a product
decision rather than an operational one, and section 10 of the plan puts this
behind legal review before launch. Paying for the region with `apt upgrade` and
self-managed backups was judged the better trade for a pilot. It is not lock-in:
the stack is a compose file and a `pg_dump`.

Two smaller decisions inside that one:

- **A DNS name rather than the quick tunnel.** Let's Encrypt will not issue for a
  bare IP, and a Cloudflare quick tunnel is issued a new random hostname on every
  restart, which breaks `APP_ORIGIN` and every bookmark. A name that survives a
  restart is the requirement; a free dynamic-DNS subdomain satisfies it.
- **Mail is configured to satisfy the production startup check, not to deliver
  invitations.** Invitations already work without it - the invite code is
  returned to the trainer and shown in the UI. The check exists because a
  verification link in a log file is not delivery. On a provider tier with no
  verified domain this means password reset works for the operator and not yet
  for testers, which is a known gap for the pilot rather than a finished state.

## Testing

| Layer | What runs |
|---|---|
| Unit | `app/validation.test.mjs` and `app/calendar-feed.test.mjs` via `node --test`. No server, no database. Covers password and date rules, unit conversion, set-row and schedule normalization, permission merging, cursor encoding, and iCalendar escaping, folding and all-day date arithmetic. |
| Static | `work/accessibility-check.mjs`. Every control named, every dialog named, chart text alternative, live regions, touch targets. Dependency-free on purpose; contrast, focus order and screen-reader phrasing still need a person. |
| API | Seven suites in `work/` covering auth, authorization, the workout loop, the exercise library, coaching notes, progress and units, scheduling, calendar date windows, the calendar export feed and its revocation, retention, and pagination. |
| End to end | `work/e2e-coaching-journey.mjs` walks the plan's definition of done on accounts created during the run. |
| Authorization probes | `work/endpoint-exposure-check.mjs` (nothing answers unauthenticated) and `work/cross-account-check.mjs` (no record is reachable by guessing an id). Both now run in CI. |

## Consistency and availability

Accounts, permissions, coaching relationships, workout assignment, workout completion, progress, and billing state require strong consistency and PostgreSQL transactions. Notifications, analytics summaries, search indexes, and future email delivery may be eventually consistent. The pilot favors correctness over accepting writes during a database outage.

Production network policy should expose only ports 80/443 at the edge, keep PostgreSQL on a private network, restrict metrics by token and network policy, and allow administrative database access only through the managed provider or a controlled tunnel. Backups must be encrypted, tested through restoration drills, and retained according to the privacy policy.
