
-- 1. storefronts
CREATE TABLE public.storefronts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  store_id uuid,
  accent_hex text NOT NULL DEFAULT '#814037',
  theme text NOT NULL DEFAULT 'enveil',
  hero_title text DEFAULT '',
  hero_subtitle text DEFAULT '',
  hero_image_url text DEFAULT '',
  logo_url text DEFAULT '',
  favicon_url text DEFAULT '',
  about_md text DEFAULT '',
  contact_email text DEFAULT '',
  contact_phone text DEFAULT '',
  social jsonb NOT NULL DEFAULT '{}'::jsonb,
  policies jsonb NOT NULL DEFAULT '{}'::jsonb,
  currency text NOT NULL DEFAULT 'BDT',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.storefronts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read active storefronts"
  ON public.storefronts FOR SELECT TO anon, authenticated
  USING (is_active = true OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));

CREATE POLICY "Staff and admin can insert storefronts"
  ON public.storefronts FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));

CREATE POLICY "Staff and admin can update storefronts"
  ON public.storefronts FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));

CREATE POLICY "Admin can delete storefronts"
  ON public.storefronts FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_storefronts_updated_at
  BEFORE UPDATE ON public.storefronts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. storefront_products
CREATE TABLE public.storefront_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storefront_id uuid NOT NULL REFERENCES public.storefronts(id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  position integer NOT NULL DEFAULT 0,
  is_featured boolean NOT NULL DEFAULT false,
  badge text DEFAULT '',
  added_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (storefront_id, product_id)
);
CREATE INDEX idx_storefront_products_sf_pos ON public.storefront_products(storefront_id, position);
CREATE INDEX idx_storefront_products_product ON public.storefront_products(product_id);

ALTER TABLE public.storefront_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read storefront_products"
  ON public.storefront_products FOR SELECT TO anon, authenticated
  USING (true);
CREATE POLICY "Staff and admin can write storefront_products"
  ON public.storefront_products FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));
CREATE POLICY "Staff and admin can update storefront_products"
  ON public.storefront_products FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));
CREATE POLICY "Staff and admin can delete storefront_products"
  ON public.storefront_products FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));

-- 3. storefront_collections
CREATE TABLE public.storefront_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storefront_id uuid NOT NULL REFERENCES public.storefronts(id) ON DELETE CASCADE,
  slug text NOT NULL,
  title text NOT NULL,
  description text DEFAULT '',
  image_url text DEFAULT '',
  position integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (storefront_id, slug)
);
ALTER TABLE public.storefront_collections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can read storefront_collections"
  ON public.storefront_collections FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Staff and admin can write storefront_collections"
  ON public.storefront_collections FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));
CREATE POLICY "Staff and admin can update storefront_collections"
  ON public.storefront_collections FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));
CREATE POLICY "Staff and admin can delete storefront_collections"
  ON public.storefront_collections FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));
CREATE TRIGGER update_storefront_collections_updated_at
  BEFORE UPDATE ON public.storefront_collections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. storefront_collection_products
CREATE TABLE public.storefront_collection_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid NOT NULL REFERENCES public.storefront_collections(id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  position integer NOT NULL DEFAULT 0,
  UNIQUE (collection_id, product_id)
);
ALTER TABLE public.storefront_collection_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can read storefront_collection_products"
  ON public.storefront_collection_products FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Staff and admin can write storefront_collection_products"
  ON public.storefront_collection_products FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));
CREATE POLICY "Staff and admin can update storefront_collection_products"
  ON public.storefront_collection_products FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));
CREATE POLICY "Staff and admin can delete storefront_collection_products"
  ON public.storefront_collection_products FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));

-- 5. storefront_pages
CREATE TABLE public.storefront_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storefront_id uuid NOT NULL REFERENCES public.storefronts(id) ON DELETE CASCADE,
  slug text NOT NULL,
  title text NOT NULL,
  body_md text DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (storefront_id, slug)
);
ALTER TABLE public.storefront_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can read storefront_pages"
  ON public.storefront_pages FOR SELECT TO anon, authenticated
  USING (is_active = true OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));
CREATE POLICY "Staff and admin can write storefront_pages"
  ON public.storefront_pages FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));
CREATE POLICY "Staff and admin can update storefront_pages"
  ON public.storefront_pages FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));
CREATE POLICY "Staff and admin can delete storefront_pages"
  ON public.storefront_pages FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));
CREATE TRIGGER update_storefront_pages_updated_at
  BEFORE UPDATE ON public.storefront_pages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed Enveil + Vincent
INSERT INTO public.storefronts (slug, name, store_id, accent_hex, theme, hero_title, hero_subtitle, currency)
VALUES
  ('enveil', 'Enveil', '4f3e88d1-c592-48d9-ba0d-aa50a12e82fd', '#814037', 'enveil',
   'Quiet luxury, woven slow.', 'A considered wardrobe of warm, modern essentials — crafted in small editions.', 'BDT'),
  ('vincent', 'Vincent', '1e69bece-51f8-414c-ab8b-341702e008f5', '#000000', 'vincent',
   'Tailored for the night.', 'Sharp silhouettes in absolute monochrome. Made to be seen.', 'BDT');
