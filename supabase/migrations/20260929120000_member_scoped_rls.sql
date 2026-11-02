-- ============================================================================
-- SIGNUP-PLAN Task 1.6b — Member-Scoped RLS Implementation
-- Allows self-serve business owners and store members with user_business_access
-- and user_store_access to manage their own stores, storefronts, products,
-- orders, and customers without requiring platform-wide global roles in user_roles.
-- Preserves existing platform admin and staff global authority.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Recursion-safe store access evaluation helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_can_access_store(p_store_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT (
    -- 1. Platform admin or staff (backward compatible global authority)
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'staff'::public.app_role)
    -- 2. Explicit store access assigned to user
    OR EXISTS (
      SELECT 1 FROM public.user_store_access usa
      WHERE usa.user_id = auth.uid() AND usa.store_id = p_store_id
    )
    -- 3. Business membership via brand link
    OR EXISTS (
      SELECT 1 FROM public.brands b
      JOIN public.user_business_access uba ON uba.business_id = b.business_id
      JOIN public.businesses biz ON biz.id = b.business_id
      WHERE b.woo_store_id = p_store_id
        AND uba.user_id = auth.uid()
        AND biz.is_active = true
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.user_can_access_store(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Operational scoping indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_user_store_access_user_store
  ON public.user_store_access (user_id, store_id);

CREATE INDEX IF NOT EXISTS idx_user_business_access_user_biz
  ON public.user_business_access (user_id, business_id);

CREATE INDEX IF NOT EXISTS idx_orders_store_id
  ON public.orders (store_id);

CREATE INDEX IF NOT EXISTS idx_products_store_id
  ON public.products (store_id);

CREATE INDEX IF NOT EXISTS idx_customers_store_id
  ON public.customers (store_id);

-- ---------------------------------------------------------------------------
-- 3. STORES table policies
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can manage stores" ON public.stores;
DROP POLICY IF EXISTS "Staff read stores via view only" ON public.stores;
DROP POLICY IF EXISTS "Members can read stores" ON public.stores;
DROP POLICY IF EXISTS "Members can update stores" ON public.stores;

CREATE POLICY "Admins can manage stores"
  ON public.stores FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Members can read stores"
  ON public.stores FOR SELECT
  TO authenticated
  USING (public.user_can_access_store(id));

CREATE POLICY "Members can update stores"
  ON public.stores FOR UPDATE
  TO authenticated
  USING (public.user_can_access_store(id))
  WITH CHECK (public.user_can_access_store(id));

-- ---------------------------------------------------------------------------
-- 4. STOREFRONTS table policies
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Staff and admin can insert storefronts" ON public.storefronts;
DROP POLICY IF EXISTS "Staff and admin can update storefronts" ON public.storefronts;
DROP POLICY IF EXISTS "Public can read active storefronts" ON public.storefronts;
DROP POLICY IF EXISTS "Members can read storefronts" ON public.storefronts;
DROP POLICY IF EXISTS "Members can insert storefronts" ON public.storefronts;
DROP POLICY IF EXISTS "Members can update storefronts" ON public.storefronts;

CREATE POLICY "Public can read active storefronts"
  ON public.storefronts FOR SELECT
  TO anon, authenticated
  USING (is_active = true OR public.user_can_access_store(store_id));

CREATE POLICY "Members can insert storefronts"
  ON public.storefronts FOR INSERT
  TO authenticated
  WITH CHECK (public.user_can_access_store(store_id));

CREATE POLICY "Members can update storefronts"
  ON public.storefronts FOR UPDATE
  TO authenticated
  USING (public.user_can_access_store(store_id))
  WITH CHECK (public.user_can_access_store(store_id));

-- ---------------------------------------------------------------------------
-- 5. PRODUCTS table policies
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Staff and admin can write products" ON public.products;
DROP POLICY IF EXISTS "Staff and admin can update products" ON public.products;
DROP POLICY IF EXISTS "Staff and admin can delete products" ON public.products;
DROP POLICY IF EXISTS "Members can write products" ON public.products;
DROP POLICY IF EXISTS "Members can update products" ON public.products;
DROP POLICY IF EXISTS "Members can delete products" ON public.products;

CREATE POLICY "Members can write products"
  ON public.products FOR INSERT
  TO authenticated
  WITH CHECK (
    store_id IS NOT NULL AND public.user_can_access_store(store_id)
  );

CREATE POLICY "Members can update products"
  ON public.products FOR UPDATE
  TO authenticated
  USING (
    public.user_can_access_store(store_id)
    OR (store_id IS NULL AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'staff'::public.app_role)))
  )
  WITH CHECK (
    public.user_can_access_store(store_id)
    OR (store_id IS NULL AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'staff'::public.app_role)))
  );

CREATE POLICY "Members can delete products"
  ON public.products FOR DELETE
  TO authenticated
  USING (
    public.user_can_access_store(store_id)
    OR (store_id IS NULL AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'staff'::public.app_role)))
  );

-- ---------------------------------------------------------------------------
-- 6. ORDERS table policies
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Staff and admin can write orders" ON public.orders;
DROP POLICY IF EXISTS "Staff and admin can update orders" ON public.orders;
DROP POLICY IF EXISTS "Staff and admin can delete orders" ON public.orders;
DROP POLICY IF EXISTS "Members can write orders" ON public.orders;
DROP POLICY IF EXISTS "Members can update orders" ON public.orders;
DROP POLICY IF EXISTS "Members can delete orders" ON public.orders;

CREATE POLICY "Members can write orders"
  ON public.orders FOR INSERT
  TO authenticated
  WITH CHECK (
    (store_id IS NOT NULL AND public.user_can_access_store(store_id))
    OR (store_id IS NULL AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'staff'::public.app_role)))
  );

CREATE POLICY "Members can update orders"
  ON public.orders FOR UPDATE
  TO authenticated
  USING (
    public.user_can_access_store(store_id)
    OR (store_id IS NULL AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'staff'::public.app_role)))
  )
  WITH CHECK (
    public.user_can_access_store(store_id)
    OR (store_id IS NULL AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'staff'::public.app_role)))
  );

CREATE POLICY "Members can delete orders"
  ON public.orders FOR DELETE
  TO authenticated
  USING (
    public.user_can_access_store(store_id)
    OR (store_id IS NULL AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'staff'::public.app_role)))
  );

-- ---------------------------------------------------------------------------
-- 7. ORDER_ITEMS table policies
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Staff and admin can write order_items" ON public.order_items;
DROP POLICY IF EXISTS "Staff and admin can update order_items" ON public.order_items;
DROP POLICY IF EXISTS "Staff and admin can delete order_items" ON public.order_items;
DROP POLICY IF EXISTS "Members can write order_items" ON public.order_items;
DROP POLICY IF EXISTS "Members can update order_items" ON public.order_items;
DROP POLICY IF EXISTS "Members can delete order_items" ON public.order_items;

CREATE POLICY "Members can write order_items"
  ON public.order_items FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_items.order_id
        AND (
          public.user_can_access_store(o.store_id)
          OR (o.store_id IS NULL AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'staff'::public.app_role)))
        )
    )
  );

CREATE POLICY "Members can update order_items"
  ON public.order_items FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_items.order_id
        AND (
          public.user_can_access_store(o.store_id)
          OR (o.store_id IS NULL AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'staff'::public.app_role)))
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_items.order_id
        AND (
          public.user_can_access_store(o.store_id)
          OR (o.store_id IS NULL AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'staff'::public.app_role)))
        )
    )
  );

CREATE POLICY "Members can delete order_items"
  ON public.order_items FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_items.order_id
        AND (
          public.user_can_access_store(o.store_id)
          OR (o.store_id IS NULL AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'staff'::public.app_role)))
        )
    )
  );

-- ---------------------------------------------------------------------------
-- 8. CUSTOMERS table policies
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Staff and admin can write customers" ON public.customers;
DROP POLICY IF EXISTS "Staff and admin can update customers" ON public.customers;
DROP POLICY IF EXISTS "Staff and admin can delete customers" ON public.customers;
DROP POLICY IF EXISTS "Members can write customers" ON public.customers;
DROP POLICY IF EXISTS "Members can update customers" ON public.customers;
DROP POLICY IF EXISTS "Members can delete customers" ON public.customers;

CREATE POLICY "Members can write customers"
  ON public.customers FOR INSERT
  TO authenticated
  WITH CHECK (
    (store_id IS NOT NULL AND public.user_can_access_store(store_id))
    OR (store_id IS NULL AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'staff'::public.app_role)))
  );

CREATE POLICY "Members can update customers"
  ON public.customers FOR UPDATE
  TO authenticated
  USING (
    public.user_can_access_store(store_id)
    OR (store_id IS NULL AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'staff'::public.app_role)))
  )
  WITH CHECK (
    public.user_can_access_store(store_id)
    OR (store_id IS NULL AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'staff'::public.app_role)))
  );

CREATE POLICY "Members can delete customers"
  ON public.customers FOR DELETE
  TO authenticated
  USING (
    public.user_can_access_store(store_id)
    OR (store_id IS NULL AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'staff'::public.app_role)))
  );

-- ---------------------------------------------------------------------------
-- 9. Verification RPC
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_member_scoped_rls()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_helper_exists boolean;
  v_stores_pol_count integer;
  v_products_pol_count integer;
  v_orders_pol_count integer;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'user_can_access_store'
  ) INTO v_helper_exists;

  SELECT count(*) INTO v_stores_pol_count
  FROM pg_policy
  WHERE polrelid = 'public.stores'::regclass;

  SELECT count(*) INTO v_products_pol_count
  FROM pg_policy
  WHERE polrelid = 'public.products'::regclass;

  SELECT count(*) INTO v_orders_pol_count
  FROM pg_policy
  WHERE polrelid = 'public.orders'::regclass;

  RETURN jsonb_build_object(
    'status', 'ok',
    'helper_installed', v_helper_exists,
    'stores_policies', v_stores_pol_count,
    'products_policies', v_products_pol_count,
    'orders_policies', v_orders_pol_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_member_scoped_rls() TO authenticated, service_role;
