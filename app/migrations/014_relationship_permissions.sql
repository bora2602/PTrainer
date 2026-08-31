BEGIN;

-- Field-level control over what a coaching relationship actually grants.
-- Until now "active trainer" implied total access to a trainee's health data
-- and the right to write records in their name.
--
-- Viewing defaults to on because the trainee chose to accept this specific
-- trainer and coaching without visibility is not coaching. Writing on their
-- behalf defaults to off, because nothing in accepting an invitation implies
-- consent to have measurements and workout logs recorded under your name.
-- Either flag is the trainee's to change at any time.
ALTER TABLE trainer_trainee_relationships
  ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL
    DEFAULT '{"view_progress":true,"view_nutrition":true,"log_on_behalf":false}'::jsonb;

DO $$ BEGIN
  ALTER TABLE trainer_trainee_relationships ADD CONSTRAINT relationships_permissions_object
    CHECK (jsonb_typeof(permissions) = 'object');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
