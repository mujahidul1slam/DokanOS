-- Task 16: drop the legacy contract tables and dead columns ("Safe contract" scope,
-- human-approved 2026-11-02). The cutover gates are complete: the 28-migration chain
-- and the Task 8 data mapping are applied, the Gate 3 live audit matched the scratch
-- rehearsal 1:1, and the new frontend is deployed. This migration removes the legacy
-- surfaces the new model replaced and stamps the legacy pool with its owning account.
--
-- DROPPED tables (7): legacy_order_channels (the renamed pre-revamp order_sources),
--   connectors, product_sources, customer_sources, brand_stores, selling_points,
--   locations.
-- DROPPED columns (5): orders.selling_point_id (2,575 legacy values, superseded by
--   order_source_id), orders.location_id (0 values), product_locations.location_id
--   (0), purchase_orders.location_id (0), pos_shifts.selling_point_id (0 rows).
-- KEPT on purpose (scope correction vs the original card):
--   orders.storefront_id — NOT dead: storefront_place_order writes it on every
--   storefront checkout and OrderDetailSheet keys the restore-stock trigger on it.
--   stores + every store_id binding + orders.source/customers.source — the
--   key-model migration is a separate, documented follow-up.
--   order_sources.legacy_store_id / legacy_selling_point_id / legacy_woo_store_id —
--   the spec's legacy_* audit columns (no FKs; they survive the table drops).
-- ADDED: orders.business_id + customers.business_id (nullable, FK → businesses ON
--   DELETE SET NULL) and the legacy pool rows are stamped with the owning legacy
--   account. The pool RLS policies are rewritten without the dropped columns and
--   gain the business_id leg.
--
-- Rollback: restore from the pre-Task-16 logical dump (schema + data). The drops are
-- destructive by design; there is no in-place DOWN path.

-- ---------------------------------------------------------------------------
-- §1 Pool account stamping (runs BEFORE the drops: it reads order_sources'
--     legacy_* mapping columns and the full pool predicates).
--     The pool is the residue of the legacy account: rows that no brand evidence
--     could attribute. Their ACCOUNT, though, is derivable — every legacy store
--     and selling point the mapping consumed belongs to exactly one business.
--     Stamp only when that derivation is unambiguous; otherwise leave the rows
--     account-less (the RLS rewrite below keeps them visible for assignment).
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_biz_count int;
  v_legacy_biz uuid;
  v_stamped int;
BEGIN
  SELECT count(DISTINCT b.business_id) INTO v_biz_count
  FROM public.order_sources os
  JOIN public.brands b ON b.id = os.brand_id
  WHERE os.legacy_store_id IS NOT NULL OR os.legacy_selling_point_id IS NOT NULL;

  IF v_biz_count = 1 THEN
    SELECT DISTINCT b.business_id INTO v_legacy_biz
    FROM public.order_sources os
    JOIN public.brands b ON b.id = os.brand_id
    WHERE os.legacy_store_id IS NOT NULL OR os.legacy_selling_point_id IS NOT NULL;

    UPDATE public.customers
    SET business_id = v_legacy_biz
    WHERE source = 'legacy migration'
      AND origin_kind = 'legacy'
      AND store_id IS NULL
      AND origin_order_source_id IS NULL;
    GET DIAGNOSTICS v_stamped = ROW_COUNT;
    RAISE NOTICE 'task16: stamped % pool customers with legacy business %', v_stamped, v_legacy_biz;

    UPDATE public.orders
    SET business_id = v_legacy_biz
    WHERE source = 'legacy migration'
      AND store_id IS NULL
      AND selling_point_id IS NULL
      AND storefront_id IS NULL
      AND order_source_id IS NULL;
    GET DIAGNOSTICS v_stamped = ROW_COUNT;
    RAISE NOTICE 'task16: stamped % pool orders with legacy business %', v_stamped, v_legacy_biz;
  ELSE
    RAISE NOTICE 'task16: legacy mapping spans % businesses — pool rows left unassigned', v_biz_count;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- §2 New account columns for orders/customers.
-- ---------------------------------------------------------------------------

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES public.businesses (id) ON DELETE SET NULL;
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES public.businesses (id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- §3 publish_my_storefront: re-home discovery + ownership on the brand leg.
--     The old body discovered the caller's storefront through selling_points and
--     cross-checked the selling_points link — both die with the table. The brand
--     leg (storefront → store → brands.woo_store_id → business membership) is the
--     authoritative ownership proof create_my_brand_store already establishes.
--     Everything else (error codes, flip-only publish, signup_events, return
--     shape) is preserved verbatim.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.publish_my_storefront(p_storefront_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user_id      uuid;
  v_sf           record;
  v_brand_count  int;
  v_biz_id       uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: authentication required' USING ERRCODE = 'P0001';
  END IF;

  IF p_storefront_id IS NOT NULL THEN
    SELECT * INTO v_sf FROM public.storefronts WHERE id = p_storefront_id;
  ELSE
    -- Brand-leg discovery (Task 16): storefront → store → brands.woo_store_id →
    -- owner/admin membership. The legacy discovery path through the dropped
    -- channel-point table is gone.
    SELECT s.* INTO v_sf
    FROM public.storefronts s
    JOIN public.brands b ON b.woo_store_id = s.store_id
    JOIN public.user_business_access uba ON uba.business_id = b.business_id
    WHERE uba.user_id = v_user_id AND uba.role IN ('owner', 'admin')
    ORDER BY s.created_at ASC
    LIMIT 1;
  END IF;

  IF v_sf.id IS NULL THEN
    RAISE EXCEPTION 'STOREFRONT_NOT_FOUND: no accessible storefront found' USING ERRCODE = 'P0001';
  END IF;

  IF v_sf.store_id IS NULL THEN
    RAISE EXCEPTION 'NO_STORE_LINK: storefront is not linked to a store' USING ERRCODE = 'P0001';
  END IF;

  -- Verify brand joins to the store
  SELECT count(DISTINCT b.id) INTO v_brand_count
  FROM public.brands b
  WHERE b.woo_store_id = v_sf.store_id;

  IF v_brand_count > 1 THEN
    RAISE EXCEPTION 'AMBIGUOUS_STORE_JOIN: multiple brands link to store' USING ERRCODE = 'P0001';
  END IF;
  IF v_brand_count = 0 THEN
    RAISE EXCEPTION 'NO_BRAND_LINK: store not linked to any brand' USING ERRCODE = 'P0001';
  END IF;

  -- Verify caller has owner/admin in the business owning the brand
  SELECT b.business_id INTO v_biz_id
  FROM public.brands b
  WHERE b.woo_store_id = v_sf.store_id
  LIMIT 1;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_business_access
    WHERE user_id = v_user_id AND business_id = v_biz_id AND role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: owner or admin role required' USING ERRCODE = 'P0001';
  END IF;

  -- Flip-only: set ONLY is_active = true
  IF NOT v_sf.is_active THEN
    UPDATE public.storefronts
    SET is_active = true, updated_at = now()
    WHERE id = v_sf.id;

    INSERT INTO public.signup_events (event, user_id)
    VALUES ('site_opened', v_user_id);
  END IF;

  RETURN jsonb_build_object(
    'status', 'ok',
    'storefront_id', v_sf.id,
    'slug', v_sf.slug,
    'is_active', true
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- §4 Pool RLS rewrite — MUST run before the column drops: the existing pool
--     policies reference orders.selling_point_id, which pins the column. The
--     recreated policies drop that leg (the column dies in §5), keep the
--     storefront_id leg (storefront checkout writes it), and gain the account
--     leg: a stamped pool row is visible only to its own business; an unstamped
--     row (legacy mapping was ambiguous, or a fresh environment) stays visible
--     to any member so it can still be assigned. The reassign WITH CHECK keeps
--     the three legal destinations: still-in-pool, store-bound, or source-bound.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Legacy pool members can read orders" ON public.orders;
CREATE POLICY "Legacy pool members can read orders"
  ON public.orders FOR SELECT TO authenticated
  USING (
    orders.source = 'legacy migration'
    AND orders.store_id IS NULL
    AND orders.storefront_id IS NULL
    AND orders.order_source_id IS NULL
    AND (orders.business_id IS NULL OR orders.business_id = public.current_business_context())
    AND EXISTS (
      SELECT 1
      FROM public.user_business_access membership
      JOIN public.businesses business ON business.id = membership.business_id
      WHERE membership.user_id = auth.uid()
        AND membership.business_id = public.current_business_context()
        AND business.is_active = true
    )
  );

DROP POLICY IF EXISTS "Legacy pool operators can reassign orders" ON public.orders;
CREATE POLICY "Legacy pool operators can reassign orders"
  ON public.orders FOR UPDATE TO authenticated
  USING (
    orders.source = 'legacy migration'
    AND orders.store_id IS NULL
    AND orders.storefront_id IS NULL
    AND orders.order_source_id IS NULL
    AND (orders.business_id IS NULL OR orders.business_id = public.current_business_context())
    AND EXISTS (
      SELECT 1
      FROM public.user_business_access membership
      JOIN public.businesses business ON business.id = membership.business_id
      WHERE membership.user_id = auth.uid()
        AND membership.business_id = public.current_business_context()
        AND business.is_active = true
        AND membership.role IN ('owner', 'admin', 'manager')
    )
  )
  WITH CHECK (
    (
      orders.source = 'legacy migration'
      AND orders.store_id IS NULL
      AND orders.storefront_id IS NULL
      AND orders.order_source_id IS NULL
      AND (orders.business_id IS NULL OR orders.business_id = public.current_business_context())
    )
    OR (orders.store_id IS NOT NULL AND public.user_can_access_store(orders.store_id))
    OR (
      orders.order_source_id IS NOT NULL
      AND (orders.store_id IS NULL OR public.user_can_access_store(orders.store_id))
      AND EXISTS (
        SELECT 1
        FROM public.order_sources os
        JOIN public.brands b ON b.id = os.brand_id
        JOIN public.businesses business ON business.id = b.business_id
        JOIN public.user_business_access membership
          ON membership.business_id = b.business_id
        WHERE os.id = orders.order_source_id
          AND membership.user_id = auth.uid()
          AND b.business_id = public.current_business_context()
          AND business.is_active = true
      )
    )
  );

DROP POLICY IF EXISTS "Legacy pool members can read customers" ON public.customers;
CREATE POLICY "Legacy pool members can read customers"
  ON public.customers FOR SELECT TO authenticated
  USING (
    customers.source = 'legacy migration'
    AND customers.origin_kind = 'legacy'
    AND customers.store_id IS NULL
    AND customers.origin_order_source_id IS NULL
    AND (customers.business_id IS NULL OR customers.business_id = public.current_business_context())
    AND EXISTS (
      SELECT 1
      FROM public.user_business_access membership
      JOIN public.businesses business ON business.id = membership.business_id
      WHERE membership.user_id = auth.uid()
        AND membership.business_id = public.current_business_context()
        AND business.is_active = true
    )
  );

DROP POLICY IF EXISTS "Legacy pool operators can reassign customers" ON public.customers;
CREATE POLICY "Legacy pool operators can reassign customers"
  ON public.customers FOR UPDATE TO authenticated
  USING (
    customers.source = 'legacy migration'
    AND customers.origin_kind = 'legacy'
    AND customers.store_id IS NULL
    AND customers.origin_order_source_id IS NULL
    AND (customers.business_id IS NULL OR customers.business_id = public.current_business_context())
    AND EXISTS (
      SELECT 1
      FROM public.user_business_access membership
      JOIN public.businesses business ON business.id = membership.business_id
      WHERE membership.user_id = auth.uid()
        AND membership.business_id = public.current_business_context()
        AND business.is_active = true
        AND membership.role IN ('owner', 'admin', 'manager')
    )
  )
  WITH CHECK (
    (
      customers.source = 'legacy migration'
      AND customers.origin_kind = 'legacy'
      AND customers.store_id IS NULL
      AND customers.origin_order_source_id IS NULL
      AND (customers.business_id IS NULL OR customers.business_id = public.current_business_context())
    )
    OR (customers.store_id IS NOT NULL AND public.user_can_access_store(customers.store_id))
    OR (
      customers.origin_order_source_id IS NOT NULL
      AND (customers.store_id IS NULL OR public.user_can_access_store(customers.store_id))
      AND EXISTS (
        SELECT 1
        FROM public.order_sources os
        JOIN public.brands b ON b.id = os.brand_id
        JOIN public.businesses business ON business.id = b.business_id
        JOIN public.user_business_access membership
          ON membership.business_id = b.business_id
        WHERE os.id = customers.origin_order_source_id
          AND membership.user_id = auth.uid()
          AND b.business_id = public.current_business_context()
          AND business.is_active = true
      )
    )
  );

-- ---------------------------------------------------------------------------
-- §5 Dead foreign keys, then dead columns.
-- ---------------------------------------------------------------------------

ALTER TABLE public.orders            DROP CONSTRAINT IF EXISTS orders_location_id_fkey;
ALTER TABLE public.orders            DROP CONSTRAINT IF EXISTS orders_selling_point_id_fkey;
ALTER TABLE public.product_locations DROP CONSTRAINT IF EXISTS product_locations_location_id_fkey;
ALTER TABLE public.purchase_orders   DROP CONSTRAINT IF EXISTS purchase_orders_location_id_fkey;
ALTER TABLE public.pos_shifts        DROP CONSTRAINT IF EXISTS pos_shifts_selling_point_id_fkey;

ALTER TABLE public.orders            DROP COLUMN IF EXISTS selling_point_id;
ALTER TABLE public.orders            DROP COLUMN IF EXISTS location_id;
ALTER TABLE public.product_locations DROP COLUMN IF EXISTS location_id;
ALTER TABLE public.purchase_orders   DROP COLUMN IF EXISTS location_id;
ALTER TABLE public.pos_shifts        DROP COLUMN IF EXISTS selling_point_id;

-- Dropping product_locations.location_id auto-drops the one-holder CHECK that
-- counted it as a holder (20261031113000_warehouses_stock.sql:102-103 planned
-- this rewrite). Re-add it in the two-way form: warehouse or stock-holding
-- order source, exactly one.
ALTER TABLE public.product_locations
  ADD CONSTRAINT product_locations_one_holder CHECK (
    (warehouse_id IS NOT NULL)::int
    + (stock_holder_order_source_id IS NOT NULL)::int = 1
  );

-- ---------------------------------------------------------------------------
-- §6 The legacy tables. brand_stores first (it references locations and
--     selling_points), then selling_points (references locations), then
--     locations. The rest have no inbound foreign keys. CASCADE is belt and
--     braces: policies and indexes on these tables die with them.
-- ---------------------------------------------------------------------------

DROP TABLE IF EXISTS public.brand_stores CASCADE;
DROP TABLE IF EXISTS public.selling_points CASCADE;
DROP TABLE IF EXISTS public.locations CASCADE;
DROP TABLE IF EXISTS public.connectors CASCADE;
DROP TABLE IF EXISTS public.product_sources CASCADE;
DROP TABLE IF EXISTS public.customer_sources CASCADE;
DROP TABLE IF EXISTS public.legacy_order_channels CASCADE;

-- ---------------------------------------------------------------------------
-- §7 Functions whose contract died with the dropped tables. brand_stores'
--     write policy depends on brand_store_legacy_links_valid, so the tables
--     must go first (their policies die with them).
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.create_brand_store(uuid, text, text);
DROP FUNCTION IF EXISTS public.brand_store_legacy_links_valid(uuid, uuid, uuid, uuid);

-- ---------------------------------------------------------------------------
-- §8 Verification: the end state must hold or the migration fails loudly.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_missing text;
  v_pool_customers int;
  v_pool_orders int;
  v_stamped_customers int;
  v_stamped_orders int;
BEGIN
  -- Every dropped table must be gone.
  FOR v_missing IN
    SELECT t FROM (VALUES
      ('brand_stores'), ('selling_points'), ('locations'),
      ('connectors'), ('product_sources'), ('customer_sources'),
      ('legacy_order_channels')
    ) AS dropped(t)
    WHERE to_regclass(format('public.%I', t)) IS NOT NULL
  LOOP
    RAISE EXCEPTION 'task16 verification failed: table % still exists', v_missing USING ERRCODE = 'P0001';
  END LOOP;

  -- Every dropped column must be gone.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name IN ('selling_point_id', 'location_id')
  ) OR EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'product_locations' AND column_name = 'location_id'
  ) OR EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'purchase_orders' AND column_name = 'location_id'
  ) OR EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pos_shifts' AND column_name = 'selling_point_id'
  ) THEN
    RAISE EXCEPTION 'task16 verification failed: a dropped column still exists' USING ERRCODE = 'P0001';
  END IF;

  -- The rewritten publish RPC must exist and must not reference selling_points.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'publish_my_storefront'
  ) THEN
    RAISE EXCEPTION 'task16 verification failed: publish_my_storefront missing' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'publish_my_storefront'
      AND pg_get_functiondef(p.oid) LIKE '%selling_points%'
  ) THEN
    RAISE EXCEPTION 'task16 verification failed: publish_my_storefront still references selling_points' USING ERRCODE = 'P0001';
  END IF;

  -- The dead contract RPCs must be gone.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('create_brand_store', 'brand_store_legacy_links_valid')
  ) THEN
    RAISE EXCEPTION 'task16 verification failed: a dead contract RPC still exists' USING ERRCODE = 'P0001';
  END IF;

  -- The rewritten pool policies must exist.
  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'public' AND tablename IN ('orders', 'customers')
        AND policyname LIKE 'Legacy pool %') <> 4 THEN
    RAISE EXCEPTION 'task16 verification failed: pool policies missing' USING ERRCODE = 'P0001';
  END IF;

  -- Report the pool state (informational).
  SELECT count(*), count(*) FILTER (WHERE business_id IS NOT NULL)
    INTO v_pool_customers, v_stamped_customers
  FROM public.customers
  WHERE source = 'legacy migration' AND origin_kind = 'legacy'
    AND store_id IS NULL AND origin_order_source_id IS NULL;
  SELECT count(*), count(*) FILTER (WHERE business_id IS NOT NULL)
    INTO v_pool_orders, v_stamped_orders
  FROM public.orders
  WHERE source = 'legacy migration'
    AND store_id IS NULL AND storefront_id IS NULL AND order_source_id IS NULL;
  RAISE NOTICE 'task16: pool customers % (% stamped), pool orders % (% stamped)',
    v_pool_customers, v_stamped_customers, v_pool_orders, v_stamped_orders;
END $$;
