BEGIN;

-- Photos and files sent in a coaching conversation. The bytes live in the
-- database rather than on disk so the one backup that already exists covers
-- them, PGlite and PostgreSQL behave the same, and no second volume or object
-- store has to be provisioned for a pilot. The ceilings below keep that honest:
-- the table cannot quietly grow into a file server.
CREATE TABLE IF NOT EXISTS message_attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  uploader_id TEXT NOT NULL REFERENCES users(id),
  file_name VARCHAR(200) NOT NULL CHECK (length(trim(file_name)) > 0),
  -- The type is read from the file's own first bytes at upload, never taken
  -- from the client, and only these are ever stored or served back.
  content_type VARCHAR(50) NOT NULL
    CHECK (content_type IN ('image/jpeg','image/png','image/webp','image/gif','application/pdf')),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 5242880),
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (octet_length(data) = byte_size)
);

CREATE INDEX IF NOT EXISTS message_attachments_message
  ON message_attachments (message_id);

CREATE INDEX IF NOT EXISTS message_attachments_uploader
  ON message_attachments (uploader_id);

-- A message may now be a photo with no caption, so an empty body is allowed.
-- The rule that a message carries text or at least one attachment is enforced
-- where both are known together, in the route.
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_body_check;

DO $$ BEGIN
  ALTER TABLE messages ADD CONSTRAINT messages_body_length CHECK (length(body) <= 2000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
