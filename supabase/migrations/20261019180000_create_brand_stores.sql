-- Issue #12: physical and online stores belong to exactly one brand.
--
-- The existing public.stores table is the WooCommerce connector registry and
-- is intentionally left untouched. A customer-facing store is a new additive
-- row whose business account is derived from its parent brand at read/write
-- time. Creation needs only a name, parent brand and explicit type; it never
-- creates a brand, legacy Woo connection, storefront, address or integration,
-- and never publishes an online shop.
--
-- Legacy locations, selling points and Woo connections are not reinterpreted.
-- The nullable legacy_* references exist only so a separately reviewed
-- mapping can preserve its stable identifiers without mutating those rows.

CREATE TABLE public.brand_stores (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id                uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  name                    text NOT NULL,
  store_type              text NOT NULL
    CONSTRAINT brand_stores_explicit_type CHECK (store_type IN ('physical', 'online')),
  -- Publication is owned by the future storefront flow. This slice has no
  -- publish path, so a created store is always unpublished.
  is_published            boolean NOT NULL DEFAULT false
    CONSTRAINT brand_stores_unpublished_creation CHECK (is_published = false),
  -- Optional, reviewed compatibility references. NULL means no mapping.
  legacy_location_id      uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  legacy_selling_point_id uuid REFERENCES public.selling_points(id) ON DELETE SET NULL,
  legacy_woo_store_id     uuid REFERENCES public.stores(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_stores_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  CONSTRAINT brand_stores_brand_name_key UNIQUE (brand_id, name)
);

CREATE INDEX idx_brand_stores_brand ON public.brand_stores(brand_id);
CREATE INDEX idx_brand_stores_type ON public.brand_stores(store_type);

-- A reviewed legacy resource may be represented by at most one new store.
CREATE UNIQUE INDEX idx_brand_stores_legacy_location
  ON public.brand_stores(legacy_location_id)
  WHERE legacy_location_id IS NOT NULL;
CREATE UNIQUE INDEX idx_brand_stores_legacy_selling_point
  ON public.brand_stores(legacy_selling_point_id)
  WHERE legacy_selling_point_id IS NOT NULL;
CREATE UNIQUE INDEX idx_brand_stores_legacy_woo_store
  ON public.brand_stores(legacy_woo_store_id)
  WHERE legacy_woo_store_id IS NOT NULL;

CREATE TRIGGER set_brand_stores_updated_at
  BEFORE UPDATE ON public.brand_stores
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();

ALTER TABLE public.brand_stores ENABLE ROW LEVEL SECURITY;

-- New Supabase projects do not grant Data API table privileges implicitly.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_stores TO authenticated;

CREATE POLICY "Account members can read brand stores"
  ON public.brand_stores FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.brands brand
      JOIN public.user_business_access membership
        ON membership.business_id = brand.business_id
      WHERE brand.id = brand_stores.brand_id
        AND membership.user_id = auth.uid()
    )
  );

-- Policy expressions run with the caller's table privileges, and the
-- authenticated role has no grant on locations/selling_points. A definer
-- helper validates reviewed legacy links without widening those grants and
-- without letting a caller probe another account's legacy resources.
CREATE OR REPLACE FUNCTION public.brand_store_legacy_links_valid(
  p_brand_id         uuid,
  p_location_id      uuid,
  p_selling_point_id uuid,
  p_woo_store_id     uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id     uuid := auth.uid();
  v_business_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT brand.business_id INTO v_business_id
  FROM public.brands brand
  WHERE brand.id = p_brand_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF COALESCE(public.my_business_role(v_business_id, v_user_id), '')
           NOT IN ('owner', 'admin', 'member') THEN
    RETURN false;
  END IF;

  IF p_location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.locations legacy_location
    WHERE legacy_location.id = p_location_id
      AND legacy_location.business_id = v_business_id
  ) THEN
    RETURN false;
  END IF;

  IF p_selling_point_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.selling_points legacy_selling_point
    WHERE legacy_selling_point.id = p_selling_point_id
      AND legacy_selling_point.business_id = v_business_id
  ) THEN
    RETURN false;
  END IF;

  IF p_woo_store_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.brands legacy_brand
    WHERE legacy_brand.woo_store_id = p_woo_store_id
      AND legacy_brand.business_id = v_business_id
  ) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.brand_store_legacy_links_valid(uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_store_legacy_links_valid(uuid, uuid, uuid, uuid)
  TO authenticated;

CREATE POLICY "Account operators can write brand stores"
  ON public.brand_stores FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.brands brand
      JOIN public.user_business_access membership
        ON membership.business_id = brand.business_id
      WHERE brand.id = brand_stores.brand_id
        AND membership.user_id = auth.uid()
        AND membership.role IN ('owner', 'admin', 'member')
    )
  )
  WITH CHECK (
    (
      EXISTS (
        SELECT 1
        FROM public.brands brand
        JOIN public.user_business_access membership
          ON membership.business_id = brand.business_id
        WHERE brand.id = brand_stores.brand_id
          AND membership.user_id = auth.uid()
          AND membership.role IN ('owner', 'admin', 'member')
      )
    )
    AND is_published = false
    -- A reviewed legacy reference must belong to the parent brand's account.
    AND public.brand_store_legacy_links_valid(
      brand_id,
      legacy_location_id,
      legacy_selling_point_id,
      legacy_woo_store_id
    )
);

CREATE OR REPLACE FUNCTION public.create_brand_store(
  p_brand_id   uuid,
  p_name       text,
  p_store_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id     uuid := auth.uid();
  v_name        text;
  v_business_id uuid;
  v_store       public.brand_stores%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: authentication required' USING ERRCODE = '42501';
  END IF;

  -- Exactly one parent brand is accepted. Its account is the authority; a
  -- caller-supplied business id cannot widen or bypass that boundary.
  SELECT brand.business_id INTO v_business_id
  FROM public.brands brand
  WHERE brand.id = p_brand_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FORBIDDEN: authorized parent brand required' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(public.my_business_role(v_business_id, v_user_id), '')
           NOT IN ('owner', 'admin', 'member') THEN
    RAISE EXCEPTION 'FORBIDDEN: account owner or member role required'
      USING ERRCODE = '42501';
  END IF;

  v_name := btrim(coalesce(p_name, ''));
  IF v_name = '' OR length(v_name) > 100 THEN
    RAISE EXCEPTION 'STORE_INVALID_NAME: store name must be 1-100 characters'
      USING ERRCODE = '22023';
  END IF;

  IF p_store_type IS NULL OR p_store_type NOT IN ('physical', 'online') THEN
    RAISE EXCEPTION 'STORE_INVALID_TYPE: store type must be physical or online'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.brand_stores
    WHERE brand_id = p_brand_id AND name = v_name
  ) THEN
    RAISE EXCEPTION 'STORE_NAME_EXISTS: a store with this name already exists for the brand'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.brand_stores (brand_id, name, store_type)
  VALUES (p_brand_id, v_name, p_store_type)
  RETURNING * INTO v_store;

  INSERT INTO public.audit_log (user_id, user_email, action, entity_type, entity_id, details)
  VALUES (
    v_user_id,
    (SELECT email FROM auth.users WHERE id = v_user_id),
    'create_brand_store',
    'brand_store',
    v_store.id::text,
    jsonb_build_object(
      'business_id', v_business_id,
      'brand_id', p_brand_id,
      'name', v_store.name,
      'store_type', v_store.store_type,
      'is_published', v_store.is_published
    )
  );

  RETURN to_jsonb(v_store);
END;
$$;

REVOKE ALL ON FUNCTION public.create_brand_store(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_brand_store(uuid, text, text) TO authenticated;
