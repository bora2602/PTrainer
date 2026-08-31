BEGIN;

-- The exercise catalog moves out of process memory so a trainer can own entries,
-- correct them, and retire them. Platform rows carry no creator; trainer rows do.
-- Nothing is ever hard-deleted, because historical workouts name the movement
-- they prescribed and that record has to stay readable.
CREATE TABLE IF NOT EXISTS exercises (
  id TEXT PRIMARY KEY,
  name VARCHAR(100) NOT NULL CHECK (length(trim(name)) >= 2),
  name_key TEXT NOT NULL,
  muscle_group VARCHAR(50) NOT NULL DEFAULT '',
  equipment VARCHAR(50) NOT NULL DEFAULT '',
  instructions VARCHAR(2000) NOT NULL DEFAULT '',
  difficulty VARCHAR(20) NOT NULL DEFAULT 'INTERMEDIATE'
    CHECK (difficulty IN ('BEGINNER','INTERMEDIATE','ADVANCED')),
  media_url VARCHAR(500),
  visibility VARCHAR(20) NOT NULL DEFAULT 'PLATFORM'
    CHECK (visibility IN ('PLATFORM','TRAINER')),
  created_by TEXT REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  -- A platform movement belongs to nobody; a trainer movement must name its owner.
  CHECK ((visibility = 'PLATFORM' AND created_by IS NULL) OR (visibility = 'TRAINER' AND created_by IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS exercises_platform_name
  ON exercises (name_key) WHERE visibility = 'PLATFORM' AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS exercises_trainer_name
  ON exercises (created_by, name_key) WHERE visibility = 'TRAINER' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS exercises_lookup
  ON exercises (visibility, muscle_group) WHERE deleted_at IS NULL;

COMMIT;
