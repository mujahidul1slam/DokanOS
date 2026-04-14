
ALTER TABLE public.products
ADD COLUMN IF NOT EXISTS is_featured boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS sales_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_products_featured ON public.products (is_featured DESC, name);
CREATE INDEX IF NOT EXISTS idx_products_sales_count ON public.products (sales_count DESC);
