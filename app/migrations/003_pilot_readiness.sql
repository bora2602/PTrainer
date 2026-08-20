BEGIN;

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  bio VARCHAR(1000) NOT NULL DEFAULT '',
  goals VARCHAR(1000) NOT NULL DEFAULT '',
  specialties VARCHAR(500) NOT NULL DEFAULT '',
  preferred_units VARCHAR(10) NOT NULL DEFAULT 'METRIC'
    CHECK (preferred_units IN ('METRIC', 'IMPERIAL')),
  timezone VARCHAR(80) NOT NULL DEFAULT 'America/Toronto',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES users(id),
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_events_actor_created
  ON audit_events (actor_id, created_at DESC);

COMMIT;
