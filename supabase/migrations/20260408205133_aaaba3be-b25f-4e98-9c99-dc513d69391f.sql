
-- Categories table with hierarchy
CREATE TABLE public.categories (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL DEFAULT '',
  woo_category_id bigint,
  parent_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  store_id uuid REFERENCES public.stores(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_categories_woo_store ON public.categories(woo_category_id, store_id) WHERE woo_category_id IS NOT NULL;

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anonymous access to categories" ON public.categories FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage categories" ON public.categories FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Junction table: product <-> category (many-to-many)
CREATE TABLE public.product_categories (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  UNIQUE(product_id, category_id)
);

ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anonymous access to product_categories" ON public.product_categories FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage product_categories" ON public.product_categories FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Add woo_variation_id to product_variations for sync
ALTER TABLE public.product_variations ADD COLUMN IF NOT EXISTS woo_variation_id bigint;
CREATE UNIQUE INDEX idx_variations_woo_product ON public.product_variations(woo_variation_id, product_id) WHERE woo_variation_id IS NOT NULL;
