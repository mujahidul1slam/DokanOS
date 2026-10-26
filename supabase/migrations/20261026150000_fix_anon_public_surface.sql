-- Issue #16 follow-up: fresh-project anon surface fixes found by live browser
-- verification. Both are parity bugs that only show up on newly provisioned
-- projects (old projects accumulated implicit default privileges and a
-- different policy shape, so the app masked them).
--
-- 1) storefronts: the public read policy "Public can read active storefronts"
--    (20260929120000) is TO anon,authenticated with
--    USING (is_active = true OR public.user_can_access_store(store_id)).
--    anon lacks EXECUTE on user_can_access_store (REVOKE'd in 20260929120000 /
--    20261026120000), and SQL does not guarantee OR short-circuit, so an anon
--    storefront read can fail with 42501 "permission denied for function
--    user_can_access_store" before RLS ever returns rows. Split the policy:
--    the anon leg never evaluates the function; the authenticated leg keeps the
--    member/OR behaviour exactly as before.
--
-- 2) invoice_settings: the pre-login branding probe
--    (select id, business_name, logo_url, tagline) runs as anon before any
--    session exists. There is no anon policy on invoice_settings (all rows stay
--    invisible) but the missing table privilege made the request 401 instead of
--    returning []. Column-level SELECT on exactly the four branding columns
--    restores the old "[]" behaviour while keeping every settings column
--    (shipping rates, templates, payment config) unreadable to anon — the same
--    column-grant carve-out pattern as products.cost_price (20260620172022).
--    RLS remains the authority: no anon row policy exists, so no row leaks.

-- 1) Split the storefronts public read policy --------------------------------
DROP POLICY IF EXISTS "Public can read active storefronts" ON public.storefronts;

-- anon: active storefronts only, no function call in the qual.
CREATE POLICY "Public can read active storefronts"
  ON public.storefronts FOR SELECT TO anon
  USING (is_active = true);

-- authenticated: unchanged semantics (active OR member of the owning store).
CREATE POLICY "Members can read storefronts"
  ON public.storefronts FOR SELECT TO authenticated
  USING (is_active = true OR public.user_can_access_store(store_id));

-- 2) Branding columns readable at the privilege layer for anon ---------------
-- Row visibility is still denied by the (authenticated-only) policies; this
-- only turns the boot-time probe's 401 into the historical empty result.
GRANT SELECT (id, business_name, logo_url, tagline) ON public.invoice_settings TO anon;

-- ROLLBACK (manual only):
--   DROP POLICY IF EXISTS "Members can read storefronts" ON public.storefronts;
--   DROP POLICY IF EXISTS "Public can read active storefronts" ON public.storefronts;
--   CREATE POLICY "Public can read active storefronts" ON public.storefronts
--     FOR SELECT TO anon, authenticated
--     USING (is_active = true OR public.user_can_access_store(store_id));
--   REVOKE SELECT (id, business_name, logo_url, tagline) ON public.invoice_settings FROM anon;
