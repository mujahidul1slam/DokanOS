-- ============================================================================
-- SIGNUP-PLAN Task 1.2 — provisioning RPCs + trigger patch + lookup fn
-- Per SIGNUP-PLAN.md §3/§3.1/§4 (FINAL v2.0) and SIGNUP-DISCOVERY.md §2.
-- Components:
--   canonical_email()                  — shared normalizer (ingest, gates, limits)
--   signup_create_business_core()      — THE shared provisioning transaction
--   provision_owner_business()         — sign-up entry (anchor-gated, service_role)
--   create_additional_business()       — switcher entry (member-gated, service_role)
--   get_auth_signup_state()            — unpaginated auth lookup (service_role)
--   handle_new_user patch              — owner-intent skips BOTH role branches
--   verify_signup_fns()                — repo verify-migration convention
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. canonical_email — lower/trim, strip +tag (all domains), strip dots (gmail)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.canonical_email(p_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT
    regexp_replace(split_part(lower(btrim(p_email)), '+', 1), '\.', '', 'g')
    || '@' ||
    CASE
      WHEN split_part(lower(btrim(p_email)), '@', 2) IN ('gmail.com', 'googlemail.com')
        THEN 'gmail.com'
      ELSE split_part(lower(btrim(p_email)), '@', 2)
    END
$$;

-- ---------------------------------------------------------------------------
-- 2. signup_create_business_core — THE single provisioning transaction body.
--    Called by both entry RPCs; the client NEVER inserts into tenant tables.
--    Gates + anchor + consent live in the entry fns; this is pure resource
--    creation: business + brand + location + store + storefront(inactive) +
--    parity rows + UBA('owner') + permission bundle + user_store_access(1).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.signup_create_business_core(
  p_user_id       uuid,
  p_business_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_name          text;
  v_slug_base     text;
  v_slug          text;
  v_attempt       int := 0;
  v_store_domain  text;
  v_store_id      uuid;
  v_brand_id      uuid;
  v_loc_id        uuid;
  v_sf_id         uuid;
  v_business_id   uuid;
  v_fb_src_exists boolean;
BEGIN
  -- Serialize all provisioning for this user (concurrent double-invoke safe)
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));

  -- Normalize the business name once (never trust client/anchor text)
  v_name := btrim(coalesce(p_business_name, ''));
  IF v_name = '' OR length(v_name) > 100 THEN
    RAISE EXCEPTION 'PROVISION_INVALID_NAME: business name must be 1-100 characters'
      USING ERRCODE = 'P0001';
  END IF;

  -- Slug candidate: same rules as src/lib/slug.ts (lower, hyphenated);
  -- fallback store-<4 random> when the name strips to nothing (Bengali/emoji).
  v_slug_base := lower(regexp_replace(trim(v_name), '[^a-zA-Z0-9]+', '-', 'g'));
  v_slug_base := btrim(v_slug_base, '-');
  IF length(v_slug_base) < 2 THEN
    v_slug_base := 'store-' || substr(md5(random()::text), 1, 4);
  END IF;
  v_slug_base := left(v_slug_base, 60);

  SELECT value #>> '{}' INTO v_store_domain
  FROM public.app_config WHERE key = 'storefront_domain';
  IF v_store_domain IS NULL OR v_store_domain = '' THEN
    RAISE EXCEPTION 'PROVISION_RETRYABLE: storefront_domain not configured'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.order_sources WHERE name = 'fb/ig')
    INTO v_fb_src_exists;

  -- Slug-collision retry across ALL THREE unique slug columns
  -- (businesses.slug, brands.slug, storefronts.slug share one candidate set).
  LOOP
    v_attempt := v_attempt + 1;
    v_slug := CASE WHEN v_attempt = 1 THEN v_slug_base
                   ELSE left(v_slug_base, 55) || '-' || v_attempt::text END;

    BEGIN
      INSERT INTO public.businesses (name, slug)
      VALUES (v_name, v_slug)
      RETURNING id INTO v_business_id;

      INSERT INTO public.stores (name, url, status)
      VALUES (v_name, 'https://' || v_slug || '.' || v_store_domain, 'disconnected')
      RETURNING id INTO v_store_id;

      INSERT INTO public.brands (business_id, name, slug, woo_store_id)
      VALUES (v_business_id, v_name, v_slug, v_store_id)
      RETURNING id INTO v_brand_id;

      INSERT INTO public.locations (business_id, name, type, is_default)
      VALUES (v_business_id, 'Main', 'showroom', true)
      RETURNING id INTO v_loc_id;

      INSERT INTO public.storefronts (name, store_id, slug, is_active)
      VALUES (v_name, v_store_id, v_slug, false)
      RETURNING id INTO v_sf_id;

      -- Parity rows = exactly what 20260904000100 §§5–7 produces per
      -- brand-with-store, statuses adjusted to 'disconnected'.
      INSERT INTO public.selling_points (business_id, brand_id, name, type, location_id, is_default)
      VALUES (v_business_id, v_brand_id, 'Showroom POS', 'showroom_pos', v_loc_id, true);

      INSERT INTO public.selling_points (business_id, brand_id, name, type, woo_store_id)
      VALUES (v_business_id, v_brand_id, v_name || ' WooCommerce', 'woocommerce', v_store_id);

      IF v_fb_src_exists THEN
        INSERT INTO public.selling_points (business_id, brand_id, name, type)
        VALUES (v_business_id, v_brand_id, 'Facebook / Instagram', 'facebook');
      END IF;

      INSERT INTO public.selling_points (business_id, brand_id, name, type, woo_store_id, storefront_id)
      VALUES (v_business_id, v_brand_id, v_name || ' Storefront', 'dokanos_storefront', v_store_id, v_sf_id);

      INSERT INTO public.connectors (business_id, brand_id, category, type, name, status, config)
      VALUES (v_business_id, v_brand_id, 'channel', 'woocommerce', v_name,
              'disconnected', jsonb_build_object('store_id', v_store_id));

      INSERT INTO public.product_sources (business_id, brand_id, name, type, status, sync_direction)
      VALUES (v_business_id, v_brand_id, 'WooCommerce catalog', 'woocommerce', 'disconnected', 'two_way');

      INSERT INTO public.customer_sources (business_id, brand_id, name, type, status, sync_direction)
      VALUES (v_business_id, v_brand_id, 'WooCommerce customers', 'woocommerce', 'disconnected', 'import');

      EXIT; -- success
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt >= 5 THEN
        RAISE EXCEPTION 'PROVISION_RETRYABLE: slug collision after 5 attempts'
          USING ERRCODE = 'P0001';
      END IF;
      -- nested block rolls back to its savepoint; retry with next candidate
    END;
  END LOOP;

  -- Owner membership (never a global user_roles row)
  INSERT INTO public.user_business_access (user_id, business_id, role)
  VALUES (p_user_id, v_business_id, 'owner');

  -- Permission bundle (global-scope per user; idempotent re-grant).
  -- 31 keys per SIGNUP-DISCOVERY.md §2 — excludes settings.manage,
  -- integrations.manage, stores.manage, team.manage.
  INSERT INTO public.user_permissions (user_id, permission)
  VALUES
    (p_user_id, 'dashboard.view'),
    (p_user_id, 'orders.view'),
    (p_user_id, 'orders.create'),
    (p_user_id, 'orders.edit'),
    (p_user_id, 'orders.delete'),
    (p_user_id, 'orders.change_status'),
    (p_user_id, 'orders.dispatch'),
    (p_user_id, 'orders.refund'),
    (p_user_id, 'orders.log_payment'),
    (p_user_id, 'orders.discount_large'),
    (p_user_id, 'preorders.view'),
    (p_user_id, 'preorders.manage'),
    (p_user_id, 'customers.view'),
    (p_user_id, 'customers.edit'),
    (p_user_id, 'customers.delete'),
    (p_user_id, 'products.view'),
    (p_user_id, 'products.create'),
    (p_user_id, 'products.edit'),
    (p_user_id, 'products.delete'),
    (p_user_id, 'products.view_cost'),
    (p_user_id, 'products.edit_cost'),
    (p_user_id, 'pos.use'),
    (p_user_id, 'pos.discount_large'),
    (p_user_id, 'pos.refund'),
    (p_user_id, 'pos.shift_close'),
    (p_user_id, 'analytics.view'),
    (p_user_id, 'analytics.view_revenue'),
    (p_user_id, 'integrations.view'),
    (p_user_id, 'stores.view'),
    (p_user_id, 'settings.view'),
    (p_user_id, 'team.view'),
    (p_user_id, 'audit.view')
  ON CONFLICT (user_id, permission) DO NOTHING;

  -- Store access: exactly 1 row (fail-open semantics resolved by 1.6b policies)
  INSERT INTO public.user_store_access (user_id, store_id)
  VALUES (p_user_id, v_store_id);

  -- Post-insert assertions
  IF NOT EXISTS (SELECT 1 FROM public.user_business_access
                 WHERE user_id = p_user_id AND business_id = v_business_id) THEN
    RAISE EXCEPTION 'PROVISION_RETRYABLE: owner membership assertion failed'
      USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_store_access
                 WHERE user_id = p_user_id AND store_id = v_store_id) THEN
    RAISE EXCEPTION 'PROVISION_RETRYABLE: store access assertion failed'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object('slug', v_slug, 'business_id', v_business_id);
END;
$$;

REVOKE ALL ON FUNCTION public.signup_create_business_core(uuid, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. provision_owner_business — SIGN-UP entry point.
--    Called by the signup-provision edge fn via service key AFTER the gateway
--    verified the user JWT (user id extracted there).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.provision_owner_business(
  p_user_id uuid,
  p_nonce   text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user      record;
  v_anchor    record;
  v_existing  record;
  v_result    jsonb;
BEGIN
  SELECT * INTO v_user FROM auth.users WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROVISION_NO_USER: no such user' USING ERRCODE = 'P0001';
  END IF;

  -- Idempotent: already provisioned → return the existing business
  SELECT b.slug, b.id INTO v_existing
  FROM public.user_business_access a
  JOIN public.businesses b ON b.id = a.business_id
  WHERE a.user_id = p_user_id AND a.role = 'owner'
  ORDER BY b.created_at LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('slug', v_existing.slug, 'business_id', v_existing.id);
  END IF;

  IF v_user.email_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'PROVISION_UNCONFIRMED: email not confirmed' USING ERRCODE = 'P0001';
  END IF;
  IF v_user.created_at < now() - interval '24 hours' THEN
    RAISE EXCEPTION 'PROVISION_EXPIRED: account older than 24h' USING ERRCODE = 'P0001';
  END IF;
  IF coalesce(v_user.raw_app_meta_data->>'provider', '') <> 'email' THEN
    RAISE EXCEPTION 'PROVISION_CHANNEL: non-email provider' USING ERRCODE = 'P0001';
  END IF;
  IF v_user.invited_at IS NOT NULL THEN
    RAISE EXCEPTION 'PROVISION_CHANNEL: invited accounts use the invite flow' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.disposable_email_domains
    WHERE domain = split_part(lower(btrim(v_user.email)), '@', 2)
  ) THEN
    RAISE EXCEPTION 'PROVISION_BLOCKED_DOMAIN: disposable email domains are not accepted'
      USING ERRCODE = 'P0001';
  END IF;

  -- Server-anchored signup record: canonical email match + client-body nonce +
  -- freshness window. raw_user_meta_data is NEVER an authorization input (§1).
  SELECT * INTO v_anchor
  FROM public.signup_events
  WHERE event = 'signup_started'
    AND coalesce(meta->>'consumed', 'false') <> 'true'
    AND public.canonical_email(email) = public.canonical_email(v_user.email)
    AND meta->>'nonce' = coalesce(p_nonce, '')
    AND created_at >= now() - interval '24 hours'
    AND created_at >= v_user.created_at - interval '2 minutes'
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROVISION_NO_ANCHOR: no valid signup anchor for this account'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.disposable_email_domains
    WHERE domain = split_part(coalesce(v_anchor.email, ''), '@', 2)
  ) THEN
    RAISE EXCEPTION 'PROVISION_BLOCKED_DOMAIN: disposable email domains are not accepted'
      USING ERRCODE = 'P0001';
  END IF;

  v_result := public.signup_create_business_core(p_user_id, v_anchor.meta->>'business_name');

  -- Consent: written ONCE, by this RPC, from the anchored record.
  -- accepted_at = acceptance time (anchor), ip/ua = acceptance-time actor.
  INSERT INTO public.consent_records (user_id, doc, version, accepted_at, ip, ua)
  VALUES (p_user_id, 'tos', coalesce(v_anchor.meta->>'tos_version', 'v1.0'),
          v_anchor.created_at, v_anchor.ip, v_anchor.ua)
  ON CONFLICT (user_id, doc) DO NOTHING;

  INSERT INTO public.consent_records (user_id, doc, version, accepted_at, ip, ua)
  VALUES (p_user_id, 'privacy', coalesce(v_anchor.meta->>'privacy_version', 'v1.0'),
          v_anchor.created_at, v_anchor.ip, v_anchor.ua)
  ON CONFLICT (user_id, doc) DO NOTHING;

  -- Audit + consume the anchor
  INSERT INTO public.signup_events (email, event, user_id, ip, ua)
  VALUES (public.canonical_email(v_user.email), 'provisioned', p_user_id,
          v_anchor.ip, v_anchor.ua);

  UPDATE public.signup_events
  SET meta = jsonb_set(meta, '{consumed}', 'true'::jsonb)
  WHERE id = v_anchor.id;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.provision_owner_business(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_owner_business(uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. create_additional_business — SWITCHER entry point (post-signup).
--    Called by the create-business edge fn via service key.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_additional_business(
  p_user_id       uuid,
  p_business_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user   record;
  v_result jsonb;
BEGIN
  SELECT * INTO v_user FROM auth.users WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROVISION_NO_USER: no such user' USING ERRCODE = 'P0001';
  END IF;
  IF v_user.email_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'PROVISION_UNCONFIRMED: email not confirmed' USING ERRCODE = 'P0001';
  END IF;

  -- Must already be a provisioned member (≥1 UBA row).
  -- Sign-up-specific gates (anchor/nonce/provider/24h) intentionally absent.
  IF NOT EXISTS (SELECT 1 FROM public.user_business_access WHERE user_id = p_user_id) THEN
    RAISE EXCEPTION 'PROVISION_NOT_MEMBER: complete your account setup first'
      USING ERRCODE = 'P0001';
  END IF;

  v_result := public.signup_create_business_core(p_user_id, p_business_name);

  INSERT INTO public.signup_events (event, user_id)
  VALUES ('business_added', p_user_id);

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.create_additional_business(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_additional_business(uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. get_auth_signup_state — unpaginated auth lookup (replaces listUsers scans).
--    Canonical-normalized comparison on both sides; may return multiple rows
--    (gmail dot-variants); the caller rejects on >1 and dispatches with the
--    STORED email only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_auth_signup_state(p_email text)
RETURNS TABLE (
  id                uuid,
  email             text,
  email_confirmed_at timestamptz,
  invited_at        timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.id, u.email, u.email_confirmed_at, u.invited_at
  FROM auth.users u
  WHERE public.canonical_email(u.email) = public.canonical_email(btrim(p_email))
$$;

REVOKE ALL ON FUNCTION public.get_auth_signup_state(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_auth_signup_state(text) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. handle_new_user patch (§3.1): owner-intent signup skips BOTH role
--    branches (invitation-consume + first-user-admin). Everything else
--    byte-compatible with 20260412161413 (the only definition of this fn).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_count INT;
  invitation_role app_role;
  v_pending_invite boolean;
BEGIN
  -- SIGNUP-PLAN §3.1: self-serve owner signup ⇒ profile only, no roles.
  IF coalesce(NEW.raw_user_meta_data->>'signup_intent', '') = 'owner' THEN
    INSERT INTO public.profiles (user_id, full_name)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));

    SELECT EXISTS (
      SELECT 1 FROM public.invitations
      WHERE email = NEW.email AND accepted_at IS NULL
    ) INTO v_pending_invite;

    IF v_pending_invite THEN
      INSERT INTO public.signup_events (email, event, user_id)
      VALUES (lower(NEW.email), 'owner_signup_trigger_skipped_invite', NEW.id);
    END IF;

    RETURN NEW;
  END IF;

  -- Create profile (unchanged)
  INSERT INTO public.profiles (user_id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));

  -- Check if there's an invitation for this email (unchanged)
  SELECT role INTO invitation_role
  FROM public.invitations
  WHERE email = NEW.email AND accepted_at IS NULL
  LIMIT 1;

  IF invitation_role IS NOT NULL THEN
    -- Use invited role (unchanged)
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, invitation_role);
    UPDATE public.invitations SET accepted_at = now() WHERE email = NEW.email AND accepted_at IS NULL;
  ELSE
    -- First user gets admin, others get no role (unchanged)
    SELECT COUNT(*) INTO user_count FROM auth.users;
    IF user_count <= 1 THEN
      INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Verify migration
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_signup_fns()
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- all five fns exist
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname='public' AND p.proname='canonical_email')
    OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname='public' AND p.proname='signup_create_business_core')
    OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname='public' AND p.proname='provision_owner_business')
    OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname='public' AND p.proname='create_additional_business')
    OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname='public' AND p.proname='get_auth_signup_state') THEN
    RAISE EXCEPTION 'verify_signup_fns: missing function';
  END IF;

  -- provision_owner_business must NOT be executable by anon/authenticated
  IF EXISTS (
    SELECT 1 FROM information_schema.role_routine_grants
    WHERE specific_schema = 'public'
      AND routine_name = 'provision_owner_business'
      AND grantee IN ('anon', 'authenticated')
  ) THEN
    RAISE EXCEPTION 'verify_signup_fns: provision_owner_business must be service_role-only';
  END IF;

  -- canonical_email sanity
  IF public.canonical_email('A.B+x@GMAIL.com') <> 'ab@gmail.com' THEN
    RAISE EXCEPTION 'verify_signup_fns: canonical_email logic broken';
  END IF;

  -- handle_new_user trigger still wired
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    WHERE c.relname = 'users' AND c.relnamespace = 'auth'::regnamespace
      AND t.tgname = 'on_auth_user_created' AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'verify_signup_fns: on_auth_user_created trigger missing';
  END IF;

  RETURN jsonb_build_object('status', 'ok', 'fns', 5, 'trigger_patched', true);
END;
$$;

REVOKE ALL ON FUNCTION public.verify_signup_fns() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_signup_fns() TO service_role, authenticated;
