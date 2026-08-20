BEGIN;

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  relationship_trainer_id TEXT NOT NULL,
  relationship_trainee_id TEXT NOT NULL,
  sender_id TEXT NOT NULL REFERENCES users(id),
  body VARCHAR(2000) NOT NULL CHECK (length(body) > 0),
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (relationship_trainer_id, relationship_trainee_id)
    REFERENCES trainer_trainee_relationships(trainer_id, trainee_id)
);

CREATE INDEX IF NOT EXISTS messages_relationship_created
  ON messages (relationship_trainer_id, relationship_trainee_id, created_at DESC);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
  plan_code VARCHAR(30) NOT NULL CHECK (plan_code IN ('STARTER','PRO','TEAM')),
  status VARCHAR(20) NOT NULL CHECK (status IN ('TRIALING','ACTIVE','PAST_DUE','CANCELED')),
  provider VARCHAR(30) NOT NULL DEFAULT 'TEST',
  provider_customer_id TEXT,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;

