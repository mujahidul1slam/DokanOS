-- Issue #16 (hybrid tenancy, S3): make the server-side active business context
-- the operational RLS authority.
--
-- S1 (20261024100000_active_business_context.sql) created the durable context
-- but deliberately changed no operational policies, so a user who belongs to
-- businesses A and B could still read BOTH through direct Data API requests no
-- matter which business the UI showed. Client predicates are not a security
-- boundary; this migration closes the boundary where it belongs.
--
-- The predicate is deliberately fail-closed: with no resolved context (no
-- login-path convergence yet, or a rejected switch), current_business_context()
-- is NULL and every operational row becomes invisible and unauthorised.

--------------------------------------------------------------------------------
-- 1. Definer-side visibility for the context RPCs under FORCE RLS
--------------------------------------------------------------------------------
-- S1 enabled FORCE ROW LEVEL SECURITY on active_business_context and granted no
-- table privileges to any client role. FORCE also applies RLS to the table
-- owner, and with zero policies the SECURITY DEFINER context RPCs would see and
-- write NOTHING whenever their owner is not a BYPASSRLS/superuser role — the
-- context would silently never resolve and every tenant read would fail closed
-- forever. This policy keeps the definer paths working in both worlds without
-- widening the client surface: client roles still hold no table privileges at
-- all, so no policy can make the table reachable to them.
DROP POLICY IF EXISTS "Definer manages the caller's own active business"
  ON public.active_business_context;
CREATE POLICY "Definer manages the caller's own active business"
  ON public.active_business_context
  FOR ALL
  TO postgres, supabase_admin
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

--------------------------------------------------------------------------------
-- 2. user_can_access_store now requires the SELECTED active business
--------------------------------------------------------------------------------
-- Every operational store predicate (stores, products, orders, order_items,
-- customers, categories, held_carts, pos_returns, pos_shifts, and the
-- parent-linked child tables through their EXISTS legs) flows through this one
-- helper, so redefining it retargets the whole operational surface at the
-- active business. Membership alone is no longer sufficient; the store must
-- belong to the business the server context currently holds.
CREATE OR REPLACE FUNCTION public.user_can_access_store(p_store_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.brands b
    JOIN public.user_business_access membership
      ON membership.business_id = b.business_id
    JOIN public.businesses business ON business.id = b.business_id
    WHERE b.woo_store_id = p_store_id
      AND membership.user_id = auth.uid()
      AND business.is_active = true
      AND b.business_id = public.current_business_context()
  );
$$;
REVOKE ALL ON FUNCTION public.user_can_access_store(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_access_store(uuid) TO authenticated, service_role;

-- New Supabase projects do not implicitly grant Data API table privileges.
-- RLS remains the authority; these grants only let authenticated requests
-- reach the scoped policies below (parity with the block in
-- 20261019160000_account_operational_boundaries.sql).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_aliases, public.pathao_store_links
  TO authenticated;

--------------------------------------------------------------------------------
-- 3. customer_aliases: parent-scoped instead of open read + global-staff writes
--------------------------------------------------------------------------------
-- The alias rows inherit the account boundary from their authoritative parent
-- (the customer's store) — the same contract order_items and product_categories
-- already use. The legacy "Staff and admin can ..." policies are the global
-- staff authority issue #10 removed from operational data.
DROP POLICY IF EXISTS "Authenticated can read customer_aliases" ON public.customer_aliases;
DROP POLICY IF EXISTS "Staff and admin can insert customer_aliases" ON public.customer_aliases;
DROP POLICY IF EXISTS "Staff and admin can update customer_aliases" ON public.customer_aliases;
DROP POLICY IF EXISTS "Staff and admin can delete customer_aliases" ON public.customer_aliases;

CREATE POLICY "Account members can read customer_aliases"
  ON public.customer_aliases FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.customers alias_customer
    WHERE alias_customer.id = customer_aliases.customer_id
      AND alias_customer.store_id IS NOT NULL
      AND public.user_can_access_store(alias_customer.store_id)
  ));
CREATE POLICY "Account members can insert customer_aliases"
  ON public.customer_aliases FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.customers alias_customer
    WHERE alias_customer.id = customer_aliases.customer_id
      AND alias_customer.store_id IS NOT NULL
      AND public.user_can_access_store(alias_customer.store_id)
  ));
CREATE POLICY "Account members can update customer_aliases"
  ON public.customer_aliases FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.customers alias_customer
    WHERE alias_customer.id = customer_aliases.customer_id
      AND alias_customer.store_id IS NOT NULL
      AND public.user_can_access_store(alias_customer.store_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.customers alias_customer
    WHERE alias_customer.id = customer_aliases.customer_id
      AND alias_customer.store_id IS NOT NULL
      AND public.user_can_access_store(alias_customer.store_id)
  ));
CREATE POLICY "Account members can delete customer_aliases"
  ON public.customer_aliases FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.customers alias_customer
    WHERE alias_customer.id = customer_aliases.customer_id
      AND alias_customer.store_id IS NOT NULL
      AND public.user_can_access_store(alias_customer.store_id)
  ));

--------------------------------------------------------------------------------
-- 4. pathao_store_links: store-scoped read/write instead of an open read
--------------------------------------------------------------------------------
-- The link row's tenant is its woo store. The reviewed platform-admin recovery
-- policy ("Admins can manage pathao_store_links") stays unchanged; what goes is
-- the authenticated USING(true) read and the missing member write path the
-- Integrations UI relies on.
DROP POLICY IF EXISTS "Authenticated can read pathao_store_links" ON public.pathao_store_links;

CREATE POLICY "Account members can read pathao_store_links"
  ON public.pathao_store_links FOR SELECT TO authenticated
  USING (public.user_can_access_store(woo_store_id));
CREATE POLICY "Account members can insert pathao_store_links"
  ON public.pathao_store_links FOR INSERT TO authenticated
  WITH CHECK (public.user_can_access_store(woo_store_id));
CREATE POLICY "Account members can update pathao_store_links"
  ON public.pathao_store_links FOR UPDATE TO authenticated
  USING (public.user_can_access_store(woo_store_id))
  WITH CHECK (public.user_can_access_store(woo_store_id));
CREATE POLICY "Account members can delete pathao_store_links"
  ON public.pathao_store_links FOR DELETE TO authenticated
  USING (public.user_can_access_store(woo_store_id));

--------------------------------------------------------------------------------
-- 5. product_variations: keep the public storefront leg, scope the auth leg
--------------------------------------------------------------------------------
-- "Public can read product variations" served anon AND authenticated behind a
-- single policy. Because RLS policies are a permissive union, the authenticated
-- leg silently unioned away the scoped member policy below it — any signed-in
-- user could read every active product's variations across all businesses. The
-- storefront read is intentional and unchanged for anon; authenticated reads
-- now go through the account policy alone.
DROP POLICY IF EXISTS "Public can read product variations" ON public.product_variations;
CREATE POLICY "Public can read product variations"
  ON public.product_variations FOR SELECT TO anon
  USING (EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = product_variations.product_id AND p.is_active
  ));

--------------------------------------------------------------------------------
-- Deliberately NOT changed here (tracked in issue #16):
--  - invoice_settings: a deployment-global branding row with no tenant key at
--    all (same class as app_settings); per-business scoping needs a schema
--    change plus client wiring.
--  - pathao_stores: the shared courier-store directory, also without a tenant
--    key; its "Authenticated can manage" policy needs a separate decision.
--  - brands / brand_stores / businesses: the issue #11/#12 membership model.
--  - Audit-log, profile and app_settings reads: platform/global surfaces.
--------------------------------------------------------------------------------
-- ROLLBACK (manual only): restore the superseded function body and policies
-- from 20261019160000_account_operational_boundaries.sql,
-- 20260418114108, 20260416203833 and 20260914140000.
--------------------------------------------------------------------------------
