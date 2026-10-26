-- ============================================================================
-- Overhaul 2.2: storefronts belong to brands.
--
-- brands is the root container (multi-tenant migration). Every storefront
-- may now be explicitly assigned to a brand and inherits its organizational
-- context. Nullable + additive: existing storefronts stay valid (unassigned)
-- until the operator assigns them in the admin.
-- ============================================================================

ALTER TABLE public.storefronts
  ADD COLUMN IF NOT EXISTS brand_id uuid REFERENCES public.brands(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_storefronts_brand ON public.storefronts(brand_id);

COMMENT ON COLUMN public.storefronts.brand_id IS
  'Owning brand (root container). NULL = standalone storefront (legacy rows).';
