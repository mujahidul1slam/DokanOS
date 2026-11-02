-- ============================================================================
-- Storefront Phase 4 (P0 #4 + §7.2): Product persistent slug & SEO foundation
-- ============================================================================

-- 1. Add slug column to products
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS slug text;

-- 2. Backfill existing products with slug formula (§7.2)
DO $$
DECLARE
  r RECORD;
  v_base text;
  v_cand text;
  v_suffix int;
BEGIN
  FOR r IN SELECT id, name FROM public.products WHERE slug IS NULL OR slug = '' ORDER BY created_at ASC LOOP
    v_base := regexp_replace(lower(COALESCE(r.name, '')), '[^a-z0-9]+', '-', 'g');
    v_base := regexp_replace(v_base, '^-+|-+$', '', 'g');
    IF length(v_base) > 60 THEN
      v_base := substring(v_base from 1 for 60);
      v_base := regexp_replace(v_base, '-+$', '', 'g');
    END IF;

    IF v_base <> '' THEN
      v_cand := v_base || '-' || substring(r.id::text from 1 for 6);
    ELSE
      v_cand := substring(r.id::text from 1 for 8);
    END IF;

    v_suffix := 1;
    WHILE EXISTS (SELECT 1 FROM public.products WHERE slug = v_cand AND id <> r.id) LOOP
      v_suffix := v_suffix + 1;
      v_cand := v_cand || '-' || v_suffix::text;
    END LOOP;

    UPDATE public.products SET slug = v_cand WHERE id = r.id;
  END LOOP;
END $$;

-- 3. Unique index on products.slug
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_slug ON public.products(slug);

-- 4. BEFORE INSERT trigger for future products (Woo imports, POS creation)
CREATE OR REPLACE FUNCTION public.set_product_slug()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_base text;
  v_cand text;
  v_suffix int := 1;
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    v_base := regexp_replace(lower(COALESCE(NEW.name, '')), '[^a-z0-9]+', '-', 'g');
    v_base := regexp_replace(v_base, '^-+|-+$', '', 'g');
    IF length(v_base) > 60 THEN
      v_base := substring(v_base from 1 for 60);
      v_base := regexp_replace(v_base, '-+$', '', 'g');
    END IF;

    IF v_base <> '' THEN
      v_cand := v_base || '-' || substring(NEW.id::text from 1 for 6);
    ELSE
      v_cand := substring(NEW.id::text from 1 for 8);
    END IF;

    WHILE EXISTS (SELECT 1 FROM public.products WHERE slug = v_cand AND id <> NEW.id) LOOP
      v_suffix := v_suffix + 1;
      v_cand := v_cand || '-' || v_suffix::text;
    END LOOP;

    NEW.slug := v_cand;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_set_product_slug ON public.products;
CREATE TRIGGER trigger_set_product_slug
  BEFORE INSERT ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.set_product_slug();
