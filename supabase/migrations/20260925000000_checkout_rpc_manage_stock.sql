-- ============================================================================
-- Storefront checkout RPC: honor manage_stock = false (overhaul task 1.1).
--
-- Bug: storefront_place_order ran the product_locations ledger decrement
-- (Case A) whenever location rows existed — regardless of manage_stock. POS/
-- Woo syncs create zero-quantity location rows for display-only-stock
-- products (manage_stock = false, stock_quantity = 0), so every checkout on
-- such products died with 'Insufficient location stock' (HTTP 400) even
-- though stock is not managed. Case B likewise pushed stock_quantity
-- negative for non-managed products.
--
-- Fix (CREATE OR REPLACE, no data changes):
--   * Case A (location FIFO ledger) only runs when products.manage_stock.
--   * Case B direct decrement only runs when products.manage_stock;
--     non-managed products journal qty 0 and touch no stock rows.
-- Stock VALIDATION stays gated on manage_stock exactly as before (fact 13).
-- ============================================================================

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

    IF v_loc_count > 0 AND v_p_row.manage_stock THEN
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
      -- Non-managed products keep their display stock untouched (informational only).
      IF v_p_row.manage_stock THEN
        v_direct_qty := v_qty;

        UPDATE public.products
      SET stock_quantity = stock_quantity - v_qty
      WHERE id = v_prod_id AND (NOT manage_stock OR stock_quantity >= v_qty);

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Insufficient product stock for "%"', v_prod_name USING ERRCODE = 'P0001';
      END IF;
      ELSE
        v_direct_qty := 0;
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
