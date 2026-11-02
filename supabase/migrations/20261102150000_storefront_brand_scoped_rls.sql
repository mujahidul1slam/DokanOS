-- 20261102150000_storefront_brand_scoped_rls.sql — Task 14 gap (found in the
-- chief's browser verification 2026-11-01): "Create a storefront" for a
-- business without a legacy store failed with
--   new row violates row-level security policy for table "storefronts"
-- and the storefront row was never created.
--
-- Root cause: every storefronts member policy gates on
-- public.user_can_access_store(store_id), which is false for store_id NULL.
-- The creation pipeline (src/components/storefront/storefrontCreate.ts:113-140)
-- resolves the store as brand woo_store_id -> scoped stores read -> null and
-- documents `store_id = null` as the intended path for store-less businesses
-- ("exact old-dialog behavior") — a path that could NEVER pass these policies.
--
-- Storefronts are brand children since 20260925130000 ("storefronts belong to
-- brands"). This migration adds the brand-child fallback — brand->business
-- membership gated on the ACTIVE business context, the same shape
-- user_can_access_store itself implements (20261026120000) and the
-- activeBusinessRlsContract test REQUIRES for every non-has_role policy on
-- storefronts (a TENANT_TABLE: membership alone is not enough, the brand must
-- belong to current_business_context()) — for the brand-scoped row shape ONLY
-- (store_id IS NULL AND brand_id IS NOT NULL). Permissive policies are OR'ed,
-- so this is purely additive and every existing store-based clause keeps
-- working unchanged:
--
--   "Members can read brand-scoped storefronts"     — any account member
--   "Brand operators can insert brand-scoped ..."   — owner/admin/manager
--   "Brand operators can update brand-scoped ..."   — owner/admin/manager
--
-- Spec §5 ladder (post-Task-12 values): members read; owner/admin/manager
-- write; staff read-only. A row can never cross into another business: the
-- operator legs' WITH CHECK re-evaluates the brand binding of the NEW row, so
-- retargeting brand_id at a foreign brand is denied, and rows with BOTH
-- bindings NULL still fail closed (no policy matches).
--
-- The ladder roles ride user_business_access, not the global app_role: real
-- accounts have no user_roles row ("first user gets admin, others get no
-- role", 20260925120100:452), which is exactly why the old has_role-based
-- gates could not serve this surface either.
--
-- The same gap one step down the flow (chief's ruling 2026-11-01, "(c) both"):
-- scaffolding and the visual page builder write storefront_pages /
-- storefront_page_sections through direct PostgREST, and THOSE tables are
-- still gated on the global has_role('admin'|'staff') (20260516201928,
-- 20260914120001) — dead for every real account. This migration therefore
-- also adds, for pages and sections, the brand-membership leg keyed through
-- the parent storefront's brand ("EXISTS-through-storefronts->brands->
-- membership"): members read, owner/admin/manager write, staff read-only.
-- The global-role legs and the public published-read stay untouched
-- (permissive policies are OR'ed). A page of a storefront with no brand
-- binding keeps failing closed (has_role only). DESIGN QUESTION for the
-- Task 16 contract pass: pages arguably deserve first-class business/brand
-- scoping (the transitional storefront->brand hop is exactly that, minus the
-- store-based column) — recorded, not redesigned here.
--
-- Policy-only migration: no schema change, no types regen.

-- Members read their brand's store-less storefronts (including drafts —
-- management visibility; the anon surface stays is_active-only).
CREATE POLICY "Members can read brand-scoped storefronts"
  ON public.storefronts FOR SELECT TO authenticated
  USING (
    store_id IS NULL
    AND brand_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.brands brand
      JOIN public.user_business_access membership
        ON membership.business_id = brand.business_id
      WHERE brand.id = storefronts.brand_id
        AND membership.user_id = auth.uid()
        AND brand.business_id = public.current_business_context()
    )
  );

-- Owner/admin/manager create store-less storefronts under their own brands.
CREATE POLICY "Brand operators can insert brand-scoped storefronts"
  ON public.storefronts FOR INSERT TO authenticated
  WITH CHECK (
    store_id IS NULL
    AND brand_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.brands brand
      JOIN public.user_business_access membership
        ON membership.business_id = brand.business_id
      WHERE brand.id = storefronts.brand_id
        AND membership.user_id = auth.uid()
        AND brand.business_id = public.current_business_context()
        AND membership.role IN ('owner', 'admin', 'manager')
    )
  );

-- Owner/admin/manager manage them; the WITH CHECK on the new row keeps a
-- cross-business brand retarget (or a store binding the operator cannot
-- access) denied.
CREATE POLICY "Brand operators can update brand-scoped storefronts"
  ON public.storefronts FOR UPDATE TO authenticated
  USING (
    store_id IS NULL
    AND brand_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.brands brand
      JOIN public.user_business_access membership
        ON membership.business_id = brand.business_id
      WHERE brand.id = storefronts.brand_id
        AND membership.user_id = auth.uid()
        AND brand.business_id = public.current_business_context()
        AND membership.role IN ('owner', 'admin', 'manager')
    )
  )
  WITH CHECK (
    store_id IS NULL
    AND brand_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.brands brand
      JOIN public.user_business_access membership
        ON membership.business_id = brand.business_id
      WHERE brand.id = storefronts.brand_id
        AND membership.user_id = auth.uid()
        AND brand.business_id = public.current_business_context()
        AND membership.role IN ('owner', 'admin', 'manager')
    )
  );


-- ---- storefront_pages: pages inherit the parent storefront's brand tenancy
--      (members read incl. drafts; owner/admin/manager write). The global
--      has_role legs and the public published-read keep working unchanged. ----
CREATE POLICY "Members can read brand-managed storefront pages"
  ON public.storefront_pages FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.storefronts s
      JOIN public.brands brand ON brand.id = s.brand_id
      JOIN public.user_business_access membership
        ON membership.business_id = brand.business_id
      WHERE s.id = storefront_pages.storefront_id
        AND membership.user_id = auth.uid()
        AND brand.business_id = public.current_business_context()
    )
  );

CREATE POLICY "Brand operators can insert brand-managed storefront pages"
  ON public.storefront_pages FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.storefronts s
      JOIN public.brands brand ON brand.id = s.brand_id
      JOIN public.user_business_access membership
        ON membership.business_id = brand.business_id
      WHERE s.id = storefront_pages.storefront_id
        AND membership.user_id = auth.uid()
        AND brand.business_id = public.current_business_context()
        AND membership.role IN ('owner', 'admin', 'manager')
    )
  );

CREATE POLICY "Brand operators can update brand-managed storefront pages"
  ON public.storefront_pages FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.storefronts s
      JOIN public.brands brand ON brand.id = s.brand_id
      JOIN public.user_business_access membership
        ON membership.business_id = brand.business_id
      WHERE s.id = storefront_pages.storefront_id
        AND membership.user_id = auth.uid()
        AND brand.business_id = public.current_business_context()
        AND membership.role IN ('owner', 'admin', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.storefronts s
      JOIN public.brands brand ON brand.id = s.brand_id
      JOIN public.user_business_access membership
        ON membership.business_id = brand.business_id
      WHERE s.id = storefront_pages.storefront_id
        AND membership.user_id = auth.uid()
        AND brand.business_id = public.current_business_context()
        AND membership.role IN ('owner', 'admin', 'manager')
    )
  );

-- ---- storefront_page_sections: the same tenancy one hop deeper (section ->
--      page -> storefront -> brand). ----
CREATE POLICY "Members can read brand-managed storefront page sections"
  ON public.storefront_page_sections FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.storefront_pages page
      JOIN public.storefronts s ON s.id = page.storefront_id
      JOIN public.brands brand ON brand.id = s.brand_id
      JOIN public.user_business_access membership
        ON membership.business_id = brand.business_id
      WHERE page.id = storefront_page_sections.page_id
        AND membership.user_id = auth.uid()
        AND brand.business_id = public.current_business_context()
    )
  );

CREATE POLICY "Brand operators can insert brand-managed storefront page sections"
  ON public.storefront_page_sections FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.storefront_pages page
      JOIN public.storefronts s ON s.id = page.storefront_id
      JOIN public.brands brand ON brand.id = s.brand_id
      JOIN public.user_business_access membership
        ON membership.business_id = brand.business_id
      WHERE page.id = storefront_page_sections.page_id
        AND membership.user_id = auth.uid()
        AND brand.business_id = public.current_business_context()
        AND membership.role IN ('owner', 'admin', 'manager')
    )
  );

CREATE POLICY "Brand operators can update brand-managed storefront page sections"
  ON public.storefront_page_sections FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.storefront_pages page
      JOIN public.storefronts s ON s.id = page.storefront_id
      JOIN public.brands brand ON brand.id = s.brand_id
      JOIN public.user_business_access membership
        ON membership.business_id = brand.business_id
      WHERE page.id = storefront_page_sections.page_id
        AND membership.user_id = auth.uid()
        AND brand.business_id = public.current_business_context()
        AND membership.role IN ('owner', 'admin', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.storefront_pages page
      JOIN public.storefronts s ON s.id = page.storefront_id
      JOIN public.brands brand ON brand.id = s.brand_id
      JOIN public.user_business_access membership
        ON membership.business_id = brand.business_id
      WHERE page.id = storefront_page_sections.page_id
        AND membership.user_id = auth.uid()
        AND brand.business_id = public.current_business_context()
        AND membership.role IN ('owner', 'admin', 'manager')
    )
  );
