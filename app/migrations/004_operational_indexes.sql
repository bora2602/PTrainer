BEGIN;

CREATE INDEX IF NOT EXISTS relationships_trainer_status
  ON trainer_trainee_relationships (trainer_id, status);

CREATE INDEX IF NOT EXISTS relationships_trainee_status
  ON trainer_trainee_relationships (trainee_id, status);

CREATE INDEX IF NOT EXISTS invitations_email_status_expiry
  ON invitations (email, status, expires_at DESC);

CREATE INDEX IF NOT EXISTS workout_logs_assignment_created
  ON workout_logs (assigned_workout_id, created_at DESC);

CREATE INDEX IF NOT EXISTS nutrition_entries_trainee_date
  ON nutrition_entries (trainee_id, entry_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_recipient_created
  ON notifications (recipient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_unread
  ON notifications (recipient_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS subscriptions_status_period
  ON subscriptions (status, current_period_end);

COMMIT;
