-- Order source default (Add Order form)
--
-- The Add Order form needs a default order source per brand. The operator
-- picks it on the Integrations page (order sources section); the form falls
-- back to the brand's Facebook/Instagram source when nothing is marked.
--
-- One default per brand: partial unique index on (brand_id) WHERE is_default.

ALTER TABLE public.order_sources
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS order_sources_one_default_per_brand
  ON public.order_sources (brand_id)
  WHERE is_default;

-- Backfill: mark each brand's Facebook/Instagram source as the default
-- (Facebook first, then Instagram, then oldest). Brands without a social
-- source stay unmarked — the form falls back to its first source.
WITH ranked AS (
  SELECT
    s.id,
    row_number() OVER (
      PARTITION BY s.brand_id
      ORDER BY
        (s.type = 'facebook') DESC,
        (s.type = 'instagram') DESC,
        s.created_at,
        s.name
    ) AS rn
  FROM public.order_sources s
  WHERE s.type IN ('facebook', 'instagram')
)
UPDATE public.order_sources s
SET is_default = true
FROM ranked r
WHERE r.id = s.id
  AND r.rn = 1;
