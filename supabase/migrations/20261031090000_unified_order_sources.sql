-- Task 4 (domain revamp, spec §2): the unified per-brand order source.
--
-- One row per real-world place/channel orders come from (Q20). At cutover
-- (Tasks 8/16) it absorbs stores, selling_points, brand_stores, storefronts,
-- showroom locations, and channel connectors. This migration is the expand
-- phase only: every legacy table keeps working; their ids land in legacy_*
-- audit columns for the later collapse.
--
-- Name note: the legacy 5-row manual-channel lookup occupied `order_sources`.
-- It is RENAMED (not dropped) to `legacy_order_channels` so its two existing
-- consumers keep working unchanged until Task 6 re-wires them, and its indexes
-- are renamed so this table can take the canonical name. Task 16 drops it.

ALTER TABLE public.order_sources RENAME TO legacy_order_channels;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'legacy_order_channels'
      AND indexname LIKE 'order_sources%'
  LOOP
    EXECUTE format('ALTER INDEX public.%I RENAME TO %I',
                   r.indexname,
                   replace(r.indexname, 'order_sources', 'legacy_order_channels'));
  END LOOP;
END $$;

CREATE TYPE public.order_source_type AS ENUM (
  'woocommerce', 'storefront', 'showroom', 'physical_store',
  'facebook', 'instagram', 'whatsapp', 'manual'
);
GRANT USAGE ON TYPE public.order_source_type TO authenticated, service_role;

CREATE TABLE public.order_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands (id) ON DELETE CASCADE,
  name text NOT NULL,
  type public.order_source_type NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  sync_direction text CHECK (sync_direction IN ('import', 'export', 'two_way')),
  last_sync_at timestamptz,
  last_sync_error text,
  is_stock_holding boolean, -- NULL = default by type (trigger below); Task 5 completes the stock model
  legacy_store_id uuid UNIQUE,
  legacy_selling_point_id uuid UNIQUE,
  legacy_brand_store_id uuid UNIQUE,
  legacy_storefront_id uuid UNIQUE,
  legacy_location_id uuid UNIQUE,
  legacy_connector_id uuid UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_sources_brand_name_key UNIQUE (brand_id, name)
);

-- Physical sources hold stock by default; digital ones never do unless the
-- toggle is set explicitly (Q12: physical stock-holding is a per-source toggle).
CREATE FUNCTION public.order_sources_stock_default() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF NEW.is_stock_holding IS NULL THEN
    NEW.is_stock_holding := NEW.type IN ('showroom', 'physical_store');
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER order_sources_stock_default
  BEFORE INSERT ON public.order_sources
  FOR EACH ROW EXECUTE FUNCTION public.order_sources_stock_default();

CREATE FUNCTION public.set_order_sources_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

CREATE TRIGGER set_order_sources_updated_at
  BEFORE UPDATE ON public.order_sources
  FOR EACH ROW EXECUTE FUNCTION public.set_order_sources_updated_at();

-- RLS mirrors brand_stores (a brand child): any account member reads;
-- owner/admin/member write; viewers are read-only; other businesses see nothing.
ALTER TABLE public.order_sources ENABLE ROW LEVEL SECURITY;

-- New local/cloud projects do not grant Data API table privileges implicitly.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_sources TO authenticated, service_role;

CREATE POLICY "Account members can read order sources"
  ON public.order_sources FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.brands brand
      JOIN public.user_business_access membership
        ON membership.business_id = brand.business_id
      WHERE brand.id = order_sources.brand_id
        AND membership.user_id = auth.uid()
    )
  );

CREATE POLICY "Account operators can write order sources"
  ON public.order_sources FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.brands brand
      JOIN public.user_business_access membership
        ON membership.business_id = brand.business_id
      WHERE brand.id = order_sources.brand_id
        AND membership.user_id = auth.uid()
        AND membership.role IN ('owner', 'admin', 'member')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.brands brand
      JOIN public.user_business_access membership
        ON membership.business_id = brand.business_id
      WHERE brand.id = order_sources.brand_id
        AND membership.user_id = auth.uid()
        AND membership.role IN ('owner', 'admin', 'member')
    )
  );

-- Provenance (spec §2 / Q22): every product and customer records where it
-- came from — which order source, and how (woo sync, CSV import, manual, POS,
-- legacy migration). Existing rows stay NULL until Task 8 backfills them.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS origin_order_source_id uuid
    REFERENCES public.order_sources (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS origin_kind text;
ALTER TABLE public.products
  ADD CONSTRAINT products_origin_kind_check
  CHECK (origin_kind IS NULL OR origin_kind IN ('woo_sync', 'csv', 'manual', 'pos', 'legacy'));

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS origin_order_source_id uuid
    REFERENCES public.order_sources (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS origin_kind text;
ALTER TABLE public.customers
  ADD CONSTRAINT customers_origin_kind_check
  CHECK (origin_kind IS NULL OR origin_kind IN ('woo_sync', 'csv', 'manual', 'pos', 'legacy'));

-- Every order attributes to a source (spec §2). Nullable and empty until
-- Task 8 backfills; old `orders.source` text dies at contract time (Task 16).
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS order_source_id uuid
    REFERENCES public.order_sources (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS order_sources_brand_id_idx ON public.order_sources (brand_id);
CREATE INDEX IF NOT EXISTS products_origin_order_source_id_idx ON public.products (origin_order_source_id);
CREATE INDEX IF NOT EXISTS customers_origin_order_source_id_idx ON public.customers (origin_order_source_id);
CREATE INDEX IF NOT EXISTS orders_order_source_id_idx ON public.orders (order_source_id);
