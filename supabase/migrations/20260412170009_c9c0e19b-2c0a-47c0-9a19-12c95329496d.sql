-- Remove anonymous access from business tables
DROP POLICY IF EXISTS "Allow anonymous access to orders" ON public.orders;
DROP POLICY IF EXISTS "Allow anonymous access to order_items" ON public.order_items;
DROP POLICY IF EXISTS "Allow anonymous access to order_payments" ON public.order_payments;
DROP POLICY IF EXISTS "Allow anonymous access to order_timeline" ON public.order_timeline;
DROP POLICY IF EXISTS "Allow anonymous access to products" ON public.products;
DROP POLICY IF EXISTS "Allow anonymous access to product_variations" ON public.product_variations;
DROP POLICY IF EXISTS "Allow anonymous access to product_categories" ON public.product_categories;
DROP POLICY IF EXISTS "Allow anonymous access to customers" ON public.customers;
DROP POLICY IF EXISTS "Allow anonymous access to categories" ON public.categories;
DROP POLICY IF EXISTS "Allow anonymous access to stores" ON public.stores;

-- Tighten the pathao tables to read-only for public (webhooks/edge functions use service role)
DROP POLICY IF EXISTS "Public access to pathao_cities" ON public.pathao_cities;
DROP POLICY IF EXISTS "Public access to pathao_zones" ON public.pathao_zones;
DROP POLICY IF EXISTS "Public access to pathao_areas" ON public.pathao_areas;
DROP POLICY IF EXISTS "Public access to pathao_stores" ON public.pathao_stores;

-- Pathao tables: public read, authenticated write
CREATE POLICY "Anyone can read pathao_cities" ON public.pathao_cities FOR SELECT USING (true);
CREATE POLICY "Authenticated can manage pathao_cities" ON public.pathao_cities FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Anyone can read pathao_zones" ON public.pathao_zones FOR SELECT USING (true);
CREATE POLICY "Authenticated can manage pathao_zones" ON public.pathao_zones FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Anyone can read pathao_areas" ON public.pathao_areas FOR SELECT USING (true);
CREATE POLICY "Authenticated can manage pathao_areas" ON public.pathao_areas FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Anyone can read pathao_stores" ON public.pathao_stores FOR SELECT USING (true);
CREATE POLICY "Authenticated can manage pathao_stores" ON public.pathao_stores FOR ALL TO authenticated USING (true) WITH CHECK (true);