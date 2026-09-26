BEGIN;

-- Authenticator-app two-factor, and the flag that makes a demo account a demo
-- account rather than a convention about its email address.

-- One enrolment per user. The row exists from the moment somebody starts
-- enrolling and confirmed_at is what makes it binding, so an abandoned setup
-- never locks anyone out and starting again simply overwrites the secret.
--
-- last_step is the replay guard: a TOTP code stays valid for its whole 30-second
-- window, and without recording the step that was accepted, a code read over a
-- shoulder could be used again inside that window.
CREATE TABLE IF NOT EXISTS user_two_factor (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret TEXT NOT NULL,
  confirmed_at TIMESTAMPTZ,
  last_step BIGINT NOT NULL DEFAULT -1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Recovery codes are the way back in when the phone is lost. Only the digest is
-- stored, exactly as for a password: the plaintext is shown once, at enrolment,
-- and cannot be recovered afterwards. A used code is kept rather than deleted so
-- "this code was already used" stays distinguishable from "no such code".
CREATE TABLE IF NOT EXISTS two_factor_recovery_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS two_factor_recovery_codes_user
  ON two_factor_recovery_codes (user_id, used_at);

-- A demo account is marked in the database rather than inferred from its email,
-- because the guards that stop a demo user from emailing a stranger, changing a
-- shared password or deleting an account have to be a property of the row. An
-- email-suffix convention would be one typo away from applying to nobody, and
-- the failure mode of that is a real account treated as disposable.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS users_is_demo ON users (is_demo) WHERE is_demo;

COMMIT;
