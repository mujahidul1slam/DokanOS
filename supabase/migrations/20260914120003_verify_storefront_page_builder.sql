-- ============================================================================
-- Verify: Storefront Phase 1 page builder (§4.6).
-- Runs as a migration AFTER 20260914120001/2; every assertion RAISEs on
-- failure. Probes it creates are deleted before returning.
-- ============================================================================

DO $$
DECLARE
  v_count int;
  v_sid uuid;
  v_pid uuid;
  v_sec_id uuid;
  v_base timestamptz;
  v_rows int;
  v_undershoot int;
BEGIN
  -- 1. storefront_pages has the new columns
  SELECT count(*) INTO v_count FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'storefront_pages'
    AND column_name IN ('type','status','seo','published_snapshot','published_at');
  IF v_count <> 5 THEN
    RAISE EXCEPTION 'storefront_pages missing expanded columns (found %/5)', v_count;
  END IF;

  -- 2. storefront_page_sections exists with RLS enabled
  IF to_regclass('public.storefront_page_sections') IS NULL THEN
    RAISE EXCEPTION 'storefront_page_sections does not exist';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.storefront_page_sections'::regclass) THEN
    RAISE EXCEPTION 'storefront_page_sections RLS is not enabled';
  END IF;

  -- 3. sections policy count = 4 (staff-only), zero policies granting anon (H4)
  SELECT count(*) INTO v_count FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'storefront_page_sections';
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'storefront_page_sections policy count % <> 4', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'storefront_page_sections'
    AND 'anon' = ANY (roles);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'storefront_page_sections must have ZERO anon policies (found %)', v_count;
  END IF;

  -- 4. storefront_pages public policy requires status = 'published' (exception #2)
  SELECT count(*) INTO v_count FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'storefront_pages'
    AND policyname = 'Public can read published storefront pages'
    AND cmd = 'SELECT' AND qual LIKE '%published%';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'storefront_pages public policy is not the published-gated policy';
  END IF;
  -- the old leaky policy must be gone
  SELECT count(*) INTO v_count FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'storefront_pages'
    AND policyname = 'Public can read storefront_pages';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'old "Public can read storefront_pages" policy still present';
  END IF;

  -- 5. enum contains storefronts.view
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'app_permission' AND e.enumlabel = 'storefronts.view'
  ) THEN
    RAISE EXCEPTION 'app_permission enum missing storefronts.view';
  END IF;

  -- 6. migration 2: every system role holding stores.view also holds storefronts.view
  SELECT count(*) INTO v_count FROM public.custom_roles
  WHERE is_system = true
    AND permissions @> ARRAY['stores.view']::app_permission[]
    AND NOT permissions @> ARRAY['storefronts.view']::app_permission[];
  IF v_count > 0 THEN
    RAISE EXCEPTION '% system role(s) hold stores.view without storefronts.view', v_count;
  END IF;

  -- 7. backfilled home drafts = storefront count. The ON CONFLICT guard can
  --    legitimately undershoot if the dead table already held a
  --    (storefront_id,'home') row — the assertion SURFACES it, not hard-fails.
  SELECT count(*) INTO v_undershoot
  FROM public.storefronts s
  WHERE NOT EXISTS (
    SELECT 1 FROM public.storefront_pages p WHERE p.storefront_id = s.id AND p.slug = 'home'
  );
  IF v_undershoot > 0 THEN
    RAISE WARNING '% storefront(s) without a backfilled home draft (legitimate if the dead table pre-held (storefront_id,''home'') rows)', v_undershoot;
  END IF;

  -- 8. backfill must not publish anything
  SELECT count(*) INTO v_count FROM public.storefront_pages WHERE status = 'published';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'backfill must not publish pages (found % published)', v_count;
  END IF;

  -- 9. uq_storefront_pages_one_home enforced (insert a second home → fails)
  SELECT s.id INTO v_sid
  FROM public.storefronts s
  JOIN public.storefront_pages p ON p.storefront_id = s.id AND p.type = 'home'
  LIMIT 1;
  IF v_sid IS NOT NULL THEN
    BEGIN
      INSERT INTO public.storefront_pages (storefront_id, slug, title, type, status)
      VALUES (v_sid, 'verify-dup-home-probe', 'verify-dup-home-probe', 'home', 'draft');
      -- reaching here means the partial unique index is NOT enforced
      DELETE FROM public.storefront_pages WHERE slug = 'verify-dup-home-probe';
      RAISE EXCEPTION 'uq_storefront_pages_one_home is not enforced';
    EXCEPTION WHEN unique_violation THEN
      NULL; -- expected
    END;
  END IF;

  -- 10. M12: both set_updated_at triggers exist (pg_trigger check), including
  --     the PRE-EXISTING update_storefront_pages_updated_at (20260516201928, N1)
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.storefront_page_sections'::regclass
      AND tgname = 'trg_storefront_page_sections_set_updated_at' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'trg_storefront_page_sections_set_updated_at missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.storefront_pages'::regclass
      AND tgname = 'trg_storefront_pages_set_updated_at' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'trg_storefront_pages_set_updated_at missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.storefront_pages'::regclass
      AND tgname = 'update_storefront_pages_updated_at' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'pre-existing update_storefront_pages_updated_at trigger (20260516201928) missing';
  END IF;

  -- 10b. scripted stale-base check (M12 mechanism proof): a section UPDATE with
  --      an OLDER updated_at reports 0 rows; with the CURRENT updated_at, 1 row.
  SELECT p.id INTO v_pid FROM public.storefront_pages p WHERE p.slug = 'home' LIMIT 1;
  IF v_pid IS NOT NULL THEN
    INSERT INTO public.storefront_page_sections (page_id, type, position, props)
    VALUES (v_pid, 'rich-text', 9999, '{"markdown":"verify-probe"}'::jsonb)
    RETURNING id INTO v_sec_id;
    SELECT updated_at INTO v_base FROM public.storefront_page_sections WHERE id = v_sec_id;

    UPDATE public.storefront_page_sections SET props = props
    WHERE id = v_sec_id AND updated_at = v_base - interval '1 hour';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 0 THEN
      RAISE EXCEPTION 'stale-base save predicate matched % rows (expected 0) — clobber detection dead', v_rows;
    END IF;

    UPDATE public.storefront_page_sections SET props = props
    WHERE id = v_sec_id AND updated_at = v_base;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'current-base save predicate matched % rows (expected 1)', v_rows;
    END IF;

    DELETE FROM public.storefront_page_sections WHERE id = v_sec_id;
  END IF;
END $$;

