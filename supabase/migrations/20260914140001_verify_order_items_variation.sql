-- ============================================================================
-- Verification: Storefront Phase 3 product variations (§6.6)
-- ============================================================================

DO $$
DECLARE
  pol_qual text;
BEGIN
  -- 1. Verify variation_id column exists on order_items
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'order_items'
      AND column_name = 'variation_id'
  ) THEN
    RAISE EXCEPTION 'Verification failed: order_items.variation_id does not exist';
  END IF;

  -- 2. Verify policy exists and includes the products.is_active EXISTS gate (L7)
  SELECT qual INTO pol_qual
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'product_variations'
    AND policyname = 'Public can read product variations';

  IF pol_qual IS NULL THEN
    RAISE EXCEPTION 'Verification failed: policy "Public can read product variations" does not exist';
  END IF;

  IF NOT (pol_qual LIKE '%products%' AND pol_qual LIKE '%is_active%') THEN
    RAISE EXCEPTION 'Verification failed: policy "Public can read product variations" is not active-product-gated: %', pol_qual;
  END IF;

  RAISE NOTICE 'Phase 3 product variations verification passed successfully';
END $$;

-- 3. Informational query on live vocabulary distribution (M2):
--    Documents vocabulary; does NOT gate availability logic.
SELECT stock_status, count(*) AS count
FROM public.product_variations
GROUP BY 1;
