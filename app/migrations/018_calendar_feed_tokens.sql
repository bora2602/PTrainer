BEGIN;

-- A calendar client cannot send a session cookie or a CSRF token, so a
-- subscribable feed needs a credential of its own. Only the hash is stored, the
-- same way invitation, reset and verification tokens are handled: a database
-- copy yields no working URL. The fingerprint is the first few characters of
-- the token and is deliberately not secret - it is what Settings shows so a
-- person can tell which link is live without the link being shown again.
CREATE TABLE IF NOT EXISTS calendar_feed_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

-- One live link per person, enforced here rather than only in the handler:
-- issuing a replacement must retire the old one, and a second live token would
-- be a credential nobody remembers granting.
CREATE UNIQUE INDEX IF NOT EXISTS one_active_calendar_feed_per_user
  ON calendar_feed_tokens (user_id) WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS calendar_feed_tokens_user
  ON calendar_feed_tokens (user_id, created_at DESC);

COMMIT;
