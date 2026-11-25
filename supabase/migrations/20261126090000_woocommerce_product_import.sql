-- S-10: WooCommerce product.created / product.updated import.
--
-- Additive and idempotent. Adds:
--   1. `product_import` to the durable work kind vocabulary;
--   2. `woocommerce_product_map` for stable external -> local identity;
--   3. `accept_woocommerce_product_delivery()` mirroring the order intake but
--      queueing an inbound `product_import` work item;
--   4. `upsert_woocommerce_product()` mapping a Woo product payload into local
--      products, categories, variations and the map, scoped to the connector's
--      store with woo_sync provenance.
--
-- All new functions are SECURITY DEFINER and executable only by service_role.

-- ---------------------------------------------------------------------------
-- 1. Work kind vocabulary
-- ---------------------------------------------------------------------------
ALTER TABLE public.woocommerce_sync_work
  DROP CONSTRAINT IF EXISTS woocommerce_sync_work_kind_check;
ALTER TABLE public.woocommerce_sync_work
  ADD CONSTRAINT woocommerce_sync_work_kind_check
  CHECK (kind IN ('webhook', 'order_refresh', 'reconciliation', 'status_write', 'product_import'));

-- ---------------------------------------------------------------------------
-- 2. Stable external product identity map
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.woocommerce_product_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id uuid NOT NULL REFERENCES public.woocommerce_connectors(id) ON DELETE CASCADE,
  external_product_id bigint NOT NULL,
  external_variation_id bigint,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variation_id uuid REFERENCES public.product_variations(id) ON DELETE CASCADE,
  last_modified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- coalesce makes the parent (variation id NULL) and variation 0 share one key,
-- so a parent row can never collide with a variation whose id is 0.
CREATE UNIQUE INDEX IF NOT EXISTS woocommerce_product_map_identity_key
  ON public.woocommerce_product_map
  (connector_id, external_product_id, coalesce(external_variation_id, 0));
CREATE INDEX IF NOT EXISTS woocommerce_product_map_product_idx
  ON public.woocommerce_product_map (product_id);

ALTER TABLE public.woocommerce_product_map ENABLE ROW LEVEL SECURITY;
-- No anon/authenticated policies: service_role (RLS bypass) only.
REVOKE ALL ON public.woocommerce_product_map FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.woocommerce_product_map TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Product delivery intake (mirrors accept_woocommerce_webhook_delivery)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_woocommerce_product_delivery(
  p_connector_id uuid, p_webhook_id bigint, p_delivery_id text, p_delivery_fingerprint text,
  p_topic text, p_resource text, p_source_url text, p_payload_version text,
  p_raw_body bytea, p_parsed_payload jsonb, p_external_order_id bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_delivery_id uuid; v_work_id uuid;
  v_existing public.woocommerce_webhook_deliveries%ROWTYPE;
  v_existing_work public.woocommerce_sync_work%ROWTYPE;
  v_key text := nullif(btrim(p_delivery_id), '');
  v_fingerprint text := nullif(btrim(p_delivery_fingerprint), '');
BEGIN
  IF p_connector_id IS NULL OR p_external_order_id IS NULL OR p_external_order_id <= 0
     OR nullif(btrim(v_fingerprint), '') IS NULL OR p_raw_body IS NULL THEN
    RAISE EXCEPTION 'accepted intake requires connector, positive external product ID, nonblank fingerprint and body'
      USING ERRCODE = '22023';
  END IF;
  -- Serialize by external product and by delivery identity. A delivery id or
  -- fingerprint may only ever authorize one product observation.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'woo-product:' || p_connector_id::text || ':' || p_external_order_id::text, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_connector_id::text || ':' || CASE WHEN v_key IS NULL THEN 'fingerprint:' || v_fingerprint ELSE 'id:' || v_key END, 0));

  IF v_key IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.woocommerce_webhook_deliveries
      WHERE connector_id = p_connector_id AND btrim(delivery_id) = v_key
        AND verification_result = 'accepted' ORDER BY received_at, id LIMIT 1 FOR UPDATE;
  ELSE
    SELECT * INTO v_existing FROM public.woocommerce_webhook_deliveries
      WHERE connector_id = p_connector_id AND btrim(delivery_fingerprint) = v_fingerprint
        AND (delivery_id IS NULL OR btrim(delivery_id) = '')
        AND verification_result = 'accepted' ORDER BY received_at, id LIMIT 1 FOR UPDATE;
  END IF;

  IF v_existing.id IS NOT NULL THEN
    IF btrim(v_existing.delivery_fingerprint) IS DISTINCT FROM v_fingerprint
       OR v_existing.parsed_payload IS NULL
       OR NOT (v_existing.parsed_payload ? 'id')
       OR NOT ((v_existing.parsed_payload->>'id') ~ '^[0-9]+$')
       OR (v_existing.parsed_payload->>'id')::bigint <= 0
       OR (v_existing.parsed_payload->>'id')::bigint <> p_external_order_id
       OR (p_parsed_payload IS NOT NULL AND p_parsed_payload ? 'id'
           AND (p_parsed_payload->>'id') ~ '^[0-9]+$'
           AND (p_parsed_payload->>'id')::bigint <> p_external_order_id) THEN
      RETURN jsonb_build_object('status', 'conflict', 'delivery_id', v_existing.id, 'work_id', NULL);
    END IF;
    SELECT * INTO v_existing_work FROM public.woocommerce_sync_work
      WHERE related_delivery_id = v_existing.id ORDER BY created_at, id LIMIT 1;
    IF v_existing_work.id IS NOT NULL THEN
      IF v_existing_work.connector_id <> p_connector_id OR v_existing_work.direction <> 'inbound'
         OR v_existing_work.kind <> 'product_import' OR v_existing_work.external_order_id <> p_external_order_id THEN
        RETURN jsonb_build_object('status', 'conflict', 'delivery_id', v_existing.id, 'work_id', NULL);
      END IF;
      RETURN jsonb_build_object('status', 'duplicate', 'delivery_id', v_existing.id, 'work_id', v_existing_work.id);
    END IF;
    -- Orphan evidence repair: accepted delivery whose work row was lost.
    SELECT * INTO v_existing_work FROM public.woocommerce_sync_work
      WHERE connector_id = p_connector_id AND direction = 'inbound' AND kind = 'product_import'
        AND external_order_id = p_external_order_id
        AND state IN ('pending', 'leased', 'retrying', 'succeeded')
      ORDER BY CASE WHEN state = 'pending' THEN 0 ELSE 1 END, created_at, id LIMIT 1 FOR UPDATE;
    IF v_existing_work.id IS NOT NULL THEN
      UPDATE public.woocommerce_webhook_deliveries SET processed_at = coalesce(processed_at, now()) WHERE id = v_existing.id;
      RETURN jsonb_build_object('status', 'duplicate', 'delivery_id', v_existing.id, 'work_id', v_existing_work.id, 'repaired', true);
    END IF;
    INSERT INTO public.woocommerce_sync_work
      (connector_id, direction, kind, external_order_id, identity_key, payload, state, related_delivery_id)
    VALUES (p_connector_id, 'inbound', 'product_import', p_external_order_id,
      'product:' || v_existing.id::text,
      jsonb_build_object('topic', v_existing.topic, 'resource', v_existing.resource,
        'payload_version', v_existing.payload_version, 'payload', coalesce(v_existing.parsed_payload, '{}'::jsonb)),
      'pending', v_existing.id)
    RETURNING id INTO v_work_id;
    RETURN jsonb_build_object('status', 'duplicate', 'delivery_id', v_existing.id, 'work_id', v_work_id, 'repaired', true);
  END IF;

  INSERT INTO public.woocommerce_webhook_deliveries
    (connector_id, webhook_id, delivery_id, delivery_fingerprint, topic, resource, source_url,
     payload_version, raw_body, parsed_payload, signature_present, signature_valid, source_valid,
     resource_valid, verification_result, verified_at)
  VALUES (p_connector_id, p_webhook_id, v_key, v_fingerprint, p_topic, p_resource, p_source_url,
     p_payload_version, p_raw_body, p_parsed_payload, true, true, true, true, 'accepted', now())
  RETURNING id INTO v_delivery_id;

  SELECT * INTO v_existing_work FROM public.woocommerce_sync_work
    WHERE connector_id = p_connector_id AND direction = 'inbound' AND kind = 'product_import'
      AND external_order_id = p_external_order_id AND state = 'pending'
    ORDER BY created_at, id LIMIT 1 FOR UPDATE;
  IF v_existing_work.id IS NOT NULL THEN
    UPDATE public.woocommerce_sync_work SET
      payload = jsonb_build_object('topic', p_topic, 'resource', p_resource,
        'payload_version', p_payload_version, 'payload', coalesce(p_parsed_payload, '{}'::jsonb)),
      related_delivery_id = v_delivery_id, updated_at = now()
    WHERE id = v_existing_work.id;
    IF v_existing_work.related_delivery_id IS NOT NULL THEN
      UPDATE public.woocommerce_webhook_deliveries SET processed_at = coalesce(processed_at, now())
        WHERE id = v_existing_work.related_delivery_id;
    END IF;
    RETURN jsonb_build_object('status', 'accepted', 'delivery_id', v_delivery_id, 'work_id', v_existing_work.id, 'merged', true);
  END IF;

  INSERT INTO public.woocommerce_sync_work
    (connector_id, direction, kind, external_order_id, identity_key, payload, state, related_delivery_id)
  VALUES (p_connector_id, 'inbound', 'product_import', p_external_order_id,
    'product:' || v_delivery_id::text,
    jsonb_build_object('topic', p_topic, 'resource', p_resource,
      'payload_version', p_payload_version, 'payload', coalesce(p_parsed_payload, '{}'::jsonb)),
    'pending', v_delivery_id)
  RETURNING id INTO v_work_id;
  RETURN jsonb_build_object('status', 'accepted', 'delivery_id', v_delivery_id, 'work_id', v_work_id);
END $$;

REVOKE ALL ON FUNCTION public.accept_woocommerce_product_delivery(uuid, bigint, text, text, text, text, text, text, bytea, jsonb, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_woocommerce_product_delivery(uuid, bigint, text, text, text, text, text, text, bytea, jsonb, bigint)
  TO service_role;
COMMENT ON FUNCTION public.accept_woocommerce_product_delivery(uuid, bigint, text, text, text, text, text, text, bytea, jsonb, bigint) IS
  'Atomically persists a validated WooCommerce product delivery and queues an inbound product_import work item; service_role only.';

-- ---------------------------------------------------------------------------
-- 4. Product upsert
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_woocommerce_product(
  p_connector_id uuid,
  p_external_product_id bigint,
  p_payload jsonb,
  p_modified_at timestamptz
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_connector public.woocommerce_connectors%ROWTYPE;
  v_product_id uuid;
  v_variation_id uuid;
  v_existing_map public.woocommerce_product_map%ROWTYPE;
  v_modified timestamptz;
  v_sku text;
  v_name text;
  v_image_url text;
  v_image_urls jsonb := '[]'::jsonb;
  v_price numeric;
  v_regular numeric;
  v_sale numeric;
  v_cat jsonb;
  v_cat_id uuid;
  v_parent_woo bigint;
  v_parent_local uuid;
  v_var jsonb;
  v_var_external bigint;
  v_var_map public.woocommerce_product_map%ROWTYPE;
  v_var_attrs jsonb;
  v_images jsonb;
BEGIN
  IF p_connector_id IS NULL OR p_external_product_id IS NULL OR p_external_product_id <= 0
     OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'product import requires connector, positive external id and object payload' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_connector FROM public.woocommerce_connectors
    WHERE id = p_connector_id AND intake_enabled = true AND status IN ('healthy', 'degraded');
  IF v_connector.id IS NULL THEN
    RAISE EXCEPTION 'WooCommerce connector not found or not accepting intake' USING ERRCODE = '22023';
  END IF;

  v_modified := p_modified_at;
  v_sku := nullif(btrim(coalesce(p_payload->>'sku', '')), '');
  v_name := nullif(btrim(coalesce(p_payload->>'name', '')), 'WooCommerce product');
  v_price := nullif(coalesce(p_payload->>'price', ''), '')::numeric;
  v_regular := nullif(coalesce(p_payload->>'regular_price', ''), '')::numeric;
  v_sale := nullif(coalesce(p_payload->>'sale_price', ''), '')::numeric;
  IF v_price IS NULL THEN v_price := coalesce(v_regular, v_sale, 0); END IF;

  -- Images: first src is the thumbnail, all src values form the gallery.
  v_images := p_payload->'images';
  IF jsonb_typeof(v_images) = 'array' THEN
    SELECT coalesce(jsonb_agg(value->>'src' ORDER BY ord), '[]'::jsonb)
      INTO v_image_urls
      FROM jsonb_array_elements(v_images) WITH ORDINALITY AS t(value, ord)
     WHERE value->>'src' IS NOT NULL;
    v_image_url := v_image_urls->>0;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'woo-product-upsert:' || p_connector_id::text || ':' || p_external_product_id::text, 0));

  -- Identity resolution: map first, then SKU within the same store only.
  SELECT * INTO v_existing_map FROM public.woocommerce_product_map
    WHERE connector_id = p_connector_id AND external_product_id = p_external_product_id
      AND external_variation_id IS NULL;
  IF v_existing_map.id IS NOT NULL THEN
    v_product_id := v_existing_map.product_id;
    IF v_modified IS NOT NULL AND v_existing_map.last_modified_at IS NOT NULL
       AND v_modified <= v_existing_map.last_modified_at THEN
      RETURN v_product_id; -- stale replay, nothing to do
    END IF;
  ELSIF v_sku IS NOT NULL THEN
    SELECT id INTO v_product_id FROM public.products
      WHERE store_id = v_connector.store_id AND sku = v_sku ORDER BY created_at, id LIMIT 1;
  END IF;

  IF v_product_id IS NULL THEN
    -- External identity lives in woocommerce_product_map (the legacy
    -- products.woo_product_id column was retired); the map row written below
    -- is what makes the next delivery a refresh instead of a second import.
    INSERT INTO public.products
      (store_id, sku, name, description, short_description, price,
       regular_price, sale_price, image_url, image_urls, attributes,
       manage_stock, stock_quantity, stock_status, backorders, is_active,
       origin_kind, origin_order_source_id, woo_updated_at)
    VALUES
      (v_connector.store_id, v_sku, v_name,
       nullif(p_payload->>'description', ''), nullif(p_payload->>'short_description', ''),
       coalesce(v_price, 0), v_regular, v_sale, v_image_url, coalesce(v_image_urls, '[]'::jsonb),
       p_payload->'attributes',
       coalesce((p_payload->>'manage_stock')::boolean, true),
       coalesce((p_payload->>'stock_quantity')::integer, 0),
       coalesce(nullif(p_payload->>'stock_status', ''), 'in_stock'),
       coalesce(nullif(p_payload->>'backorders', ''), 'no'), true,
       'woo_sync', v_connector.order_source_id, v_modified)
    RETURNING id INTO v_product_id;
  ELSE
    UPDATE public.products SET
      sku = v_sku,
      name = v_name,
      description = nullif(p_payload->>'description', ''),
      short_description = nullif(p_payload->>'short_description', ''),
      price = coalesce(v_price, price),
      regular_price = v_regular,
      sale_price = v_sale,
      image_url = v_image_url,
      image_urls = coalesce(v_image_urls, image_urls),
      attributes = p_payload->'attributes',
      manage_stock = coalesce((p_payload->>'manage_stock')::boolean, manage_stock),
      stock_quantity = coalesce((p_payload->>'stock_quantity')::integer, stock_quantity),
      stock_status = coalesce(nullif(p_payload->>'stock_status', ''), stock_status),
      backorders = coalesce(nullif(p_payload->>'backorders', ''), backorders),
      origin_kind = 'woo_sync',
      origin_order_source_id = v_connector.order_source_id,
      woo_updated_at = v_modified,
      updated_at = now()
    WHERE id = v_product_id;
  END IF;

  -- Record/renew the parent identity.
  IF v_existing_map.id IS NULL THEN
    INSERT INTO public.woocommerce_product_map
      (connector_id, external_product_id, external_variation_id, product_id, last_modified_at)
    VALUES (p_connector_id, p_external_product_id, NULL, v_product_id, v_modified)
    RETURNING id INTO v_existing_map.id;
  ELSE
    UPDATE public.woocommerce_product_map
      SET product_id = v_product_id, last_modified_at = v_modified, updated_at = now()
      WHERE id = v_existing_map.id;
  END IF;

  -- Categories: find or create by (woo_category_id, store_id), with name/slug
  -- and parent resolved from the Woo parent id. Two passes so a child can
  -- reference a parent created in the same delivery.
  IF jsonb_typeof(p_payload->'categories') = 'array' THEN
    FOR v_cat IN SELECT value FROM jsonb_array_elements(p_payload->'categories') LOOP
      v_parent_woo := nullif(btrim(coalesce(v_cat->>'parent', '')), '')::bigint;
      SELECT id INTO v_cat_id FROM public.categories
        WHERE store_id = v_connector.store_id AND woo_category_id = (v_cat->>'id')::bigint;
      IF v_cat_id IS NULL THEN
        INSERT INTO public.categories (name, slug, woo_category_id, store_id)
        VALUES (coalesce(nullif(v_cat->>'name', ''), 'Woo category'),
                coalesce(nullif(v_cat->>'slug', ''), ''),
                (v_cat->>'id')::bigint, v_connector.store_id)
        RETURNING id INTO v_cat_id;
      ELSE
        UPDATE public.categories
          SET name = coalesce(nullif(v_cat->>'name', ''), name),
              slug = coalesce(nullif(v_cat->>'slug', ''), slug), updated_at = now()
          WHERE id = v_cat_id;
      END IF;
      INSERT INTO public.product_categories (product_id, category_id)
        VALUES (v_product_id, v_cat_id) ON CONFLICT DO NOTHING;
    END LOOP;
    -- Second pass: resolve parent_id now that every woo category exists.
    FOR v_cat IN SELECT value FROM jsonb_array_elements(p_payload->'categories')
                 WHERE coalesce(value->>'parent', '0') <> '0' LOOP
      SELECT id INTO v_cat_id FROM public.categories
        WHERE store_id = v_connector.store_id AND woo_category_id = (v_cat->>'id')::bigint;
      SELECT id INTO v_parent_local FROM public.categories
        WHERE store_id = v_connector.store_id AND woo_category_id = (v_cat->>'parent')::bigint;
      IF v_cat_id IS NOT NULL AND v_parent_local IS NOT NULL THEN
        UPDATE public.categories SET parent_id = v_parent_local WHERE id = v_cat_id;
      END IF;
    END LOOP;
  END IF;

  -- Variations: the worker supplies the array from /products/{id}/variations
  -- as `variations_data`. Each variation is mapped by (product, variation id).
  IF jsonb_typeof(p_payload->'variations_data') = 'array' THEN
    FOR v_var IN SELECT value FROM jsonb_array_elements(p_payload->'variations_data') LOOP
      v_var_external := nullif(btrim(coalesce(v_var->>'id', '')), '')::bigint;
      IF v_var_external IS NULL OR v_var_external <= 0 THEN CONTINUE; END IF;

      SELECT * INTO v_var_map FROM public.woocommerce_product_map
        WHERE connector_id = p_connector_id AND external_product_id = p_external_product_id
          AND external_variation_id = v_var_external;
      IF v_var_map.id IS NOT NULL THEN
        v_variation_id := v_var_map.variation_id;
        IF v_modified IS NOT NULL AND v_var_map.last_modified_at IS NOT NULL
           AND v_modified <= v_var_map.last_modified_at THEN
          CONTINUE;
        END IF;
      ELSE
        v_variation_id := NULL;
      END IF;

      v_var_attrs := coalesce(v_var->'attributes', '[]'::jsonb);
      IF v_variation_id IS NULL THEN
        -- External variation identity lives in woocommerce_product_map (the
        -- legacy product_variations.woo_variation_id column was retired).
        INSERT INTO public.product_variations
          (product_id, name, sku, price, regular_price, sale_price, attributes,
           manage_stock, stock_quantity, stock_status, barcode, woo_updated_at)
        VALUES (v_product_id,
          coalesce(nullif(v_var->>'name', ''), 'Variation'),
          nullif(btrim(coalesce(v_var->>'sku', '')), ''),
          coalesce(nullif(coalesce(v_var->>'price', ''), '')::numeric,
                   nullif(coalesce(v_var->>'regular_price', ''), '')::numeric, 0),
          nullif(coalesce(v_var->>'regular_price', ''), '')::numeric,
          nullif(coalesce(v_var->>'sale_price', ''), '')::numeric,
          v_var_attrs,
          coalesce((v_var->>'manage_stock')::boolean, true),
          coalesce((v_var->>'stock_quantity')::integer, 0),
          coalesce(nullif(v_var->>'stock_status', ''), 'in_stock'),
          nullif(v_var->>'barcode', ''), v_modified)
        RETURNING id INTO v_variation_id;
      ELSE
        UPDATE public.product_variations SET
          name = coalesce(nullif(v_var->>'name', ''), name),
          sku = nullif(btrim(coalesce(v_var->>'sku', '')), ''),
          price = coalesce(nullif(coalesce(v_var->>'price', ''), '')::numeric, price),
          regular_price = nullif(coalesce(v_var->>'regular_price', ''), '')::numeric,
          sale_price = nullif(coalesce(v_var->>'sale_price', ''), '')::numeric,
          attributes = v_var_attrs,
          manage_stock = coalesce((v_var->>'manage_stock')::boolean, manage_stock),
          stock_quantity = coalesce((v_var->>'stock_quantity')::integer, stock_quantity),
          stock_status = coalesce(nullif(v_var->>'stock_status', ''), stock_status),
          barcode = nullif(v_var->>'barcode', ''),
          woo_updated_at = v_modified, updated_at = now()
        WHERE id = v_variation_id;
      END IF;

      IF v_var_map.id IS NULL THEN
        INSERT INTO public.woocommerce_product_map
          (connector_id, external_product_id, external_variation_id, product_id, variation_id, last_modified_at)
        VALUES (p_connector_id, p_external_product_id, v_var_external, v_product_id, v_variation_id, v_modified);
      ELSE
        UPDATE public.woocommerce_product_map
          SET product_id = v_product_id, variation_id = v_variation_id,
              last_modified_at = v_modified, updated_at = now()
          WHERE id = v_var_map.id;
      END IF;
    END LOOP;
  END IF;

  RETURN v_product_id;
END $$;

REVOKE ALL ON FUNCTION public.upsert_woocommerce_product(uuid, bigint, jsonb, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_woocommerce_product(uuid, bigint, jsonb, timestamptz)
  TO service_role;
COMMENT ON FUNCTION public.upsert_woocommerce_product(uuid, bigint, jsonb, timestamptz) IS
  'Import a WooCommerce product (fields, images, categories, variations) into the connector store; idempotent, service_role only.';
