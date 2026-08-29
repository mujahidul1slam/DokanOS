-- Repair: 20260802065800_create_webhook_events is marked applied in
-- supabase_migrations, but the table was never actually created on the
-- remote project (migration-state drift, same class of issue as
-- 20260824000000). woo-webhook depends on this table for delivery
-- idempotency and audit logging — without it every webhook errors silently.
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    uuid REFERENCES public.stores(id),
  delivery_id text UNIQUE,
  topic       text,
  woo_id      bigint,
  entity_type text,
  status_code int,
  error       text,
  payload_size int,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_created ON public.webhook_events(created_at);
CREATE INDEX IF NOT EXISTS idx_webhook_events_delivery ON public.webhook_events(delivery_id);

REVOKE ALL ON TABLE public.webhook_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.webhook_events TO service_role;
