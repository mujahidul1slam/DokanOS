-- Richer product sync (Issue 5) + echo-guard prerequisites (Issue 4).
--
-- New product columns:
--   regular_price / sale_price / sale_price_from / sale_price_to
--     Woo's `price` field is the EFFECTIVE price (sale price while on sale).
--     The old importer stored it into the single `price` column, and
--     woo-push then wrote regular_price = that value — which destroyed Woo
--     sale structures whenever anyone edited a product mid-sale. We now keep
--     `price` as the effective price (POS depends on it) and store the
--     regular/sale pair separately so pushes are lossless.
--   short_description — Woo has separate short/long description fields;
--     previously only one was kept and pushes wrote the short one into the
--     long field.
--   attributes (jsonb) — parent-level attributes (name, slug, options…)
--   tags (jsonb), weight, dimensions (jsonb)
--
-- product_variations.woo_updated_at:
--   The stock push trigger (20260831000400) uses woo_updated_at as the
--   Woo-origin discriminator. Products and orders already have it; Woo
--   variation imports must stamp it too or every 15-min sync would look like
--   a local stock edit and echo-push back.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS regular_price numeric,
  ADD COLUMN IF NOT EXISTS sale_price numeric,
  ADD COLUMN IF NOT EXISTS sale_price_from timestamptz,
  ADD COLUMN IF NOT EXISTS sale_price_to timestamptz,
  ADD COLUMN IF NOT EXISTS short_description text,
  ADD COLUMN IF NOT EXISTS attributes jsonb,
  ADD COLUMN IF NOT EXISTS tags jsonb,
  ADD COLUMN IF NOT EXISTS weight numeric,
  ADD COLUMN IF NOT EXISTS dimensions jsonb;

ALTER TABLE public.product_variations
  ADD COLUMN IF NOT EXISTS regular_price numeric,
  ADD COLUMN IF NOT EXISTS sale_price numeric,
  ADD COLUMN IF NOT EXISTS woo_updated_at timestamptz;

-- Existing rows: the stored `price` is the best known regular price.
UPDATE public.products
SET regular_price = price
WHERE regular_price IS NULL;

UPDATE public.product_variations
SET regular_price = price
WHERE regular_price IS NULL;