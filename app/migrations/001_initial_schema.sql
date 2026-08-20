BEGIN;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash TEXT NOT NULL,
  name VARCHAR(80) NOT NULL,
  role VARCHAR(16) NOT NULL CHECK (role IN ('TRAINER','TRAINEE')),
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','DELETED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trainer_trainee_relationships (
  trainer_id TEXT NOT NULL REFERENCES users(id),
  trainee_id TEXT NOT NULL REFERENCES users(id),
  status VARCHAR(16) NOT NULL CHECK (status IN ('PENDING','ACTIVE','PAUSED','ARCHIVED','REVOKED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (trainer_id, trainee_id),
  CHECK (trainer_id <> trainee_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_trainer_per_trainee
  ON trainer_trainee_relationships (trainee_id)
  WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  trainer_id TEXT NOT NULL REFERENCES users(id),
  email TEXT NOT NULL CHECK (email = lower(email)),
  token_hash TEXT NOT NULL UNIQUE,
  note VARCHAR(500) NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL CHECK (status IN ('PENDING','ACCEPTED','EXPIRED','REVOKED')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS one_pending_invite_per_trainer_email
  ON invitations (trainer_id, email) WHERE status = 'PENDING';

CREATE TABLE IF NOT EXISTS workout_templates (
  id TEXT PRIMARY KEY,
  trainer_id TEXT NOT NULL REFERENCES users(id),
  name VARCHAR(100) NOT NULL,
  description VARCHAR(500) NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  exercises JSONB NOT NULL CHECK (jsonb_typeof(exercises) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS assigned_workouts (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES workout_templates(id),
  trainer_id TEXT NOT NULL REFERENCES users(id),
  trainee_id TEXT NOT NULL REFERENCES users(id),
  template_snapshot JSONB NOT NULL,
  due_date DATE,
  status VARCHAR(20) NOT NULL CHECK (status IN ('ASSIGNED','IN_PROGRESS','COMPLETED','SKIPPED','ARCHIVED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assigned_workouts_trainee_due ON assigned_workouts (trainee_id, due_date DESC);

CREATE TABLE IF NOT EXISTS workout_logs (
  id TEXT PRIMARY KEY,
  assigned_workout_id TEXT NOT NULL REFERENCES assigned_workouts(id),
  author_id TEXT NOT NULL REFERENCES users(id),
  idempotency_key VARCHAR(100) NOT NULL,
  exercises JSONB NOT NULL,
  completed_count INTEGER NOT NULL CHECK (completed_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (author_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS progress_entries (
  id TEXT PRIMARY KEY,
  trainee_id TEXT NOT NULL REFERENCES users(id),
  author_id TEXT NOT NULL REFERENCES users(id),
  metric_type VARCHAR(50) NOT NULL,
  value NUMERIC(12,3) NOT NULL CHECK (value >= 0),
  unit VARCHAR(20) NOT NULL,
  measured_at TIMESTAMPTZ NOT NULL,
  note VARCHAR(500) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS progress_entries_trainee_metric_time ON progress_entries (trainee_id, metric_type, measured_at DESC);

CREATE TABLE IF NOT EXISTS nutrition_entries (
  id TEXT PRIMARY KEY,
  trainee_id TEXT NOT NULL REFERENCES users(id),
  author_id TEXT NOT NULL REFERENCES users(id),
  entry_date DATE NOT NULL,
  entry_type VARCHAR(30) NOT NULL,
  description VARCHAR(1000) NOT NULL DEFAULT '',
  calories INTEGER CHECK (calories >= 0),
  protein_g NUMERIC(8,2) CHECK (protein_g >= 0),
  carbs_g NUMERIC(8,2) CHECK (carbs_g >= 0),
  fat_g NUMERIC(8,2) CHECK (fat_g >= 0),
  water_ml INTEGER CHECK (water_ml >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  recipient_id TEXT NOT NULL REFERENCES users(id),
  event_type VARCHAR(50) NOT NULL,
  title VARCHAR(120) NOT NULL,
  body VARCHAR(500) NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
