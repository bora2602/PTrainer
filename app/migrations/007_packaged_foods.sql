BEGIN;

ALTER TABLE nutrition_entries
  ADD COLUMN IF NOT EXISTS food_barcode VARCHAR(14),
  ADD COLUMN IF NOT EXISTS food_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS food_brand VARCHAR(200),
  ADD COLUMN IF NOT EXISTS food_quantity_g NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS data_source VARCHAR(50);

ALTER TABLE nutrition_entries
  ADD CONSTRAINT nutrition_entries_food_barcode_format
  CHECK (food_barcode IS NULL OR food_barcode ~ '^[0-9]{8,14}$');

ALTER TABLE nutrition_entries
  ADD CONSTRAINT nutrition_entries_food_quantity_positive
  CHECK (food_quantity_g IS NULL OR (food_quantity_g > 0 AND food_quantity_g <= 100000));

CREATE INDEX IF NOT EXISTS nutrition_entries_food_barcode
  ON nutrition_entries (food_barcode)
  WHERE food_barcode IS NOT NULL;

COMMIT;
