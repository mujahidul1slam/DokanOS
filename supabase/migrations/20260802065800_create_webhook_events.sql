CREATE TABLE IF NOT EXISTS public.webhook_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    uuid REFERENCES public.stores(id),
  delivery_id text,
  topic       text NOT NULL,
  woo_id      bigint,
  entity_type text, -- 'order' or 'product'
  status_code int NOT NULL DEFAULT 200,
  error       text,
  payload_size int,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Auto-purge old logs (keep 30 days) by querying via index
CREATE INDEX IF NOT EXISTS idx_webhook_events_created ON public.webhook_events(created_at);
CREATE INDEX IF NOT EXISTS idx_webhook_events_delivery ON public.webhook_events(delivery_id);

-- Give service role full access
REVOKE ALL ON TABLE public.webhook_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.webhook_events TO service_role;
