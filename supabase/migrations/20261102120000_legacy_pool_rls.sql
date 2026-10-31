-- 20261102120000_legacy_pool_rls.sql — Task 15 (spec §7): the business-level
-- "Legacy / unattributed" pool surface (src/pages/LegacyPool.tsx).
--
-- The pool rows are the ones scripts/migrate-enveil-vincent.sql step 10
-- (lines 361-374) tags, and the predicates here are that step's WHERE shapes:
--
--   orders:    source = 'legacy migration' AND store_id IS NULL
--              AND selling_point_id IS NULL AND storefront_id IS NULL
--              AND order_source_id IS NULL
--   customers: source = 'legacy migration' AND origin_kind = 'legacy'
--              AND store_id IS NULL AND origin_order_source_id IS NULL
--
-- The tag identifies the row as a pool row; the NULLed binding half is what
-- makes a reassignment drain it (reassignment writes those binding columns).
--
-- Today those rows pass NO policy at all (every orders/customers policy
-- requires store_id IS NOT NULL AND user_can_access_store(store_id)), so the
-- pool is invisible and unmodifiable through the Data API. This migration adds
-- the legs it needs and nothing else:
--
--   1. Pool read (any active-business member) + pool reassign
--      (owner/admin/manager — spec §5 ladder values, post-Task-12; staff is
--      read-only). Pool rows are UNOWNED by construction (no business or brand
--      binding exists on them — the script deliberately leaves them unbound),
--      so their only tenancy gate is membership in the server-side ACTIVE
--      business context (public.current_business_context()), the same gate
--      user_can_access_store applies. Post-migration there is exactly one
--      tenant draining one pool; until Task 16's contract rework gives pool
--      rows a business binding, unowned rows are therefore shared by whichever
--      business a member has active, and outsiders (no membership / no active
--      context) fail closed. Once reassigned, rows are tenanted again through
--      the brand's store or order source and normal rules apply.
--   2. Source-attribution read/update: a reassigned row is bound to the
--      brand's order source (the binding scripts/migrate-enveil-vincent.sql
--      itself writes for inferred orders — step 9 sets order_source_id only).
--      Rows bound that way carry no store_id and therefore stayed invisible
--      under the store-only policies (the same is true of the script's ~97
--      inferred orders). This leg makes them visible to the source's brand's
--      business — and to nobody else: the leg re-checks the row's store
--      binding for consistency so a cross-tenant store/source mismatch cannot
--      leak a row into the wrong business.
--
-- INSERT policies are untouched: the app still creates orders/customers with
-- a store binding (POS / AddOrderDialog). Closing that last gap belongs to
-- Task 16's contract phase.

-- ---------------------------------------------------------------------------
-- Shared shapes (kept inline per policy — the repo idiom, e.g.
-- 20261031140000_courier_services.sql):
--
-- active-member:  EXISTS (SELECT 1 FROM user_business_access membership
--                         JOIN businesses business ON business.id = membership.business_id
--                         WHERE membership.user_id = auth.uid()
--                           AND membership.business_id = public.current_business_context()
--                           AND business.is_active = true)
-- active-operator: the same plus membership.role IN ('owner', 'admin', 'manager')
-- source-bound(os_id): EXISTS (SELECT 1 FROM order_sources os
--                              JOIN brands b ON b.id = os.brand_id
--                              JOIN businesses business ON business.id = b.business_id
--                              JOIN user_business_access membership
--                                ON membership.business_id = b.business_id
--                              WHERE os.id = <os_id>
--                                AND membership.user_id = auth.uid()
--                                AND b.business_id = public.current_business_context()
--                                AND business.is_active = true)
--   and, for rows that also carry a store binding, the consistency guard
--   (store_id IS NULL OR public.user_can_access_store(store_id)).
-- ---------------------------------------------------------------------------

-- =========================== orders ===========================

CREATE POLICY "Legacy pool members can read orders"
  ON public.orders FOR SELECT TO authenticated
  USING (
    orders.source = 'legacy migration'
    AND orders.store_id IS NULL
    AND orders.selling_point_id IS NULL
    AND orders.storefront_id IS NULL
    AND orders.order_source_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.user_business_access membership
      JOIN public.businesses business ON business.id = membership.business_id
      WHERE membership.user_id = auth.uid()
        AND membership.business_id = public.current_business_context()
        AND business.is_active = true
    )
  );

CREATE POLICY "Legacy pool operators can reassign orders"
  ON public.orders FOR UPDATE TO authenticated
  USING (
    orders.source = 'legacy migration'
    AND orders.store_id IS NULL
    AND orders.selling_point_id IS NULL
    AND orders.storefront_id IS NULL
    AND orders.order_source_id IS NULL
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
    -- A pool operator may only move a row INTO a binding they can access:
    -- still-in-pool (no-op), bound to their brand's legacy store, or bound to
    -- their brand's order source. Cross-business bindings fail all three.
    (
      orders.source = 'legacy migration'
      AND orders.store_id IS NULL
      AND orders.selling_point_id IS NULL
      AND orders.storefront_id IS NULL
      AND orders.order_source_id IS NULL
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

CREATE POLICY "Account members can read source-attributed orders"
  ON public.orders FOR SELECT TO authenticated
  USING (
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
  );

CREATE POLICY "Account members can update source-attributed orders"
  ON public.orders FOR UPDATE TO authenticated
  USING (
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
  WITH CHECK (
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
  );

-- =========================== customers ===========================

CREATE POLICY "Legacy pool members can read customers"
  ON public.customers FOR SELECT TO authenticated
  USING (
    customers.source = 'legacy migration'
    AND customers.origin_kind = 'legacy'
    AND customers.store_id IS NULL
    AND customers.origin_order_source_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.user_business_access membership
      JOIN public.businesses business ON business.id = membership.business_id
      WHERE membership.user_id = auth.uid()
        AND membership.business_id = public.current_business_context()
        AND business.is_active = true
    )
  );

CREATE POLICY "Legacy pool operators can reassign customers"
  ON public.customers FOR UPDATE TO authenticated
  USING (
    customers.source = 'legacy migration'
    AND customers.origin_kind = 'legacy'
    AND customers.store_id IS NULL
    AND customers.origin_order_source_id IS NULL
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

CREATE POLICY "Account members can read source-attributed customers"
  ON public.customers FOR SELECT TO authenticated
  USING (
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
  );

CREATE POLICY "Account members can update source-attributed customers"
  ON public.customers FOR UPDATE TO authenticated
  USING (
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
  WITH CHECK (
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
  );
