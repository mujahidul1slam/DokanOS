-- Task 5: the stock-holder model — product_locations holder columns and
-- stock_transfers. Part 1 runs as the connection owner (schema semantics:
-- one-holder CHECK, stock-holding toggle trigger, unique siblings, transfer
-- endpoint CHECKs). Part 2 covers brand-child RLS on stock_transfers.
-- Fixture ids per _harness.md. One transaction, rolled back at the end.

BEGIN;

-- ---------------------------------------------------------------------------
-- Part 1 — schema semantics (connection owner: RLS does not apply)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_wh   uuid;
  v_show uuid;
  v_digi uuid;
  v_prod uuid;
  v_rc   bigint;
BEGIN
  INSERT INTO public.brands (id, business_id, name, slug)
  VALUES ('11111111-0000-0000-0000-0000000000f3', '11111111-0000-0000-0000-000000000001',
          'Task5 Stock Brand', 'task5-stock-brand');

  INSERT INTO public.warehouses (id, brand_id, name)
  VALUES ('11111111-0000-0000-0000-0000000000d1', '11111111-0000-0000-0000-0000000000f3', 'Stock WH')
  RETURNING id INTO v_wh;

  INSERT INTO public.order_sources (id, brand_id, name, type, is_stock_holding)
  VALUES ('11111111-0000-0000-0000-0000000000d2', '11111111-0000-0000-0000-0000000000f3',
          'Stock Showroom', 'showroom', true)
  RETURNING id INTO v_show;

  INSERT INTO public.order_sources (id, brand_id, name, type, is_stock_holding)
  VALUES ('11111111-0000-0000-0000-0000000000d3', '11111111-0000-0000-0000-0000000000f3',
          'Digital Source', 'manual', false)
  RETURNING id INTO v_digi;

  INSERT INTO public.products (id, name) VALUES
  ('11111111-0000-0000-0000-0000000000e2', 'Stock Test Product')
  RETURNING id INTO v_prod;

  -- exactly one holder
  BEGIN
    INSERT INTO public.product_locations (product_id, warehouse_id, stock_holder_order_source_id, stock_quantity)
    VALUES (v_prod, v_wh, v_show, 1);
    RAISE EXCEPTION 'FAIL: row with two holders accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.product_locations (product_id, stock_quantity)
    VALUES (v_prod, 1);
    RAISE EXCEPTION 'FAIL: row with no holder accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- warehouse holder ok
  INSERT INTO public.product_locations (product_id, warehouse_id, stock_quantity)
  VALUES (v_prod, v_wh, 10);

  -- stock-holding source ok
  INSERT INTO public.product_locations (product_id, stock_holder_order_source_id, stock_quantity)
  VALUES (v_prod, v_show, 5);

  -- duplicate holder row rejected by the unique sibling
  BEGIN
    INSERT INTO public.product_locations (product_id, warehouse_id, stock_quantity)
    VALUES (v_prod, v_wh, 1);
    RAISE EXCEPTION 'FAIL: duplicate warehouse holder row accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- digital (non-holding) source rejected by the toggle trigger
  BEGIN
    INSERT INTO public.product_locations (product_id, stock_holder_order_source_id, stock_quantity)
    VALUES (v_prod, v_digi, 1);
    RAISE EXCEPTION 'FAIL: non-stock-holding source held stock' USING ERRCODE = 'P0001';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- aggregate rollup counts both holders (10 + 5)
  IF (SELECT stock_quantity FROM public.products WHERE id = v_prod) <> 15 THEN
    RAISE EXCEPTION 'FAIL: stock aggregate did not roll up both holders (got %)',
      (SELECT stock_quantity FROM public.products WHERE id = v_prod) USING ERRCODE = 'P0001';
  END IF;

  -- transfer endpoint CHECKs
  BEGIN
    INSERT INTO public.stock_transfers (brand_id, from_warehouse_id, from_order_source_id,
                                        to_warehouse_id, product_id, quantity)
    VALUES ('11111111-0000-0000-0000-0000000000f3', v_wh, v_show, v_wh, v_prod, 1);
    RAISE EXCEPTION 'FAIL: transfer with two from-holders accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.stock_transfers (brand_id, to_warehouse_id, product_id, quantity)
    VALUES ('11111111-0000-0000-0000-0000000000f3', v_wh, v_prod, 1);
    RAISE EXCEPTION 'FAIL: transfer with no from-holder accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.stock_transfers (brand_id, from_warehouse_id, to_warehouse_id,
                                        product_id, quantity)
    VALUES ('11111111-0000-0000-0000-0000000000f3', v_wh, v_wh, v_prod, 1);
    RAISE EXCEPTION 'FAIL: transfer with identical endpoints accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  INSERT INTO public.stock_transfers (brand_id, from_warehouse_id, to_order_source_id,
                                      product_id, quantity, note)
  VALUES ('11111111-0000-0000-0000-0000000000f3', v_wh, v_show, v_prod, 3, 'stock the showroom');
  GET DIAGNOSTICS v_rc = ROW_COUNT;
  IF v_rc <> 1 THEN
    RAISE EXCEPTION 'FAIL: valid warehouse→source transfer not recorded' USING ERRCODE = 'P0001';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Part 2 — stock_transfers RLS: brand child (members/operators vs outsiders)
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
DO $$
DECLARE v_count bigint;
BEGIN
  -- the part-1 transfer is visible to an account member
  SELECT count(*) INTO v_count FROM public.stock_transfers
  WHERE brand_id = '11111111-0000-0000-0000-0000000000f3';
  IF v_count < 1 THEN
    RAISE EXCEPTION 'FAIL: member could not read own-account transfers' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.stock_transfers (brand_id, from_warehouse_id, to_order_source_id,
                                      product_id, quantity)
  VALUES ('11111111-0000-0000-0000-0000000000f3',
          '11111111-0000-0000-0000-0000000000d1',
          '11111111-0000-0000-0000-0000000000d2',
          '11111111-0000-0000-0000-0000000000e2', 2);
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated"}';
DO $$
DECLARE v_rc bigint;
BEGIN
  IF (SELECT count(*) FROM public.stock_transfers
      WHERE brand_id = '11111111-0000-0000-0000-0000000000f3') < 2 THEN
    RAISE EXCEPTION 'FAIL: viewer could not read own-account transfers' USING ERRCODE = 'P0001';
  END IF;
  BEGIN
    INSERT INTO public.stock_transfers (brand_id, from_warehouse_id, to_order_source_id,
                                        product_id, quantity)
    VALUES ('11111111-0000-0000-0000-0000000000f3',
            '11111111-0000-0000-0000-0000000000d1',
            '11111111-0000-0000-0000-0000000000d2',
            '11111111-0000-0000-0000-0000000000e2', 1);
    RAISE EXCEPTION 'FAIL: viewer recorded a transfer' USING ERRCODE = 'P0001';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.stock_transfers SET note = 'viewer-hijack'
    WHERE brand_id = '11111111-0000-0000-0000-0000000000f3';
    GET DIAGNOSTICS v_rc = ROW_COUNT;
    IF v_rc <> 0 THEN
      RAISE EXCEPTION 'FAIL: viewer updated % transfer rows', v_rc USING ERRCODE = 'P0001';
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000007","role":"authenticated"}';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.stock_transfers
             WHERE brand_id = '11111111-0000-0000-0000-0000000000f3') THEN
    RAISE EXCEPTION 'FAIL: outsider saw another account''s transfers' USING ERRCODE = 'P0001';
  END IF;
END $$;
RESET ROLE;

-- Owner-side value-pinned survival.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.stock_transfers
                 WHERE note = 'stock the showroom' AND quantity = 3) THEN
    RAISE EXCEPTION 'FAIL: recorded transfer did not survive' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.stock_transfers WHERE note = 'viewer-hijack') THEN
    RAISE EXCEPTION 'FAIL: denied writes left residue' USING ERRCODE = 'P0001';
  END IF;
END $$;

ROLLBACK;
