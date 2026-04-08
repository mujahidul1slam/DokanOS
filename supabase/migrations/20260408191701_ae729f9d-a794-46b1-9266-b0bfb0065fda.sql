
-- Add inventory columns to products
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS manage_stock boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS stock_status text NOT NULL DEFAULT 'in_stock',
  ADD COLUMN IF NOT EXISTS backorders text NOT NULL DEFAULT 'no';

-- Product variations table
CREATE TABLE public.product_variations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  sku text,
  price numeric NOT NULL DEFAULT 0,
  manage_stock boolean NOT NULL DEFAULT true,
  stock_quantity integer NOT NULL DEFAULT 0,
  stock_status text NOT NULL DEFAULT 'in_stock',
  barcode text,
  attributes jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.product_variations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anonymous access to product_variations" ON public.product_variations FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage product_variations" ON public.product_variations FOR ALL TO authenticated USING (true) WITH CHECK (true);
