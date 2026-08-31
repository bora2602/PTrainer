BEGIN;

ALTER TABLE workout_templates
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- A recurring program is expanded into one row per occurrence at assign time and
-- the occurrences share a series id. Each row keeps its own snapshot, so editing
-- or retiring the program never reaches back into a session already logged.
ALTER TABLE assigned_workouts
  ADD COLUMN IF NOT EXISTS start_date DATE,
  ADD COLUMN IF NOT EXISTS end_date DATE,
  ADD COLUMN IF NOT EXISTS frequency VARCHAR(20) NOT NULL DEFAULT 'ONCE',
  ADD COLUMN IF NOT EXISTS series_id TEXT;

DO $$ BEGIN
  ALTER TABLE assigned_workouts ADD CONSTRAINT assigned_workouts_frequency_valid
    CHECK (frequency IN ('ONCE','DAILY','WEEKLY','BIWEEKLY'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE assigned_workouts ADD CONSTRAINT assigned_workouts_date_order
    CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS assigned_workouts_series
  ON assigned_workouts (series_id, due_date) WHERE series_id IS NOT NULL;

COMMIT;
