
CREATE POLICY "Allow anonymous access to stores" ON public.stores FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow anonymous access to products" ON public.products FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow anonymous access to orders" ON public.orders FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow anonymous access to order_items" ON public.order_items FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow anonymous access to customers" ON public.customers FOR ALL TO anon USING (true) WITH CHECK (true);
