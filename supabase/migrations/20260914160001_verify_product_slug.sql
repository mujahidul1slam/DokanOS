-- ============================================================================
-- Verification: Storefront Phase 4 Product persistent slug & SEO (§7.5)
-- ============================================================================

DO $$
DECLARE
  v_null_count int;
  v_dup_count int;
BEGIN
  -- 1. Confirm products.slug column exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'products' AND column_name = 'slug'
  ) THEN
    RAISE EXCEPTION 'Verification failed: products.slug column does not exist';
  END IF;

  -- 2. Confirm zero NULL slugs
  SELECT count(*) INTO v_null_count FROM public.products WHERE slug IS NULL;
  IF v_null_count > 0 THEN
    RAISE EXCEPTION 'Verification failed: % products have NULL slug', v_null_count;
  END IF;

  -- 3. Confirm zero duplicate slugs
  SELECT count(*) INTO v_dup_count FROM (
    SELECT slug FROM public.products GROUP BY slug HAVING count(*) > 1
  ) d;
  IF v_dup_count > 0 THEN
    RAISE EXCEPTION 'Verification failed: % duplicate slug groups found', v_dup_count;
  END IF;

  -- 4. Confirm unique index uq_products_slug exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'products' AND indexname = 'uq_products_slug'
  ) THEN
    RAISE EXCEPTION 'Verification failed: index uq_products_slug does not exist';
  END IF;

  -- 5. Confirm trigger trigger_set_product_slug exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE event_object_table = 'products' AND trigger_name = 'trigger_set_product_slug'
  ) THEN
    RAISE EXCEPTION 'Verification failed: trigger trigger_set_product_slug does not exist';
  END IF;

  RAISE NOTICE 'Phase 4 product slug verification passed successfully';
END $$;
