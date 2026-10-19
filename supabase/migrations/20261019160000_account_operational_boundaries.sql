-- Issue #10: account membership, not a legacy global staff grant, is the
-- authority for operational data. Platform-admin recovery policies and the
-- reviewed owner/member administration contracts remain unchanged.

CREATE OR REPLACE FUNCTION public.user_can_access_store(p_store_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.brands b
    JOIN public.user_business_access membership
      ON membership.business_id = b.business_id
    JOIN public.businesses business ON business.id = b.business_id
    WHERE b.woo_store_id = p_store_id
      AND membership.user_id = auth.uid()
      AND business.is_active = true
  );
$$;
REVOKE ALL ON FUNCTION public.user_can_access_store(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_access_store(uuid) TO authenticated, service_role;

-- New Supabase projects do not implicitly grant Data API table privileges.
-- RLS remains the authority; these grants only let authenticated requests
-- reach the scoped policies below.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stores, public.storefronts,
  public.products, public.orders, public.order_items, public.order_payments,
  public.order_timeline, public.customers, public.held_carts, public.pos_returns,
  public.pos_shifts, public.categories, public.product_categories,
  public.product_variations, public.product_locations
  TO authenticated;

-- Replace historical authenticated-wide reads with account-scoped reads.
DROP POLICY IF EXISTS "Authenticated can read products" ON public.products;
DROP POLICY IF EXISTS "Authenticated can read orders" ON public.orders;
DROP POLICY IF EXISTS "Authenticated can read customers" ON public.customers;
DROP POLICY IF EXISTS "Authenticated can read order_items" ON public.order_items;

CREATE POLICY "Account members can read products"
  ON public.products FOR SELECT TO authenticated
  USING (store_id IS NOT NULL AND public.user_can_access_store(store_id));
CREATE POLICY "Account members can read orders"
  ON public.orders FOR SELECT TO authenticated
  USING (store_id IS NOT NULL AND public.user_can_access_store(store_id));
CREATE POLICY "Account members can read customers"
  ON public.customers FOR SELECT TO authenticated
  USING (store_id IS NOT NULL AND public.user_can_access_store(store_id));
CREATE POLICY "Account members can read order_items"
  ON public.order_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.orders account_order
    WHERE account_order.id = order_items.order_id
      AND account_order.store_id IS NOT NULL
      AND public.user_can_access_store(account_order.store_id)
  ));

-- Existing member write policies were mostly scoped, but retained a fallback
-- that let global roles mutate unassigned rows. Require a real account store
-- for every operational write and for every forged parent identifier.
DROP POLICY IF EXISTS "Members can write products" ON public.products;
DROP POLICY IF EXISTS "Members can update products" ON public.products;
DROP POLICY IF EXISTS "Members can delete products" ON public.products;
CREATE POLICY "Account members can insert products" ON public.products
  FOR INSERT TO authenticated
  WITH CHECK (store_id IS NOT NULL AND public.user_can_access_store(store_id));
CREATE POLICY "Account members can update products" ON public.products
  FOR UPDATE TO authenticated
  USING (store_id IS NOT NULL AND public.user_can_access_store(store_id))
  WITH CHECK (store_id IS NOT NULL AND public.user_can_access_store(store_id));
CREATE POLICY "Account members can delete products" ON public.products
  FOR DELETE TO authenticated
  USING (store_id IS NOT NULL AND public.user_can_access_store(store_id));

DROP POLICY IF EXISTS "Members can write orders" ON public.orders;
DROP POLICY IF EXISTS "Members can update orders" ON public.orders;
DROP POLICY IF EXISTS "Members can delete orders" ON public.orders;
CREATE POLICY "Account members can insert orders" ON public.orders
  FOR INSERT TO authenticated
  WITH CHECK (store_id IS NOT NULL AND public.user_can_access_store(store_id));
CREATE POLICY "Account members can update orders" ON public.orders
  FOR UPDATE TO authenticated
  USING (store_id IS NOT NULL AND public.user_can_access_store(store_id))
  WITH CHECK (store_id IS NOT NULL AND public.user_can_access_store(store_id));
CREATE POLICY "Account members can delete orders" ON public.orders
  FOR DELETE TO authenticated
  USING (store_id IS NOT NULL AND public.user_can_access_store(store_id));

DROP POLICY IF EXISTS "Members can write customers" ON public.customers;
DROP POLICY IF EXISTS "Members can update customers" ON public.customers;
DROP POLICY IF EXISTS "Members can delete customers" ON public.customers;
CREATE POLICY "Account members can insert customers" ON public.customers
  FOR INSERT TO authenticated
  WITH CHECK (store_id IS NOT NULL AND public.user_can_access_store(store_id));
CREATE POLICY "Account members can update customers" ON public.customers
  FOR UPDATE TO authenticated
  USING (store_id IS NOT NULL AND public.user_can_access_store(store_id))
  WITH CHECK (store_id IS NOT NULL AND public.user_can_access_store(store_id));
CREATE POLICY "Account members can delete customers" ON public.customers
  FOR DELETE TO authenticated
  USING (store_id IS NOT NULL AND public.user_can_access_store(store_id));

DROP POLICY IF EXISTS "Members can write order_items" ON public.order_items;
DROP POLICY IF EXISTS "Members can update order_items" ON public.order_items;
DROP POLICY IF EXISTS "Members can delete order_items" ON public.order_items;
CREATE POLICY "Account members can insert order_items" ON public.order_items
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.orders account_order
    WHERE account_order.id = order_items.order_id
      AND account_order.store_id IS NOT NULL
      AND public.user_can_access_store(account_order.store_id)
  ));
CREATE POLICY "Account members can update order_items" ON public.order_items
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.orders account_order
    WHERE account_order.id = order_items.order_id
      AND account_order.store_id IS NOT NULL
      AND public.user_can_access_store(account_order.store_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.orders account_order
    WHERE account_order.id = order_items.order_id
      AND account_order.store_id IS NOT NULL
      AND public.user_can_access_store(account_order.store_id)
  ));
CREATE POLICY "Account members can delete order_items" ON public.order_items
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.orders account_order
    WHERE account_order.id = order_items.order_id
      AND account_order.store_id IS NOT NULL
      AND public.user_can_access_store(account_order.store_id)
  ));

-- Direct store-scoped operational tables.
DO $$
DECLARE
  account_table text;
BEGIN
  FOREACH account_table IN ARRAY ARRAY['held_carts', 'pos_returns', 'pos_shifts', 'categories'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Authenticated can read %1$s" ON public.%1$I', account_table);
    EXECUTE format('DROP POLICY IF EXISTS "Users can read own shifts, admins read all" ON public.%1$I', account_table);
    EXECUTE format('DROP POLICY IF EXISTS "Staff and admin can write %1$s" ON public.%1$I', account_table);
    EXECUTE format('DROP POLICY IF EXISTS "Staff and admin can insert %1$s" ON public.%1$I', account_table);
    EXECUTE format('DROP POLICY IF EXISTS "Staff and admin can update %1$s" ON public.%1$I', account_table);
    EXECUTE format('DROP POLICY IF EXISTS "Own shifts or admin can update %1$s" ON public.%1$I', account_table);
    EXECUTE format('DROP POLICY IF EXISTS "Staff and admin can delete %1$s" ON public.%1$I', account_table);
    EXECUTE format('DROP POLICY IF EXISTS "Admin can delete %1$s" ON public.%1$I', account_table);
    EXECUTE format(
      'CREATE POLICY "Account members can read %1$s" ON public.%1$I FOR SELECT TO authenticated USING (store_id IS NOT NULL AND public.user_can_access_store(store_id))',
      account_table
    );
    EXECUTE format(
      'CREATE POLICY "Account members can insert %1$s" ON public.%1$I FOR INSERT TO authenticated WITH CHECK (store_id IS NOT NULL AND public.user_can_access_store(store_id))',
      account_table
    );
    EXECUTE format(
      'CREATE POLICY "Account members can update %1$s" ON public.%1$I FOR UPDATE TO authenticated USING (store_id IS NOT NULL AND public.user_can_access_store(store_id)) WITH CHECK (store_id IS NOT NULL AND public.user_can_access_store(store_id))',
      account_table
    );
    EXECUTE format(
      'CREATE POLICY "Account members can delete %1$s" ON public.%1$I FOR DELETE TO authenticated USING (store_id IS NOT NULL AND public.user_can_access_store(store_id))',
      account_table
    );
  END LOOP;
END $$;

-- Child rows inherit the account boundary from their authoritative parent.
DO $$
DECLARE
  child_table text;
  parent_expression text;
BEGIN
  FOR child_table, parent_expression IN VALUES
    ('order_payments', 'EXISTS (SELECT 1 FROM public.orders parent WHERE parent.id = order_payments.order_id AND parent.store_id IS NOT NULL AND public.user_can_access_store(parent.store_id))'),
    ('order_timeline', 'EXISTS (SELECT 1 FROM public.orders parent WHERE parent.id = order_timeline.order_id AND parent.store_id IS NOT NULL AND public.user_can_access_store(parent.store_id))'),
    ('product_variations', 'EXISTS (SELECT 1 FROM public.products parent WHERE parent.id = product_variations.product_id AND parent.store_id IS NOT NULL AND public.user_can_access_store(parent.store_id))'),
    ('product_categories', 'EXISTS (SELECT 1 FROM public.products parent WHERE parent.id = product_categories.product_id AND parent.store_id IS NOT NULL AND public.user_can_access_store(parent.store_id))'),
    ('product_locations', 'EXISTS (SELECT 1 FROM public.products parent WHERE parent.id = product_locations.product_id AND parent.store_id IS NOT NULL AND public.user_can_access_store(parent.store_id))')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Authenticated can read %1$s" ON public.%1$I', child_table);
    EXECUTE format('DROP POLICY IF EXISTS "Staff and admin can write %1$s" ON public.%1$I', child_table);
    EXECUTE format('DROP POLICY IF EXISTS "Staff and admin can update %1$s" ON public.%1$I', child_table);
    EXECUTE format('DROP POLICY IF EXISTS "Staff and admin can delete %1$s" ON public.%1$I', child_table);
    EXECUTE format('DROP POLICY IF EXISTS "Members can read %1$s" ON public.%1$I', child_table);
    EXECUTE format('DROP POLICY IF EXISTS "Members can write %1$s" ON public.%1$I', child_table);
    EXECUTE format('CREATE POLICY "Account members can read %1$s" ON public.%1$I FOR SELECT TO authenticated USING (%2$s)', child_table, parent_expression);
    EXECUTE format('CREATE POLICY "Account members can insert %1$s" ON public.%1$I FOR INSERT TO authenticated WITH CHECK (%2$s)', child_table, parent_expression);
    EXECUTE format('CREATE POLICY "Account members can update %1$s" ON public.%1$I FOR UPDATE TO authenticated USING (%2$s) WITH CHECK (%2$s)', child_table, parent_expression);
    EXECUTE format('CREATE POLICY "Account members can delete %1$s" ON public.%1$I FOR DELETE TO authenticated USING (%2$s)', child_table, parent_expression);
  END LOOP;
END $$;
