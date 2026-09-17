-- Safe production migration for flexible kg/litr quantities.
-- Integer stock values are preserved exactly when widened to numeric(16,6).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'products'
      AND column_name = 'stock'
      AND (data_type <> 'numeric' OR numeric_precision <> 16 OR numeric_scale <> 6)
  ) THEN
    ALTER TABLE "products"
      ALTER COLUMN "stock" TYPE numeric(16, 6)
      USING "stock"::numeric(16, 6);
  END IF;
END $$;