-- Task 5 (domain revamp, spec §3): warehouses and the stock-holder model.
--
-- Stock holders = warehouses (stock-only) + order sources with is_stock_holding
-- (Q12). product_locations grows two holder columns; exactly one holder per row
-- (legacy location_id stays valid until Task 16 contracts it away). The stock
-- aggregate (sync_product_stock_from_locations) already sums ALL product rows
-- regardless of holder, so warehouse/source stock rolls up unchanged.
--
-- order_sources gains the fulfillment controls (Q13): ship_from_store toggle
-- and an ordered fulfillment_preference holder-id list.
--
-- Transfers v1 (Q14): one line per transfer (product, variation, quantity)
-- between two distinct holders of one brand. Applying the movement to
-- product_locations is Task 7's action; this migration is schema only.

-- ---------------------------------------------------------------------------
-- warehouses — brand-level stock-only locations
-- ---------------------------------------------------------------------------
CREATE TABLE public.warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands (id) ON DELETE CASCADE,
  name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  address text,
  city text,
  zone text,
  area text,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT warehouses_brand_name_key UNIQUE (brand_id, name)
);

CREATE TRIGGER set_warehouses_updated_at
  BEFORE UPDATE ON public.warehouses
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();

ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;

-- New local/cloud projects do not grant Data API table privileges implicitly.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.warehouses TO authenticated, service_role;

CREATE POLICY "Account members can read warehouses"
  ON public.warehouses FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.brands brand
      JOIN public.user_business_access membership
        ON membership.business_id = brand.business_id
      WHERE brand.id = warehouses.brand_id
        AND membership.user_id = auth.uid()
    )
  );

CREATE POLICY "Account operators can write warehouses"
  ON public.warehouses FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.brands brand
      JOIN public.user_business_access membership
        ON membership.business_id = brand.business_id
      WHERE brand.id = warehouses.brand_id
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
      WHERE brand.id = warehouses.brand_id
        AND membership.user_id = auth.uid()
        AND membership.role IN ('owner', 'admin', 'member')
    )
  );

-- ---------------------------------------------------------------------------
-- order_sources: fulfillment controls (Q13)
-- ---------------------------------------------------------------------------
ALTER TABLE public.order_sources
  ADD COLUMN IF NOT EXISTS ship_from_store boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fulfillment_preference jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.order_sources
  ADD CONSTRAINT order_sources_fulfillment_array
  CHECK (jsonb_typeof(fulfillment_preference) = 'array');

-- ---------------------------------------------------------------------------
-- product_locations: the holder columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.product_locations
  ALTER COLUMN location_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS warehouse_id uuid
    REFERENCES public.warehouses (id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS stock_holder_order_source_id uuid
    REFERENCES public.order_sources (id) ON DELETE CASCADE;

-- Exactly one holder per row: legacy location, warehouse, or stock-holding
-- order source. Rewritten to the two-way form when location_id dies (Task 16).
ALTER TABLE public.product_locations
  ADD CONSTRAINT product_locations_one_holder CHECK (
    (location_id IS NOT NULL)::int
    + (warehouse_id IS NOT NULL)::int
    + (stock_holder_order_source_id IS NOT NULL)::int = 1
  );

-- Siblings of idx_product_locations_unique for the new holder kinds.
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_locations_unique_warehouse
  ON public.product_locations (
    product_id,
    COALESCE(variation_id, '00000000-0000-0000-0000-000000000000'::uuid),
    warehouse_id
  )
  WHERE warehouse_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_locations_unique_source
  ON public.product_locations (
    product_id,
    COALESCE(variation_id, '00000000-0000-0000-0000-000000000000'::uuid),
    stock_holder_order_source_id
  )
  WHERE stock_holder_order_source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_product_locations_warehouse
  ON public.product_locations (warehouse_id);
CREATE INDEX IF NOT EXISTS idx_product_locations_source
  ON public.product_locations (stock_holder_order_source_id);

-- Only stock-holding order sources may hold rows (Q12: digital sources never
-- hold stock; the toggle is the per-source switch).
CREATE FUNCTION public.product_locations_stock_holder_valid() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF NEW.stock_holder_order_source_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.order_sources s
       WHERE s.id = NEW.stock_holder_order_source_id
         AND s.is_stock_holding IS TRUE
     ) THEN
    RAISE EXCEPTION 'order source % is not a stock holder',
      NEW.stock_holder_order_source_id USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER product_locations_stock_holder_valid
  BEFORE INSERT OR UPDATE ON public.product_locations
  FOR EACH ROW EXECUTE FUNCTION public.product_locations_stock_holder_valid();

-- ---------------------------------------------------------------------------
-- stock_transfers — simple holder→holder movements (one line per transfer)
-- ---------------------------------------------------------------------------
CREATE TABLE public.stock_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands (id) ON DELETE CASCADE,
  from_warehouse_id uuid REFERENCES public.warehouses (id) ON DELETE CASCADE,
  from_order_source_id uuid REFERENCES public.order_sources (id) ON DELETE CASCADE,
  to_warehouse_id uuid REFERENCES public.warehouses (id) ON DELETE CASCADE,
  to_order_source_id uuid REFERENCES public.order_sources (id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  variation_id uuid REFERENCES public.product_variations (id) ON DELETE CASCADE,
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  status text NOT NULL DEFAULT 'completed'
    CHECK (status IN ('pending', 'completed', 'cancelled')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_transfers_one_from CHECK (
    (from_warehouse_id IS NOT NULL)::int
    + (from_order_source_id IS NOT NULL)::int = 1
  ),
  CONSTRAINT stock_transfers_one_to CHECK (
    (to_warehouse_id IS NOT NULL)::int
    + (to_order_source_id IS NOT NULL)::int = 1
  ),
  CONSTRAINT stock_transfers_distinct_endpoints CHECK (
    NOT (from_warehouse_id IS NOT NULL AND from_warehouse_id = to_warehouse_id)
    AND NOT (from_order_source_id IS NOT NULL AND from_order_source_id = to_order_source_id)
  )
);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_brand ON public.stock_transfers (brand_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_product ON public.stock_transfers (product_id);

CREATE TRIGGER set_stock_transfers_updated_at
  BEFORE UPDATE ON public.stock_transfers
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();

ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_transfers TO authenticated, service_role;

CREATE POLICY "Account members can read stock transfers"
  ON public.stock_transfers FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.brands brand
      JOIN public.user_business_access membership
        ON membership.business_id = brand.business_id
      WHERE brand.id = stock_transfers.brand_id
        AND membership.user_id = auth.uid()
    )
  );

CREATE POLICY "Account operators can write stock transfers"
  ON public.stock_transfers FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.brands brand
      JOIN public.user_business_access membership
        ON membership.business_id = brand.business_id
      WHERE brand.id = stock_transfers.brand_id
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
      WHERE brand.id = stock_transfers.brand_id
        AND membership.user_id = auth.uid()
        AND membership.role IN ('owner', 'admin', 'member')
    )
  );
