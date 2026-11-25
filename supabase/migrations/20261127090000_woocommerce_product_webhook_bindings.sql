-- One WooCommerce connector can own several webhook registrations. Order
-- webhooks stay on the connector's expected_webhook_id; product webhooks get a
-- binding row so registering one cannot clobber the order binding.
--
-- Additive and idempotent. No existing row, column or function behaviour is
-- removed: resolve_woocommerce_connector is replaced with a superset of its
-- previous guards and return shape.

-- ---------------------------------------------------------------------------
-- 1. Webhook binding registrations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.woocommerce_webhook_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id uuid NOT NULL REFERENCES public.woocommerce_connectors(id) ON DELETE CASCADE,
  webhook_id bigint NOT NULL,
  topic text NOT NULL CHECK (topic IN (
    'order.created', 'order.updated', 'order.deleted', 'product.created', 'product.updated'
  )),
  -- A binding owns its own signing secret so registering a product webhook
  -- cannot rotate or weaken the working order webhook's secret.
  secret_ref text NOT NULL CHECK (secret_ref ~ '^[A-Z][A-Z0-9_]{2,127}$'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- A Woo webhook id is globally unique per store; cross-store collisions must
-- fail closed rather than silently mis-route.
CREATE UNIQUE INDEX IF NOT EXISTS woocommerce_webhook_bindings_webhook_id_key
  ON public.woocommerce_webhook_bindings (webhook_id);
CREATE INDEX IF NOT EXISTS woocommerce_webhook_bindings_connector_idx
  ON public.woocommerce_webhook_bindings (connector_id);

ALTER TABLE public.woocommerce_webhook_bindings ENABLE ROW LEVEL SECURITY;
-- No anon/authenticated policies: service_role (RLS bypass) only.
REVOKE ALL ON public.woocommerce_webhook_bindings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.woocommerce_webhook_bindings TO service_role;

COMMENT ON TABLE public.woocommerce_webhook_bindings IS
  'Extra WooCommerce webhook registrations owned by one connector: an order webhook plus product webhooks, each with its own signing secret.';

DROP TRIGGER IF EXISTS set_woocommerce_webhook_bindings_updated_at ON public.woocommerce_webhook_bindings;
CREATE TRIGGER set_woocommerce_webhook_bindings_updated_at
  BEFORE UPDATE ON public.woocommerce_webhook_bindings FOR EACH ROW
  EXECUTE FUNCTION public.set_woocommerce_sync_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Connector resolution via a legacy id or an active binding
-- ---------------------------------------------------------------------------
-- Resolve the connector from server-side relations, never request payload tenant ids.
CREATE OR REPLACE FUNCTION public.resolve_woocommerce_connector(p_webhook_id bigint, p_source_url text)
RETURNS TABLE (connector_id uuid, business_id uuid, brand_id uuid, store_id uuid, order_source_id uuid)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT c.id, c.business_id, c.brand_id, c.store_id, c.order_source_id
  FROM public.woocommerce_connectors c
  JOIN public.stores s ON s.id = c.store_id
  JOIN public.brands b ON b.id = c.brand_id AND b.business_id = c.business_id
  JOIN public.order_sources os ON os.id = c.order_source_id AND os.brand_id = c.brand_id
  WHERE c.intake_enabled
    AND c.status IN ('healthy','degraded')
    AND (
      c.expected_webhook_id = p_webhook_id
      OR EXISTS (
        SELECT 1 FROM public.woocommerce_webhook_bindings wb
        WHERE wb.connector_id = c.id AND wb.webhook_id = p_webhook_id AND wb.status = 'active'
      )
    )
    AND lower(trim(trailing '/' from c.external_store_url)) = lower(trim(trailing '/' from p_source_url));
$$;
REVOKE ALL ON FUNCTION public.resolve_woocommerce_connector(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_woocommerce_connector(bigint, text) TO service_role;
