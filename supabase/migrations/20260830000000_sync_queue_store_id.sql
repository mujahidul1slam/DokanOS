-- Phase 3 / Phase 4 prep.
--
-- Goals:
--   * Make sync_queue store-aware and entity-agnostic so the circuit breaker
--     (Phase 4) can skip rows for a tripped store WITHOUT joining public.orders,
--     and so product / stock pushes can enter the queue without a parent order.
--   * Add woo_updated_at to orders + products so the Phase 2 webhook can reject
--     out-of-order / stale payloads.
--   * Add circuit-breaker state columns to public.stores.

-- 1. store_id on sync_queue (backfilled from orders), then NOT NULL + FK.
ALTER TABLE public.sync_queue ADD COLUMN IF NOT EXISTS store_id uuid;

-- Audit table for any sync_queue rows that must be purged because they cannot
-- be attributed to a store (they will fail NOT NULL otherwise).
CREATE TABLE IF NOT EXISTS public.sync_queue_cleanup_log (
  id          uuid NOT NULL,
  order_id    uuid,
  action      text,
  payload     jsonb,
  status      text,
  attempts    integer,
  created_at  timestamptz,
  purged_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

-- Backfill store_id from the parent order. Some legacy rows point at orders
-- with a NULL store_id (manual/POS orders never linked to a WooCommerce store)
-- or at orders that no longer exist; with order_id NOT NULL and the FK,
-- any row whose order is gone would already be cascade-deleted, so in practice
-- this is rows whose parent order has a NULL store_id (or rows whose parent
-- order was created without a store linkage).
UPDATE public.sync_queue sq
SET store_id = o.store_id
FROM public.orders o
WHERE sq.store_id IS NULL
  AND sq.order_id = o.id
  AND o.store_id IS NOT NULL;

-- Rows still NULL have no linkable store (parent store_id is NULL, or the
-- referenced order is gone). These can never be pushed to WooCommerce and the
-- breaker/queue logic treats store_id as mandatory, so purge them before
-- declaring the column NOT NULL. (Log them first so leftovers are visible.)
INSERT INTO public.sync_queue_cleanup_log (
  id, order_id, action, payload, status, attempts, created_at
)
SELECT id, order_id, action, payload, status, attempts, created_at
FROM public.sync_queue
WHERE store_id IS NULL
ON CONFLICT DO NOTHING;

DELETE FROM public.sync_queue WHERE store_id IS NULL;

ALTER TABLE public.sync_queue
  ALTER COLUMN store_id SET NOT NULL,
  ADD CONSTRAINT sync_queue_store_id_fkey
    FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;

-- order_id is no longer mandatory: product / stock pushes may not reference one.
ALTER TABLE public.sync_queue ALTER COLUMN order_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sync_queue_store_id ON public.sync_queue(store_id);

-- 2. Webhook out-of-order guard. WooCommerce sends date_modified_gmt; we persist
--    it and only apply a payload that is strictly newer than what we already hold.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS woo_updated_at timestamptz;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS woo_updated_at timestamptz;

-- 3. Circuit breaker state on stores.
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS sync_failures integer NOT NULL DEFAULT 0;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS circuit_breaker_until timestamptz;
