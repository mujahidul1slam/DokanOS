-- Rollback-only regression test for resolve_woocommerce_sync_conflict.
--
-- Covers the 'replayed' resolution specifically. It was accepted by the RPC's
-- allowlist while the column CHECK (20261110090000:305) still listed only
-- 'pending', 'accepted_external', 'kept_local', 'dismissed'. The UPDATE then
-- raised 23514 *after* the re-enqueue decision, rolling back the whole call:
-- no resolution recorded, no work created, and the operator saw a raw
-- constraint-violation string. 20261110110000 now widens the CHECK.
BEGIN;

DO $$
DECLARE
  business uuid := '11111111-0000-0000-0000-000000000001';
  actor uuid := '00000000-0000-0000-0000-0000000000aa';
  brand uuid := '8a000000-0000-0000-0000-00000000cf01';
  store uuid := '89000000-0000-0000-0000-00000000cf01';
  source uuid := '88000000-0000-0000-0000-00000000cf01';
  connector uuid := '8c000000-0000-0000-0000-00000000cf01';
  conflict_id uuid;
  result jsonb;
  stored text;
  work_count integer;
BEGIN
  INSERT INTO auth.users(id, instance_id, aud, role, email, created_at, updated_at)
  VALUES (actor, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conflict-test@example.invalid', now(), now());

  INSERT INTO public.user_business_access(user_id, business_id, role)
  VALUES (actor, business, 'owner');

  INSERT INTO public.stores(id, name, url) VALUES (store, 'Conflict resolution test store', 'https://conflict-resolution.invalid');
  INSERT INTO public.brands(id, business_id, name, slug, woo_store_id)
  VALUES (brand, business, 'Conflict resolution test brand', 'conflict-resolution-test', store);
  INSERT INTO public.order_sources(id, brand_id, name, type)
  VALUES (source, brand, 'Conflict resolution source', 'woocommerce');
  -- intake_enabled defaults to false, and a connector with intake off is
  -- deliberately contained: the resolution is recorded but no work is created.
  -- This test wants the re-enqueue path, so intake must be on.
  INSERT INTO public.woocommerce_connectors(id, business_id, brand_id, store_id, order_source_id, external_store_url, external_store_key, credentials_ref, webhook_secret_ref, status, intake_enabled)
  VALUES (connector, business, brand, store, source, 'https://conflict-resolution.invalid', 'https://conflict-resolution.invalid', 'LOCAL_TEST_CREDENTIAL', 'LOCAL_TEST_SECRET', 'healthy', true);

  INSERT INTO public.woocommerce_sync_conflicts(connector_id, external_order_id, reason)
  VALUES (connector, 99501, 'stale_external_state')
  RETURNING id INTO conflict_id;

  -- Act as the owner: auth.uid() reads this claim.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', actor, 'role', 'authenticated')::text, true);

  result := public.resolve_woocommerce_sync_conflict(conflict_id, 'replayed', 'operator replay');

  SELECT resolution INTO stored FROM public.woocommerce_sync_conflicts WHERE id = conflict_id;
  IF stored IS DISTINCT FROM 'replayed' THEN
    RAISE EXCEPTION 'replayed resolution was not stored (got %)', coalesce(stored, '<null>');
  END IF;
  IF (SELECT resolution_note FROM public.woocommerce_sync_conflicts WHERE id = conflict_id) <> 'operator replay' THEN
    RAISE EXCEPTION 'resolution note was not stored';
  END IF;

  -- A replay must create exactly one reconciliation work row pointing at the conflict.
  SELECT count(*) INTO work_count FROM public.woocommerce_sync_work
   WHERE connector_id = connector AND identity_key = 'correction:conflict:' || conflict_id::text || ':replayed';
  IF work_count <> 1 THEN
    RAISE EXCEPTION 'replayed resolution did not enqueue exactly one work row (got %)', work_count;
  END IF;
  IF (SELECT direction FROM public.woocommerce_sync_work WHERE connector_id = connector AND identity_key LIKE 'correction:conflict:%') <> 'reconciliation' THEN
    RAISE EXCEPTION 'replayed work row is not a reconciliation';
  END IF;
  IF (result->>'reenqueued_work_id') IS NULL THEN
    RAISE EXCEPTION 'result did not report the re-enqueued work id';
  END IF;

  -- Resolving twice is refused, and must not create a second work row.
  BEGIN
    PERFORM public.resolve_woocommerce_sync_conflict(conflict_id, 'replayed', NULL);
    RAISE EXCEPTION 'a second resolution was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'a second resolution was accepted' THEN RAISE; END IF;
    IF SQLERRM <> 'conflict already resolved' THEN
      RAISE EXCEPTION 'unexpected second-resolution error: %', SQLERRM;
    END IF;
  END;

  -- An unknown resolution is still refused.
  INSERT INTO public.woocommerce_sync_conflicts(connector_id, external_order_id, reason)
  VALUES (connector, 99502, 'stale_external_state')
  RETURNING id INTO conflict_id;
  BEGIN
    PERFORM public.resolve_woocommerce_sync_conflict(conflict_id, 'not_a_resolution', NULL);
    RAISE EXCEPTION 'an unknown resolution was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'an unknown resolution was accepted' THEN RAISE; END IF;
    IF SQLERRM <> 'unsupported conflict resolution' THEN
      RAISE EXCEPTION 'unexpected unknown-resolution error: %', SQLERRM;
    END IF;
  END;

  -- 'pending' is still in the constraint for historical rows, but the RPC must
  -- never be able to write it back.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'woocommerce_sync_conflicts_resolution_check'
       AND pg_get_constraintdef(oid) LIKE '%replayed%'
  ) THEN
    RAISE EXCEPTION 'the resolution CHECK was not widened to allow replayed';
  END IF;
END $$;

ROLLBACK;
