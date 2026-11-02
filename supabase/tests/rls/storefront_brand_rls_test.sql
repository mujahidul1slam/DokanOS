-- Task 14 gap fix: brand-scoped storefronts (store_id IS NULL AND brand_id set)
-- are creatable and manageable by their brand's account operators, while
-- cross-business brand bindings stay denied and both-bindings-NULL stays
-- fail-closed (migration 20261102150000_storefront_brand_scoped_rls.sql —
-- "new row violates row-level security policy" was the browser repro). The
-- same migration lifts the scaffold/page-builder surface (storefront_pages /
-- storefront_page_sections) onto brand->business membership, so this file
-- pins those legs too. Spec §5 ladder (post-Task-12 values): members read;
-- owner/admin/manager write; staff read-only. Fixture ids per _harness.md.
--
-- DISCRIMINATION: the harness fixtures hold global `staff` app_roles, which
-- would satisfy the OLD has_role('admin'|'staff') legs and mask the new
-- membership legs entirely. Real accounts have NO user_roles row ("first user
-- gets admin, others get no role", 20260925120100:452), so this file DELETES
-- the fixtures' user_roles rows inside its transaction (rolled back at the
-- end) — every pin below therefore exercises the membership legs only, and
-- the deletion itself proves the surface works for role-less real accounts.
--
-- Everything below runs against the ACTIVE business context too (the legs
-- match the activeBusinessRlsContract tenant-scope rule — membership alone is
-- not enough, the brand must belong to the server-side active business, which
-- the harness converges per fixture the way the app does at login).
--
-- Every storefront here is INACTIVE on purpose: `is_active = true` is already
-- visible to everyone through "Members can read storefronts", so inactive
-- rows are the only ones that discriminate the brand-scoped read leg. The
-- store-based clauses are untouched by the migration and pinned as unchanged
-- by the brand_stores / anon_public_surface batteries — not re-pinned here.

BEGIN;

-- ---- fixtures (postgres; a store-less storefront cannot pass any
--      authenticated INSERT policy outside the new brand-scoped leg) ----
INSERT INTO public.brands (id, business_id, name, slug)
VALUES ('66666666-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
        'Storefront RLS Brand A', 'sf-rls-brand-a'),
       ('66666666-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000002',
        'Storefront RLS Brand B', 'sf-rls-brand-b');

INSERT INTO public.storefronts (id, slug, name, store_id, brand_id, is_active)
VALUES ('77777777-0000-0000-0000-000000000001', 'sf-rls-storeless', 'Storeless Fixture', NULL,
        '66666666-0000-0000-0000-000000000001', false),
       ('77777777-0000-0000-0000-000000000002', 'sf-rls-foreign-front', 'Foreign Brand Fixture', NULL,
        '66666666-0000-0000-0000-000000000002', false);

INSERT INTO public.storefront_pages (id, storefront_id, slug, title, body_md, is_active, type, status, seo)
VALUES ('88888888-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000001',
        'sf-rls-page', 'Fixture Page', '', true, 'custom', 'draft', '{}'::jsonb);

INSERT INTO public.storefront_page_sections (id, page_id, type, position, is_visible, props)
VALUES ('99999999-0000-0000-0000-000000000001', '88888888-0000-0000-0000-000000000001',
        'rich-text', 0, true, '{}'::jsonb);

-- ---- real-account simulation: drop the fixtures' global app_roles so the
--      old has_role legs cannot mask the new membership legs (rolled back). ----
DELETE FROM public.user_roles
WHERE user_id IN ('00000000-0000-0000-0000-000000000004',
                  '00000000-0000-0000-0000-000000000005',
                  '00000000-0000-0000-0000-000000000006',
                  '00000000-0000-0000-0000-000000000007');

-- ---- Manager (…004, role manager): the repro path works — INSERT of a
--      store-less storefront under their own brand succeeds; the inactive
--      fixture is readable and updatable; pages/sections scaffold the same
--      way the create pipeline does; cross-business shapes are denied
--      (Shape A). ----
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
DO $$
DECLARE v_rc bigint;
DECLARE v_page uuid;
BEGIN
  INSERT INTO public.storefronts (slug, name, store_id, brand_id, is_active)
  VALUES ('sf-rls-member-made', 'Member Made Storefront', NULL,
          '66666666-0000-0000-0000-000000000001', false);
  GET DIAGNOSTICS v_rc = ROW_COUNT;
  IF v_rc <> 1 THEN
    RAISE EXCEPTION 'FAIL: brand manager store-less INSERT matched % rows', v_rc USING ERRCODE = 'P0001';
  END IF;

  IF (SELECT count(*) FROM public.storefronts
      WHERE id = '77777777-0000-0000-0000-000000000001'
        AND store_id IS NULL
        AND brand_id = '66666666-0000-0000-0000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'FAIL: brand manager cannot read the store-less storefront' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.storefronts
  SET name = 'Storeless Fixture v2'
  WHERE id = '77777777-0000-0000-0000-000000000001';
  GET DIAGNOSTICS v_rc = ROW_COUNT;
  IF v_rc <> 1 THEN
    RAISE EXCEPTION 'FAIL: brand manager could not update the store-less storefront (% rows)', v_rc
      USING ERRCODE = 'P0001';
  END IF;

  -- Scaffold parity with the create pipeline: page + section under the
  -- store-less storefront (drafts — only the new read leg shows them).
  INSERT INTO public.storefront_pages (storefront_id, slug, title, body_md, is_active, type, status, seo)
  VALUES ('77777777-0000-0000-0000-000000000001', 'sf-rls-page-home', 'Home', '', true, 'home', 'draft', '{}'::jsonb)
  RETURNING id INTO v_page;
  IF v_page IS NULL THEN
    RAISE EXCEPTION 'FAIL: brand manager could not insert a page under the store-less storefront'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.storefront_page_sections (page_id, type, position, is_visible, props)
  VALUES (v_page, 'hero', 0, true, '{"title":"Hello"}'::jsonb);
  GET DIAGNOSTICS v_rc = ROW_COUNT;
  IF v_rc <> 1 THEN
    RAISE EXCEPTION 'FAIL: brand manager could not insert a page section (% rows)', v_rc
      USING ERRCODE = 'P0001';
  END IF;

  IF (SELECT count(*) FROM public.storefront_pages
      WHERE storefront_id = '77777777-0000-0000-0000-000000000001' AND status = 'draft') <> 2 THEN
    RAISE EXCEPTION 'FAIL: brand manager cannot read their draft pages' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.storefront_pages SET title = 'Home Page' WHERE id = v_page;
  GET DIAGNOSTICS v_rc = ROW_COUNT;
  IF v_rc <> 1 THEN
    RAISE EXCEPTION 'FAIL: brand manager could not update their page (% rows)', v_rc USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.storefront_page_sections SET position = 1 WHERE page_id = v_page AND type = 'hero';
  GET DIAGNOSTICS v_rc = ROW_COUNT;
  IF v_rc <> 1 THEN
    RAISE EXCEPTION 'FAIL: brand manager could not update their section (% rows)', v_rc
      USING ERRCODE = 'P0001';
  END IF;

  -- WITH CHECK: moving the storefront into the OTHER business's brand is denied.
  BEGIN
    UPDATE public.storefronts
    SET brand_id = '66666666-0000-0000-0000-000000000002'
    WHERE id = '77777777-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'FAIL: cross-business brand retarget was accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  -- WITH CHECK: creating under the other business's brand is denied.
  BEGIN
    INSERT INTO public.storefronts (slug, name, store_id, brand_id)
    VALUES ('sf-rls-foreign-brand', 'Foreign Brand Insert', NULL,
            '66666666-0000-0000-0000-000000000002');
    RAISE EXCEPTION 'FAIL: cross-business brand INSERT was accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  -- WITH CHECK: a page under a FOREIGN brand's storefront is denied too.
  BEGIN
    INSERT INTO public.storefront_pages (storefront_id, slug, title, body_md, is_active, type, status, seo)
    VALUES ('77777777-0000-0000-0000-000000000002', 'sf-rls-foreign-page', 'Foreign Page', '', true,
            'custom', 'draft', '{}'::jsonb);
    RAISE EXCEPTION 'FAIL: cross-business page INSERT was accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  -- Fail-closed: both bindings NULL passes no policy at all.
  BEGIN
    INSERT INTO public.storefronts (slug, name)
    VALUES ('sf-rls-no-binding', 'No Binding Insert');
    RAISE EXCEPTION 'FAIL: unbound storefront INSERT was accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
RESET ROLE;

-- ---- Staff (…005): reads like any member, cannot write (Shape A for the
--      INSERTs; Shape A′ for the UPDATEs: in-block rowcount + owner-side
--      survival below). ----
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated"}';
DO $$
DECLARE v_rc bigint;
BEGIN
  IF (SELECT count(*) FROM public.storefronts
      WHERE id = '77777777-0000-0000-0000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'FAIL: staff member cannot read the store-less storefront' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.storefront_pages
      WHERE storefront_id = '77777777-0000-0000-0000-000000000001') <> 2 THEN
    RAISE EXCEPTION 'FAIL: staff member cannot read the storefront pages' USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    INSERT INTO public.storefronts (slug, name, store_id, brand_id, is_active)
    VALUES ('sf-rls-staff-made', 'Staff Made Storefront', NULL,
            '66666666-0000-0000-0000-000000000001', false);
    RAISE EXCEPTION 'FAIL: staff inserted a store-less storefront' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  BEGIN
    INSERT INTO public.storefront_pages (storefront_id, slug, title, body_md, is_active, type, status, seo)
    VALUES ('77777777-0000-0000-0000-000000000001', 'sf-rls-staff-page', 'Staff Page', '', true,
            'custom', 'draft', '{}'::jsonb);
    RAISE EXCEPTION 'FAIL: staff inserted a storefront page' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  BEGIN
    UPDATE public.storefronts
    SET name = 'Staff Was Here'
    WHERE id = '77777777-0000-0000-0000-000000000001';
    GET DIAGNOSTICS v_rc = ROW_COUNT;
    IF v_rc <> 0 THEN
      RAISE EXCEPTION 'FAIL: staff mutated the store-less storefront (rowcount %)', v_rc
        USING ERRCODE = 'P0001';
    END IF;
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN RAISE;
  END;

  BEGIN
    UPDATE public.storefront_pages
    SET title = 'Staff Was Here'
    WHERE id = '88888888-0000-0000-0000-000000000001';
    GET DIAGNOSTICS v_rc = ROW_COUNT;
    IF v_rc <> 0 THEN
      RAISE EXCEPTION 'FAIL: staff mutated a storefront page (rowcount %)', v_rc
        USING ERRCODE = 'P0001';
    END IF;
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN RAISE;
  END;

  BEGIN
    UPDATE public.storefront_page_sections
    SET position = 7
    WHERE id = '99999999-0000-0000-0000-000000000001';
    GET DIAGNOSTICS v_rc = ROW_COUNT;
    IF v_rc <> 0 THEN
      RAISE EXCEPTION 'FAIL: staff mutated a page section (rowcount %)', v_rc
        USING ERRCODE = 'P0001';
    END IF;
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN RAISE;
  END;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.storefronts
                 WHERE id = '77777777-0000-0000-0000-000000000001'
                   AND name = 'Storeless Fixture v2'
                   AND brand_id = '66666666-0000-0000-0000-000000000001'
                   AND store_id IS NULL) THEN
    RAISE EXCEPTION 'FAIL: store-less storefront survival (staff write)' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.storefront_pages
                 WHERE id = '88888888-0000-0000-0000-000000000001' AND title = 'Fixture Page') THEN
    RAISE EXCEPTION 'FAIL: page survival (staff write)' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.storefront_page_sections
                 WHERE id = '99999999-0000-0000-0000-000000000001' AND position = 0) THEN
    RAISE EXCEPTION 'FAIL: section survival (staff write)' USING ERRCODE = 'P0001';
  END IF;
END $$;

-- ---- Owner of the OTHER business (…006): foreign brand-scoped rows are
--      invisible and uninsertable (storefronts AND pages); their own brand
--      works (per-brand tenancy, both ways). ----
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}';
DO $$
DECLARE v_rc bigint;
BEGIN
  IF (SELECT count(*) FROM public.storefronts
      WHERE slug IN ('sf-rls-storeless', 'sf-rls-member-made')) <> 0 THEN
    RAISE EXCEPTION 'FAIL: cross-business operator saw foreign store-less storefronts'
      USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.storefront_pages WHERE slug LIKE 'sf-rls-%') <> 0 THEN
    RAISE EXCEPTION 'FAIL: cross-business operator saw foreign storefront pages'
      USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    INSERT INTO public.storefronts (slug, name, store_id, brand_id)
    VALUES ('sf-rls-ownerb-foreign', 'Owner B Foreign Brand', NULL,
            '66666666-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'FAIL: cross-business brand INSERT was accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  INSERT INTO public.storefronts (slug, name, store_id, brand_id, is_active)
  VALUES ('sf-rls-ownerb-made', 'Owner B Made Storefront', NULL,
          '66666666-0000-0000-0000-000000000002', false);
  GET DIAGNOSTICS v_rc = ROW_COUNT;
  IF v_rc <> 1 THEN
    RAISE EXCEPTION 'FAIL: other-business owner could not create under their own brand (% rows)', v_rc
      USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.storefronts WHERE slug = 'sf-rls-ownerb-made') <> 1 THEN
    RAISE EXCEPTION 'FAIL: other-business owner cannot read their own store-less storefront'
      USING ERRCODE = 'P0001';
  END IF;
END $$;
RESET ROLE;

-- ---- Outsider (…007, no membership, no active context): fails closed on
--      everything brand-scoped. ----
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000007","role":"authenticated"}';
DO $$
BEGIN
  IF (SELECT count(*) FROM public.storefronts
      WHERE slug IN ('sf-rls-storeless', 'sf-rls-member-made', 'sf-rls-ownerb-made',
                     'sf-rls-foreign-front')) <> 0 THEN
    RAISE EXCEPTION 'FAIL: outsider saw brand-scoped storefronts' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.storefront_pages WHERE slug LIKE 'sf-rls-%') <> 0 THEN
    RAISE EXCEPTION 'FAIL: outsider saw storefront pages' USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    INSERT INTO public.storefronts (slug, name, store_id, brand_id)
    VALUES ('sf-rls-outsider-made', 'Outsider Made Storefront', NULL,
            '66666666-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'FAIL: outsider storefront INSERT was accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  BEGIN
    INSERT INTO public.storefront_pages (storefront_id, slug, title, body_md, is_active, type, status, seo)
    VALUES ('77777777-0000-0000-0000-000000000001', 'sf-rls-outsider-page', 'Outsider Page', '', true,
            'custom', 'draft', '{}'::jsonb);
    RAISE EXCEPTION 'FAIL: outsider page INSERT was accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
RESET ROLE;

-- ---- owner-side value pins (postgres): the denied attempts changed nothing,
--      the manager's scaffold survived pinned, and no unbound row exists. ----
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.storefronts
                 WHERE id = '77777777-0000-0000-0000-000000000001'
                   AND name = 'Storeless Fixture v2'
                   AND brand_id = '66666666-0000-0000-0000-000000000001'
                   AND store_id IS NULL
                   AND is_active = false) THEN
    RAISE EXCEPTION 'FAIL: store-less storefront did not survive pinned' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.storefronts WHERE slug = 'sf-rls-member-made') THEN
    RAISE EXCEPTION 'FAIL: member-created storefront survival' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.storefront_pages
                 WHERE slug = 'sf-rls-page-home' AND title = 'Home Page' AND status = 'draft') THEN
    RAISE EXCEPTION 'FAIL: member-created page survival' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.storefront_page_sections
                 WHERE page_id = (SELECT id FROM public.storefront_pages WHERE slug = 'sf-rls-page-home')
                   AND type = 'hero' AND position = 1) THEN
    RAISE EXCEPTION 'FAIL: member-created section survival' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.storefronts
      WHERE slug LIKE 'sf-rls-%' AND store_id IS NULL AND brand_id IS NULL) <> 0 THEN
    RAISE EXCEPTION 'FAIL: an unbound storefront row was accepted' USING ERRCODE = 'P0001';
  END IF;
END $$;

ROLLBACK;
