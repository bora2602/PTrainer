BEGIN;

CREATE TABLE IF NOT EXISTS privacy_consents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  notice_version VARCHAR(20) NOT NULL,
  source VARCHAR(30) NOT NULL DEFAULT 'REGISTRATION',
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  withdrawn_at TIMESTAMPTZ,
  CHECK (source IN ('REGISTRATION', 'NOTICE_UPDATE'))
);

CREATE INDEX IF NOT EXISTS privacy_consents_user_accepted
  ON privacy_consents (user_id, accepted_at DESC);

COMMIT;
