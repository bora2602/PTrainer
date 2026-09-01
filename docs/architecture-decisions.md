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

## Testing

| Layer | What runs |
|---|---|
| Unit | `app/validation.test.mjs` via `node --test`. No server, no database. Covers password and date rules, unit conversion, set-row and schedule normalization, permission merging, and cursor encoding. |
| Static | `work/accessibility-check.mjs`. Every control named, every dialog named, chart text alternative, live regions, touch targets. Dependency-free on purpose; contrast, focus order and screen-reader phrasing still need a person. |
| API | Five suites in `work/` covering auth, authorization, the workout loop, the exercise library, coaching notes, progress and units, scheduling, retention, and pagination. |
| End to end | `work/e2e-coaching-journey.mjs` walks the plan's definition of done on accounts created during the run. |
| Authorization probes | `work/endpoint-exposure-check.mjs` (nothing answers unauthenticated) and `work/cross-account-check.mjs` (no record is reachable by guessing an id). Both now run in CI. |

## Consistency and availability

Accounts, permissions, coaching relationships, workout assignment, workout completion, progress, and billing state require strong consistency and PostgreSQL transactions. Notifications, analytics summaries, search indexes, and future email delivery may be eventually consistent. The pilot favors correctness over accepting writes during a database outage.

Production network policy should expose only ports 80/443 at the edge, keep PostgreSQL on a private network, restrict metrics by token and network policy, and allow administrative database access only through the managed provider or a controlled tunnel. Backups must be encrypted, tested through restoration drills, and retained according to the privacy policy.
