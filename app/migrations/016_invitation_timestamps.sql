BEGIN;

-- Invitations change status - accepted, revoked, expired by the retention sweep
-- - and until now nothing recorded when. That matters for the same reason the
-- other lifecycle tables carry it: a support question about when somebody's
-- invitation lapsed had no answer in the data.
ALTER TABLE invitations
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

COMMIT;
