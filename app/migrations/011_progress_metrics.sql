BEGIN;

-- A metric definition names the dimension it measures and the unit charts read.
-- Without this, metric_type was an unvalidated free string and a kilogram and a
-- pound landed on the same axis as bare numbers.
CREATE TABLE IF NOT EXISTS progress_metrics (
  key VARCHAR(50) PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{1,49}$'),
  label VARCHAR(80) NOT NULL,
  dimension VARCHAR(20) NOT NULL CHECK (dimension IN ('MASS','LENGTH','RATIO')),
  canonical_unit VARCHAR(20) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO progress_metrics (key, label, dimension, canonical_unit) VALUES
  ('weight', 'Body weight', 'MASS', 'kg'),
  ('lean_mass', 'Lean mass', 'MASS', 'kg'),
  ('body_fat', 'Body fat', 'RATIO', 'percent'),
  ('waist', 'Waist', 'LENGTH', 'cm'),
  ('chest', 'Chest', 'LENGTH', 'cm'),
  ('hips', 'Hips', 'LENGTH', 'cm'),
  ('thigh', 'Thigh', 'LENGTH', 'cm'),
  ('arm', 'Arm', 'LENGTH', 'cm'),
  ('calf', 'Calf', 'LENGTH', 'cm')
ON CONFLICT (key) DO NOTHING;

-- The value the trainee typed stays in value/unit exactly as entered. The
-- normalized pair is what charts and comparisons use, so switching a profile
-- between metric and imperial never rewrites anybody's history.
ALTER TABLE progress_entries
  ADD COLUMN IF NOT EXISTS value_normalized NUMERIC(12,3),
  ADD COLUMN IF NOT EXISTS normalized_unit VARCHAR(20),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

UPDATE progress_entries SET
  value_normalized = CASE
    WHEN unit = 'lb' THEN round(value * 0.45359237, 3)
    WHEN unit = 'in' THEN round(value * 2.54, 3)
    ELSE value END,
  normalized_unit = CASE
    WHEN unit IN ('kg','lb') THEN 'kg'
    WHEN unit IN ('cm','in') THEN 'cm'
    ELSE unit END
WHERE value_normalized IS NULL;

COMMIT;
