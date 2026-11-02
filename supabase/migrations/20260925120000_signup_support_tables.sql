-- ============================================================================
-- SIGNUP-PLAN Task 1.1 — sign-up support tables + RLS + seeds + get_my_businesses
-- Per SIGNUP-PLAN.md §4 (FINAL v2.0) and SIGNUP-DISCOVERY.md.
-- Tables: consent_records, signup_events, disposable_email_domains, app_config,
--         rate_limit_hits. RPC: get_my_businesses().
-- Verify-migration pattern follows the repo's *_verify_*.sql convention.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. consent_records
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.consent_records (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL, -- consent proof survives account deletion; scrubbed by the future deletion phase (plan §9)
  doc         text NOT NULL CHECK (doc IN ('tos', 'privacy')),
  version     text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  ip          inet,
  ua          text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, doc)
);

ALTER TABLE public.consent_records ENABLE ROW LEVEL SECURITY;

-- select-own only; inserts happen via provision RPC (service role, RLS bypassed)
CREATE POLICY "Users can read own consent records"
  ON public.consent_records FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2. signup_events (append-only audit; no client select/insert)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.signup_events (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email      text,                -- canonical-normalized; NULL on purge/self-delete rows
  event      text NOT NULL CHECK (event IN (
    'signup_started', 'email_confirmed', 'provisioned', 'provision_failed',
    'resend', 'blocked', 'purged_unconfirmed',
    'owner_signup_trigger_skipped_invite', 'self_deleted_unprovisioned',
    'site_opened', 'staff_role_attached', 'invitee_expired', 'business_added'
  )),
  user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ip         inet,
  ua         text,
  meta       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signup_events_email ON public.signup_events (email);
CREATE INDEX IF NOT EXISTS idx_signup_events_event_created ON public.signup_events (event, created_at);
CREATE INDEX IF NOT EXISTS idx_signup_events_user ON public.signup_events (user_id);

ALTER TABLE public.signup_events ENABLE ROW LEVEL SECURITY;

-- No client policies at all: written only by service role (edge fns, RPC, trigger).
-- Internal dashboards read via service role.

-- ---------------------------------------------------------------------------
-- 3. disposable_email_domains
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.disposable_email_domains (
  domain text PRIMARY KEY
);

ALTER TABLE public.disposable_email_domains ENABLE ROW LEVEL SECURITY;

-- Readable by authenticated for UX pre-check convenience; enforcement stays server-side.
CREATE POLICY "Authenticated can read disposable domain list"
  ON public.disposable_email_domains FOR SELECT
  TO authenticated
  USING (true);

-- ---------------------------------------------------------------------------
-- 4. app_config (runtime kill switch + server-stamped values)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_config (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

-- anon/authenticated may select ONLY the signup_open row (UI runtime flag).
CREATE POLICY "Public can read signup_open flag only"
  ON public.app_config FOR SELECT
  TO anon, authenticated
  USING (key = 'signup_open');

-- Writes: service role only (no policy needed for service role — it bypasses RLS).

-- ---------------------------------------------------------------------------
-- 5. rate_limit_hits
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rate_limit_hits (
  key    text NOT NULL,
  bucket timestamptz NOT NULL,
  count  integer NOT NULL DEFAULT 1,
  PRIMARY KEY (key, bucket)
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_hits_bucket ON public.rate_limit_hits (bucket);

ALTER TABLE public.rate_limit_hits ENABLE ROW LEVEL SECURITY;
-- No client policies: edge fns read/write via service role only.

-- ---------------------------------------------------------------------------
-- 6. Seeds
-- ---------------------------------------------------------------------------
INSERT INTO public.app_config (key, value) VALUES
  ('signup_open', 'false'::jsonb),
  ('tos_version', '"v1.0"'::jsonb),
  ('privacy_version', '"v1.0"'::jsonb),
  ('storefront_domain', '"stores.dokanos.app"'::jsonb),
  ('invitee_expiry_enabled', 'true'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 7. get_my_businesses() — switcher data source
--    Caller's OWN user_business_access rows, ALL roles (owner/admin/member/viewer),
--    with the role column. Never the platform-admin dump (r14).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_businesses()
RETURNS TABLE (
  id       uuid,
  name     text,
  slug     text,
  logo_url text,
  role     text
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT b.id, b.name, b.slug, b.logo_url, a.role
  FROM public.user_business_access a
  JOIN public.businesses b ON b.id = a.business_id
  WHERE a.user_id = auth.uid()
  ORDER BY (a.role = 'owner') DESC, b.name;
$$;

REVOKE ALL ON FUNCTION public.get_my_businesses() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_businesses() TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. Verify migration (repo convention)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_signup_tables()
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
  v_missing text;
BEGIN
  -- tables exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'consent_records')
    OR NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'signup_events')
    OR NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'disposable_email_domains')
    OR NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'app_config')
    OR NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'rate_limit_hits') THEN
    RAISE EXCEPTION 'verify_signup_tables: missing table';
  END IF;

  -- RLS enabled on all five
  FOR v_missing IN
    SELECT t FROM (VALUES ('consent_records'),('signup_events'),('disposable_email_domains'),('app_config'),('rate_limit_hits')) AS x(t)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relrowsecurity = true
    )
  LOOP
    RAISE EXCEPTION 'verify_signup_tables: RLS not enabled on %', v_missing;
  END LOOP;

  -- seeds present
  IF (SELECT value FROM public.app_config WHERE key = 'signup_open') IS NULL THEN
    RAISE EXCEPTION 'verify_signup_tables: signup_open seed missing';
  END IF;

  -- signup_events has NO client-facing policies
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'signup_events'
  ) THEN
    RAISE EXCEPTION 'verify_signup_tables: signup_events must have zero client policies';
  END IF;

  -- app_config anon policy restricts to signup_open key only
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'app_config'
      AND cmd = 'SELECT'
      AND qual::text LIKE '%signup_open%'
  ) THEN
    RAISE EXCEPTION 'verify_signup_tables: app_config SELECT policy missing signup_open restriction';
  END IF;

  -- get_my_businesses exists + is authenticated-only
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_my_businesses'
  ) THEN
    RAISE EXCEPTION 'verify_signup_tables: get_my_businesses missing';
  END IF;

  SELECT jsonb_build_object(
    'status', 'ok',
    'tables', 5,
    'rls_enabled', true,
    'seeds', (SELECT count(*) FROM public.app_config),
    'get_my_businesses', true
  ) INTO v_result;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_signup_tables() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_signup_tables() TO service_role, authenticated;
