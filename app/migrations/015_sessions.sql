BEGIN;

-- Signed-in sessions live in the database so a restart or a deploy does not sign
-- everybody out, and so "sign out my other devices" has something real to act on.
--
-- Only authenticated sessions are stored. An anonymous visitor's session holds
-- nothing but a CSRF token, and persisting one row per unauthenticated request
-- would trade a memory leak for a table that grows just as fast.
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  csrf TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_user_last_seen
  ON sessions (user_id, last_seen DESC);

CREATE INDEX IF NOT EXISTS sessions_last_seen
  ON sessions (last_seen);

COMMIT;
