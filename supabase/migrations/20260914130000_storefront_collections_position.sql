-- ============================================================================
-- Storefront Phase 2 (P0 #2): Wire up collections.
--
-- N2: position columns EXIST on both tables since 20260516201928 (fact 10),
-- defaulted 0, never managed by any UI (live rows expected all-default). This
-- migration adds NO columns.
--
-- Junction backfill — NON-DESTRUCTIVE: renumber only rows still at the
-- DEFAULT (position = 0), preserving any curated positions (from the §5.4
-- reorder UI or operator SQL). Within a collection, rows still at the
-- default get a deterministic uuid order; rows already curated keep their
-- value untouched. Idempotent in EVERY state — curated or not — because a
-- re-run only ever matches position = 0 rows, and a renumbered row never
-- returns to 0.
-- ============================================================================

WITH ordered AS (
  SELECT collection_id, product_id,
         row_number() OVER (PARTITION BY collection_id ORDER BY product_id) - 1 AS rn
  FROM public.storefront_collection_products
  WHERE position = 0
)
UPDATE public.storefront_collection_products scp
SET position = ordered.rn
FROM ordered
WHERE scp.collection_id = ordered.collection_id
  AND scp.product_id = ordered.product_id
  AND scp.position = 0;

-- Collections rows keep position=0 initially; listCollections (§5.3) orders by
-- (position, title) so the pre-reorder state is stable and deterministic.
CREATE INDEX IF NOT EXISTS idx_scp_collection_pos
  ON public.storefront_collection_products(collection_id, position);
