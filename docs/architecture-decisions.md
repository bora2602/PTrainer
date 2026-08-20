# Ptrainer architecture decisions

This document records which infrastructure concepts are appropriate for the current Ptrainer pilot, which are deferred, and why. Adding every technology would create more failure modes without improving the product.

## Implemented now

| Capability | Decision |
|---|---|
| Database design | PostgreSQL schema with foreign keys, checks, unique constraints, versioned workout snapshots, migrations, and targeted indexes. PGlite is used only for persistent local development. |
| ACID | Multi-step invitation acceptance, workout log/status updates, and account anonymization use database transactions. |
| REST | The browser uses a same-origin REST API with consistent JSON errors. |
| Authentication | Scrypt password hashing, rotating server sessions, CSRF tokens, secure cookies in production, role checks, relationship checks, password reset expiry, and login rate limiting. |
| Rate limiting | Authentication, invitations, password resets, and messages are limited. The current limiter is process-local and suitable for one application instance. |
| Encryption | HTTPS is terminated by Caddy; production requires an HTTPS origin. Passwords are one-way hashed. Database volumes, managed database storage, object storage, and backups must have provider-side encryption enabled. Secrets are environment variables and must not be committed. |
| Reverse proxy | Caddy provides HTTPS, compression, security headers, access logs, and upstream health checks. |
| Caching | Static assets use ETags and a short browser cache; HTML and authenticated API responses use `no-store`. |
| Polling | Notifications and the open conversation refresh every 20 seconds only while the tab is visible. This is simpler and more reliable than WebSockets for the pilot. |
| Error logging | JSON request/error logs include a request ID, route, status, and duration without logging message, nutrition, password, or token content. |
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
| Load balancer and multiple replicas | Add only after sessions and mutable domain caches move out of process. The current pilot must run one app replica. |
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

## Consistency and availability

Accounts, permissions, coaching relationships, workout assignment, workout completion, progress, and billing state require strong consistency and PostgreSQL transactions. Notifications, analytics summaries, search indexes, and future email delivery may be eventually consistent. The pilot favors correctness over accepting writes during a database outage.

Production network policy should expose only ports 80/443 at the edge, keep PostgreSQL on a private network, restrict metrics by token and network policy, and allow administrative database access only through the managed provider or a controlled tunnel. Backups must be encrypted, tested through restoration drills, and retained according to the privacy policy.
