-- ============================================================================
-- Storefront Phase 5 (P0 #5): Storefront settings object.
--
-- Pure-expand: adds settings jsonb column to storefronts, defaulted to '{}'.
-- No anon policy on invoice_settings is added (solved via the public
-- storefront-shipping-quote edge function in §8.2 instead).
-- ============================================================================

ALTER TABLE public.storefronts
  ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb;
