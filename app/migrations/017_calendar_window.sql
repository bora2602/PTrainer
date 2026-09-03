BEGIN;

-- The calendar reads assigned_workouts by a date window rather than by page.
-- A trainee already had (trainee_id, due_date DESC) from the initial schema; a
-- trainer had nothing, so their month view scanned every workout they have ever
-- assigned to find the thirty days on screen.
CREATE INDEX IF NOT EXISTS assigned_workouts_trainer_due
  ON assigned_workouts (trainer_id, due_date)
  WHERE deleted_at IS NULL;

COMMIT;
