-- Issue 47: durable, order-only WooCommerce connector.
-- Secrets are deployment-managed. This migration stores references/fingerprints only;
-- no consumer key, consumer secret, webhook secret, or scheduler token is persisted.

-- The source table did not previously expose a composite key. Add it before
-- creating the connector FK so the binding is validated by PostgreSQL.
CREATE UNIQUE INDEX IF NOT EXISTS order_sources_id_brand_key
  ON public.order_sources (id, brand_id);

CREATE TABLE IF NOT EXISTS public.woocommerce_connectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  order_source_id uuid NOT NULL REFERENCES public.order_sources(id) ON DELETE RESTRICT,
  external_store_url text NOT NULL,
  external_store_key text NOT NULL,
  status text NOT NULL DEFAULT 'disabled'
    CHECK (status IN ('healthy', 'degraded', 'paused', 'disabled', 'quarantined', 'rolled_back')),
  intake_enabled boolean NOT NULL DEFAULT false,
  outbound_enabled boolean NOT NULL DEFAULT false,
  credentials_ref text NOT NULL,
  webhook_secret_ref text NOT NULL,
  webhook_secret_fingerprint text,
  previous_webhook_secret_ref text,
  previous_secret_expires_at timestamptz,
  expected_webhook_id bigint,
  expected_webhook_topic text NOT NULL DEFAULT 'order.updated',
  expected_delivery_url text,
  webhook_status text NOT NULL DEFAULT 'unknown'
    CHECK (webhook_status IN ('unknown', 'active', 'paused', 'disabled', 'missing', 'invalid')),
  cutover_watermark timestamptz,
  reconciliation_watermark timestamptz,
  last_webhook_received_at timestamptz,
  last_webhook_verified_at timestamptz,
  last_webhook_processed_at timestamptz,
  last_reconciliation_at timestamptz,
  last_error text,
  error_class text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT woocommerce_connectors_store_url_key UNIQUE (external_store_key),
  CONSTRAINT woocommerce_connectors_source_brand_fk
    FOREIGN KEY (order_source_id, brand_id)
    REFERENCES public.order_sources (id, brand_id)
);

CREATE INDEX IF NOT EXISTS woocommerce_connectors_business_idx
  ON public.woocommerce_connectors (business_id);
CREATE INDEX IF NOT EXISTS woocommerce_connectors_health_idx
  ON public.woocommerce_connectors (status, updated_at);

CREATE OR REPLACE FUNCTION public.validate_woocommerce_connector_scope()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE resolved_business uuid; bound_store uuid;
BEGIN
  NEW.external_store_url := lower(trim(trailing '/' from btrim(NEW.external_store_url)));
  NEW.external_store_key := NEW.external_store_url;
  IF NEW.external_store_url !~ '^https://[^/[:space:]]+(/.*)?$' AND NEW.external_store_url !~ '^http://localhost([:/].*)?$' THEN
    RAISE EXCEPTION 'WooCommerce connector store URL must use HTTPS';
  END IF;
  IF NEW.credentials_ref !~ '^[A-Za-z_][A-Za-z0-9_]*$' OR NEW.webhook_secret_ref !~ '^[A-Za-z_][A-Za-z0-9_]*$' THEN
    RAISE EXCEPTION 'WooCommerce connector secrets must be managed secret references';
  END IF;
  SELECT b.business_id, b.woo_store_id INTO resolved_business, bound_store
  FROM public.brands b WHERE b.id = NEW.brand_id AND b.is_active;
  IF resolved_business IS NULL OR resolved_business <> NEW.business_id THEN
    RAISE EXCEPTION 'WooCommerce connector brand/business scope is invalid';
  END IF;
  IF bound_store IS NULL OR bound_store <> NEW.store_id THEN
    RAISE EXCEPTION 'WooCommerce connector store is not the brand-bound online store';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.order_sources os
    WHERE os.id = NEW.order_source_id AND os.brand_id = NEW.brand_id AND os.type = 'woocommerce'
  ) THEN
    RAISE EXCEPTION 'WooCommerce connector requires a WooCommerce order source for the same brand';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS validate_woocommerce_connector_scope ON public.woocommerce_connectors;
CREATE TRIGGER validate_woocommerce_connector_scope
  BEFORE INSERT OR UPDATE OF business_id, brand_id, store_id, order_source_id
  ON public.woocommerce_connectors FOR EACH ROW
  EXECUTE FUNCTION public.validate_woocommerce_connector_scope();

CREATE TABLE IF NOT EXISTS public.woocommerce_order_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id uuid NOT NULL REFERENCES public.woocommerce_connectors(id) ON DELETE CASCADE,
  external_order_id bigint NOT NULL,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  external_order_number text,
  last_external_status text,
  last_external_modified_at timestamptz,
  last_external_payload jsonb,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connector_id, external_order_id),
  UNIQUE (connector_id, order_id)
);
CREATE INDEX IF NOT EXISTS woocommerce_order_identities_order_idx
  ON public.woocommerce_order_identities (order_id);

CREATE TABLE IF NOT EXISTS public.woocommerce_webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id uuid NOT NULL REFERENCES public.woocommerce_connectors(id) ON DELETE CASCADE,
  webhook_id bigint,
  delivery_id text,
  delivery_fingerprint text NOT NULL,
  topic text,
  resource text,
  source_url text,
  payload_version text,
  raw_body bytea NOT NULL,
  parsed_payload jsonb,
  signature_present boolean NOT NULL DEFAULT false,
  signature_valid boolean NOT NULL DEFAULT false,
  source_valid boolean NOT NULL DEFAULT false,
  resource_valid boolean NOT NULL DEFAULT false,
  verification_result text NOT NULL
    CHECK (verification_result IN ('accepted', 'duplicate', 'rejected', 'quarantined')),
  received_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  processed_at timestamptz,
  UNIQUE (connector_id, delivery_fingerprint)
);
CREATE UNIQUE INDEX IF NOT EXISTS woocommerce_delivery_id_key
  ON public.woocommerce_webhook_deliveries (connector_id, delivery_id)
  WHERE delivery_id IS NOT NULL AND btrim(delivery_id) <> '';
CREATE INDEX IF NOT EXISTS woocommerce_deliveries_order_idx
  ON public.woocommerce_webhook_deliveries (connector_id, received_at DESC);

CREATE OR REPLACE FUNCTION public.prevent_woocommerce_delivery_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'WooCommerce webhook evidence is immutable';
  END IF;
  IF NEW.connector_id IS DISTINCT FROM OLD.connector_id
     OR NEW.webhook_id IS DISTINCT FROM OLD.webhook_id
     OR NEW.delivery_id IS DISTINCT FROM OLD.delivery_id
     OR NEW.delivery_fingerprint IS DISTINCT FROM OLD.delivery_fingerprint
     OR NEW.topic IS DISTINCT FROM OLD.topic
     OR NEW.resource IS DISTINCT FROM OLD.resource
     OR NEW.source_url IS DISTINCT FROM OLD.source_url
     OR NEW.payload_version IS DISTINCT FROM OLD.payload_version
     OR NEW.raw_body IS DISTINCT FROM OLD.raw_body
     OR NEW.parsed_payload IS DISTINCT FROM OLD.parsed_payload
     OR NEW.signature_present IS DISTINCT FROM OLD.signature_present
     OR NEW.signature_valid IS DISTINCT FROM OLD.signature_valid
     OR NEW.source_valid IS DISTINCT FROM OLD.source_valid
     OR NEW.resource_valid IS DISTINCT FROM OLD.resource_valid
     OR NEW.verification_result IS DISTINCT FROM OLD.verification_result
     OR NEW.received_at IS DISTINCT FROM OLD.received_at
     OR NEW.verified_at IS DISTINCT FROM OLD.verified_at THEN
    RAISE EXCEPTION 'WooCommerce webhook evidence fields are immutable';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS prevent_woocommerce_delivery_mutation ON public.woocommerce_webhook_deliveries;
CREATE TRIGGER prevent_woocommerce_delivery_mutation
  BEFORE UPDATE OR DELETE ON public.woocommerce_webhook_deliveries FOR EACH ROW
  EXECUTE FUNCTION public.prevent_woocommerce_delivery_mutation();

CREATE OR REPLACE FUNCTION public.mark_woocommerce_delivery_processed(p_delivery_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.woocommerce_webhook_deliveries
  SET processed_at = coalesce(processed_at, now())
  WHERE id = p_delivery_id
  RETURNING true;
$$;
REVOKE ALL ON FUNCTION public.mark_woocommerce_delivery_processed(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_woocommerce_delivery_processed(uuid) TO service_role;

COMMENT ON TABLE public.woocommerce_webhook_deliveries IS 'Immutable authenticated raw webhook evidence; only processed_at may be filled after intake.';

-- Safely identifiable invalid/unbound requests still retain evidence without
-- inventing a tenant or connector binding.
CREATE TABLE IF NOT EXISTS public.woocommerce_webhook_rejections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id uuid REFERENCES public.woocommerce_connectors(id) ON DELETE SET NULL,
  webhook_id bigint,
  delivery_id text,
  source_url text,
  topic text,
  resource text,
  raw_body bytea NOT NULL,
  reason text NOT NULL,
  signature_present boolean NOT NULL DEFAULT false,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS woocommerce_rejection_delivery_key
  ON public.woocommerce_webhook_rejections (connector_id, delivery_id)
  WHERE connector_id IS NOT NULL AND delivery_id IS NOT NULL AND btrim(delivery_id) <> '';
CREATE INDEX IF NOT EXISTS woocommerce_rejections_received_idx
  ON public.woocommerce_webhook_rejections (received_at DESC);

CREATE OR REPLACE FUNCTION public.prevent_woocommerce_rejection_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'WooCommerce webhook rejection evidence is immutable';
END $$;
DROP TRIGGER IF EXISTS prevent_woocommerce_rejection_mutation ON public.woocommerce_webhook_rejections;
CREATE TRIGGER prevent_woocommerce_rejection_mutation
  BEFORE UPDATE OR DELETE ON public.woocommerce_webhook_rejections FOR EACH ROW
  EXECUTE FUNCTION public.prevent_woocommerce_rejection_mutation();

CREATE TABLE IF NOT EXISTS public.woocommerce_sync_work (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id uuid NOT NULL REFERENCES public.woocommerce_connectors(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('inbound', 'reconciliation', 'outbound')),
  kind text NOT NULL CHECK (kind IN ('webhook', 'order_refresh', 'reconciliation', 'status_write')),
  external_order_id bigint,
  identity_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'leased', 'retrying', 'succeeded', 'dead_letter', 'quarantined', 'cancelled', 'replayed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 8 CHECK (max_attempts > 0),
  lease_owner text,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  error_class text,
  last_error text,
  related_delivery_id uuid REFERENCES public.woocommerce_webhook_deliveries(id) ON DELETE SET NULL,
  replay_of uuid REFERENCES public.woocommerce_sync_work(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connector_id, identity_key, state)
);
CREATE INDEX IF NOT EXISTS woocommerce_work_claim_idx
  ON public.woocommerce_sync_work (connector_id, state, next_attempt_at, lease_expires_at);
CREATE INDEX IF NOT EXISTS woocommerce_work_order_idx
  ON public.woocommerce_sync_work (connector_id, external_order_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.woocommerce_sync_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_work_id uuid NOT NULL REFERENCES public.woocommerce_sync_work(id) ON DELETE RESTRICT,
  connector_id uuid NOT NULL REFERENCES public.woocommerce_connectors(id) ON DELETE CASCADE,
  correction_key text NOT NULL,
  reason text NOT NULL,
  corrected_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  correction_work_id uuid REFERENCES public.woocommerce_sync_work(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connector_id, correction_key)
);
CREATE INDEX IF NOT EXISTS woocommerce_corrections_original_idx
  ON public.woocommerce_sync_corrections (original_work_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.woocommerce_outbound_writes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id uuid NOT NULL REFERENCES public.woocommerce_connectors(id) ON DELETE CASCADE,
  external_order_id bigint NOT NULL,
  local_order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  target_status text NOT NULL CHECK (target_status IN ('processing', 'completed', 'cancelled')),
  origin text NOT NULL CHECK (origin IN ('accepted', 'entered', 'delivered', 'pre_dispatch_cancel')),
  related_local_action text,
  expected_external_status text,
  local_order_version timestamptz,
  idempotency_key text NOT NULL,
  request_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_metadata jsonb,
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'succeeded', 'retrying', 'dead_letter', 'quarantined', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connector_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.woocommerce_reconciliation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id uuid NOT NULL REFERENCES public.woocommerce_connectors(id) ON DELETE CASCADE,
  watermark_before timestamptz,
  watermark_after timestamptz,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  overlap interval NOT NULL DEFAULT interval '10 minutes',
  pages integer NOT NULL DEFAULT 0,
  requests integer NOT NULL DEFAULT 0,
  discovered integer NOT NULL DEFAULT 0,
  enqueued integer NOT NULL DEFAULT 0,
  failure_count integer NOT NULL DEFAULT 0,
  state text NOT NULL DEFAULT 'running'
    CHECK (state IN ('running', 'succeeded', 'failed', 'partial', 'cancelled')),
  page_metadata jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_class text,
  last_error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS woocommerce_reconciliation_connector_idx
  ON public.woocommerce_reconciliation_runs (connector_id, started_at DESC);

CREATE TABLE IF NOT EXISTS public.woocommerce_sync_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id uuid NOT NULL REFERENCES public.woocommerce_connectors(id) ON DELETE CASCADE,
  external_order_id bigint,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  reason text NOT NULL,
  external_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  local_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolution text CHECK (resolution IS NULL OR resolution IN ('pending', 'accepted_external', 'kept_local', 'dismissed')),
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS woocommerce_conflicts_open_idx
  ON public.woocommerce_sync_conflicts (connector_id, resolution, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS woocommerce_conflicts_open_order_reason_key
  ON public.woocommerce_sync_conflicts (connector_id, external_order_id, reason)
  WHERE resolution IS NULL;

-- One transaction and one advisory lock reserve the external identity before
-- creating the local customer/order. Concurrent webhook and reconciliation work
-- therefore cannot create duplicate Orders or leave half an import committed.
CREATE OR REPLACE FUNCTION public.upsert_woocommerce_order(
  p_connector_id uuid,
  p_external_order_id bigint,
  p_external_order_number text,
  p_external_status text,
  p_external_modified_at timestamptz,
  p_total numeric,
  p_subtotal numeric,
  p_discount numeric,
  p_shipping numeric,
  p_payment_method text,
  p_local_status text,
  p_payment_status text,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_customer_address text,
  p_customer_city text,
  p_customer_zone text,
  p_customer_area text,
  p_notes text,
  p_created_at timestamptz,
  p_items jsonb,
  p_safe_external_facts jsonb
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c record;
  identity_row record;
  order_id uuid;
  customer_id uuid;
  existing_modified timestamptz;
  local_consignment text;
  local_status text;
  item jsonb;
BEGIN
  IF p_external_status NOT IN ('pending','on-hold','processing','completed','cancelled','refunded','failed','trash','deleted') THEN
    RAISE EXCEPTION 'woocommerce_unsupported_status';
  END IF;
  SELECT id, business_id, store_id, order_source_id INTO c
  FROM public.woocommerce_connectors
  WHERE id = p_connector_id AND intake_enabled AND status IN ('healthy','degraded');
  IF c.id IS NULL THEN RAISE EXCEPTION 'WooCommerce connector is not enabled'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_connector_id::text || ':' || p_external_order_id::text, 0));
  SELECT * INTO identity_row
  FROM public.woocommerce_order_identities
  WHERE connector_id = p_connector_id AND external_order_id = p_external_order_id;

  IF identity_row.id IS NOT NULL THEN
    order_id := identity_row.order_id;
    existing_modified := identity_row.last_external_modified_at;
    IF p_external_modified_at IS NOT NULL AND existing_modified IS NOT NULL AND p_external_modified_at < existing_modified THEN
      INSERT INTO public.woocommerce_sync_conflicts
        (connector_id, external_order_id, order_id, reason, external_state, local_state)
      VALUES
        (p_connector_id, p_external_order_id, order_id, 'stale_external_state',
         jsonb_build_object('status', p_external_status, 'modified_at', p_external_modified_at),
         jsonb_build_object('last_external_modified_at', existing_modified))
      ON CONFLICT (connector_id, external_order_id, reason) WHERE resolution IS NULL DO UPDATE
        SET external_state = EXCLUDED.external_state;
      RETURN order_id;
    END IF;
    UPDATE public.orders
    SET payment_status = coalesce(nullif(p_payment_status, ''), payment_status),
        woocommerce_external_status = p_external_status,
        woocommerce_external_status_at = coalesce(p_external_modified_at, woocommerce_external_status_at),
        woocommerce_external_deleted_at = CASE WHEN p_external_status IN ('trash','deleted') THEN now() ELSE woocommerce_external_deleted_at END
    WHERE id = order_id;
  ELSE
    SELECT id INTO customer_id FROM public.customers
    WHERE business_id = c.business_id
      AND ((p_customer_email IS NOT NULL AND lower(email) = lower(p_customer_email))
        OR (p_customer_phone IS NOT NULL AND phone = p_customer_phone))
    ORDER BY updated_at DESC LIMIT 1;
    IF customer_id IS NULL THEN
      INSERT INTO public.customers (business_id, store_id, source, origin_kind, name, email, phone, address, city, zone, area)
      VALUES (c.business_id, c.store_id, 'woocommerce', 'woo_sync', coalesce(nullif(p_customer_name,''), 'WooCommerce customer'), p_customer_email, p_customer_phone, p_customer_address, p_customer_city, p_customer_zone, p_customer_area)
      RETURNING id INTO customer_id;
    END IF;
    INSERT INTO public.orders
      (business_id, store_id, customer_id, order_source_id, source, order_number, status, payment_status, payment_method, subtotal, discount, shipping_cost, total, notes, created_at, woocommerce_external_status, woocommerce_external_status_at, woocommerce_external_deleted_at)
    VALUES
      (c.business_id, c.store_id, customer_id, c.order_source_id, 'woocommerce', coalesce(p_external_order_number, p_external_order_id::text), coalesce(p_local_status,'pending'), coalesce(p_payment_status,'unpaid'), p_payment_method, coalesce(p_subtotal,0), coalesce(p_discount,0), coalesce(p_shipping,0), coalesce(p_total,0), p_notes, coalesce(p_created_at, now()), p_external_status, p_external_modified_at, CASE WHEN p_external_status IN ('trash','deleted') THEN now() ELSE NULL END)
    RETURNING id INTO order_id;
    IF jsonb_typeof(coalesce(p_items,'[]'::jsonb)) = 'array' THEN
      FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
        INSERT INTO public.order_items (order_id, product_name, quantity, unit_price, line_total)
        VALUES (order_id, coalesce(item->>'name','WooCommerce item'), greatest(1, coalesce((item->>'quantity')::integer,1)), coalesce((item->>'price')::numeric,0), coalesce((item->>'total')::numeric,0));
      END LOOP;
    END IF;
    INSERT INTO public.woocommerce_order_identities
      (connector_id, external_order_id, order_id, external_order_number, last_external_status, last_external_modified_at, last_external_payload)
    VALUES (p_connector_id, p_external_order_id, order_id, p_external_order_number, p_external_status, p_external_modified_at, coalesce(p_safe_external_facts,'{}'::jsonb));
  END IF;

  IF identity_row.id IS NOT NULL THEN
    UPDATE public.woocommerce_order_identities
    SET last_external_status = p_external_status,
        last_external_modified_at = coalesce(p_external_modified_at, last_external_modified_at),
        last_external_payload = coalesce(p_safe_external_facts,'{}'::jsonb),
        last_seen_at = now()
    WHERE id = identity_row.id;
  END IF;

  SELECT status, consignment_id INTO local_status, local_consignment FROM public.orders WHERE id = order_id;
  IF p_external_status IN ('cancelled','refunded','failed','trash','deleted')
     AND (local_consignment IS NOT NULL OR local_status IN ('shipped','pickup_pending','in_transit','out_for_delivery','delivered','entered')) THEN
    INSERT INTO public.woocommerce_sync_conflicts (connector_id, external_order_id, order_id, reason, external_state, local_state)
    VALUES (p_connector_id, p_external_order_id, order_id, CASE WHEN p_external_status IN ('trash','deleted') THEN 'external_deleted_after_local_work' ELSE 'external_terminal_after_local_work' END, jsonb_build_object('status',p_external_status), jsonb_build_object('status',local_status,'consignment_id',local_consignment))
    ON CONFLICT (connector_id, external_order_id, reason) WHERE resolution IS NULL DO NOTHING;
  END IF;
  RETURN order_id;
END $$;
DO $$
DECLARE
  target regprocedure;
BEGIN
  SELECT p.oid::regprocedure INTO target
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'upsert_woocommerce_order'
    AND p.pronargs = 23;
  IF target IS NULL THEN
    RAISE EXCEPTION 'upsert_woocommerce_order function was not created';
  END IF;
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', target);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', target);
END $$;

CREATE OR REPLACE FUNCTION public.record_woocommerce_external_deletion(p_connector_id uuid, p_external_order_id bigint)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE order_id uuid;
BEGIN
  SELECT oi.order_id INTO order_id FROM public.woocommerce_order_identities oi
  WHERE oi.connector_id = p_connector_id AND oi.external_order_id = p_external_order_id;
  IF order_id IS NULL THEN
    INSERT INTO public.woocommerce_sync_conflicts (connector_id, external_order_id, reason, external_state)
    VALUES (p_connector_id, p_external_order_id, 'external_deleted_unmatched', jsonb_build_object('deleted', true));
    RETURN NULL;
  END IF;
  UPDATE public.orders SET woocommerce_external_status = 'deleted', woocommerce_external_status_at = now(), woocommerce_external_deleted_at = coalesce(woocommerce_external_deleted_at, now()) WHERE id = order_id;
  INSERT INTO public.woocommerce_sync_conflicts (connector_id, external_order_id, order_id, reason, external_state)
  SELECT p_connector_id, p_external_order_id, order_id, CASE WHEN o.consignment_id IS NULL THEN 'external_deleted' ELSE 'external_deleted_after_local_work' END, jsonb_build_object('deleted', true)
  FROM public.orders o WHERE o.id = order_id AND o.consignment_id IS NOT NULL
  ON CONFLICT (connector_id, external_order_id, reason) WHERE resolution IS NULL DO NOTHING;
  RETURN order_id;
END $$;
REVOKE ALL ON FUNCTION public.record_woocommerce_external_deletion(uuid,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_woocommerce_external_deletion(uuid,bigint) TO service_role;

-- Keep unsupported/stale authoritative observations visible without allowing them
-- to overwrite the last trusted external facts or local fulfillment state.
CREATE OR REPLACE FUNCTION public.record_woocommerce_sync_observation(
  p_connector_id uuid,
  p_external_order_id bigint,
  p_reason text,
  p_external_state jsonb
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order_id uuid; v_conflict uuid;
BEGIN
  IF p_reason NOT IN ('unsupported_status', 'stale_external_state', 'missing_current_order') THEN
    RAISE EXCEPTION 'unsupported WooCommerce observation reason';
  END IF;
  SELECT oi.order_id INTO v_order_id
  FROM public.woocommerce_order_identities oi
  WHERE oi.connector_id = p_connector_id AND oi.external_order_id = p_external_order_id;
  INSERT INTO public.woocommerce_sync_conflicts
    (connector_id, external_order_id, order_id, reason, external_state, local_state)
  VALUES
    (p_connector_id, p_external_order_id, v_order_id, p_reason,
     coalesce(p_external_state, '{}'::jsonb), '{}'::jsonb)
  ON CONFLICT (connector_id, external_order_id, reason) WHERE resolution IS NULL
  DO UPDATE SET external_state = EXCLUDED.external_state
  RETURNING id INTO v_conflict;
  RETURN v_conflict;
END $$;
REVOKE ALL ON FUNCTION public.record_woocommerce_sync_observation(uuid,bigint,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_woocommerce_sync_observation(uuid,bigint,text,jsonb) TO service_role;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS woocommerce_external_status text,
  ADD COLUMN IF NOT EXISTS woocommerce_external_status_at timestamptz,
  ADD COLUMN IF NOT EXISTS woocommerce_external_deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS orders_woo_external_status_idx
  ON public.orders (woocommerce_external_status);

CREATE OR REPLACE FUNCTION public.set_woocommerce_connector_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS set_woocommerce_connector_updated_at ON public.woocommerce_connectors;
CREATE TRIGGER set_woocommerce_connector_updated_at
  BEFORE UPDATE ON public.woocommerce_connectors FOR EACH ROW
  EXECUTE FUNCTION public.set_woocommerce_connector_updated_at();

CREATE OR REPLACE FUNCTION public.set_woocommerce_sync_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS set_woocommerce_identity_updated_at ON public.woocommerce_order_identities;
CREATE TRIGGER set_woocommerce_identity_updated_at
  BEFORE UPDATE ON public.woocommerce_order_identities FOR EACH ROW
  EXECUTE FUNCTION public.set_woocommerce_sync_updated_at();
DROP TRIGGER IF EXISTS set_woocommerce_work_updated_at ON public.woocommerce_sync_work;
CREATE TRIGGER set_woocommerce_work_updated_at
  BEFORE UPDATE ON public.woocommerce_sync_work FOR EACH ROW
  EXECUTE FUNCTION public.set_woocommerce_sync_updated_at();
DROP TRIGGER IF EXISTS set_woocommerce_outbound_updated_at ON public.woocommerce_outbound_writes;
CREATE TRIGGER set_woocommerce_outbound_updated_at
  BEFORE UPDATE ON public.woocommerce_outbound_writes FOR EACH ROW
  EXECUTE FUNCTION public.set_woocommerce_sync_updated_at();

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
    AND c.expected_webhook_id = p_webhook_id
    AND lower(trim(trailing '/' from c.external_store_url)) = lower(trim(trailing '/' from p_source_url));
$$;
REVOKE ALL ON FUNCTION public.resolve_woocommerce_connector(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_woocommerce_connector(bigint, text) TO service_role;

-- All operator-visible rows are account-scoped. Service-role workers bypass RLS only
-- after resolving the connector through the function above.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['woocommerce_connectors','woocommerce_order_identities','woocommerce_webhook_deliveries','woocommerce_webhook_rejections','woocommerce_sync_work','woocommerce_sync_corrections','woocommerce_outbound_writes','woocommerce_reconciliation_runs','woocommerce_sync_conflicts'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated, service_role', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "Woo connector members can read" ON public.woocommerce_connectors;
CREATE POLICY "Woo connector members can read"
  ON public.woocommerce_connectors FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));
DROP POLICY IF EXISTS "Woo connector operators can write" ON public.woocommerce_connectors;
CREATE POLICY "Woo connector operators can write"
  ON public.woocommerce_connectors FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_business_access a WHERE a.business_id = woocommerce_connectors.business_id AND a.user_id = auth.uid() AND a.role IN ('owner','admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_business_access a WHERE a.business_id = woocommerce_connectors.business_id AND a.user_id = auth.uid() AND a.role IN ('owner','admin')));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['woocommerce_order_identities','woocommerce_webhook_deliveries','woocommerce_webhook_rejections','woocommerce_sync_work','woocommerce_outbound_writes','woocommerce_reconciliation_runs','woocommerce_sync_conflicts'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Woo scoped members read %1$s" ON public.%1$I', t);
    EXECUTE format('CREATE POLICY "Woo scoped members read %1$s" ON public.%1$I FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.woocommerce_connectors c WHERE c.id = %1$I.connector_id AND public.is_business_member(c.business_id)))', t);
  END LOOP;
END $$;

COMMENT ON TABLE public.woocommerce_connectors IS 'Issue 47 connector registry; secret values remain in deployment-managed secret storage.';
COMMENT ON TABLE public.woocommerce_webhook_deliveries IS 'Immutable authenticated raw webhook evidence; processing is asynchronous.';
COMMENT ON TABLE public.woocommerce_sync_work IS 'Durable inbound, reconciliation, and outbound work with leases and bounded retries.';

-- Reconciliation uses a stable identity containing the Woo modified timestamp.
-- The boolean return makes the run evidence truthful: duplicates are not counted
-- as newly enqueued work, while a changed current-state version is repairable.
CREATE OR REPLACE FUNCTION public.enqueue_woocommerce_reconciliation_work(
  p_connector_id uuid,
  p_external_order_id bigint,
  p_identity_key text,
  p_payload jsonb
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inserted_id uuid;
BEGIN
  INSERT INTO public.woocommerce_sync_work
    (connector_id, direction, kind, external_order_id, identity_key, payload, state)
  VALUES
    (p_connector_id, 'reconciliation', 'order_refresh', p_external_order_id, p_identity_key, coalesce(p_payload, '{}'::jsonb), 'pending')
  ON CONFLICT (connector_id, identity_key, state) DO NOTHING
  RETURNING id INTO inserted_id;
  RETURN inserted_id IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION public.enqueue_woocommerce_reconciliation_work(uuid, bigint, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_woocommerce_reconciliation_work(uuid, bigint, text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_woocommerce_sync_work(p_owner text, p_limit integer DEFAULT 20)
RETURNS SETOF public.woocommerce_sync_work
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT w.id
    FROM public.woocommerce_sync_work w
    JOIN public.woocommerce_connectors c ON c.id = w.connector_id
    WHERE (
      (w.direction = 'outbound' AND c.outbound_enabled)
      OR (w.direction IN ('inbound', 'reconciliation') AND c.intake_enabled)
    )
      AND c.status IN ('healthy', 'degraded')
      AND (
        w.state IN ('pending', 'retrying')
        OR (w.state = 'leased' AND w.lease_expires_at < now())
      )
      AND w.next_attempt_at <= now()
      AND (w.lease_expires_at IS NULL OR w.lease_expires_at < now())
    ORDER BY w.next_attempt_at, w.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT greatest(1, least(coalesce(p_limit, 20), 100))
  )
  UPDATE public.woocommerce_sync_work w
  SET state = 'leased', lease_owner = p_owner,
      lease_expires_at = now() + interval '2 minutes', heartbeat_at = now(),
      attempt_count = w.attempt_count + 1, updated_at = now()
  FROM candidates c
  WHERE w.id = c.id
  RETURNING w.*;
END $$;
REVOKE ALL ON FUNCTION public.claim_woocommerce_sync_work(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_woocommerce_sync_work(text, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.heartbeat_woocommerce_sync_work(p_work_id uuid, p_owner text, p_lease_seconds integer DEFAULT 120)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE updated_count integer;
BEGIN
  UPDATE public.woocommerce_sync_work
  SET lease_expires_at = now() + make_interval(secs => least(600, greatest(30, coalesce(p_lease_seconds, 120)))),
      heartbeat_at = now(), updated_at = now()
  WHERE id = p_work_id AND state = 'leased' AND lease_owner = p_owner
    AND lease_expires_at > now();
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count = 1;
END $$;
REVOKE ALL ON FUNCTION public.heartbeat_woocommerce_sync_work(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_woocommerce_sync_work(uuid, text, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.finish_woocommerce_sync_work(p_work_id uuid, p_owner text, p_state text, p_error_class text DEFAULT NULL, p_error text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE updated_count integer; final_state text;
BEGIN
  IF p_state NOT IN ('succeeded', 'retrying', 'quarantined', 'dead_letter', 'cancelled') THEN
    RAISE EXCEPTION 'invalid WooCommerce work completion state';
  END IF;
  UPDATE public.woocommerce_sync_work
  SET state = CASE
        WHEN p_state = 'retrying' AND attempt_count >= max_attempts THEN 'dead_letter'
        ELSE p_state
      END,
      lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
      error_class = p_error_class, last_error = p_error,
      next_attempt_at = CASE WHEN p_state = 'retrying' AND attempt_count < max_attempts
        THEN now() + make_interval(secs => (least(900::numeric, greatest(1::numeric, power(2::numeric, least(attempt_count, 8)) * (0.75 + random() * 0.5))))::double precision)
        ELSE next_attempt_at END,
      updated_at = now()
  WHERE id = p_work_id AND state = 'leased' AND lease_owner = p_owner;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count = 1;
END $$;
REVOKE ALL ON FUNCTION public.finish_woocommerce_sync_work(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_woocommerce_sync_work(uuid, text, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.heartbeat_woocommerce_sync_work(p_work_id uuid, p_owner text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.woocommerce_sync_work
  SET heartbeat_at = now(), lease_expires_at = now() + interval '2 minutes', updated_at = now()
  WHERE id = p_work_id AND state = 'leased' AND lease_owner = p_owner
  RETURNING true;
$$;
REVOKE ALL ON FUNCTION public.heartbeat_woocommerce_sync_work(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_woocommerce_sync_work(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.replay_woocommerce_sync_work(p_work_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE source_row public.woocommerce_sync_work; replay_id uuid;
BEGIN
  SELECT * INTO source_row FROM public.woocommerce_sync_work WHERE id = p_work_id;
  IF source_row.id IS NULL OR source_row.state NOT IN ('dead_letter', 'quarantined') THEN
    RAISE EXCEPTION 'work is not replayable';
  END IF;
  INSERT INTO public.woocommerce_sync_work
    (connector_id, direction, kind, external_order_id, identity_key, payload, state, max_attempts, replay_of)
  VALUES
    (source_row.connector_id, source_row.direction, source_row.kind, source_row.external_order_id,
     source_row.identity_key || ':replay:' || gen_random_uuid()::text, source_row.payload,
     'pending', source_row.max_attempts, source_row.id)
  RETURNING id INTO replay_id;
  UPDATE public.woocommerce_sync_work SET state = 'replayed', updated_at = now() WHERE id = source_row.id;
  RETURN replay_id;
END $$;
REVOKE ALL ON FUNCTION public.replay_woocommerce_sync_work(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replay_woocommerce_sync_work(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.create_woocommerce_work_correction(
  p_original_work_id uuid,
  p_reason text,
  p_payload jsonb,
  p_correction_id uuid DEFAULT gen_random_uuid()
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE original public.woocommerce_sync_work; correction_id uuid; correction_work_id uuid;
BEGIN
  SELECT * INTO original FROM public.woocommerce_sync_work WHERE id = p_original_work_id;
  IF original.id IS NULL OR original.state NOT IN ('dead_letter', 'quarantined', 'succeeded') THEN
    RAISE EXCEPTION 'work is not eligible for correction';
  END IF;
  INSERT INTO public.woocommerce_sync_corrections
    (original_work_id, connector_id, correction_key, reason, corrected_payload, created_by)
  VALUES (original.id, original.connector_id, p_correction_id::text, btrim(p_reason), coalesce(p_payload, '{}'::jsonb), auth.uid())
  ON CONFLICT (connector_id, correction_key) DO UPDATE SET reason = excluded.reason
  RETURNING id INTO correction_id;
  INSERT INTO public.woocommerce_sync_work
    (connector_id, direction, kind, external_order_id, identity_key, payload, state, max_attempts, replay_of)
  VALUES (original.connector_id, original.direction, original.kind, original.external_order_id,
          'correction:' || original.id::text || ':' || p_correction_id::text,
          coalesce(p_payload, original.payload), 'pending', original.max_attempts, original.id)
  ON CONFLICT (connector_id, identity_key, state) DO NOTHING
  RETURNING id INTO correction_work_id;
  UPDATE public.woocommerce_sync_corrections c
  SET correction_work_id = coalesce(correction_work_id, w.id)
  FROM public.woocommerce_sync_work w
  WHERE c.id = correction_id AND w.connector_id = original.connector_id
    AND w.identity_key = 'correction:' || original.id::text || ':' || p_correction_id::text;
  RETURN correction_work_id;
END $$;
REVOKE ALL ON FUNCTION public.create_woocommerce_work_correction(uuid, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_woocommerce_work_correction(uuid, text, jsonb, uuid) TO service_role;

COMMENT ON FUNCTION public.claim_woocommerce_sync_work(text, integer) IS 'Atomically leases pending or retrying work; expired leases are reclaimable.';
COMMENT ON FUNCTION public.replay_woocommerce_sync_work(uuid) IS 'Creates an auditable new attempt without deleting the failed evidence.';

CREATE OR REPLACE FUNCTION public.enqueue_woocommerce_status_write(
  p_connector_id uuid,
  p_external_order_id bigint,
  p_target_status text,
  p_origin text,
  p_expected_external_status text,
  p_local_order_version timestamptz,
  p_local_order_id uuid DEFAULT NULL,
  p_related_local_action text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE write_id uuid; work_id uuid; key text;
BEGIN
  IF p_target_status NOT IN ('processing', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'WooCommerce outbound status is not allowed';
  END IF;
  IF p_origin NOT IN ('accepted', 'entered', 'delivered', 'pre_dispatch_cancel') THEN
    RAISE EXCEPTION 'WooCommerce outbound origin is not allowed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.woocommerce_connectors WHERE id = p_connector_id AND outbound_enabled AND status NOT IN ('paused','disabled','rolled_back','quarantined')) THEN
    RAISE EXCEPTION 'WooCommerce connector is not enabled for outbound writes';
  END IF;
  key := p_external_order_id::text || ':' || p_target_status || ':' || coalesce(p_local_order_version::text, 'unknown');
  INSERT INTO public.woocommerce_outbound_writes
    (connector_id, external_order_id, local_order_id, target_status, origin, related_local_action, expected_external_status, local_order_version, idempotency_key)
  VALUES (p_connector_id, p_external_order_id, p_local_order_id, p_target_status, p_origin, p_related_local_action, p_expected_external_status, p_local_order_version, key)
  ON CONFLICT (connector_id, idempotency_key) DO UPDATE SET updated_at = now()
  RETURNING id INTO write_id;
  INSERT INTO public.woocommerce_sync_work
    (connector_id, direction, kind, external_order_id, identity_key, payload)
  VALUES (p_connector_id, 'outbound', 'status_write', p_external_order_id,
          'outbound:' || key, jsonb_build_object('target_status', p_target_status, 'outbound_write_id', write_id))
  ON CONFLICT (connector_id, identity_key, state) DO NOTHING
  RETURNING id INTO work_id;
  RETURN coalesce(work_id, write_id);
END $$;
REVOKE ALL ON FUNCTION public.enqueue_woocommerce_status_write(uuid, bigint, text, text, text, timestamptz, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_woocommerce_status_write(uuid, bigint, text, text, text, timestamptz, uuid, text) TO service_role;
COMMENT ON FUNCTION public.enqueue_woocommerce_status_write(uuid, bigint, text, text, text, timestamptz, uuid, text) IS 'Enqueues only conservative processing/completed/pre-dispatch-cancelled writes with connector-scoped idempotency.';

DO $$
BEGIN
  IF to_regclass('public.order_sources') IS NULL THEN
    RAISE EXCEPTION 'Issue 47 requires the canonical order_sources table';
  END IF;
END $$;

-- Managed scheduler hooks. The secret is read from Vault at invocation time;
-- no scheduler credential is embedded in this migration.
DO $$
BEGIN
  BEGIN PERFORM cron.unschedule('woocommerce-sync-worker-5min'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM cron.unschedule('woocommerce-reconciliation-15min'); EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

SELECT cron.schedule(
  'woocommerce-sync-worker-5min',
  '*/5 * * * *',
  $$SELECT net.http_post(
      url := 'https://jiwndicvfkiltgageqwv.supabase.co/functions/v1/woocommerce-worker',
      headers := jsonb_build_object('Content-Type','application/json','x-woocommerce-scheduler-secret',coalesce((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'sync_worker_cron_token' LIMIT 1),'')),
      body := '{}'::jsonb,
      timeout_milliseconds := 300000
    )$$
);

SELECT cron.schedule(
  'woocommerce-reconciliation-15min',
  '*/15 * * * *',
  $$SELECT net.http_post(
      url := 'https://jiwndicvfkiltgageqwv.supabase.co/functions/v1/woocommerce-reconcile',
      headers := jsonb_build_object('Content-Type','application/json','x-woocommerce-scheduler-secret',coalesce((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'sync_worker_cron_token' LIMIT 1),'')),
      body := '{}'::jsonb,
      timeout_milliseconds := 300000
    )$$
);

COMMIT;
