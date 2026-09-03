-- Revamp Phase 2: courier-agnostic core schema.
--
-- 2.1 Three new tables:
--   courier_providers    — registry of supported couriers (pathao today;
--                          steadfast/redx/ecourier when their adapters land).
--   courier_integrations — per-merchant credentials, provider-agnostic
--                          (pathao_integrations stays as the Pathao
--                          adapter's creds store; new couriers use this).
--   courier_shipments   — the ONE tracking row per (order, consignment),
--                          provider-agnostic. orders.consignment_id is
--                          backfilled into it; new dispatches write BOTH
--                          (orders.consignment_id remains the hot path the
--                          existing UI reads).

CREATE TABLE IF NOT EXISTS public.courier_providers (
  code        text PRIMARY KEY,            -- 'pathao' | 'steadfast' | 'redx' | 'ecourier'
  name        text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  -- 2.4: polling-first cadence config (per-provider)
  track_interval_minutes integer NOT NULL DEFAULT 15,
  max_requests_per_minute integer NOT NULL DEFAULT 60,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Seed the known providers; polling cadence stays configurable per row.
INSERT INTO public.courier_providers (code, name, track_interval_minutes, max_requests_per_minute) VALUES
  ('pathao', 'Pathao', 15, 60)
ON CONFLICT (code) DO NOTHING;

-- Per-merchant credentials, provider-agnostic. Pathao keeps using
-- pathao_integrations (existing adapter + UI); courier #2+ use this table.
CREATE TABLE IF NOT EXISTS public.courier_integrations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider    text NOT NULL REFERENCES public.courier_providers(code) ON DELETE CASCADE,
  store_id    uuid REFERENCES public.stores(id) ON DELETE CASCADE,   -- owning merchant store (woo store); nullable = platform-wide
  credentials jsonb NOT NULL,             -- provider-specific secret blob (adapter knows the shape)
  is_active   boolean NOT NULL DEFAULT true,
  allowed_courier_store_ids jsonb,        -- optional allowlist of the merchant's store_ids AT the courier
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_courier_integrations_provider
  ON public.courier_integrations (provider) WHERE is_active;

-- The canonical shipment record (2.1). One row per (order, consignment).
CREATE TABLE IF NOT EXISTS public.courier_shipments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  provider         text NOT NULL REFERENCES public.courier_providers(code),
  integration_id   uuid,                  -- which merchant creds dispatched this (nullable: env creds)
  consignment_id   text NOT NULL,
  raw_status       text,                  -- exactly what the courier reported
  canonical_status text,                  -- mapped: pending|picked_up|in_transit|out_for_delivery|delivered|returned|cancelled|on_hold|lost
  last_tracked_at  timestamptz,
  dispatched_at    timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, consignment_id)
);
CREATE INDEX IF NOT EXISTS idx_courier_shipments_order ON public.courier_shipments (order_id);
CREATE INDEX IF NOT EXISTS idx_courier_shipments_track_window
  ON public.courier_shipments (provider, last_tracked_at)
  WHERE canonical_status NOT IN ('delivered', 'returned', 'cancelled');

-- Backfill orders.consignment_id -> courier_shipments (existing Pathao
-- parcels). pathao_integration_id maps to integration_id; orders with a
-- consignment but no integration row fall in with integration_id NULL.
INSERT INTO public.courier_shipments (order_id, provider, integration_id, consignment_id, raw_status, canonical_status, last_tracked_at, dispatched_at, created_at)
SELECT o.id, 'pathao', o.pathao_integration_id, o.consignment_id,
       o.tracking_status,
       CASE o.status
         WHEN 'shipped' THEN 'in_transit'
         WHEN 'delivered' THEN 'delivered'
         WHEN 'returned' THEN 'returned'
         WHEN 'cancelled' THEN 'cancelled'
         WHEN 'processing' THEN 'on_hold'
         ELSE 'pending'
       END,
       o.last_tracked_at,
       COALESCE(o.updated_at, o.created_at, now()),
       COALESCE(o.created_at, now())
FROM public.orders o
WHERE o.consignment_id IS NOT NULL
ON CONFLICT (provider, consignment_id) DO NOTHING;

-- Protection: credentials blobs + shipment records are service-role only
-- (edge functions); the frontend reads shipment status via orders joins.
REVOKE ALL ON TABLE public.courier_providers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.courier_providers TO authenticated;
REVOKE ALL ON TABLE public.courier_integrations FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.courier_integrations TO service_role;
REVOKE ALL ON TABLE public.courier_shipments FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.courier_shipments TO service_role;
GRANT SELECT ON TABLE public.courier_shipments TO authenticated;

CREATE TRIGGER set_courier_integrations_updated_at
  BEFORE UPDATE ON public.courier_integrations
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();
CREATE TRIGGER set_courier_shipments_updated_at
  BEFORE UPDATE ON public.courier_shipments
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();

-- 2.3: sync_queue gains courier actions. The worker routes these to
-- pathao-courier (for now) instead of woo-push.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sync_queue_action_check'
  ) THEN
    ALTER TABLE public.sync_queue
      ADD CONSTRAINT sync_queue_action_check
      CHECK (action IN ('push_order', 'push_stock', 'courier_dispatch', 'courier_track_batch'));
  END IF;
END $$;
