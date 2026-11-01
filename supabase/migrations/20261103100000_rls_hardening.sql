-- RLS hardening: close the production privilege drift found during the
-- 2026-11-01 post-cutover audit (tasks/audit/task17-readiness-report.md §8).
--
-- ROOT CAUSE (measured on production, absent from every repo migration):
-- the production `postgres` role carried permissive ALTER DEFAULT PRIVILEGES
-- on schema public — every newly created table/sequence/function was born
-- with full grants to anon, authenticated and service_role
-- (`{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,…}`). Consequences
-- measured live:
--   * 9 public tables had RLS DISABLED (courier_integrations, courier_providers,
--     courier_shipments, courier_tokens, payment_providers, product_locations,
--     sync_queue, sync_queue_cleanup_log, webhook_events) — on 4 of them anon
--     could read real rows (payment_providers 4, product_locations 205,
--     sync_queue 254 incl. 142 internal error logs, sync_queue_cleanup_log 20).
--   * TRUNCATE was granted to anon and authenticated on ~70 tables. RLS does
--     NOT gate TRUNCATE (proven locally: a deny-all RLS table was wiped by a
--     role holding only TRUNCATE), so enabling RLS alone is NOT sufficient —
--     the grants must go.
--   * app_config held table-wide grants for every API role, breaking the
--     function-only contract of 20261022120000 (signup_config_accessor_test).
--   * authenticated could EXECUTE internal SECURITY DEFINER functions
--     (claim_sync_queue_batch, recover_orphaned_sync_rows) that run as the
--     table owner and bypass RLS entirely.
--
-- THE DOCTRINE this migration enforces (same as 20261026140000): grants are
-- derived from pg_policies — a role holds exactly the verbs its policies
-- implement, plus the two deliberate column carve-outs (products catalog,
-- invoice_settings branding) and the function-only app_config accessor.
-- service_role keeps its existing explicit grants untouched (server-side
-- key, not browser-reachable); only its app_config grant is narrowed to the
-- columns the signup edge function actually reads.
--
-- Idempotent: REVOKE/GRANT/ALTER statements are no-ops when already applied;
-- policies are dropped-then-created.

-- §1 Repair the default ACLs (root cause) ------------------------------------
-- After a full revoke the default-ACL entries disappear, so future tables,
-- sequences and functions created by migrations receive NO API-role grants
-- until a migration grants them explicitly.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated, service_role, public;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated, service_role, public;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon, authenticated, service_role, public;
-- Note: supabase_admin also ships platform default ACLs on public, but
-- postgres cannot alter another role's defaults (not a superuser) and every
-- repo table is postgres-owned, so those entries are inert here. Documented
-- in tasks/audit/task17-readiness-report.md §8.

-- §2 Enable RLS on the nine exposed tables -----------------------------------
-- product_locations already carries the four member-scoped policies (they
-- simply activate); courier_providers / payment_providers / courier_shipments
-- get intent-matching policies below; the remaining five are service-role /
-- cron-only tables and stay policy-less (invisible to API roles).
ALTER TABLE public.courier_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courier_providers    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courier_shipments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courier_tokens       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_providers    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_locations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_queue           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_queue_cleanup_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events       ENABLE ROW LEVEL SECURITY;

-- §3 Policies for the tables the app legitimately reads ----------------------
-- courier_providers: deployment-global directory (code/name/rate limits), the
-- same class as pathao_areas/cities/zones ("Anyone can read …", TO public).
DROP POLICY IF EXISTS "Anyone can read courier providers" ON public.courier_providers;
CREATE POLICY "Anyone can read courier providers"
  ON public.courier_providers FOR SELECT TO public
  USING (true);

-- payment_providers: 20261031180000 granted authenticated SELECT explicitly;
-- that intent becomes a policy (row visibility was previously grant-only).
DROP POLICY IF EXISTS "Authenticated can read payment providers" ON public.payment_providers;
CREATE POLICY "Authenticated can read payment providers"
  ON public.payment_providers FOR SELECT TO authenticated
  USING (true);

-- courier_shipments: the OrderDetailSheet reads shipments for an order; scope
-- them with the same parent-order predicate as order_payments/order_items.
DROP POLICY IF EXISTS "Account members can read courier_shipments" ON public.courier_shipments;
CREATE POLICY "Account members can read courier_shipments"
  ON public.courier_shipments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.orders parent
      WHERE parent.id = courier_shipments.order_id
        AND parent.store_id IS NOT NULL
        AND public.user_can_access_store(parent.store_id)
    )
  );

-- §4 Strip the drift grants ---------------------------------------------------
-- Blanket revoke of every table (incl. views) and sequence privilege held by
-- the browser-reachable roles; §5 re-grants exactly what policies implement.
-- service_role is deliberately untouched (server-side; explicit grants from
-- earlier migrations must keep working).
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated, public;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated, public;

-- §5 Re-grant per policy (the 20261026140000 doctrine, verbatim mapping) ------
DO $$
DECLARE
  v_policy record;
  v_role text;
BEGIN
  FOR v_policy IN
    SELECT p.tablename AS table_name,
           lower(r.role_name) AS policy_role,
           p.cmd AS policy_cmd
    FROM pg_policies p
    CROSS JOIN LATERAL unnest(p.roles) AS r(role_name)
    WHERE p.schemaname = 'public'
      -- products/anon SELECT stays column-scoped (carve-out below).
      AND NOT (p.tablename = 'products' AND p.cmd = 'SELECT'
               AND lower(r.role_name) IN ('anon', 'public'))
      -- app_config is function-only for anon/authenticated (20261022120000);
      -- service_role gets a column-scoped grant below (signup-event reads
      -- key/value directly with the service key).
      AND p.tablename <> 'app_config'
  LOOP
    FOREACH v_role IN ARRAY CASE WHEN v_policy.policy_role = 'public'
                                 THEN ARRAY['anon', 'authenticated']
                                 ELSE ARRAY[v_policy.policy_role] END
    LOOP
      IF v_role NOT IN ('anon', 'authenticated') THEN
        CONTINUE;
      END IF;
      EXECUTE format(
        'GRANT %s ON public.%I TO %I',
        CASE v_policy.policy_cmd
          WHEN 'ALL' THEN 'SELECT, INSERT, UPDATE, DELETE'
          ELSE v_policy.policy_cmd
        END,
        v_policy.table_name,
        v_role);
    END LOOP;
  END LOOP;
END $$;

-- §6 Column carve-outs --------------------------------------------------------
-- products: the anon storefront catalog columns, cost_price and the Task 4
-- provenance pair stay excluded (20260620172022 + 20261026140000).
GRANT SELECT (
  id, store_id, woo_product_id, sku, slug, name, description,
  price, regular_price, sale_price, sale_price_from, sale_price_to,
  short_description, attributes, tags, weight, dimensions,
  stock_quantity, manage_stock, stock_status, backorders,
  barcode, category, image_url, image_urls, is_featured, is_active,
  sales_count, woo_updated_at, created_at, updated_at
) ON public.products TO anon;

-- invoice_settings: the pre-login branding probe columns (20261026150000).
GRANT SELECT (id, business_name, logo_url, tagline) ON public.invoice_settings TO anon;

-- app_config: service_role keeps exactly what supabase/functions/signup-event
-- reads (key, value for tos_version/privacy_version) — column-scoped, so the
-- function-only contract (no table-wide SELECT for any API role) holds again.
REVOKE ALL ON public.app_config FROM service_role;
GRANT SELECT (key, value) ON public.app_config TO service_role;

-- §7 Views --------------------------------------------------------------------
-- Restore the explicit view grants the blanket revoke stripped. sync_health is
-- owner-rights (aggregates for the dashboard); the two _safe views are
-- security_invoker, so authenticated reads stay RLS-gated underneath.
GRANT SELECT ON public.sync_health TO authenticated, service_role;
GRANT SELECT ON public.pathao_integrations_safe TO authenticated;
GRANT SELECT ON public.stores_safe TO authenticated;

-- §8 Function hygiene ---------------------------------------------------------
-- Internal SECURITY DEFINER functions must not be executable by browser
-- roles: claim_sync_queue_batch/recover_orphaned_sync_rows run as the owner
-- and bypass RLS (authenticated could RPC them directly); the auto_push_*
-- and sync_product_stock_from_locations triggers are not API surface at all.
-- service_role is re-granted explicitly for the two the sync pipeline calls.
DO $$
DECLARE
  v_fn record;
BEGIN
  FOR v_fn IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'claim_sync_queue_batch', 'recover_orphaned_sync_rows',
        'auto_push_order_to_woo', 'auto_push_product_stock',
        'auto_push_variation_stock', 'sync_product_stock_from_locations')
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated',
      v_fn.proname, v_fn.args);
  END LOOP;

  FOR v_fn IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('claim_sync_queue_batch', 'recover_orphaned_sync_rows')
  LOOP
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role',
      v_fn.proname, v_fn.args);
  END LOOP;
END $$;

--------------------------------------------------------------------------------
-- ROLLBACK (manual only): the pre-migration state was the production drift —
-- permissive default ACLs plus blanket grants — and must NOT be restored.
-- To undo a mistake in this file specifically: re-run the matching REVOKE/GRANT
-- by hand; the regression test (supabase/tests/rls/rls_hardening_test.sql)
-- defines the state that must be kept.
--------------------------------------------------------------------------------
