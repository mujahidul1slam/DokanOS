-- Versioned WooCommerce import contract.
-- This migration is intentionally append-only: the deployed 23-argument RPC is
-- retained for replay compatibility; new workers use this reviewed v2 seam.

CREATE OR REPLACE FUNCTION public.format_woocommerce_order_number(
  p_connector_id uuid,
  p_external_order_number text,
  p_external_order_id bigint,
  p_order_id uuid DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store_id uuid;
  v_prefix text := '';
  v_base text;
BEGIN
  SELECT store_id INTO v_store_id
  FROM public.woocommerce_connectors
  WHERE id = p_connector_id;
  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'woocommerce_connector_not_found';
  END IF;

  IF p_order_id IS NOT NULL THEN
    SELECT string_agg(prefix, '' ORDER BY prefix)
      INTO v_prefix
    FROM (
      SELECT DISTINCT btrim(s.woo_order_prefix) AS prefix
      FROM public.order_brands ob
      JOIN public.brands b ON b.id = ob.brand_id
      JOIN public.stores s ON s.id = b.woo_store_id
      WHERE ob.order_id = p_order_id
        AND btrim(coalesce(s.woo_order_prefix, '')) <> ''
    ) prefixes;
  END IF;

  IF v_prefix IS NULL OR v_prefix = '' THEN
    SELECT coalesce(nullif(btrim(woo_order_prefix), ''), '')
      INTO v_prefix
    FROM public.stores
    WHERE id = v_store_id;
  END IF;

  IF v_prefix = '' THEN
    SELECT coalesce(nullif(btrim(woo_order_prefix), ''), '')
      INTO v_prefix
    FROM public.invoice_settings
    ORDER BY created_at
    LIMIT 1;
  END IF;

  v_base := coalesce(nullif(btrim(p_external_order_number), ''), p_external_order_id::text);
  IF v_base IS NULL OR v_base = '' THEN
    RAISE EXCEPTION 'woocommerce_external_order_number_missing';
  END IF;

  -- Source suffix is owned by this contract, not by free-form settings. This
  -- prevents a configured suffix from producing W-W or exposing a UUID.
  RETURN v_prefix || v_base || '-W';
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_woocommerce_order_v2(
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
  p_safe_external_facts jsonb,
  p_fulfillment_type text,
  p_is_preorder boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id uuid;
  v_desired text;
  v_existing uuid;
  v_existing_modified timestamptz;
  v_is_preorder boolean;
BEGIN
  IF p_fulfillment_type NOT IN ('walkin', 'delivery') THEN
    RAISE EXCEPTION 'woocommerce_invalid_fulfillment_type';
  END IF;

  v_is_preorder := coalesce(p_is_preorder, false);
  -- Serialize the freshness read with the legacy upsert's identity lock.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_connector_id::text || ':' || p_external_order_id::text, 0));
  SELECT last_external_modified_at INTO v_existing_modified
  FROM public.woocommerce_order_identities
  WHERE connector_id = p_connector_id AND external_order_id = p_external_order_id;
  IF p_external_modified_at IS NOT NULL
     AND v_existing_modified IS NOT NULL
     AND p_external_modified_at < v_existing_modified THEN
    v_order_id := public.upsert_woocommerce_order(
      p_connector_id, p_external_order_id, p_external_order_number,
      p_external_status, p_external_modified_at, p_total, p_subtotal,
      p_discount, p_shipping, p_payment_method,
      p_local_status, p_payment_status, p_customer_name, p_customer_email, p_customer_phone,
      p_customer_address, p_customer_city, p_customer_zone, p_customer_area,
      p_notes, p_created_at, p_items, p_safe_external_facts
    );
    RETURN v_order_id;
  END IF;
  v_order_id := public.upsert_woocommerce_order(
    p_connector_id, p_external_order_id, p_external_order_number,
    p_external_status, p_external_modified_at, p_total, p_subtotal,
    p_discount, p_shipping, p_payment_method,
    CASE WHEN v_is_preorder AND p_external_status = 'processing' THEN 'pre_order_pending' ELSE p_local_status END,
    p_payment_status, p_customer_name, p_customer_email, p_customer_phone,
    p_customer_address, p_customer_city, p_customer_zone, p_customer_area,
    p_notes, p_created_at, p_items, p_safe_external_facts
  );

  v_desired := public.format_woocommerce_order_number(
    p_connector_id, p_external_order_number, p_external_order_id, v_order_id
  );
  PERFORM pg_advisory_xact_lock(hashtextextended(v_desired, 0));

  SELECT id INTO v_existing
  FROM public.orders
  WHERE order_number = v_desired AND id <> v_order_id
  FOR UPDATE;
  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'woocommerce_order_number_collision';
  END IF;

  UPDATE public.orders
  SET order_number = v_desired,
      fulfillment_type = CASE
        WHEN status IN ('pending', 'payment_pending', 'new_order', 'pre_order_pending')
          THEN p_fulfillment_type
        ELSE fulfillment_type
      END,
      status = CASE
        WHEN status IN ('pending', 'payment_pending')
          THEN CASE
            WHEN v_is_preorder AND p_external_status = 'processing' THEN 'pre_order_pending'
            ELSE coalesce(nullif(p_local_status, ''), status)
          END
        ELSE status
      END
  WHERE id = v_order_id;

  RETURN v_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.backfill_woocommerce_order_snapshots()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row_data record;
  desired text;
  owner uuid;
  updated_count integer := 0;
BEGIN
  FOR row_data IN
    SELECT i.connector_id, i.external_order_number, i.external_order_id,
           i.order_id, o.order_number
    FROM public.woocommerce_order_identities i
    JOIN public.orders o ON o.id = i.order_id
    WHERE o.source = 'woocommerce'
    ORDER BY i.order_id
    FOR UPDATE OF o
  LOOP
    desired := public.format_woocommerce_order_number(
      row_data.connector_id, row_data.external_order_number,
      row_data.external_order_id, row_data.order_id
    );
    PERFORM pg_advisory_xact_lock(hashtextextended(desired, 0));
    SELECT id INTO owner FROM public.orders
    WHERE order_number = desired AND id <> row_data.order_id
    FOR UPDATE;
    IF owner IS NOT NULL THEN
      RAISE EXCEPTION 'woocommerce_order_number_collision';
    END IF;
    UPDATE public.orders AS target
    SET order_number = desired,
        customer_name = coalesce(nullif(target.customer_name, ''), nullif(customer.name, '')),
        customer_email = coalesce(nullif(target.customer_email, ''), nullif(customer.email, '')),
        customer_phone = coalesce(nullif(target.customer_phone, ''), nullif(customer.phone, '')),
        customer_address = coalesce(nullif(target.customer_address, ''), nullif(customer.address, '')),
        customer_city = coalesce(nullif(target.customer_city, ''), nullif(customer.city, ''))
    FROM public.customers customer
    WHERE target.id = row_data.order_id
      AND customer.id = target.customer_id;
    updated_count := updated_count + CASE WHEN FOUND THEN 1 ELSE 0 END;
  END LOOP;
  RETURN updated_count;
END;
$$;

REVOKE ALL ON FUNCTION public.backfill_woocommerce_order_snapshots() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_woocommerce_order_snapshots() TO service_role;
REVOKE ALL ON FUNCTION public.format_woocommerce_order_number(uuid, text, bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.format_woocommerce_order_number(uuid, text, bigint, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.upsert_woocommerce_order_v2(uuid, bigint, text, text, timestamptz, numeric, numeric, numeric, numeric, text, text, text, text, text, text, text, text, text, text, text, timestamptz, jsonb, jsonb, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_woocommerce_order_v2(uuid, bigint, text, text, timestamptz, numeric, numeric, numeric, numeric, text, text, text, text, text, text, text, text, text, text, text, timestamptz, jsonb, jsonb, text, boolean) TO service_role;

DO $$
BEGIN
  IF to_regprocedure('public.upsert_woocommerce_order_v2(uuid,bigint,text,text,timestamptz,numeric,numeric,numeric,numeric,text,text,text,text,text,text,text,text,text,text,text,timestamptz,jsonb,jsonb,text,boolean)') IS NULL THEN
    RAISE EXCEPTION 'upsert_woocommerce_order_v2 function was not created';
  END IF;
END $$;

COMMENT ON FUNCTION public.upsert_woocommerce_order_v2(uuid, bigint, text, text, timestamptz, numeric, numeric, numeric, numeric, text, text, text, text, text, text, text, text, text, text, text, timestamptz, jsonb, jsonb, text, boolean)
  IS 'Reviewed Woo import contract: explicit fulfillment/pre-order facts and collision-safe human-readable W numbers.';

-- No automatic production backfill is performed by this migration.
-- Existing UUID-bearing identifiers require a separately approved preview/rewrite.
