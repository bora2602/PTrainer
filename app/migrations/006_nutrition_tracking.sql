BEGIN;

ALTER TABLE nutrition_entries
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS nutrition_targets (
  trainee_id TEXT PRIMARY KEY REFERENCES users(id),
  author_id TEXT NOT NULL REFERENCES users(id),
  calories INTEGER CHECK (calories >= 0 AND calories <= 100000),
  protein_g NUMERIC(8,2) CHECK (protein_g >= 0 AND protein_g <= 100000),
  carbs_g NUMERIC(8,2) CHECK (carbs_g >= 0 AND carbs_g <= 100000),
  fat_g NUMERIC(8,2) CHECK (fat_g >= 0 AND fat_g <= 100000),
  water_ml INTEGER CHECK (water_ml >= 0 AND water_ml <= 100000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
