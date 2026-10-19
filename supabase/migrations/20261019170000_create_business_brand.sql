-- Issue #11: brands are independent children of a business account.
--
-- Minimal creation needs only a name and the caller's authorized account
-- context. It never creates a store, storefront, selling point, or onboarding
-- marker. Owners/admins and account-wide operational members may create and
-- list brands; viewers remain read-only. A forged parent business is rejected
-- with the same insufficient-privilege SQLSTATE as a nonmember.

-- Replace the legacy global-admin SELECT/write predicates with account-membership
-- checks. Viewers may read their account's brands but cannot write directly.
DROP POLICY IF EXISTS "Members can write brands" ON public.brands;
DROP POLICY IF EXISTS "Members can read brands" ON public.brands;
DROP POLICY IF EXISTS "Account operators can write brands" ON public.brands;
-- New local/cloud projects do not grant Data API table privileges implicitly.
-- RLS remains the authority for which rows each role may touch.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brands TO authenticated;

CREATE POLICY "Account members can read brands"
  ON public.brands FOR SELECT TO authenticated
  USING (public.my_business_role(business_id, auth.uid()) IN ('owner', 'admin', 'member', 'viewer'));

CREATE POLICY "Account operators can write brands"
  ON public.brands FOR ALL TO authenticated
  USING (
    public.my_business_role(business_id, auth.uid()) IN ('owner', 'admin', 'member')
  )
  WITH CHECK (
    public.my_business_role(business_id, auth.uid()) IN ('owner', 'admin', 'member')
  );

CREATE OR REPLACE FUNCTION public.create_business_brand(
  p_business_id uuid,
  p_name        text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id   uuid := auth.uid();
  v_name      text;
  v_slug_base text;
  v_slug      text;
  v_attempt   int := 0;
  v_brand     public.brands%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: authentication required' USING ERRCODE = '42501';
  END IF;

  -- The business id is a parent, never an authority claim by itself. Only the
  -- caller's current membership in that exact account can authorize creation.
  IF COALESCE(public.my_business_role(p_business_id, v_user_id), '')
       NOT IN ('owner', 'admin', 'member') THEN
    RAISE EXCEPTION 'FORBIDDEN: account owner or member role required'
      USING ERRCODE = '42501';
  END IF;

  v_name := btrim(coalesce(p_name, ''));
  IF v_name = '' OR length(v_name) > 100 THEN
    RAISE EXCEPTION 'BRAND_INVALID_NAME: brand name must be 1-100 characters'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.brands
    WHERE business_id = p_business_id AND name = v_name
  ) THEN
    RAISE EXCEPTION 'BRAND_NAME_EXISTS: a brand with this name already exists'
      USING ERRCODE = '23505';
  END IF;

  v_slug_base := lower(regexp_replace(v_name, '[^a-zA-Z0-9]+', '-', 'g'));
  v_slug_base := btrim(v_slug_base, '-');
  IF length(v_slug_base) < 2 THEN
    v_slug_base := 'brand-' || substr(md5(random()::text), 1, 4);
  END IF;
  v_slug_base := left(v_slug_base, 60);

  LOOP
    v_attempt := v_attempt + 1;
    v_slug := CASE WHEN v_attempt = 1 THEN v_slug_base
                   ELSE left(v_slug_base, 55) || '-' || v_attempt::text END;

    BEGIN
      -- Slugs share the public namespace with business/storefront routes.
      IF EXISTS (SELECT 1 FROM public.businesses WHERE slug = v_slug)
         OR EXISTS (SELECT 1 FROM public.brands WHERE slug = v_slug)
         OR EXISTS (SELECT 1 FROM public.storefronts WHERE slug = v_slug) THEN
        RAISE EXCEPTION 'slug collision' USING ERRCODE = '23505';
      END IF;

      INSERT INTO public.brands (business_id, name, slug)
      VALUES (p_business_id, v_name, v_slug)
      RETURNING * INTO v_brand;

      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt >= 5 THEN
        RAISE EXCEPTION 'BRAND_RETRYABLE: slug collision after 5 attempts'
          USING ERRCODE = '23505';
      END IF;
    END;
  END LOOP;

  -- #8 audit trail: record only the created brand's identity, no store data.
  INSERT INTO public.audit_log (user_id, user_email, action, entity_type, entity_id, details)
  VALUES (
    v_user_id,
    (SELECT email FROM auth.users WHERE id = v_user_id),
    'create_brand',
    'brand',
    v_brand.id::text,
    jsonb_build_object(
      'business_id', p_business_id,
      'name', v_brand.name,
      'slug', v_brand.slug
    )
  );

  RETURN to_jsonb(v_brand);
END;
$$;

REVOKE ALL ON FUNCTION public.create_business_brand(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_business_brand(uuid, text) TO authenticated;
