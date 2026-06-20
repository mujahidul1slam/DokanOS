
-- 1. products: prevent anon from reading cost_price
DROP POLICY IF EXISTS "Public can read active products" ON public.products;
REVOKE SELECT ON public.products FROM anon;
GRANT SELECT (id, store_id, woo_product_id, sku, name, description, price, stock_quantity, barcode, category, image_url, is_active, created_at, updated_at, manage_stock, stock_status, backorders, is_featured, sales_count, image_urls) ON public.products TO anon;
CREATE POLICY "Public can read active products" ON public.products
  FOR SELECT TO anon USING (is_active = true);

-- 2. pathao_stores: remove public read
DROP POLICY IF EXISTS "Anyone can read pathao_stores" ON public.pathao_stores;

-- 3. user_roles: own row + admins
DROP POLICY IF EXISTS "Users can view all roles" ON public.user_roles;
CREATE POLICY "Users view own role; admins view all" ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

-- 4. user_custom_roles: own row + admins
DROP POLICY IF EXISTS "Authenticated can read user_custom_roles" ON public.user_custom_roles;
CREATE POLICY "Users view own custom roles; admins view all" ON public.user_custom_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

-- 5. user_store_access: own row + admins
DROP POLICY IF EXISTS "Authenticated can read user_store_access" ON public.user_store_access;
CREATE POLICY "Users view own store access; admins view all" ON public.user_store_access
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));
