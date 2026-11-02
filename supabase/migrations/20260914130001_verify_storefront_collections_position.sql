-- ============================================================================
-- Verification: Storefront Phase 2 collections position & index (§5.5)
-- ============================================================================

DO $$
BEGIN
  -- 1. Confirm position column exists on storefront_collections
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'storefront_collections'
      AND column_name = 'position'
  ) THEN
    RAISE EXCEPTION 'Verification failed: storefront_collections.position does not exist';
  END IF;

  -- 2. Confirm position column exists on storefront_collection_products
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'storefront_collection_products'
      AND column_name = 'position'
  ) THEN
    RAISE EXCEPTION 'Verification failed: storefront_collection_products.position does not exist';
  END IF;

  -- 3. Confirm idx_scp_collection_pos exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'storefront_collection_products'
      AND indexname = 'idx_scp_collection_pos'
  ) THEN
    RAISE EXCEPTION 'Verification failed: index idx_scp_collection_pos does not exist';
  END IF;

  -- 4. Confirm RLS is enabled on both tables
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename = 'storefront_collections'
      AND rowsecurity = true
  ) THEN
    RAISE EXCEPTION 'Verification failed: RLS not enabled on storefront_collections';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename = 'storefront_collection_products'
      AND rowsecurity = true
  ) THEN
    RAISE EXCEPTION 'Verification failed: RLS not enabled on storefront_collection_products';
  END IF;

  RAISE NOTICE 'Phase 2 collections verification passed successfully';
END $$;
