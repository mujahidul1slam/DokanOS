-- ============================================================================
-- Storefront Phase 6 (P0 #6 + §2.9.1/§2.9.3): atomic checkout, idempotency,
-- Track fix substrate, and closure of the anon FOR ALL batch (H1/H5/H7) +
-- the never-ran pathao tighten (H7, amended by M15).
--
-- Expand-only EXCEPT the plan's deliberate exception #1 (§10.3): the ten-table
-- anon-policy drop + pathao tighten. Every statement is idempotent and re-runs
-- safely (own-name DROP IF EXISTS before every CREATE; unique-index guards).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. orders columns + partial unique idempotency key (H2)
-- ---------------------------------------------------------------------------
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_idempotency_key
  ON public.orders(idempotency_key) WHERE idempotency_key IS NOT NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS storefront_id uuid REFERENCES public.storefronts(id) ON DELETE SET NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS stock_restored_at timestamptz;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS stock_ledger jsonb;  -- decrement journal (M10)

-- ---------------------------------------------------------------------------
-- 2. L8: orders.order_number uniqueness, self-guarded (loud duplicate halt —
--    never silently weakened to a partial index).
-- ---------------------------------------------------------------------------
DO $$
DECLARE dup_groups int;
BEGIN
  SELECT count(*) INTO dup_groups
  FROM (SELECT order_number FROM public.orders
        WHERE order_number IS NOT NULL
        GROUP BY 1 HAVING count(*) > 1) d;
  IF dup_groups > 0 THEN
    RAISE EXCEPTION 'uq_orders_order_number blocked: % duplicate order_number groups exist — dedupe before deploying this migration', dup_groups;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_order_number ON public.orders(order_number);

-- ---------------------------------------------------------------------------
-- 3. Close the anon FOR ALL batch — the plan's deliberate exception #1 (§10.3).
--    The anon policies were created by FOUR migrations (fact 6):
--      20260407074308 (orders, order_items, customers, products, stores — 5)
--      20260407150827 (order_timeline, order_payments)
--      20260408191701 (product_variations)
--      20260408205133 (categories, product_categories)
--    The failed 20260412170009 attempted to drop ALL TEN + the pathao tighten;
--    live DB shows the orders one failed, so under the plan's rollback premise
--    NONE of that migration's statements took effect. Re-run all ten drops
--    idempotently (harmless where already gone):
--      * products anon READ is preserved by 20260619164824's differently-named
--        SELECT-only (is_active) policy, NOT dropped;
--      * product_variations anon read is re-granted SELECT-only by Phase 3's
--        policy (different name, NOT dropped);
--      * categories/product_categories end with ZERO anon policies (runtime
--        never reads categories; POS/admin read as authenticated).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow anonymous access to orders"             ON public.orders;
DROP POLICY IF EXISTS "Allow anonymous access to order_items"        ON public.order_items;
DROP POLICY IF EXISTS "Allow anonymous access to order_payments"     ON public.order_payments;
DROP POLICY IF EXISTS "Allow anonymous access to order_timeline"     ON public.order_timeline;
DROP POLICY IF EXISTS "Allow anonymous access to customers"          ON public.customers;
DROP POLICY IF EXISTS "Allow anonymous access to product_variations" ON public.product_variations;
DROP POLICY IF EXISTS "Allow anonymous access to products"           ON public.products;             -- H5
DROP POLICY IF EXISTS "Allow anonymous access to stores"             ON public.stores;               -- H5
DROP POLICY IF EXISTS "Allow anonymous access to categories"         ON public.categories;           -- H7
DROP POLICY IF EXISTS "Allow anonymous access to product_categories" ON public.product_categories;   -- H7

-- ---------------------------------------------------------------------------
-- 4. pathao_* tighten (H7), re-run idempotently and AS AMENDED BY M15.
--    Every re-create below is preceded by a DROP POLICY IF EXISTS of the SAME
--    name (M14 — the §4.1 self-owned-object idiom; PostgreSQL has no
--    CREATE POLICY IF NOT EXISTS). 20260412170009's own tail already created
--    every one of these names, so a plain CREATE POLICY would error on a fresh
--    `db reset`. On live the guards are no-ops and the creates ARE the
--    tighten; on fresh the drop+create is a byte-identical re-create.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Public access to pathao_cities" ON public.pathao_cities;
DROP POLICY IF EXISTS "Public access to pathao_zones"  ON public.pathao_zones;
DROP POLICY IF EXISTS "Public access to pathao_areas"  ON public.pathao_areas;
DROP POLICY IF EXISTS "Public access to pathao_stores" ON public.pathao_stores;

DROP POLICY IF EXISTS "Anyone can read pathao_cities" ON public.pathao_cities;
CREATE POLICY "Anyone can read pathao_cities" ON public.pathao_cities FOR SELECT USING (true);
DROP POLICY IF EXISTS "Authenticated can manage pathao_cities" ON public.pathao_cities;
CREATE POLICY "Authenticated can manage pathao_cities" ON public.pathao_cities FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can read pathao_zones" ON public.pathao_zones;
CREATE POLICY "Anyone can read pathao_zones" ON public.pathao_zones FOR SELECT USING (true);
DROP POLICY IF EXISTS "Authenticated can manage pathao_zones" ON public.pathao_zones;
CREATE POLICY "Authenticated can manage pathao_zones" ON public.pathao_zones FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can read pathao_areas" ON public.pathao_areas;
CREATE POLICY "Anyone can read pathao_areas" ON public.pathao_areas FOR SELECT USING (true);
DROP POLICY IF EXISTS "Authenticated can manage pathao_areas" ON public.pathao_areas;
CREATE POLICY "Authenticated can manage pathao_areas" ON public.pathao_areas FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- M15: "Anyone can read pathao_stores" is deliberately NOT re-created — the
-- April tail's read policy was superseded by 20260620172022 ("pathao_stores:
-- remove public read"). pathao_stores (courier store mappings) ends with ZERO
-- anon policies, authenticated-manage-only (the shipping quote is service-role).
DROP POLICY IF EXISTS "Authenticated can manage pathao_stores" ON public.pathao_stores;
CREATE POLICY "Authenticated can manage pathao_stores" ON public.pathao_stores FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 5. Atomic place-order RPC (H2, M7, M8, M10, M13, L6, L8)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.storefront_place_order(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_idempotency_key text;
  v_storefront_id uuid;
  v_store_id uuid;
  v_customer jsonb;
  v_order jsonb;
  v_items jsonb;
  v_customer_id uuid;
  v_order_id uuid;
  v_order_number text;
  v_constraint text;
  v_existing_id uuid;
  v_existing_num text;
  v_item jsonb;
  v_prod_id uuid;
  v_var_id uuid;
  v_qty int;
  v_unit_price numeric;
  v_line_total numeric;
  v_prod_name text;
  v_p_row record;
  v_v_row record;
  v_loc_count int;
  v_loc_row record;
  v_needed int;
  v_take int;
  v_decrements jsonb;
  v_direct_qty int;
  v_case text;
  v_ledger jsonb;
BEGIN
  v_idempotency_key := p_payload->>'idempotency_key';
  v_storefront_id := (p_payload->>'storefront_id')::uuid;
  v_store_id := CASE WHEN p_payload->>'store_id' IS NOT NULL AND p_payload->>'store_id' <> '' THEN (p_payload->>'store_id')::uuid ELSE NULL END;
  v_customer := p_payload->'customer';
  v_order := p_payload->'order';
  v_items := p_payload->'items';

  IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'Order items cannot be empty' USING ERRCODE = 'P0001';
  END IF;

  -- 0. UPSERT the customer row inside the transaction (L6)
  IF v_customer IS NOT NULL AND v_customer->>'phone' IS NOT NULL AND trim(v_customer->>'phone') <> '' THEN
    SELECT id INTO v_customer_id FROM public.customers WHERE phone = trim(v_customer->>'phone') LIMIT 1;
    IF v_customer_id IS NOT NULL THEN
      UPDATE public.customers
      SET name = COALESCE(v_customer->>'name', name),
          email = COALESCE(v_customer->>'email', email),
          address = COALESCE(v_customer->>'address', address),
          city = COALESCE(v_customer->>'city_name', city),
          zone = COALESCE(v_customer->>'zone_name', zone),
          area = COALESCE(v_customer->>'area_name', area),
          store_id = COALESCE(v_store_id, store_id)
      WHERE id = v_customer_id;
    ELSE
      INSERT INTO public.customers (name, phone, email, address, city, zone, area, store_id, source)
      VALUES (
        COALESCE(v_customer->>'name', 'Customer'),
        trim(v_customer->>'phone'),
        v_customer->>'email',
        v_customer->>'address',
        v_customer->>'city_name',
        v_customer->>'zone_name',
        v_customer->>'area_name',
        v_store_id,
        'online'
      )
      RETURNING id INTO v_customer_id;
    END IF;
  END IF;

  -- 1. INSERT the orders row FIRST (serializes same-key races via uq_orders_idempotency_key)
  v_order_number := v_order->>'order_number';
  BEGIN
    INSERT INTO public.orders (
      order_number,
      storefront_id,
      store_id,
      customer_id,
      customer_name,
      customer_phone,
      customer_email,
      customer_address,
      customer_city,
      total,
      subtotal,
      shipping_cost,
      source,
      status,
      payment_status,
      payment_method,
      payment_meta,
      fulfillment_type,
      amount_to_collect,
      item_qty,
      pathao_recipient_city,
      pathao_recipient_zone,
      pathao_recipient_area,
      special_instruction,
      notes,
      idempotency_key
    ) VALUES (
      v_order_number,
      v_storefront_id,
      v_store_id,
      v_customer_id,
      v_customer->>'name',
      v_customer->>'phone',
      v_customer->>'email',
      v_customer->>'address',
      v_customer->>'city_name',
      COALESCE((v_order->>'total')::numeric, 0),
      COALESCE((v_order->>'subtotal')::numeric, 0),
      COALESCE((v_order->>'shipping_cost')::numeric, 0),
      'online',
      COALESCE(v_order->>'status', 'pending'),
      COALESCE(v_order->>'payment_status', 'unpaid'),
      COALESCE(v_order->>'payment_method', 'cod'),
      CASE WHEN v_order->'payment_meta' IS NOT NULL THEN v_order->'payment_meta'
           WHEN v_order->>'payment_method' = 'cod' THEN '{"method":"cod"}'::jsonb
           ELSE jsonb_build_object(
             'method', COALESCE(v_order->>'payment_method', 'cod'),
             'trx_id', v_order->>'payment_trx_id',
             'sender', v_order->>'payment_sender'
           ) END,
      COALESCE(v_order->>'fulfillment_type', 'delivery'),
      COALESCE((v_order->>'amount_to_collect')::numeric, (v_order->>'total')::numeric, 0),
      COALESCE((v_order->>'item_qty')::int, 0),
      CASE WHEN v_order->>'pathao_recipient_city' IS NOT NULL THEN (v_order->>'pathao_recipient_city')::int ELSE NULL END,
      CASE WHEN v_order->>'pathao_recipient_zone' IS NOT NULL THEN (v_order->>'pathao_recipient_zone')::int ELSE NULL END,
      CASE WHEN v_order->>'pathao_recipient_area' IS NOT NULL THEN (v_order->>'pathao_recipient_area')::int ELSE NULL END,
      v_order->>'special_instruction',
      v_order->>'notes',
      v_idempotency_key
    )
    RETURNING id INTO v_order_id;

  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    -- a) Verify constraint is uq_orders_idempotency_key (M7)
    IF v_constraint = 'uq_orders_idempotency_key' THEN
      -- b) Select the committed row by idempotency_key
      SELECT id, order_number INTO v_existing_id, v_existing_num
      FROM public.orders
      WHERE idempotency_key = v_idempotency_key;

      IF v_existing_id IS NULL THEN
        RAISE EXCEPTION 'Idempotency conflict but no order row found' USING ERRCODE = '23505';
      END IF;

      -- c) Deduplicated success: return existing order without decrementing stock
      RETURN jsonb_build_object('order_id', v_existing_id, 'order_number', v_existing_num, 'deduped', true);
    ELSE
      -- Any other unique violation (including uq_orders_order_number collision, L8) is RE-RAISED!
      RAISE EXCEPTION 'unique_violation on constraint %: %', v_constraint, SQLERRM USING ERRCODE = '23505';
    END IF;
  END;

  -- 2 & 3. Process items, validate stock FOR UPDATE, decrement stock (M8 / M13)
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_prod_id := (v_item->>'product_id')::uuid;
    v_var_id := CASE WHEN v_item->>'variation_id' IS NOT NULL AND v_item->>'variation_id' <> '' THEN (v_item->>'variation_id')::uuid ELSE NULL END;
    v_qty := (v_item->>'quantity')::int;
    v_unit_price := (v_item->>'unit_price')::numeric;
    v_line_total := COALESCE((v_item->>'line_total')::numeric, v_unit_price * v_qty);
    v_prod_name := COALESCE(v_item->>'product_name', 'Product');
    v_decrements := '[]'::jsonb;
    v_direct_qty := 0;

    -- Lock parent product
    SELECT id, name, price, manage_stock, stock_quantity
    INTO v_p_row
    FROM public.products
    WHERE id = v_prod_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product % not found', v_prod_id USING ERRCODE = 'P0001';
    END IF;

    -- If variation, lock variation row
    IF v_var_id IS NOT NULL THEN
      SELECT id, name, price, manage_stock, stock_quantity
      INTO v_v_row
      FROM public.product_variations
      WHERE id = v_var_id AND product_id = v_prod_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Variation % for product % not found', v_var_id, v_prod_id USING ERRCODE = 'P0001';
      END IF;

      -- Validate variation stock (manage_stock gated only per fact 13 / M2)
      IF v_v_row.manage_stock AND v_v_row.stock_quantity < v_qty THEN
        RAISE EXCEPTION 'Item "%" is out of stock (available: %)', v_prod_name, v_v_row.stock_quantity USING ERRCODE = 'P0001';
      END IF;
    END IF;

    -- Validate parent product stock
    IF v_p_row.manage_stock AND v_p_row.stock_quantity < v_qty THEN
      RAISE EXCEPTION 'Item "%" is out of stock (available: %)', v_prod_name, v_p_row.stock_quantity USING ERRCODE = 'P0001';
    END IF;

    -- Check if product_locations rows exist
    SELECT count(*) INTO v_loc_count
    FROM public.product_locations
    WHERE product_id = v_prod_id;

    IF v_loc_count > 0 THEN
      v_case := 'A';
      v_needed := v_qty;

      IF v_var_id IS NOT NULL THEN
        -- Primary: decrement matching variation-keyed rows FIFO
        FOR v_loc_row IN
          SELECT id, stock_quantity
          FROM public.product_locations
          WHERE product_id = v_prod_id AND variation_id = v_var_id
          ORDER BY created_at ASC
          FOR UPDATE
        LOOP
          IF v_needed <= 0 THEN EXIT; END IF;
          IF v_loc_row.stock_quantity > 0 THEN
            v_take := LEAST(v_loc_row.stock_quantity, v_needed);
            UPDATE public.product_locations
            SET stock_quantity = stock_quantity - v_take
            WHERE id = v_loc_row.id AND stock_quantity >= v_take;

            IF NOT FOUND THEN
              RAISE EXCEPTION 'Concurrent modification on location % for %', v_loc_row.id, v_prod_name USING ERRCODE = 'P0001';
            END IF;

            v_decrements := v_decrements || jsonb_build_object('location_row_id', v_loc_row.id, 'qty', v_take);
            v_needed := v_needed - v_take;
          END IF;
        END LOOP;

        -- Fallback: parent-keyed rows (variation_id IS NULL)
        IF v_needed > 0 THEN
          FOR v_loc_row IN
            SELECT id, stock_quantity
            FROM public.product_locations
            WHERE product_id = v_prod_id AND variation_id IS NULL
            ORDER BY created_at ASC
            FOR UPDATE
          LOOP
            IF v_needed <= 0 THEN EXIT; END IF;
            IF v_loc_row.stock_quantity > 0 THEN
              v_take := LEAST(v_loc_row.stock_quantity, v_needed);
              UPDATE public.product_locations
              SET stock_quantity = stock_quantity - v_take
              WHERE id = v_loc_row.id AND stock_quantity >= v_take;

              IF NOT FOUND THEN
                RAISE EXCEPTION 'Concurrent modification on parent location % for %', v_loc_row.id, v_prod_name USING ERRCODE = 'P0001';
              END IF;

              v_decrements := v_decrements || jsonb_build_object('location_row_id', v_loc_row.id, 'qty', v_take);
              v_needed := v_needed - v_take;
            END IF;
          END LOOP;
        END IF;

        IF v_needed > 0 THEN
          RAISE EXCEPTION 'Insufficient location stock for "%"', v_prod_name USING ERRCODE = 'P0001';
        END IF;

        -- Decrement variation aggregate row
        UPDATE public.product_variations
        SET stock_quantity = stock_quantity - v_qty
        WHERE id = v_var_id AND (NOT manage_stock OR stock_quantity >= v_qty);

      ELSE
        -- Non-variation item: decrement parent-keyed rows (variation_id IS NULL) FIFO
        FOR v_loc_row IN
          SELECT id, stock_quantity
          FROM public.product_locations
          WHERE product_id = v_prod_id AND variation_id IS NULL
          ORDER BY created_at ASC
          FOR UPDATE
        LOOP
          IF v_needed <= 0 THEN EXIT; END IF;
          IF v_loc_row.stock_quantity > 0 THEN
            v_take := LEAST(v_loc_row.stock_quantity, v_needed);
            UPDATE public.product_locations
            SET stock_quantity = stock_quantity - v_take
            WHERE id = v_loc_row.id AND stock_quantity >= v_take;

            IF NOT FOUND THEN
              RAISE EXCEPTION 'Concurrent modification on location % for %', v_loc_row.id, v_prod_name USING ERRCODE = 'P0001';
            END IF;

            v_decrements := v_decrements || jsonb_build_object('location_row_id', v_loc_row.id, 'qty', v_take);
            v_needed := v_needed - v_take;
          END IF;
        END LOOP;

        -- M13 cross-key FIFO fallback to variation-keyed rows
        IF v_needed > 0 THEN
          FOR v_loc_row IN
            SELECT id, stock_quantity
            FROM public.product_locations
            WHERE product_id = v_prod_id AND variation_id IS NOT NULL
            ORDER BY created_at ASC
            FOR UPDATE
          LOOP
            IF v_needed <= 0 THEN EXIT; END IF;
            IF v_loc_row.stock_quantity > 0 THEN
              v_take := LEAST(v_loc_row.stock_quantity, v_needed);
              UPDATE public.product_locations
              SET stock_quantity = stock_quantity - v_take
              WHERE id = v_loc_row.id AND stock_quantity >= v_take;

              IF NOT FOUND THEN
                RAISE EXCEPTION 'Concurrent modification on variation location % for %', v_loc_row.id, v_prod_name USING ERRCODE = 'P0001';
              END IF;

              v_decrements := v_decrements || jsonb_build_object('location_row_id', v_loc_row.id, 'qty', v_take);
              v_needed := v_needed - v_take;
            END IF;
          END LOOP;
        END IF;

        IF v_needed > 0 THEN
          RAISE EXCEPTION 'Insufficient location stock for "%"', v_prod_name USING ERRCODE = 'P0001';
        END IF;
      END IF;

    ELSE
      -- CASE B: Zero location rows for product -> direct decrement on products
      v_case := 'B';
      v_direct_qty := v_qty;

      UPDATE public.products
      SET stock_quantity = stock_quantity - v_qty
      WHERE id = v_prod_id AND (NOT manage_stock OR stock_quantity >= v_qty);

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Insufficient product stock for "%"', v_prod_name USING ERRCODE = 'P0001';
      END IF;

      IF v_var_id IS NOT NULL THEN
        UPDATE public.product_variations
        SET stock_quantity = stock_quantity - v_qty
        WHERE id = v_var_id AND (NOT manage_stock OR stock_quantity >= v_qty);

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Insufficient variation stock for "%"', v_prod_name USING ERRCODE = 'P0001';
        END IF;
      END IF;
    END IF;

    -- 4. Write stock_ledger journal entry per item (M10)
    v_ledger := jsonb_build_object(
      'case', v_case,
      'product_id', v_prod_id,
      'variation_id', v_var_id,
      'location_decrements', v_decrements,
      'products_direct_qty', v_direct_qty
    );

    INSERT INTO public.order_items (
      order_id,
      product_id,
      variation_id,
      product_name,
      quantity,
      unit_price,
      line_total,
      stock_ledger
    ) VALUES (
      v_order_id,
      v_prod_id,
      v_var_id,
      v_prod_name,
      v_qty,
      v_unit_price,
      v_line_total,
      v_ledger
    );
  END LOOP;

  -- Insert order timeline
  INSERT INTO public.order_timeline (order_id, event, description, metadata)
  VALUES (
    v_order_id,
    'created',
    'Online order placed via storefront',
    jsonb_build_object('storefront_id', v_storefront_id, 'order_number', v_order_number)
  );

  -- 5. Return success
  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'deduped', false
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Stock Restore RPC (M10, H3, H6)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.storefront_restore_stock(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order record;
  v_item record;
  v_ledger jsonb;
  v_dec jsonb;
  v_loc_id uuid;
  v_take int;
  v_loc_exists boolean;
  v_has_locations boolean;
BEGIN
  -- Lock the order row
  SELECT id, storefront_id, status, stock_restored_at
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % not found', p_order_id USING ERRCODE = 'P0001';
  END IF;

  -- Idempotency check: no-op if already restored
  IF v_order.stock_restored_at IS NOT NULL THEN
    RAISE NOTICE 'Order % inventory was already restored at %', p_order_id, v_order.stock_restored_at;
    RETURN;
  END IF;

  -- Only restore storefront orders (H3 discriminator)
  IF v_order.storefront_id IS NULL THEN
    RETURN;
  END IF;

  -- Mark restored timestamp
  UPDATE public.orders
  SET stock_restored_at = now()
  WHERE id = p_order_id;

  -- Replay each item's stock_ledger (M10)
  FOR v_item IN SELECT * FROM public.order_items WHERE order_id = p_order_id
  LOOP
    v_ledger := v_item.stock_ledger;
    IF v_ledger IS NOT NULL THEN
      -- Case A: replay location decrements
      IF v_ledger->>'case' = 'A' AND v_ledger->'location_decrements' IS NOT NULL THEN
        FOR v_dec IN SELECT * FROM jsonb_array_elements(v_ledger->'location_decrements')
        LOOP
          v_loc_id := (v_dec->>'location_row_id')::uuid;
          v_take := (v_dec->>'qty')::int;

          SELECT EXISTS(SELECT 1 FROM public.product_locations WHERE id = v_loc_id) INTO v_loc_exists;

          IF v_loc_exists THEN
            UPDATE public.product_locations
            SET stock_quantity = stock_quantity + v_take
            WHERE id = v_loc_id;
          ELSE
            -- Location row deleted since placement: restore directly to products.stock_quantity (M10)
            UPDATE public.products
            SET stock_quantity = stock_quantity + v_take
            WHERE id = v_item.product_id;
            RAISE NOTICE 'Location row % deleted since placement; restored % units directly to products', v_loc_id, v_take;
          END IF;
        END LOOP;

      ELSIF v_ledger->>'case' = 'B' THEN
        -- Case B: direct restore
        SELECT EXISTS(SELECT 1 FROM public.product_locations WHERE product_id = v_item.product_id) INTO v_has_locations;
        IF v_has_locations THEN
          -- Locations were added since placement: direct restore + drift notice
          RAISE NOTICE 'Location rows added since Case-B placement for product %; replaying direct restore', v_item.product_id;
        END IF;

        UPDATE public.products
        SET stock_quantity = stock_quantity + COALESCE((v_ledger->>'products_direct_qty')::int, v_item.quantity)
        WHERE id = v_item.product_id;
      END IF;

      -- If item has variation, restore variation stock_quantity
      IF v_item.variation_id IS NOT NULL THEN
        UPDATE public.product_variations
        SET stock_quantity = stock_quantity + v_item.quantity
        WHERE id = v_item.variation_id;
      END IF;
    END IF;
  END LOOP;

  -- Add timeline entry
  INSERT INTO public.order_timeline (order_id, event, description, metadata)
  VALUES (
    p_order_id,
    'inventory_restored',
    'Stock restored following storefront order cancellation',
    jsonb_build_object('restored_at', now())
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Function permissions (H6, fact 22):
--    service_role bypasses RLS, NOT EXECUTE privileges. A SECURITY DEFINER
--    function still requires the CALLING role to hold EXECUTE; after REVOKEs,
--    only owner retains it. The explicit GRANTs make them callable by service-role
--    edge functions.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.storefront_place_order(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storefront_place_order(jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.storefront_restore_stock(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storefront_restore_stock(uuid) TO service_role;