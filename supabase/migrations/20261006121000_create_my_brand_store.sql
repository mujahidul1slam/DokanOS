-- ============================================================================
-- R4a — create_my_brand_store(p_business_id uuid, p_name text)
-- Member-callable, single-transaction store + brand + access + INACTIVE
-- storefront creation for the onboarding wizard (audit §4 R4a, critiques #4/#6).
-- Plus the businesses.onboarding_completed_at marker column (D-09).
--
-- The three-column slug retry + storefront_domain check MOVED here from
-- signup_create_business_core (R1, 20261006120000, removed them there).
--
-- Authorization = the caller's UBA role ONLY (no admin/staff special-cases,
-- D-03). Rollback:
-- .planning/rollbacks/20261006121000_create_my_brand_store.md
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Onboarding-done marker (D-09): NULL = onboarding incomplete.
--    Writable by owner/admin via the existing "Owners can update businesses"
--    UPDATE policy (20260911000120:24-29); readable by members via the
--    "Members can read businesses" SELECT policy.
-- ---------------------------------------------------------------------------
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. create_my_brand_store — caller-JWT RPC (house idiom:
--    20260925140000:41-131). SECURITY DEFINER, search_path = '', auth.uid()
--    null check, role assert, REVOKE from PUBLIC/anon + GRANT to authenticated.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_my_brand_store(
  p_business_id uuid,
  p_name        text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id      uuid;
  v_name         text;
  v_slug_base    text;
  v_slug         text;
  v_attempt      int := 0;
  v_store_domain text;
  v_store_id     uuid;
  v_brand_id     uuid;
  v_sf_id        uuid;
  v_sf_slug      text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: authentication required' USING ERRCODE = 'P0001';
  END IF;

  -- Authorization: the caller's UBA role on THIS business is the ONLY gate
  -- (D-03 — no admin/staff special-case branches; platform admin/staff get
  -- the same answer as any other caller).
  IF NOT EXISTS (
    SELECT 1 FROM public.user_business_access
    WHERE user_id = v_user_id AND business_id = p_business_id AND role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: owner or admin role required' USING ERRCODE = 'P0001';
  END IF;

  -- Normalize the store name once (mirrors core 20260925120100:66-70)
  v_name := btrim(coalesce(p_name, ''));
  IF v_name = '' OR length(v_name) > 100 THEN
    RAISE EXCEPTION 'PROVISION_INVALID_NAME: store name must be 1-100 characters'
      USING ERRCODE = 'P0001';
  END IF;

  -- Slug candidate: same rules as the core (:74-79) EXCEPT the under-2-char
  -- fallback is the deterministic literal 'store' (the step-1 client preview
  -- must match the reserved server-side slug — no random suffix here).
  v_slug_base := lower(regexp_replace(trim(v_name), '[^a-zA-Z0-9]+', '-', 'g'));
  v_slug_base := btrim(v_slug_base, '-');
  IF length(v_slug_base) < 2 THEN
    v_slug_base := 'store';
  END IF;
  v_slug_base := left(v_slug_base, 60);

  -- storefront_domain check moved out of the core (:81-86)
  SELECT value #>> '{}' INTO v_store_domain
  FROM public.app_config WHERE key = 'storefront_domain';
  IF v_store_domain IS NULL OR v_store_domain = '' THEN
    RAISE EXCEPTION 'PROVISION_RETRYABLE: storefront_domain not configured'
      USING ERRCODE = 'P0001';
  END IF;

  -- Idempotency pre-check (declared single-store cap): a brand of this
  -- business already linked to a store makes this RPC a no-op — return the
  -- existing store/brand/storefront set. Keyed on the brand-with-store link,
  -- NOT on slug or name (RESEARCH Pitfall 2), so backfilled businesses never
  -- see the wizard or a duplicate row set.
  SELECT b.id, b.woo_store_id, b.slug INTO v_brand_id, v_store_id, v_slug
  FROM public.brands b
  WHERE b.business_id = p_business_id AND b.woo_store_id IS NOT NULL
  ORDER BY b.created_at ASC
  LIMIT 1;
  IF FOUND THEN
    SELECT s.id, s.slug INTO v_sf_id, v_sf_slug
    FROM public.storefronts s
    WHERE s.store_id = v_store_id
    ORDER BY s.created_at ASC
    LIMIT 1;
    RETURN jsonb_build_object(
      'store_id', v_store_id,
      'brand_id', v_brand_id,
      'storefront_id', v_sf_id,
      'slug', coalesce(v_sf_slug, v_slug)
    );
  END IF;

  -- ONE transaction: store → brand(linked) → caller's store access →
  -- INACTIVE storefront carrying the reserved slug. The candidate must clear
  -- ALL THREE unique slug columns — businesses is not inserted here, so its
  -- column is checked explicitly (RESEARCH Pitfall 3).
  LOOP
    v_attempt := v_attempt + 1;
    v_slug := CASE WHEN v_attempt = 1 THEN v_slug_base
                   ELSE left(v_slug_base, 55) || '-' || v_attempt::text END;

    BEGIN
      IF EXISTS (SELECT 1 FROM public.businesses WHERE slug = v_slug)
         OR EXISTS (SELECT 1 FROM public.brands WHERE slug = v_slug)
         OR EXISTS (SELECT 1 FROM public.storefronts WHERE slug = v_slug) THEN
        RAISE EXCEPTION 'slug collision' USING ERRCODE = '23505';
      END IF;

      INSERT INTO public.stores (name, url, status)
      VALUES (v_name, 'https://' || v_slug || '.' || v_store_domain, 'disconnected')
      RETURNING id INTO v_store_id;

      INSERT INTO public.brands (business_id, name, slug, woo_store_id)
      VALUES (p_business_id, v_name, v_slug, v_store_id)
      RETURNING id INTO v_brand_id;

      INSERT INTO public.user_store_access (user_id, store_id)
      VALUES (v_user_id, v_store_id);

      -- is_active defaults TRUE — must be passed explicitly false so the
      -- reserved placeholder never goes live before step-4 publish
      -- (RESEARCH Pitfall 1).
      INSERT INTO public.storefronts (name, store_id, slug, is_active)
      VALUES (v_name, v_store_id, v_slug, false)
      RETURNING id INTO v_sf_id;

      EXIT; -- success
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt >= 5 THEN
        RAISE EXCEPTION 'PROVISION_RETRYABLE: slug collision after 5 attempts'
          USING ERRCODE = 'P0001';
      END IF;
      -- nested block rolls back to its savepoint; retry with next candidate
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'store_id', v_store_id,
    'brand_id', v_brand_id,
    'storefront_id', v_sf_id,
    'slug', v_slug
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_my_brand_store(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_my_brand_store(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Verify migration (house verify-fn idiom, newest convention:
--    20260925120100:466-515 / 20260925140000:281-338)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_create_my_brand_store()
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'create_my_brand_store') THEN
    RAISE EXCEPTION 'verify: create_my_brand_store missing';
  END IF;

  -- must NOT be anon-executable (mirror verify_signup_fns:486-494)
  IF EXISTS (
    SELECT 1 FROM information_schema.role_routine_grants
    WHERE specific_schema = 'public'
      AND routine_name = 'create_my_brand_store'
      AND grantee = 'anon'
  ) THEN
    RAISE EXCEPTION 'verify: create_my_brand_store must not be anon-executable';
  END IF;

  -- must be authenticated-executable
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.role_routine_grants
    WHERE specific_schema = 'public'
      AND routine_name = 'create_my_brand_store'
      AND grantee = 'authenticated'
  ) THEN
    RAISE EXCEPTION 'verify: create_my_brand_store must be granted to authenticated';
  END IF;

  -- onboarding-done marker column exists
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'businesses'
                   AND column_name = 'onboarding_completed_at') THEN
    RAISE EXCEPTION 'verify: businesses.onboarding_completed_at missing';
  END IF;

  RETURN jsonb_build_object(
    'status', 'ok',
    'rpc', true,
    'granted_authenticated', true,
    'marker_column', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.verify_create_my_brand_store() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_create_my_brand_store() TO service_role, authenticated;
