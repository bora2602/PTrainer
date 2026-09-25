BEGIN;

-- A workout is now started and finished as one session, so a log records when
-- it began and how long it took. Both are optional: every log written before
-- this, and any client that never presses Start, simply has neither.
ALTER TABLE workout_logs
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS duration_seconds INTEGER;

DO $$ BEGIN
  ALTER TABLE workout_logs ADD CONSTRAINT workout_logs_duration_range
    CHECK (duration_seconds IS NULL OR (duration_seconds >= 0 AND duration_seconds <= 86400));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
