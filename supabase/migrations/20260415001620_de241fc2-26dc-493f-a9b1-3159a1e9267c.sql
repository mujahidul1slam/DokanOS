
-- =============================================
-- 1. STORES: Create safe view, restrict base table SELECT
-- =============================================
CREATE VIEW public.stores_safe
WITH (security_invoker = on) AS
  SELECT id, name, url, status, last_synced_at, created_at, updated_at
  FROM public.stores;

-- Drop the broad staff SELECT policy
DROP POLICY IF EXISTS "Staff can read stores basic info" ON public.stores;

-- Staff can only read via the safe view (which excludes credentials)
-- We need a SELECT policy that excludes non-admins from direct table access
CREATE POLICY "Staff read stores via view only"
  ON public.stores
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- =============================================
-- 2. ORDERS: Role-scoped write, open read
-- =============================================
DROP POLICY IF EXISTS "Authenticated users can manage orders" ON public.orders;

CREATE POLICY "Authenticated can read orders"
  ON public.orders FOR SELECT TO authenticated USING (true);

CREATE POLICY "Staff and admin can write orders"
  ON public.orders FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role));

CREATE POLICY "Staff and admin can update orders"
  ON public.orders FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role));

CREATE POLICY "Staff and admin can delete orders"
  ON public.orders FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role));

-- =============================================
-- 3. PRODUCTS
-- =============================================
DROP POLICY IF EXISTS "Authenticated users can manage products" ON public.products;

CREATE POLICY "Authenticated can read products"
  ON public.products FOR SELECT TO authenticated USING (true);

CREATE POLICY "Staff and admin can write products"
  ON public.products FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role));

CREATE POLICY "Staff and admin can update products"
  ON public.products FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role));

CREATE POLICY "Staff and admin can delete products"
  ON public.products FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role));

-- =============================================
-- 4. CUSTOMERS
-- =============================================
DROP POLICY IF EXISTS "Authenticated users can manage customers" ON public.customers;

CREATE POLICY "Authenticated can read customers"
  ON public.customers FOR SELECT TO authenticated USING (true);

CREATE POLICY "Staff and admin can write customers"
  ON public.customers FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role));

CREATE POLICY "Staff and admin can update customers"
  ON public.customers FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role));

CREATE POLICY "Staff and admin can delete customers"
  ON public.customers FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role));

-- =============================================
-- 5. ORDER_ITEMS
-- =============================================
DROP POLICY IF EXISTS "Authenticated users can manage order items" ON public.order_items;

CREATE POLICY "Authenticated can read order_items"
  ON public.order_items FOR SELECT TO authenticated USING (true);

CREATE POLICY "Staff and admin can write order_items"
  ON public.order_items FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role));

CREATE POLICY "Staff and admin can update order_items"
  ON public.order_items FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role));

CREATE POLICY "Staff and admin can delete order_items"
  ON public.order_items FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role));

-- =============================================
-- 6. ORDER_PAYMENTS
-- =============================================
DROP POLICY IF EXISTS "Authenticated users can manage order_payments" ON public.order_payments;

CREATE POLICY "Authenticated can read order_payments"
  ON public.order_payments FOR SELECT TO authenticated USING (true);

CREATE POLICY "Staff and admin can write order_payments"
  ON public.order_payments FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role));

CREATE POLICY "Staff and admin can update order_payments"
  ON public.order_payments FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role));

CREATE POLICY "Staff and admin can delete order_payments"
  ON public.order_payments FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role));

-- =============================================
-- 7. ORDER_TIMELINE
-- =============================================
DROP POLICY IF EXISTS "Authenticated users can manage order_timeline" ON public.order_timeline;

CREATE POLICY "Authenticated can read order_timeline"
  ON public.order_timeline FOR SELECT TO authenticated USING (true);

CREATE POLICY "Staff and admin can write order_timeline"
  ON public.order_timeline FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role));

CREATE POLICY "Staff and admin can update order_timeline"
  ON public.order_timeline FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role));

CREATE POLICY "Staff and admin can delete order_timeline"
  ON public.order_timeline FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role));

-- =============================================
-- 8. HELD_CARTS
-- =============================================
DROP POLICY IF EXISTS "Authenticated users can manage held_carts" ON public.held_carts;

CREATE POLICY "Authenticated can read held_carts"
  ON public.held_carts FOR SELECT TO authenticated USING (true);

CREATE POLICY "Staff and admin can write held_carts"
  ON public.held_carts FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role));

CREATE POLICY "Staff and admin can update held_carts"
  ON public.held_carts FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role));

CREATE POLICY "Staff and admin can delete held_carts"
  ON public.held_carts FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role));

-- =============================================
-- 9. POS_RETURNS
-- =============================================
DROP POLICY IF EXISTS "Authenticated users can manage pos_returns" ON public.pos_returns;

CREATE POLICY "Authenticated can read pos_returns"
  ON public.pos_returns FOR SELECT TO authenticated USING (true);

CREATE POLICY "Staff and admin can write pos_returns"
  ON public.pos_returns FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role));

CREATE POLICY "Staff and admin can update pos_returns"
  ON public.pos_returns FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role));

CREATE POLICY "Staff and admin can delete pos_returns"
  ON public.pos_returns FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role));

-- =============================================
-- 10. POS_SHIFTS: Scoped to own shifts for non-admins
-- =============================================
DROP POLICY IF EXISTS "Authenticated users can manage pos_shifts" ON public.pos_shifts;

CREATE POLICY "Users can read own shifts, admins read all"
  ON public.pos_shifts FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Staff and admin can insert pos_shifts"
  ON public.pos_shifts FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role));

CREATE POLICY "Own shifts or admin can update pos_shifts"
  ON public.pos_shifts FOR UPDATE TO authenticated
  USING ((auth.uid() = user_id AND public.has_role(auth.uid(), 'staff'::app_role)) OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admin can delete pos_shifts"
  ON public.pos_shifts FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- =============================================
-- 11. PRODUCT_CATEGORIES
-- =============================================
DROP POLICY IF EXISTS "Authenticated users can manage product_categories" ON public.product_categories;

CREATE POLICY "Authenticated can read product_categories"
  ON public.product_categories FOR SELECT TO authenticated USING (true);

CREATE POLICY "Staff and admin can write product_categories"
  ON public.product_categories FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role));

CREATE POLICY "Staff and admin can update product_categories"
  ON public.product_categories FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role));

CREATE POLICY "Staff and admin can delete product_categories"
  ON public.product_categories FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role));

-- =============================================
-- 12. PRODUCT_VARIATIONS
-- =============================================
DROP POLICY IF EXISTS "Authenticated users can manage product_variations" ON public.product_variations;

CREATE POLICY "Authenticated can read product_variations"
  ON public.product_variations FOR SELECT TO authenticated USING (true);

CREATE POLICY "Staff and admin can write product_variations"
  ON public.product_variations FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role));

CREATE POLICY "Staff and admin can update product_variations"
  ON public.product_variations FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role));

CREATE POLICY "Staff and admin can delete product_variations"
  ON public.product_variations FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role));

-- =============================================
-- 13. CATEGORIES
-- =============================================
DROP POLICY IF EXISTS "Authenticated users can manage categories" ON public.categories;

CREATE POLICY "Authenticated can read categories"
  ON public.categories FOR SELECT TO authenticated USING (true);

CREATE POLICY "Staff and admin can write categories"
  ON public.categories FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role));

CREATE POLICY "Staff and admin can update categories"
  ON public.categories FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role));

CREATE POLICY "Staff and admin can delete categories"
  ON public.categories FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role));

-- =============================================
-- 14. AUDIT_LOG: Keep read for all, write for admin/staff
-- =============================================
DROP POLICY IF EXISTS "Authenticated users can read audit log" ON public.audit_log;
DROP POLICY IF EXISTS "Authenticated users can insert audit log" ON public.audit_log;

CREATE POLICY "Authenticated can read audit_log"
  ON public.audit_log FOR SELECT TO authenticated USING (true);

CREATE POLICY "Staff and admin can insert audit_log"
  ON public.audit_log FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role));
