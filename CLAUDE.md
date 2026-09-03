# CLAUDE.md — PTrainer

This file orients Claude Code (or any engineer) working in this repository. Read this before writing code. It reflects the product plan in [`outputs/Fitness_Coaching_Platform_Planning_Document.docx`](outputs/Fitness_Coaching_Platform_Planning_Document.docx) — treat that document as the source of truth for product rationale and this file as the source of truth for how to build it.

> **Working agreement, before anything else: never run `git commit` or `git push` without asking first and waiting for an explicit yes.** Staging changes and proposing a commit message is welcome; writing to history is the maintainer's call. Full rule in [section 6a](#6a-working-agreement--version-control).

## 1. What this product is

A web platform connecting fitness trainers with trainees. Trainers assign workouts from reusable templates, review completion and progress; trainees log workouts, weight, and nutrition. It is a coaching/tracking tool, **not** a medical diagnostic system — never introduce features that could be read as clinical advice.

MVP roles: `trainer`, `trainee`. `admin` is a future role — design permission checks so adding it later doesn't require a rewrite (role-based checks, not `if trainer/trainee` binaries).

## 2. Tech stack

This section describes what the repository actually contains. It diverges from
the plan document's recommendation (Spring Boot + SvelteKit/React), and that was
a deliberate call for a pilot that has to stay small and deployable from one
machine — not drift. The plan's *requirements* still bind; only the technology
choice differs.

| Layer | Choice | Notes |
|---|---|---|
| Frontend | Vanilla JavaScript, no framework, no build step | `app/index.html`, `app/app.js`, `app/*.css`. Mobile-first; the workout logger must work one-handed on a phone. |
| Backend | Node 24 with `node:http` — no web framework | `app/server.mjs`. Modular boundaries are described in §3. |
| Database | PostgreSQL 16 in production; PGlite for local development | Same SQL either way. Numbered migrations in `app/migrations/`, applied at startup. |
| Auth | Server sessions in PostgreSQL, rotated on privilege change | scrypt password hashing, CSRF tokens, origin allow-list, `httpOnly` cookies, `Secure` in production. |
| Mail | Pluggable transport (`app/email.mjs`) | `log` for development, `http` for a provider. Production refuses to start on `log`. |
| File storage | None yet | Deferred until progress photos or exercise media are in scope — see `docs/architecture-decisions.md`. |
| Charts | Hand-rolled CSS bars, no charting library | Keeps the dependency count at two. |
| Deploy | Docker, Compose, optional Caddy edge, Cloudflare tunnel | Env-based config; no secrets in source control (§7). |

**Two runtime dependencies: `pg` and `@electric-sql/pglite`.** That is a feature.
Adding a third needs a reason that outweighs the supply-chain and maintenance
cost. Do not introduce a frontend framework, a build step, or a second backend
language without updating this file first.

## 3. Architecture

One process, organised by module boundary. The intended modules are `identity`,
`profiles`, `relationships`, `exercises`, `workouts`, `logging`, `progress`,
`notifications`, and `audit`.

**Current reality, stated plainly:** most of that lives in one large
`app/server.mjs`. Pure input validation, normalization and unit conversion have
been extracted into `app/validation.mjs` (which is why they can be unit tested
without a server), and `email.mjs`, `retention.mjs`, `bounded-map.mjs`,
`food-lookup.mjs` and `exercise-catalog.mjs` are separate. The routing and
persistence for each domain is not yet split.

The target stands, and the way to reach it is to extract a module when you next
have reason to touch that domain, rather than in one sweeping refactor.

Rules that apply regardless of how the code is arranged:

- **Domain decisions belong in functions, not inline in a route handler.** A
  route should read as: check access → validate → call the operation → map the
  response.
- **Authorization is a domain rule.** `accessibleTrainee()` and `logAccess()` are
  the choke points; new health-data routes go through them rather than
  reimplementing the check.
- Anything pure — validation, normalization, conversion — goes in
  `validation.mjs` so it can be tested directly.

## 4. Data model

Tables: `users`, `sessions`, `user_profiles`, `trainer_trainee_relationships`,
`invitations`, `exercises`, `workout_templates`, `assigned_workouts`,
`workout_logs`, `set_logs`, `progress_metrics`, `progress_entries`,
`nutrition_entries`, `nutrition_targets`, `trainer_notes`, `messages`,
`notifications`, `audit_events`, `privacy_consents`, `password_reset_tokens`,
`email_verification_tokens`, `subscriptions`, `schema_migrations`.

Two differences from the plan's §8 list, both intentional: `trainer_profiles`
and `trainee_profiles` are one `user_profiles` table, because the role-specific
fields were few enough that two tables bought nothing; and
`workout_template_exercises` is a JSONB array on the template rather than a
child table, because a template's exercises are only ever read and written as a
whole.

Rules that apply to every table:

- **Non-sequential public identifiers.** Text ids of the form `prefix_<20 hex>`
  (`usr_`, `tpl_`, `assigned_`). Not UUIDs, but they satisfy the requirement the
  plan actually states — "UUIDs or comparable non-sequential public identifiers"
  — and carry their type, which helps when reading logs.
- `created_at` on every table that records an event, and `updated_at` on every
  table whose rows are edited in place. Several tables deliberately have neither:
  `audit_events` is append-only by design — an audit row that can be updated is a
  defect, not a feature — while `sessions`, `notifications` and
  `privacy_consents` carry a purpose-specific timestamp (`last_seen`, `read_at`,
  `withdrawn_at`) that already answers when they last changed. Known gap:
  `invitations` changes status without recording when.
- `deleted_at` wherever history or audit needs the row to survive:
  `workout_templates`, `assigned_workouts`, `workout_logs`, `exercises`,
  `progress_entries`, `trainer_notes`.
- **Store the unit alongside every measurement, and never overwrite what the
  person entered.** `progress_entries` keeps `value`/`unit` exactly as typed and
  derives `value_normalized`/`normalized_unit` for charting. `set_logs` requires
  a unit whenever a load or distance is present — a database `CHECK`, not just a
  validator.
- Database-level constraints for nonnegative values, valid foreign keys, and
  relationship uniqueness. Note the shipped index is
  `one_active_trainer_per_trainee`: **one active trainer per trainee overall**,
  which is stricter than "one per pair" and encodes the MVP's single-trainer
  assumption. Revisit it if open decision #3 (multi-trainer) is answered yes.
- **A relationship carries permissions**, not just a status. `view_progress` and
  `view_nutrition` default on, `log_on_behalf` defaults off, and only the trainee
  may change them.
- `workout_templates` changes must not mutate historical `assigned_workouts`.
  Each assignment holds its own snapshot; a recurring program is expanded into
  dated occurrences at assign time, sharing a `series_id`.


## 5. API conventions

Base pattern from plan §9 (`/api/auth/*`, `/api/me`, `/api/relationships`, `/api/workout-templates`, `/api/assigned-workouts`, `/api/progress-entries`, `/api/nutrition-entries`, etc.). Add these conventions when implementing:

- **Every** endpoint enforces both role-based AND relationship-based authorization server-side. Never trust a client-supplied trainee/trainer ID in the URL without checking the requesting user actually owns or is connected to that record — this is the #1 risk called out in the plan (broken object-level authorization).
- Validate all request payloads server-side regardless of client-side validation.
- Consistent error shape, e.g. `{ "error": { "code": "...", "message": "...", "field": "..." } }`. Never leak stack traces or internal identifiers in error bodies.
- Idempotency: writing a workout log must be safe against duplicate submission (e.g. client-generated idempotency key, or unique constraint on `(assigned_workout_id, submitted_at_client)`).
- Paginate any list endpoint that can grow unbounded. **The choice is keyset (cursor) pagination, not offset** — an offset re-scans what it skips and can repeat or drop rows at a page boundary when something is written between requests. Paginated today: `progress-entries`, `nutrition-entries`, `messages`, `notifications`, `assigned-workouts`. Full contract in [docs/api-reference.md](docs/api-reference.md).
- Do not log request/response bodies containing passwords, tokens, or health-related field values.

## 6. Security & privacy (non-negotiable)

- Hash passwords with a modern one-way algorithm via a trusted library (e.g. Spring Security's `BCryptPasswordEncoder` or Argon2) — never write custom hashing.
- HTTPS in every non-local environment; secure, httpOnly cookies or carefully scoped token storage; CSRF protection on state-changing requests; rate limiting on all `/api/auth/*` endpoints.
- Authorization checks belong in the service layer, backed by DB constraints — never rely on the UI hiding a button as the only control.
- Nutrition, progress entries, and trainer notes are private by default; visibility is explicit and field-level, not inferred from role alone.
- Collect only fields a shipped feature actually uses. Emergency contact info, date of birth, and similar fields require a specific justified feature before they're added to a form.
- Audit log sensitive actions (relationship changes, permission changes, data export, account deletion) with actor, action, entity, entity ID, timestamp — never log the sensitive content itself.
- This product will likely process personal health information from Canadian users — do not finalize retention/consent/export behavior without legal review of applicable Canadian privacy law (see plan §10). Treat this as a blocking item for launch, not a nice-to-have.

## 6a. Working agreement — version control

**Never run `git commit` or `git push` without asking first and getting an explicit yes.**
This holds even when the work is complete, the tests pass, or the repository was just
created. Staging changes and proposing a commit message are welcome; writing to history
is the maintainer's call. Same rule for `git commit --amend`, tags, and branch pushes.

## 7. Environment & secrets

- All config via environment variables; `.env.example` in repo, real `.env` gitignored.
- Required at minimum: `DATABASE_URL`, `JWT_SECRET` or session signing key, `OBJECT_STORAGE_*` credentials, `APP_BASE_URL` (for invitation links / email verification).
- No secrets committed, ever, including in test fixtures or seed scripts.

## 8. Testing expectations

Match plan §13. When adding a feature, add tests at the layer where a regression would first be caught:

- **Unit**: validation rules, unit conversion, permission-decision functions.
- **Integration**: invitation flow, workout assignment, progress-entry access across roles.
- **API**: auth, authorization (including ID-tampering attempts — swap another user's UUID into the URL and confirm 403/404), malformed input, duplicate-submission handling.
- **E2E** (at least for MVP-critical paths): trainer onboarding → invite → trainee accepts → workout assigned → trainee logs → trainer reviews.

Any PR touching authorization logic must include a test that proves the *denied* case, not just the allowed case.

## 9. Build order (matches plan §16 backlog)

1. Auth, roles, profiles
2. Trainer-trainee invitations & relationship lifecycle
3. Exercise library + workout templates
4. Workout assignment + trainee logging (with versioning/snapshot)
5. Weight & nutrition entries
6. Dashboards, charts, filtering
7. Authorization test suite, audit events, backups, deploy pipeline
8. Pilot, then reprioritize from feedback

Steps 1-7 are implemented. **Messaging and test-mode billing are also built, and both sit outside the plan's MVP boundary** (plan §2 lists them under later releases, and §11 below has messaging as an open decision defaulting to *out*). They shipped before this was noticed. They are not to be extended, and the maintainer should either move them into scope in the plan document or record them as pilot-only extras — see [docs/architecture-decisions.md](docs/architecture-decisions.md). Beyond those two, do not build features from plan §2 "Features for later releases" (native apps, in-app messaging, billing, gym/org accounts, food databases, wearables, video, automated insights, public discovery) unless the plan is explicitly updated to move them into MVP scope.

The **calendar view** is a deliberate borderline case, resolved rather than drifted into: plan §2 lists "calendar and appointments" under later releases, but what shipped is only a read-only month view of assignments the MVP already creates — §2's MVP includes "assignment, scheduling" and §6 already specifies "upcoming assignments" on the trainer dashboard. It reads; it writes nothing. **An iCal/webcal feed, Google or Outlook sync, and appointment booking stay out** and need the plan updated first — the reasoning for each is in [docs/architecture-decisions.md](docs/architecture-decisions.md).

## 10. Definition of done for any MVP feature

A feature isn't done when it works for the happy path. It's done when:
- Server-side authorization is enforced and tested (allowed + denied cases).
- Inputs are validated server-side with sensible error messages.
- It works on a mobile browser viewport with touch-sized targets.
- Sensitive fields are private by default.
- Relevant audit event is recorded, if the action mutates sensitive data.
- It degrades gracefully if a non-critical dependency (charts, notifications, file upload) fails — it should not take down the core logging flow.

## 11. Open product decisions still pending sign-off

These affect data model and scope — check `Fitness_Coaching_Platform_Plan.docx` §18 before building around an assumption:
- Web app vs. responsive web vs. native for v1 (plan assumes responsive web).
- Who pays: trainers, trainees, or both.
- Multi-trainer support for a trainee (MVP assumes one trainer initially).
- Nutrition: free-form journal vs. structured macro tracking.
- Progress photos in or out of MVP.
- In-app messaging in or out of MVP (plan defaults to out).

If a task requires an answer to one of these and it's still unresolved, flag it rather than silently picking an assumption that expands scope.
