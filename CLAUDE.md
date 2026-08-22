# CLAUDE.md — PTrainer

This file orients Claude Code (or any engineer) working in this repository. Read this before writing code. It reflects the product plan in `Fitness_Coaching_Platform_Plan.docx` — treat that document as the source of truth for product rationale and this file as the source of truth for how to build it.

> **Working agreement, before anything else: never run `git commit` or `git push` without asking first and waiting for an explicit yes.** Staging changes and proposing a commit message is welcome; writing to history is the maintainer's call. Full rule in [section 6a](#6a-working-agreement--version-control).

## 1. What this product is

A web platform connecting fitness trainers with trainees. Trainers assign workouts from reusable templates, review completion and progress; trainees log workouts, weight, and nutrition. It is a coaching/tracking tool, **not** a medical diagnostic system — never introduce features that could be read as clinical advice.

MVP roles: `trainer`, `trainee`. `admin` is a future role — design permission checks so adding it later doesn't require a rewrite (role-based checks, not `if trainer/trainee` binaries).

## 2. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | React (or SvelteKit) + responsive CSS | Mobile-first; workout logger must work one-handed on a phone |
| Backend | Spring Boot REST API | Modular monolith — see §3 |
| Database | PostgreSQL (SQLite only for local prototyping) | UUID primary keys for anything exposed via API |
| Auth | Session or short-lived JWT + refresh-token rotation | Never roll custom crypto; use a vetted library (Spring Security) |
| File storage | Object storage (S3-compatible) | No binary blobs in Postgres rows |
| Charts | Any frontend charting lib (Recharts, Chart.js) | Weight, completion %, nutrition trends |
| Deploy | Docker containers, managed Postgres, HTTPS everywhere, env-based config | No secrets in source control — see §7 |

Do not introduce a second backend language/framework or a second frontend framework without updating this file — consistency here is a deliberate scope-control decision, not an oversight.

## 3. Architecture

Single modular-monolith backend, split into logical modules with clear boundaries (separate packages, not separate services, for MVP):

- `identity` — accounts, auth, sessions
- `profiles` — trainer/trainee profile data
- `relationships` — trainer-trainee invitations, connection status
- `exercises` — exercise library
- `workouts` — templates, assignment, versioning
- `logging` — workout completion / set logs
- `progress` — weight, body metrics, nutrition
- `notifications` — optional for MVP, stub the interface now
- `audit` — audit event capture, used by every module that mutates sensitive data

Domain logic lives in services, not controllers. Controllers only: parse request → call service → map response → set status code.

## 4. Data model (see plan §8 for full field lists)

Core tables: `users`, `trainer_profiles`, `trainee_profiles`, `trainer_trainee_relationships`, `exercises`, `workout_templates`, `workout_template_exercises`, `assigned_workouts`, `workout_logs`, `set_logs`, `progress_metrics`, `progress_entries`, `nutrition_entries`, `trainer_notes`, `notifications`, `audit_events`.

Rules that apply to every table:
- UUID (not sequential int) primary key for any record referenced by an external API.
- `created_at`, `updated_at` on every table; `deleted_at` (soft delete) on any table needed for audit or historical workout accuracy — specifically `workout_templates`, `assigned_workouts`, `workout_logs`, `exercises`.
- Store the unit alongside every numeric measurement (`unit` column) — never assume a global unit system. Preserve the trainee's original input unit even if you also store a normalized value for charting.
- Database-level constraints for: nonnegative numeric values, valid foreign keys, and **at most one active relationship** between a given trainer/trainee pair (unique partial index on status = 'active').
- `workout_templates` changes must not mutate historical `assigned_workouts` — assign by snapshot or immutable version reference, never by live foreign key to the mutable template.

## 5. API conventions

Base pattern from plan §9 (`/api/auth/*`, `/api/me`, `/api/relationships`, `/api/workout-templates`, `/api/assigned-workouts`, `/api/progress-entries`, `/api/nutrition-entries`, etc.). Add these conventions when implementing:

- **Every** endpoint enforces both role-based AND relationship-based authorization server-side. Never trust a client-supplied trainee/trainer ID in the URL without checking the requesting user actually owns or is connected to that record — this is the #1 risk called out in the plan (broken object-level authorization).
- Validate all request payloads server-side regardless of client-side validation.
- Consistent error shape, e.g. `{ "error": { "code": "...", "message": "...", "field": "..." } }`. Never leak stack traces or internal identifiers in error bodies.
- Idempotency: writing a workout log must be safe against duplicate submission (e.g. client-generated idempotency key, or unique constraint on `(assigned_workout_id, submitted_at_client)`).
- Paginate any list endpoint that can grow unbounded (`workout-logs`, `progress-entries`, `nutrition-entries`) — cursor or offset pagination, document which.
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

Do not build features from plan §2 "Features for later releases" (native apps, in-app messaging, billing, gym/org accounts, food databases, wearables, video, automated insights, public discovery) unless the plan is explicitly updated to move them into MVP scope.

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
