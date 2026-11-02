-- ============================================================================
-- SIGNUP-PLAN Task 1.7 — publish_my_storefront + delete_unprovisioned_self
-- Plus Task 1.6a hard dependency: unique partial index on brands(woo_store_id).
-- Plus disposable_email_domains seed.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. 1.6a Hard Dependency: Unique partial index on brands.woo_store_id
--    Prevents multiple brands linking to the same store, eliminating cross-tenant
--    store attachment / foreign storefront publish exploits.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_brands_woo_store_id_unique
  ON public.brands (woo_store_id)
  WHERE woo_store_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Seed disposable_email_domains
-- ---------------------------------------------------------------------------
INSERT INTO public.disposable_email_domains (domain) VALUES
  ('mailinator.com'),
  ('tempmail.com'),
  ('guerrillamail.com'),
  ('10minutemail.com'),
  ('throwawaymail.com'),
  ('yopmail.com'),
  ('sharklasers.com'),
  ('dispostable.com'),
  ('trashmail.com'),
  ('fakeinbox.com'),
  ('getairmail.com'),
  ('maildrop.cc'),
  ('temp-mail.org')
ON CONFLICT (domain) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. publish_my_storefront — caller-JWT, flip-only storefront publisher.
--    Membership assert = brand-join cross-checked via selling_points.
--    Rejects if >1 brand joins the store (or 0).
--    Sets ONLY is_active=true; writes site_opened audit on true flip.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.publish_my_storefront(p_storefront_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id      uuid;
  v_sf           record;
  v_brand_count  int;
  v_biz_id       uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: authentication required' USING ERRCODE = 'P0001';
  END IF;

  IF p_storefront_id IS NOT NULL THEN
    SELECT * INTO v_sf FROM public.storefronts WHERE id = p_storefront_id;
  ELSE
    SELECT s.* INTO v_sf
    FROM public.storefronts s
    JOIN public.selling_points sp ON sp.storefront_id = s.id
    JOIN public.user_business_access uba ON uba.business_id = sp.business_id
    WHERE uba.user_id = v_user_id AND uba.role IN ('owner', 'admin')
    ORDER BY s.created_at ASC
    LIMIT 1;
  END IF;

  IF v_sf.id IS NULL THEN
    RAISE EXCEPTION 'STOREFRONT_NOT_FOUND: no accessible storefront found' USING ERRCODE = 'P0001';
  END IF;

  IF v_sf.store_id IS NULL THEN
    RAISE EXCEPTION 'NO_STORE_LINK: storefront is not linked to a store' USING ERRCODE = 'P0001';
  END IF;

  -- Verify brand joins to the store
  SELECT count(DISTINCT b.id) INTO v_brand_count
  FROM public.brands b
  WHERE b.woo_store_id = v_sf.store_id;

  IF v_brand_count > 1 THEN
    RAISE EXCEPTION 'AMBIGUOUS_STORE_JOIN: multiple brands link to store' USING ERRCODE = 'P0001';
  END IF;
  IF v_brand_count = 0 THEN
    RAISE EXCEPTION 'NO_BRAND_LINK: store not linked to any brand' USING ERRCODE = 'P0001';
  END IF;

  -- Verify caller has owner/admin in the business owning the brand
  SELECT b.business_id INTO v_biz_id
  FROM public.brands b
  WHERE b.woo_store_id = v_sf.store_id
  LIMIT 1;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_business_access
    WHERE user_id = v_user_id AND business_id = v_biz_id AND role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: owner or admin role required' USING ERRCODE = 'P0001';
  END IF;

  -- Cross-check via transaction-owned selling_points storefront link
  IF NOT EXISTS (
    SELECT 1 FROM public.selling_points
    WHERE business_id = v_biz_id AND storefront_id = v_sf.id AND woo_store_id = v_sf.store_id
  ) THEN
    RAISE EXCEPTION 'STOREFRONT_NOT_ATTACHED: selling point link missing' USING ERRCODE = 'P0001';
  END IF;

  -- Flip-only: set ONLY is_active = true
  IF NOT v_sf.is_active THEN
    UPDATE public.storefronts
    SET is_active = true, updated_at = now()
    WHERE id = v_sf.id;

    INSERT INTO public.signup_events (event, user_id)
    VALUES ('site_opened', v_user_id);
  END IF;

  RETURN jsonb_build_object(
    'status', 'ok',
    'storefront_id', v_sf.id,
    'slug', v_sf.slug,
    'is_active', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.publish_my_storefront(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_my_storefront(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. delete_unprovisioned_self — caller-JWT, self-only account deletion
--    for typo recipients or gate-expiry restart.
--    Invariants: zero business memberships, zero store access, zero roles.
--    Rate limited: <= 3/h/actor.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_unprovisioned_self()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id   uuid;
  v_bucket    timestamptz;
  v_key       text;
  v_hit_count int;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: authentication required' USING ERRCODE = 'P0001';
  END IF;

  -- Rate limit: <= 3/h/actor
  v_bucket := date_trunc('hour', now());
  v_key := 'delete_self:' || v_user_id::text;
  INSERT INTO public.rate_limit_hits (key, bucket, count)
  VALUES (v_key, v_bucket, 1)
  ON CONFLICT (key, bucket) DO UPDATE
  SET count = public.rate_limit_hits.count + 1
  RETURNING count INTO v_hit_count;

  IF v_hit_count > 3 THEN
    RAISE EXCEPTION 'RATE_LIMITED: too many deletion attempts' USING ERRCODE = 'P0001';
  END IF;

  -- Invariant checks: must NOT have any tenant rows or roles
  IF EXISTS (SELECT 1 FROM public.user_business_access WHERE user_id = v_user_id) THEN
    RAISE EXCEPTION 'DELETE_DENIED_PROVISIONED: user has business memberships' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_store_access WHERE user_id = v_user_id) THEN
    RAISE EXCEPTION 'DELETE_DENIED_PROVISIONED: user has store access' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_user_id) THEN
    RAISE EXCEPTION 'DELETE_DENIED_ROLES: user has assigned roles' USING ERRCODE = 'P0001';
  END IF;

  -- Audit row: email explicitly NULL at insert per plan §4.2 / §9
  INSERT INTO public.signup_events (event, user_id, email)
  VALUES ('self_deleted_unprovisioned', v_user_id, NULL);

  -- Wipe non-tenant records
  DELETE FROM public.consent_records WHERE user_id = v_user_id;
  DELETE FROM public.user_permissions WHERE user_id = v_user_id;
  DELETE FROM public.profiles WHERE user_id = v_user_id;
  DELETE FROM auth.users WHERE id = v_user_id;

  RETURN jsonb_build_object('status', 'ok', 'deleted', true);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_unprovisioned_self() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_unprovisioned_self() TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. get_purge_candidates — returns users to purge (26h unconfirmed + 30d invitees)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_purge_candidates()
RETURNS TABLE (
  id uuid,
  reason text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  -- Unconfirmed self-signups older than 26 hours
  SELECT u.id, 'unconfirmed_26h'::text AS reason
  FROM auth.users u
  WHERE u.email_confirmed_at IS NULL
    AND u.invited_at IS NULL
    AND u.created_at < now() - interval '26 hours'

  UNION ALL

  -- Expired invitees older than 30 days (when ops toggle is enabled)
  SELECT u.id, 'invitee_30d'::text AS reason
  FROM auth.users u
  WHERE coalesce((SELECT value::text FROM public.app_config WHERE key = 'invitee_expiry_enabled'), 'true') = 'true'
    AND u.invited_at IS NOT NULL
    AND u.email_confirmed_at IS NULL
    AND u.invited_at < now() - interval '30 days';
$$;

REVOKE ALL ON FUNCTION public.get_purge_candidates() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_purge_candidates() TO service_role;

-- ---------------------------------------------------------------------------
-- 6. run_data_retention_cleanup — §9 retention limits:
--    - signup_events ip/ua scrubbed after 30d
--    - signup_events live rows deleted after 400d
--    - rate_limit_hits purged after 24h
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_data_retention_cleanup()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_scrubbed int;
  v_deleted_events int;
  v_deleted_hits int;
BEGIN
  -- 1. Scrub IP and UA after 30 days
  UPDATE public.signup_events
  SET ip = NULL, ua = NULL
  WHERE created_at < now() - interval '30 days'
    AND (ip IS NOT NULL OR ua IS NOT NULL);
  GET DIAGNOSTICS v_scrubbed = ROW_COUNT;

  -- 2. Delete live event rows older than 400 days
  DELETE FROM public.signup_events
  WHERE created_at < now() - interval '400 days';
  GET DIAGNOSTICS v_deleted_events = ROW_COUNT;

  -- 3. Delete rate limit hits older than 24 hours
  DELETE FROM public.rate_limit_hits
  WHERE bucket < now() - interval '24 hours';
  GET DIAGNOSTICS v_deleted_hits = ROW_COUNT;

  RETURN jsonb_build_object(
    'status', 'ok',
    'scrubbed_events_ip_ua', v_scrubbed,
    'deleted_events_400d', v_deleted_events,
    'deleted_rate_limits_24h', v_deleted_hits
  );
END;
$$;

REVOKE ALL ON FUNCTION public.run_data_retention_cleanup() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_data_retention_cleanup() TO service_role;

-- ---------------------------------------------------------------------------
-- 7. Verification function
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_signup_publish_and_delete_rpcs()
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'brands' AND indexname = 'idx_brands_woo_store_id_unique'
  ) THEN
    RAISE EXCEPTION 'verify: idx_brands_woo_store_id_unique missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'publish_my_storefront'
  ) THEN
    RAISE EXCEPTION 'verify: publish_my_storefront missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'delete_unprovisioned_self'
  ) THEN
    RAISE EXCEPTION 'verify: delete_unprovisioned_self missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_purge_candidates'
  ) THEN
    RAISE EXCEPTION 'verify: get_purge_candidates missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'run_data_retention_cleanup'
  ) THEN
    RAISE EXCEPTION 'verify: run_data_retention_cleanup missing';
  END IF;

  IF (SELECT count(*) FROM public.disposable_email_domains) = 0 THEN
    RAISE EXCEPTION 'verify: disposable_email_domains seed missing';
  END IF;

  RETURN jsonb_build_object(
    'status', 'ok',
    'unique_index', true,
    'publish_rpc', true,
    'delete_rpc', true,
    'purge_fns', true,
    'disposable_domains_count', (SELECT count(*) FROM public.disposable_email_domains)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.verify_signup_publish_and_delete_rpcs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_signup_publish_and_delete_rpcs() TO service_role, authenticated;

