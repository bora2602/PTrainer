BEGIN;

-- Actual performance is stored separately from the prescribed targets that live
-- in assigned_workouts.template_snapshot, so editing a template can never
-- rewrite what somebody already lifted.
ALTER TABLE workout_logs
  ADD COLUMN IF NOT EXISTS status VARCHAR(10) NOT NULL DEFAULT 'FINAL',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE assigned_workouts
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

DO $$ BEGIN
  ALTER TABLE workout_logs ADD CONSTRAINT workout_logs_status_valid
    CHECK (status IN ('DRAFT','FINAL'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- One resumable draft per author per assignment. The key carries a colon, which
-- the client-supplied idempotency key format rejects, so a caller cannot forge
-- a request that collides with a draft row.
CREATE TABLE IF NOT EXISTS set_logs (
  id TEXT PRIMARY KEY,
  workout_log_id TEXT NOT NULL REFERENCES workout_logs(id) ON DELETE CASCADE,
  exercise_index INTEGER NOT NULL CHECK (exercise_index >= 0 AND exercise_index < 50),
  set_index INTEGER NOT NULL CHECK (set_index >= 0 AND set_index < 50),
  completed BOOLEAN NOT NULL DEFAULT false,
  reps INTEGER CHECK (reps >= 0 AND reps <= 1000),
  load_value NUMERIC(10,3) CHECK (load_value >= 0 AND load_value <= 100000),
  load_unit VARCHAR(10) CHECK (load_unit IN ('kg','lb')),
  duration_seconds INTEGER CHECK (duration_seconds >= 0 AND duration_seconds <= 86400),
  distance_value NUMERIC(10,3) CHECK (distance_value >= 0 AND distance_value <= 100000),
  distance_unit VARCHAR(10) CHECK (distance_unit IN ('m','km','mi')),
  rest_seconds INTEGER CHECK (rest_seconds >= 0 AND rest_seconds <= 3600),
  exertion NUMERIC(3,1) CHECK (exertion >= 1 AND exertion <= 10),
  pain_flag BOOLEAN NOT NULL DEFAULT false,
  note VARCHAR(500) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A measurement without its unit is not a measurement.
  CHECK (load_value IS NULL OR load_unit IS NOT NULL),
  CHECK (distance_value IS NULL OR distance_unit IS NOT NULL),
  UNIQUE (workout_log_id, exercise_index, set_index)
);

CREATE INDEX IF NOT EXISTS set_logs_log_order
  ON set_logs (workout_log_id, exercise_index, set_index);

COMMIT;
