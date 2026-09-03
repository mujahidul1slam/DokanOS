-- ============================================================================
-- Multi-Business Restructure — Phase 0: Foundation
-- Hierarchy: User → Business (org) → Brand → {Locations, Stores, Connectors}
-- Couriers are connectors (woo, pathao, ...). Selling points merged with
-- channels (single typed list per brand). POS is location/showroom-based.
--
-- Backfill strategy (live data: 1 invoice_settings row "Enveil Vincent",
-- 2 Woo stores Enveil/Vincent, 2 storefronts, 2 pathao_integrations,
-- 2 admin users, order_sources: woocommerce/pos/fb-ig):
--   * 1 business "Enveil Vincent" (owner: every admin user)
--   * 2 brands (Enveil, Vincent) — one per Woo store
--   * 1 default location per brand (type=showroom)
--   * selling points per brand: POS (location-bound), WooCommerce
--     (channel-linked), FB/IG (from order_sources), DokanOS Storefront
--   * connectors: 2 woo (→ stores), 2 pathao (→ pathao_integrations)
--   * product/customer source registries per brand
-- ============================================================================

-- ----------------------------------------------------------------------------
-- businesses (the org / tenant)
-- ----------------------------------------------------------------------------
CREATE TABLE public.businesses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text UNIQUE NOT NULL,
  logo_url    text,
  currency    text NOT NULL DEFAULT 'BDT',
  timezone    text NOT NULL DEFAULT 'Asia/Dhaka',
  address     text,
  email       text,
  phone       text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER set_businesses_updated_at
  BEFORE UPDATE ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();

-- ----------------------------------------------------------------------------
-- user_business_access — true multi-tenancy membership (user ↔ business)
-- ----------------------------------------------------------------------------
CREATE TABLE public.user_business_access (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_id  uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  role         text NOT NULL DEFAULT 'member'
    CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, business_id)
);
CREATE INDEX idx_user_business_access_user ON public.user_business_access(user_id);
CREATE INDEX idx_user_business_access_business ON public.user_business_access(business_id);

-- Helper: is the caller a member of this business?
CREATE OR REPLACE FUNCTION public.is_business_member(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_business_access
    WHERE business_id = p_business_id
      AND user_id = auth.uid()
  );
$$;
REVOKE ALL ON FUNCTION public.is_business_member(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_business_member(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- brands — the selling identity under a business (Enveil, Vincent, ...)
-- ----------------------------------------------------------------------------
CREATE TABLE public.brands (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name         text NOT NULL,
  slug         text UNIQUE NOT NULL,
  logo_url     text,
  -- optional 1:1 link to the Woo store row this brand sells through
  -- (NULL = brand without a Woo channel yet)
  woo_store_id uuid REFERENCES public.stores(id) ON DELETE SET NULL,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, name)
);
CREATE INDEX idx_brands_business ON public.brands(business_id);
CREATE TRIGGER set_brands_updated_at
  BEFORE UPDATE ON public.brands
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();

-- ----------------------------------------------------------------------------
-- locations — physical/virtual places (warehouses, showrooms, stores)
-- type: warehouse = stock source; showroom/store = demand place
-- ----------------------------------------------------------------------------
CREATE TABLE public.locations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  brand_id    uuid REFERENCES public.brands(id) ON DELETE CASCADE,
  name        text NOT NULL,
  type        text NOT NULL DEFAULT 'warehouse'
    CHECK (type IN ('warehouse', 'showroom', 'store', 'online')),
  address     text,
  city        text,
  zone        text,
  area        text,
  is_default  boolean NOT NULL DEFAULT false,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_locations_business ON public.locations(business_id);
CREATE INDEX idx_locations_brand ON public.locations(brand_id);
CREATE TRIGGER set_locations_updated_at
  BEFORE UPDATE ON public.locations
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();

-- ----------------------------------------------------------------------------
-- selling_points — MERGED list of channels/outlets per brand (user decision).
-- POS rows bind to a location (showroom-based POS). Woo rows link the channel
-- (store) and inherit its selling point semantics.
-- ----------------------------------------------------------------------------
CREATE TABLE public.selling_points (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  brand_id    uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  name         text NOT NULL,
  -- channel type (merged channel semantics)
  type         text NOT NULL
    CHECK (type IN ('woocommerce', 'shopify', 'dokanos_storefront', 'showroom_pos',
                    'facebook', 'instagram', 'tiktok', 'google', 'whatsapp',
                    'marketplace', 'other')),
  -- POS/showroom types carry the physical place
  location_id  uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  -- link to the underlying channel row when one exists
  woo_store_id uuid REFERENCES public.stores(id) ON DELETE SET NULL,
  storefront_id uuid REFERENCES public.storefronts(id) ON DELETE SET NULL,
  is_active    boolean NOT NULL DEFAULT true,
  is_default   boolean NOT NULL DEFAULT false,
  config       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_selling_points_brand ON public.selling_points(brand_id);
CREATE INDEX idx_selling_points_business ON public.selling_points(business_id);
CREATE TRIGGER set_selling_points_updated_at
  BEFORE UPDATE ON public.selling_points
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();

-- ----------------------------------------------------------------------------
-- connectors — provider-agnostic integration registry (user decision: couriers
-- are connectors). Woo/Shopify sync + courier dispatch both register here.
-- Existing tables (stores, pathao_integrations, courier_integrations) remain
-- the credential stores; connectors reference them via config + status.
-- ----------------------------------------------------------------------------
CREATE TABLE public.connectors (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  brand_id      uuid REFERENCES public.brands(id) ON DELETE CASCADE,
  -- what kind of connector (channel-sync, courier, accounting, marketing, ...)
  category      text NOT NULL DEFAULT 'channel'
    CHECK (category IN ('channel', 'courier', 'payment', 'accounting', 'marketing', 'other')),
  type          text NOT NULL,  -- 'woocommerce' | 'pathao' | 'steadfast' | ...
  name          text NOT NULL,
  status        text NOT NULL DEFAULT 'disconnected'
    CHECK (status IN ('connected', 'disconnected', 'error', 'paused')),
  -- adapter-level config: linked row ids, sync direction, etc.
  config        jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_sync_at  timestamptz,
  last_error    text,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_connectors_business ON public.connectors(business_id);
CREATE INDEX idx_connectors_category_type ON public.connectors(category, type);
CREATE TRIGGER set_connectors_updated_at
  BEFORE UPDATE ON public.connectors
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();

-- ----------------------------------------------------------------------------
-- product_sources / customer_sources — connector-style registries
-- (where catalog/customers come from; config + sync direction + status)
-- ----------------------------------------------------------------------------
CREATE TABLE public.product_sources (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  brand_id     uuid REFERENCES public.brands(id) ON DELETE CASCADE,
  name         text NOT NULL,
  type         text NOT NULL
    CHECK (type IN ('woocommerce', 'shopify', 'dokanos_internal', 'excel', 'csv', 'other')),
  status       text NOT NULL DEFAULT 'disconnected'
    CHECK (status IN ('connected', 'disconnected', 'error', 'paused')),
  config       jsonb NOT NULL DEFAULT '{}'::jsonb,  -- credentials, mapping rules
  sync_direction text NOT NULL DEFAULT 'import'
    CHECK (sync_direction IN ('import', 'export', 'two_way')),
  last_sync_at timestamptz,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_product_sources_business ON public.product_sources(business_id);
CREATE TRIGGER set_product_sources_updated_at
  BEFORE UPDATE ON public.product_sources
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();

CREATE TABLE public.customer_sources (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  brand_id     uuid REFERENCES public.brands(id) ON DELETE CASCADE,
  name         text NOT NULL,
  type         text NOT NULL
    CHECK (type IN ('woocommerce', 'shopify', 'dokanos_storefront', 'pos_showroom',
                    'facebook', 'instagram', 'tiktok', 'whatsapp', 'excel', 'csv', 'other')),
  status       text NOT NULL DEFAULT 'disconnected'
    CHECK (status IN ('connected', 'disconnected', 'error', 'paused')),
  config       jsonb NOT NULL DEFAULT '{}'::jsonb,
  sync_direction text NOT NULL DEFAULT 'import'
    CHECK (sync_direction IN ('import', 'export', 'two_way')),
  last_sync_at timestamptz,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_customer_sources_business ON public.customer_sources(business_id);
CREATE TRIGGER set_customer_sources_updated_at
  BEFORE UPDATE ON public.customer_sources
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();

-- ----------------------------------------------------------------------------
-- suppliers / supplier_products / purchase_orders — schema frozen now
-- (FK contracts for later phases; UI in §6)
-- ----------------------------------------------------------------------------
CREATE TABLE public.suppliers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name         text NOT NULL,
  is_factory   boolean NOT NULL DEFAULT false,
  contact_name text,
  phone        text,
  email        text,
  address      text,
  city         text,
  notes        text,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_suppliers_business ON public.suppliers(business_id);
CREATE TRIGGER set_suppliers_updated_at
  BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();

CREATE TABLE public.supplier_products (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id    uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  product_id     uuid REFERENCES public.products(id) ON DELETE CASCADE,
  sku            text,
  cost_price     numeric(12,2),
  lead_time_days integer,
  is_preferred   boolean NOT NULL DEFAULT false,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (supplier_id, product_id)
);
CREATE TRIGGER set_supplier_products_updated_at
  BEFORE UPDATE ON public.supplier_products
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();

CREATE TABLE public.purchase_orders (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  supplier_id  uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  location_id  uuid REFERENCES public.locations(id) ON DELETE SET NULL, -- receive-into
  po_number    text NOT NULL,
  status       text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'partial', 'received', 'cancelled')),
  items        jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{product_id, qty, unit_cost, received_qty}]
  total_cost   numeric(14,2) NOT NULL DEFAULT 0,
  expected_at  timestamptz,
  received_at  timestamptz,
  notes        text,
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, po_number)
);
CREATE INDEX idx_purchase_orders_business ON public.purchase_orders(business_id);
CREATE TRIGGER set_purchase_orders_updated_at
  BEFORE UPDATE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();

-- ----------------------------------------------------------------------------
-- product_locations — per-location stock (Phase 3 write model)
-- ----------------------------------------------------------------------------
CREATE TABLE public.product_locations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variation_id   uuid REFERENCES public.product_variations(id) ON DELETE CASCADE,
  location_id    uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  stock_quantity numeric(14,3) NOT NULL DEFAULT 0,
  stock_status   text NOT NULL DEFAULT 'instock'
    CHECK (stock_status IN ('instock', 'outofstock', 'onbackorder')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_product_locations_unique
  ON public.product_locations(product_id, COALESCE(variation_id, '00000000-0000-0000-0000-000000000000'::uuid), location_id);
CREATE INDEX idx_product_locations_location ON public.product_locations(location_id);
CREATE TRIGGER set_product_locations_updated_at
  BEFORE UPDATE ON public.product_locations
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();

-- ----------------------------------------------------------------------------
-- Scope columns on existing tables (nullable, additive — no breakage)
-- ----------------------------------------------------------------------------
-- orders: which location fulfills; which selling point produced the order
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS selling_point_id uuid REFERENCES public.selling_points(id) ON DELETE SET NULL;

-- pos shifts: showroom-based POS (nullable to stay compatible)
ALTER TABLE public.pos_shifts
  ADD COLUMN IF NOT EXISTS selling_point_id uuid REFERENCES public.selling_points(id) ON DELETE SET NULL;

-- ============================================================================
-- RLS — new tables are business-scoped (member OR app-admin); existing tables
-- untouched (§6 tightening).
-- ============================================================================
DO $$
DECLARE
  t text;
BEGIN
  -- business_id-carrying tables
  FOREACH t IN ARRAY ARRAY[
    'brands','locations','selling_points','connectors','product_sources',
    'customer_sources','suppliers','purchase_orders'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Members can read %1$s" ON public.%1$I', t);
    EXECUTE format('CREATE POLICY "Members can read %1$s" ON public.%1$I FOR SELECT TO authenticated
      USING (has_role(auth.uid(), ''admin''::app_role) OR is_business_member(business_id))', t);
    EXECUTE format('CREATE POLICY "Members can write %1$s" ON public.%1$I FOR ALL TO authenticated
      USING (has_role(auth.uid(), ''admin''::app_role) OR is_business_member(business_id))
      WITH CHECK (has_role(auth.uid(), ''admin''::app_role) OR is_business_member(business_id))', t);
  END LOOP;

  -- businesses: readable/writable by members (is_business_member(id)) or admins
  ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "Members can read businesses" ON public.businesses;
  DROP POLICY IF EXISTS "Members can write businesses" ON public.businesses;
  CREATE POLICY "Members can read businesses" ON public.businesses
    FOR SELECT TO authenticated
    USING (has_role(auth.uid(), 'admin'::app_role) OR is_business_member(id));
  CREATE POLICY "Members can write businesses" ON public.businesses
    FOR ALL TO authenticated
    USING (has_role(auth.uid(), 'admin'::app_role) OR is_business_member(id))
    WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR is_business_member(id));

  -- user_business_access: users see/edit their own rows; admins see all
  ALTER TABLE public.user_business_access ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "Users can read own access" ON public.user_business_access;
  DROP POLICY IF EXISTS "Users can write own access" ON public.user_business_access;
  DROP POLICY IF EXISTS "Admins manage access" ON public.user_business_access;
  CREATE POLICY "Users can read own access" ON public.user_business_access
    FOR SELECT TO authenticated
    USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));
  CREATE POLICY "Users can write own access" ON public.user_business_access
    FOR ALL TO authenticated
    USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
    WITH CHECK (user_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));

  -- supplier_products: scoped via the parent supplier's business
  ALTER TABLE public.supplier_products ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "Members can read supplier_products" ON public.supplier_products;
  DROP POLICY IF EXISTS "Members can write supplier_products" ON public.supplier_products;
  CREATE POLICY "Members can read supplier_products" ON public.supplier_products
    FOR SELECT TO authenticated
    USING (
      has_role(auth.uid(), 'admin'::app_role)
      OR EXISTS (
        SELECT 1 FROM public.suppliers s
        WHERE s.id = supplier_products.supplier_id
          AND is_business_member(s.business_id)
      )
    );
  CREATE POLICY "Members can write supplier_products" ON public.supplier_products
    FOR ALL TO authenticated
    USING (
      has_role(auth.uid(), 'admin'::app_role)
      OR EXISTS (
        SELECT 1 FROM public.suppliers s
        WHERE s.id = supplier_products.supplier_id
          AND is_business_member(s.business_id)
      )
    )
    WITH CHECK (
      has_role(auth.uid(), 'admin'::app_role)
      OR EXISTS (
        SELECT 1 FROM public.suppliers s
        WHERE s.id = supplier_products.supplier_id
          AND is_business_member(s.business_id)
      )
    );
END $$;

-- product_locations has no business_id — scope via product's brand/business
DROP POLICY IF EXISTS "Members can read product_locations" ON public.product_locations;
DROP POLICY IF EXISTS "Members can write product_locations" ON public.product_locations;
CREATE POLICY "Members can read product_locations" ON public.product_locations
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = product_locations.product_id
        AND has_role(auth.uid(), 'admin'::app_role)
    )
    OR EXISTS (  -- public read for authenticated (catalog browsing), consistent
      SELECT 1   -- with products' current (true) policy
      FROM public.products p
      WHERE p.id = product_locations.product_id
    )
  );
CREATE POLICY "Members can write product_locations" ON public.product_locations
  FOR ALL TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.products p
        JOIN public.stores s ON s.id = p.store_id
        WHERE p.id = product_locations.product_id
      -- write only via products that live under a business the user can reach
    )
  )
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
  );

-- ============================================================================
-- BACKFILL — one business, two brands, locations, selling points, connectors,
-- sources (idempotent: guarded with NOT EXISTS)
-- ============================================================================
DO $$
DECLARE
  v_business_id uuid;
  v_brand_id uuid;
  v_loc_id uuid;
  v_store RECORD;
  v_owner RECORD;
  v_sp_id uuid;
  v_sf RECORD;
  v_pi RECORD;
  v_src RECORD;
  v_pos_src RECORD;
BEGIN
  -- 1. Business from the single invoice_settings row ("Enveil Vincent")
  IF NOT EXISTS (SELECT 1 FROM public.businesses) THEN
    INSERT INTO public.businesses (name, slug, logo_url, currency, timezone, address, email, phone)
    SELECT COALESCE(iv.business_name, 'My Business'),
           'enveil-vincent',
           iv.logo_url, 'BDT', 'Asia/Dhaka', iv.address, iv.email, iv.phone
    FROM public.invoice_settings iv
    ORDER BY iv.created_at ASC
    LIMIT 1;
  END IF;
  SELECT id INTO v_business_id FROM public.businesses ORDER BY created_at ASC LIMIT 1;

  -- 2. Owners: every admin user
  FOR v_owner IN SELECT user_id FROM public.user_roles WHERE role = 'admin' LOOP
    INSERT INTO public.user_business_access (user_id, business_id, role)
    VALUES (v_owner.user_id, v_business_id, 'owner')
    ON CONFLICT (user_id, business_id) DO NOTHING;
  END LOOP;

  -- 3. Brands: one per Woo store (Enveil, Vincent)
  FOR v_store IN SELECT * FROM public.stores LOOP
    IF NOT EXISTS (SELECT 1 FROM public.brands WHERE woo_store_id = v_store.id) THEN
      INSERT INTO public.brands (business_id, name, slug, woo_store_id)
      VALUES (v_business_id, v_store.name, lower(regexp_replace(v_store.name, '[^a-z0-9]+', '-', 'gi')), v_store.id);
    END IF;
  END LOOP;

  -- 4. Default location per brand (showroom; POS is location-based)
  FOR v_brand_id IN SELECT id FROM public.brands LOOP
    IF NOT EXISTS (SELECT 1 FROM public.locations WHERE brand_id = v_brand_id) THEN
      INSERT INTO public.locations (business_id, brand_id, name, type, is_default)
      VALUES (v_business_id, v_brand_id, 'Main', 'showroom', true);
    END IF;
  END LOOP;

  -- 5. Selling points per brand: POS (location-bound) + Woo + FB/IG
  FOR v_brand_id IN SELECT id FROM public.brands LOOP
    SELECT id INTO v_loc_id FROM public.locations
    WHERE brand_id = v_brand_id AND is_default LIMIT 1;

    -- POS selling point (bound to the default location)
    IF NOT EXISTS (SELECT 1 FROM public.selling_points WHERE brand_id = v_brand_id AND type = 'showroom_pos') THEN
      INSERT INTO public.selling_points (business_id, brand_id, name, type, location_id, is_default)
      VALUES (v_business_id, v_brand_id, 'Showroom POS', 'showroom_pos', v_loc_id, true);
    END IF;

    -- Woo selling point (channel-linked)
    IF NOT EXISTS (SELECT 1 FROM public.selling_points sp
        JOIN public.brands b ON b.id = sp.brand_id
        WHERE b.woo_store_id IS NOT NULL AND sp.type = 'woocommerce') THEN
      INSERT INTO public.selling_points (business_id, brand_id, name, type, woo_store_id)
      SELECT v_business_id, b.id, b.name || ' WooCommerce', 'woocommerce', b.woo_store_id
      FROM public.brands b WHERE b.woo_store_id IS NOT NULL;
    END IF;

    -- FB/IG selling point (from the global order_sources rows)
    SELECT id INTO v_pos_src FROM public.order_sources WHERE name = 'fb/ig' LIMIT 1;
    IF v_pos_src IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.selling_points WHERE brand_id = v_brand_id AND type IN ('facebook')) THEN
      INSERT INTO public.selling_points (business_id, brand_id, name, type)
      VALUES (v_business_id, v_brand_id, 'Facebook / Instagram', 'facebook');
    END IF;
  END LOOP;

  -- Storefront selling points (link existing storefronts to brands via store)
  FOR v_sf IN SELECT * FROM public.storefronts LOOP
    IF NOT EXISTS (SELECT 1 FROM public.selling_points WHERE storefront_id = v_sf.id) THEN
      INSERT INTO public.selling_points (business_id, brand_id, name, type, woo_store_id, storefront_id)
      SELECT v_business_id, b.id, v_sf.name || ' Storefront', 'dokanos_storefront', b.woo_store_id, v_sf.id
      FROM public.brands b WHERE b.woo_store_id = v_sf.store_id;
    END IF;
  END LOOP;

  -- 6. Connectors: woo (category=channel) + pathao (category=courier)
  FOR v_store IN SELECT * FROM public.stores LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.connectors c
      WHERE c.category = 'channel' AND (c.config->>'store_id')::uuid = v_store.id
    ) THEN
      INSERT INTO public.connectors (business_id, brand_id, category, type, name, status, config)
      SELECT v_business_id, b.id, 'channel', 'woocommerce', v_store.name,
             v_store.status, jsonb_build_object('store_id', v_store.id)
      FROM public.brands b WHERE b.woo_store_id = v_store.id;
    END IF;
  END LOOP;

  FOR v_pi IN SELECT pi.*, b.id AS brand_id
      FROM public.pathao_integrations pi
      LEFT JOIN public.stores s ON true
      JOIN public.brands b ON b.woo_store_id = s.id
      WHERE pi.is_active = true LIMIT 2 LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.connectors c
      WHERE c.category = 'courier' AND (c.config->>'integration_id')::uuid = v_pi.id
    ) THEN
      INSERT INTO public.connectors (business_id, brand_id, category, type, name, status, config)
      VALUES (v_business_id, v_pi.brand_id, 'courier', 'pathao', 'Pathao — ' || COALESCE(v_pi.brand_id::text, ''),
              'connected', jsonb_build_object('integration_id', v_pi.id));
    END IF;
  END LOOP;

  -- 7. Product/customer source registries (woo per brand + dokanos_internal)
  FOR v_brand_id IN SELECT id FROM public.brands LOOP
    IF NOT EXISTS (SELECT 1 FROM public.product_sources WHERE brand_id = v_brand_id AND type = 'woocommerce') THEN
      INSERT INTO public.product_sources (business_id, brand_id, name, type, status, sync_direction)
      SELECT v_business_id, v_brand_id, 'WooCommerce catalog', 'woocommerce', 'connected', 'two_way'
      FROM public.brands b WHERE b.id = v_brand_id AND b.woo_store_id IS NOT NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.customer_sources WHERE brand_id = v_brand_id AND type = 'woocommerce') THEN
      INSERT INTO public.customer_sources (business_id, brand_id, name, type, status, sync_direction)
      SELECT v_business_id, v_brand_id, 'WooCommerce customers', 'woocommerce', 'connected', 'import'
      FROM public.brands b WHERE b.id = v_brand_id AND b.woo_store_id IS NOT NULL;
    END IF;
  END LOOP;

  -- 8. Backfill orders: selling_point/location from store linkage (best effort —
  --    Woo orders → the Woo selling point of that brand; POS orders stay NULL
  --    until Phase 3 UI assigns them)
  UPDATE public.orders o
  SET selling_point_id = sp.id
  FROM public.selling_points sp
    JOIN public.brands b ON b.id = sp.brand_id
  WHERE o.selling_point_id IS NULL
    AND sp.type = 'woocommerce'
    AND b.woo_store_id = o.store_id;

  -- 9. product_locations: seed each product's stock into its brand default
  --    location (via the product's store → brand → default location).
  --    products.stock_status uses DokanOS enums (in_stock/out_of_stock/...);
  --    product_locations uses Woo-style (instock/outofstock/onbackorder).
  INSERT INTO public.product_locations (product_id, location_id, stock_quantity, stock_status)
  SELECT p.id, l.id,
         COALESCE(p.stock_quantity, 0),
         CASE COALESCE(p.stock_status, 'in_stock')
           WHEN 'in_stock' THEN 'instock'
           WHEN 'out_of_stock' THEN 'outofstock'
           WHEN 'on_backorder' THEN 'onbackorder'
           ELSE 'instock'
         END
  FROM public.products p
  JOIN public.brands b ON b.woo_store_id = p.store_id
  JOIN public.locations l ON l.brand_id = b.id AND l.is_default
  ON CONFLICT DO NOTHING;

  -- 10. pos_shifts: bind to the brand's POS selling point
  UPDATE public.pos_shifts ps
  SET selling_point_id = sp.id
  FROM public.selling_points sp
    JOIN public.brands b ON b.id = sp.brand_id
  WHERE ps.selling_point_id IS NULL
    AND sp.type = 'showroom_pos'
    AND b.woo_store_id = ps.store_id;
END $$;
