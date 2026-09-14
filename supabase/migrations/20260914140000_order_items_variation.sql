-- ============================================================================
-- Storefront Phase 3 (P0 #3): Product variations on storefront + checkout.
--
-- 1. Adds nullable variation_id column to order_items.
-- 2. Grants active-product-gated anon SELECT on product_variations (L7).
-- ============================================================================

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS variation_id uuid REFERENCES public.product_variations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_order_items_variation_id
  ON public.order_items(variation_id);

-- L7: Active-product-gated public SELECT policy, matching the 20260619164824
-- products policy precedent. A bare USING (true) would expose variation rows
-- (including price) of inactive/draft products via direct anon REST.
DROP POLICY IF EXISTS "Public can read product variations" ON public.product_variations;
CREATE POLICY "Public can read product variations"
  ON public.product_variations FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = product_variations.product_id
      AND p.is_active
  ));
