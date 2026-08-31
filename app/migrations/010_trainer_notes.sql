BEGIN;

-- Coaching notes are private to their author unless the trainer deliberately
-- shares one with the trainee it is about. Private by default is the rule for
-- every sensitive field in this product, so the column default carries it.
CREATE TABLE IF NOT EXISTS trainer_notes (
  id TEXT PRIMARY KEY,
  trainer_id TEXT NOT NULL REFERENCES users(id),
  trainee_id TEXT NOT NULL REFERENCES users(id),
  body VARCHAR(2000) NOT NULL CHECK (length(trim(body)) > 0),
  visibility VARCHAR(10) NOT NULL DEFAULT 'PRIVATE'
    CHECK (visibility IN ('PRIVATE','SHARED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CHECK (trainer_id <> trainee_id)
);

CREATE INDEX IF NOT EXISTS trainer_notes_pair
  ON trainer_notes (trainer_id, trainee_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS trainer_notes_shared_with_trainee
  ON trainer_notes (trainee_id, created_at DESC)
  WHERE visibility = 'SHARED' AND deleted_at IS NULL;

COMMIT;
