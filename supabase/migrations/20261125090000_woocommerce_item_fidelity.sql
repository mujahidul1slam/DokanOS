-- WooCommerce item/product/currency fidelity (E2E finding W-11 / scenario S-02).
--
-- Why this exists: the import contract kept only name/quantity/unit price/line
-- total per line item, and kept no order currency at all. Real WooCommerce
-- payloads carry a SKU, the external product id, the external variation id and
-- the line tax, and the order carries a currency code. Those facts were dropped
-- on import (see docs/verification/woocommerce-e2e-verification-list-2026-11-24.md,
-- W-11), so the local order could not be reconciled against the store.
--
-- This migration is strictly additive:
--   1. four nullable columns on public.order_items (SKU, external product id,
--      external variation id, line tax);
--   2. one nullable column on public.orders (currency code);
--   3. a CREATE OR REPLACE of public.upsert_woocommerce_order with the SAME
--      23-argument signature, so replays and the v2 wrapper keep working
--      unchanged. Only the two INSERT/UPDATE statements gain the new facts.
--
-- The external ids are bigint on purpose: WooCommerce product/variation ids are
-- numeric, while the local catalogue uses uuid keys. Storing the external id as
-- a number keeps it comparable with Woo without inventing a fake local link.

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS sku text,
  ADD COLUMN IF NOT EXISTS woocommerce_product_id bigint,
  ADD COLUMN IF NOT EXISTS woocommerce_variation_id bigint,
  ADD COLUMN IF NOT EXISTS tax_amount numeric;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS currency text;

COMMENT ON COLUMN public.order_items.sku IS 'External WooCommerce SKU as sent by the store; display/reconciliation fact only.';
COMMENT ON COLUMN public.order_items.woocommerce_product_id IS 'External WooCommerce product id (bigint, not a local uuid reference).';
COMMENT ON COLUMN public.order_items.woocommerce_variation_id IS 'External WooCommerce variation id (bigint); null when the line has no variation.';
COMMENT ON COLUMN public.order_items.tax_amount IS 'Line tax reported by WooCommerce total_tax; null when the store sent no tax fact.';
COMMENT ON COLUMN public.orders.currency IS 'Currency code reported by the source store for this order; null for local orders.';

CREATE OR REPLACE FUNCTION public.upsert_woocommerce_order(
  p_connector_id uuid, p_external_order_id bigint, p_external_order_number text,
  p_external_status text, p_external_modified_at timestamptz, p_total numeric,
  p_subtotal numeric, p_discount numeric, p_shipping numeric, p_payment_method text,
  p_local_status text, p_payment_status text, p_customer_name text,
  p_customer_email text, p_customer_phone text, p_customer_address text,
  p_customer_city text, p_customer_zone text, p_customer_area text, p_notes text,
  p_created_at timestamptz, p_items jsonb, p_safe_external_facts jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c record; identity_row record; order_id uuid; customer_id uuid;
  existing_modified timestamptz; local_consignment text; local_status text;
  desired_order_number text; new_order_number text; item jsonb;
  v_currency text;
  v_sku text; v_woo_product_id bigint; v_woo_variation_id bigint; v_item_tax numeric;
BEGIN
  IF p_external_status NOT IN ('pending','on-hold','processing','completed','cancelled','refunded','failed','trash','deleted') THEN
    RAISE EXCEPTION 'woocommerce_unsupported_status';
  END IF;
  SELECT id, business_id, store_id, order_source_id INTO c
    FROM public.woocommerce_connectors
   WHERE id = p_connector_id AND intake_enabled AND status IN ('healthy','degraded');
  IF c.id IS NULL THEN RAISE EXCEPTION 'WooCommerce connector is not enabled'; END IF;

  -- The only currency fact this contract trusts is the one the connector already
  -- recorded as safe external facts. Absent/blank means "not reported", so the
  -- stored value is left alone instead of being erased.
  v_currency := nullif(btrim(coalesce(p_safe_external_facts,'{}'::jsonb)->>'currency'), '');

  PERFORM pg_advisory_xact_lock(hashtextextended(p_connector_id::text || ':' || p_external_order_id::text, 0));
  SELECT * INTO identity_row FROM public.woocommerce_order_identities
   WHERE connector_id = p_connector_id AND external_order_id = p_external_order_id;

  IF identity_row.id IS NOT NULL THEN
    order_id := identity_row.order_id;
    existing_modified := identity_row.last_external_modified_at;
    IF p_external_modified_at IS NOT NULL AND existing_modified IS NOT NULL AND p_external_modified_at < existing_modified THEN
      INSERT INTO public.woocommerce_sync_conflicts
        (connector_id, external_order_id, order_id, reason, external_state, local_state)
      VALUES (p_connector_id, p_external_order_id, order_id, 'stale_external_state',
        jsonb_build_object('status', p_external_status, 'modified_at', p_external_modified_at),
        jsonb_build_object('last_external_modified_at', existing_modified))
      ON CONFLICT (connector_id, external_order_id, reason) WHERE resolution IS NULL DO UPDATE
        SET external_state = EXCLUDED.external_state;
      RETURN order_id;
    END IF;
    SELECT public.format_order_number(c.store_id, 'woo', format('WC-%s-%s', p_connector_id::text, coalesce(nullif(p_external_order_number, ''), p_external_order_id::text)))
      INTO desired_order_number;
    UPDATE public.orders AS target
       SET order_number = CASE WHEN target.order_number IS DISTINCT FROM desired_order_number
           AND NOT EXISTS (SELECT 1 FROM public.orders other WHERE other.order_number = desired_order_number AND other.id <> order_id)
           THEN desired_order_number ELSE target.order_number END,
           -- An inbound COD echo must never erase a collection recorded locally.
           payment_status = CASE
             WHEN target.payment_status IN ('paid','partial','refunded') AND coalesce(nullif(p_payment_status, ''), '') = 'unpaid'
               THEN target.payment_status
             ELSE coalesce(nullif(p_payment_status, ''), target.payment_status)
           END,
           -- External terminal state cancels only orders that have not entered fulfilment.
           status = CASE
             WHEN p_external_status IN ('cancelled','refunded','failed','trash','deleted')
               AND target.status IN ('pending','payment_pending','new_order','pre_order_pending')
                AND target.consignment_id IS NULL
                AND NOT EXISTS (SELECT 1 FROM public.courier_shipments s
                                  WHERE s.order_id = target.id
                                    AND lower(coalesce(s.canonical_status,'')) NOT IN ('delivered','returned','cancelled')) THEN 'cancelled'
             ELSE target.status
           END,
           customer_name = coalesce(nullif(p_customer_name,''), target.customer_name),
           customer_email = coalesce(nullif(p_customer_email,''), target.customer_email),
           customer_phone = coalesce(nullif(p_customer_phone,''), target.customer_phone),
           customer_address = coalesce(nullif(p_customer_address,''), target.customer_address),
           customer_city = coalesce(nullif(p_customer_city,''), target.customer_city),
           currency = coalesce(v_currency, target.currency),
           woocommerce_external_status = p_external_status,
           woocommerce_external_status_at = coalesce(p_external_modified_at, target.woocommerce_external_status_at),
           woocommerce_external_deleted_at = CASE WHEN p_external_status IN ('trash','deleted') THEN now() ELSE target.woocommerce_external_deleted_at END
     WHERE target.id = order_id;
  ELSE
    SELECT id INTO customer_id FROM public.customers
     WHERE business_id = c.business_id
       AND ((p_customer_email IS NOT NULL AND lower(email) = lower(p_customer_email)) OR (p_customer_phone IS NOT NULL AND phone = p_customer_phone))
     ORDER BY updated_at DESC LIMIT 1;
    IF customer_id IS NULL THEN
      INSERT INTO public.customers (business_id, store_id, source, origin_kind, name, email, phone, address, city, zone, area)
      VALUES (c.business_id, c.store_id, 'woocommerce', 'woo_sync', coalesce(nullif(p_customer_name,''), 'WooCommerce customer'), p_customer_email, p_customer_phone, p_customer_address, p_customer_city, p_customer_zone, p_customer_area)
      RETURNING id INTO customer_id;
    END IF;
    new_order_number := public.format_order_number(c.store_id, 'woo', format('WC-%s-%s', p_connector_id::text, coalesce(nullif(p_external_order_number, ''), p_external_order_id::text)));
    INSERT INTO public.orders
      (business_id, store_id, customer_id, order_source_id, source, order_number, status, payment_status, payment_method, customer_name, customer_email, customer_phone, customer_address, customer_city, subtotal, discount, shipping_cost, total, notes, created_at, woocommerce_external_status, woocommerce_external_status_at, woocommerce_external_deleted_at, currency)
    VALUES
      (c.business_id, c.store_id, customer_id, c.order_source_id, 'woocommerce', new_order_number,
       CASE WHEN p_external_status IN ('cancelled','refunded','failed','trash','deleted') THEN 'cancelled' ELSE coalesce(p_local_status,'pending') END,
       coalesce(p_payment_status,'unpaid'), p_payment_method, p_customer_name, p_customer_email, p_customer_phone, p_customer_address, p_customer_city, coalesce(p_subtotal,0), coalesce(p_discount,0), coalesce(p_shipping,0), coalesce(p_total,0), p_notes, coalesce(p_created_at, now()), p_external_status, p_external_modified_at, CASE WHEN p_external_status IN ('trash','deleted') THEN now() ELSE NULL END, v_currency)
      RETURNING id INTO order_id;
    IF jsonb_typeof(coalesce(p_items,'[]'::jsonb)) = 'array' THEN
      FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
        -- External identity facts are parsed defensively: WooCommerce sends them
        -- as JSON numbers or strings, and a simple product reports variation_id 0.
        -- Anything unparsable stays NULL rather than aborting the whole import.
        v_sku := nullif(btrim(coalesce(item->>'sku','')), '');
        v_woo_product_id := CASE WHEN coalesce(item->>'product_id','') ~ '^[0-9]{1,18}$'
          THEN nullif((item->>'product_id')::bigint, 0) END;
        v_woo_variation_id := CASE WHEN coalesce(item->>'variation_id','') ~ '^[0-9]{1,18}$'
          THEN nullif((item->>'variation_id')::bigint, 0) END;
        v_item_tax := CASE WHEN coalesce(item->>'total_tax','') ~ '^-?[0-9]{1,12}(\.[0-9]{1,6})?$'
          THEN (item->>'total_tax')::numeric END;
        INSERT INTO public.order_items (order_id, product_name, quantity, unit_price, line_total, sku, woocommerce_product_id, woocommerce_variation_id, tax_amount)
        VALUES (order_id, coalesce(item->>'name','WooCommerce item'), greatest(1, coalesce((item->>'quantity')::integer,1)), coalesce((item->>'price')::numeric,0), coalesce((item->>'total')::numeric,0), v_sku, v_woo_product_id, v_woo_variation_id, v_item_tax);
      END LOOP;
    END IF;
    INSERT INTO public.woocommerce_order_identities (connector_id, external_order_id, order_id, external_order_number, last_external_status, last_external_modified_at, last_external_payload)
    VALUES (p_connector_id, p_external_order_id, order_id, p_external_order_number, p_external_status, p_external_modified_at, coalesce(p_safe_external_facts,'{}'::jsonb));
  END IF;

  IF identity_row.id IS NOT NULL THEN
    UPDATE public.woocommerce_order_identities
       SET last_external_status = p_external_status,
           last_external_modified_at = coalesce(p_external_modified_at, last_external_modified_at),
           last_external_payload = coalesce(p_safe_external_facts,'{}'::jsonb), last_seen_at = now()
     WHERE id = identity_row.id;
  END IF;

  SELECT status, consignment_id INTO local_status, local_consignment FROM public.orders WHERE id = order_id;
  IF p_external_status IN ('cancelled','refunded','failed','trash','deleted')
     AND (local_consignment IS NOT NULL OR local_status IN ('shipped','pickup_pending','in_transit','out_for_delivery','delivered','entered','accepted')) THEN
    INSERT INTO public.woocommerce_sync_conflicts (connector_id, external_order_id, order_id, reason, external_state, local_state)
    VALUES (p_connector_id, p_external_order_id, order_id,
      CASE WHEN p_external_status IN ('trash','deleted') THEN 'external_deleted_after_local_work' ELSE 'external_terminal_after_local_work' END,
      jsonb_build_object('status',p_external_status), jsonb_build_object('status',local_status,'consignment_id',local_consignment))
    ON CONFLICT (connector_id, external_order_id, reason) WHERE resolution IS NULL DO NOTHING;
  END IF;
  RETURN order_id;
END $$;

-- Re-assert the privilege surface of the replaced function: the argument list is
-- unchanged, so the existing grant stays valid, but re-stating it keeps this
-- migration self-verifying if the function were ever recreated by a later edit.
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

COMMENT ON FUNCTION public.upsert_woocommerce_order(uuid, bigint, text, text, timestamptz, numeric, numeric, numeric, numeric, text, text, text, text, text, text, text, text, text, text, text, timestamptz, jsonb, jsonb)
  IS 'WooCommerce import contract: preserves local payment/fulfilment facts and records item SKU, external product/variation ids, line tax and order currency.';

-- No backfill: existing imported orders keep NULL external ids and currency
-- rather than inventing values a later reconciliation could not verify.
