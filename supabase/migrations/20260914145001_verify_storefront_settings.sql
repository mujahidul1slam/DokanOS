-- ============================================================================
-- Verification: Storefront Phase 5 settings object (§8.5)
-- ============================================================================

DO $$
BEGIN
  -- 1. Verify settings column exists on storefronts
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'storefronts'
      AND column_name = 'settings'
  ) THEN
    RAISE EXCEPTION 'Verification failed: storefronts.settings does not exist';
  END IF;

  -- 2. Verify column is jsonb
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'storefronts'
      AND column_name = 'settings'
      AND data_type = 'jsonb'
  ) THEN
    RAISE EXCEPTION 'Verification failed: storefronts.settings is not jsonb';
  END IF;

  RAISE NOTICE 'Phase 5 storefront settings verification passed successfully';
END $$;
