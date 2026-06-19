CREATE POLICY "Public can read active products" ON public.products FOR SELECT TO anon USING (is_active = true);
GRANT SELECT ON public.products TO anon;