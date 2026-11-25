-- Issue 55: the WooCommerce connector surface is the project's first
-- credential-bearing integration, and none of its eleven tables were covered by
-- the RLS battery. This file pins the tenant boundary that matters:
--
--   * `woocommerce_connectors` is the only table with an authenticated write
--     path, and only for business owner/admin (`Woo connector owner admin can
--     write`, 20261110093000). Every other table carries a SELECT-only policy
--     (`Woo scoped members read <table>`, 20261110090000 /
--     20261110093100), so authenticated INSERT/UPDATE/DELETE is refused by
--     default-deny even though the table grants exist.
--   * Every policy resolves the tenant through connector -> business ->
--     is_business_member(), so a member of another business sees zero rows.
--   * `resolve_woocommerce_sync_conflict` (20261110110000) is the single
--     authorized writer of a conflict resolution and is owner/admin-only; it
--     raises 'conflict not found or unauthorized' (P0001) rather than a
--     privilege error, so the denials below catch P0001.
--
-- Fixture ids per scripts/run-rls-tests.mjs (_harness.md):
--   OWNER_A   ...0001 owner of BIZ_A      UBA_ADMIN_A ...0003 admin of BIZ_A
--   MEMBER_A  ...0004 manager of BIZ_A    VIEWER_A    ...0005 staff of BIZ_A
--   OWNER_B   ...0006 owner of BIZ_B      OUTSIDER    ...0007 no memberships
--   BIZ_A 11111111-0000-0000-0000-000000000001
--   BIZ_B 11111111-0000-0000-0000-000000000002
--
-- The WooCommerce fixtures below are seeded on the privileged connection before
-- SET LOCAL ROLE (RLS applies to `authenticated` only), and the membership rows
-- this file depends on are re-pinned here because earlier battery files commit
-- role changes. One transaction, rolled back at the end.

BEGIN;

INSERT INTO public.stores (id, name, url)
VALUES
  ('8f000000-0000-0000-0000-0000000000a1', 'Woo Store A', 'https://woo-a.test'),
  ('8f000000-0000-0000-0000-0000000000b1', 'Woo Store B', 'https://woo-b.test');
INSERT INTO public.brands (id, business_id, name, slug, woo_store_id)
VALUES
  ('8e000000-0000-0000-0000-0000000000a1', '11111111-0000-0000-0000-000000000001',
   'Woo Brand A', 'woo-brand-a', '8f000000-0000-0000-0000-0000000000a1'),
  ('8e000000-0000-0000-0000-0000000000b1', '11111111-0000-0000-0000-000000000002',
   'Woo Brand B', 'woo-brand-b', '8f000000-0000-0000-0000-0000000000b1');
INSERT INTO public.order_sources (id, brand_id, name, type)
VALUES
  ('8d000000-0000-0000-0000-0000000000a1', '8e000000-0000-0000-0000-0000000000a1', 'Woo Source A', 'woocommerce'),
  ('8d000000-0000-0000-0000-0000000000b1', '8e000000-0000-0000-0000-0000000000b1', 'Woo Source B', 'woocommerce');
INSERT INTO public.woocommerce_connectors
  (id, business_id, brand_id, store_id, order_source_id,
   external_store_url, external_store_key, credentials_ref, webhook_secret_ref, status)
VALUES
  ('8c000000-0000-0000-0000-0000000000a1', '11111111-0000-0000-0000-000000000001',
   '8e000000-0000-0000-0000-0000000000a1', '8f000000-0000-0000-0000-0000000000a1',
   '8d000000-0000-0000-0000-0000000000a1', 'https://woo-a.test', 'https://woo-a.test',
   'ISSUE55_CRED_A', 'ISSUE55_SECRET_A', 'healthy'),
  ('8c000000-0000-0000-0000-0000000000b1', '11111111-0000-0000-0000-000000000002',
   '8e000000-0000-0000-0000-0000000000b1', '8f000000-0000-0000-0000-0000000000b1',
   '8d000000-0000-0000-0000-0000000000b1', 'https://woo-b.test', 'https://woo-b.test',
   'ISSUE55_CRED_B', 'ISSUE55_SECRET_B', 'healthy');
INSERT INTO public.orders (id, store_id, order_number, order_source_id, business_id, customer_name)
VALUES
  ('8b000000-0000-0000-0000-0000000000a1', '8f000000-0000-0000-0000-0000000000a1',
   'ISSUE55-A-1', '8d000000-0000-0000-0000-0000000000a1', '11111111-0000-0000-0000-000000000001', 'Woo Buyer A'),
  ('8b000000-0000-0000-0000-0000000000b1', '8f000000-0000-0000-0000-0000000000b1',
   'ISSUE55-B-1', '8d000000-0000-0000-0000-0000000000b1', '11111111-0000-0000-0000-000000000002', 'Woo Buyer B');
INSERT INTO public.woocommerce_order_identities (id, connector_id, external_order_id, order_id, external_order_number)
VALUES
  ('8a000000-0000-0000-0000-0000000000a1', '8c000000-0000-0000-0000-0000000000a1', 550001, '8b000000-0000-0000-0000-0000000000a1', 'ISSUE55-A-1'),
  ('8a000000-0000-0000-0000-0000000000b1', '8c000000-0000-0000-0000-0000000000b1', 550002, '8b000000-0000-0000-0000-0000000000b1', 'ISSUE55-B-1');
INSERT INTO public.woocommerce_webhook_deliveries (id, connector_id, delivery_fingerprint, raw_body, verification_result)
VALUES
  ('89000000-0000-0000-0000-0000000000a1', '8c000000-0000-0000-0000-0000000000a1', 'issue55-fp-a', '\x00'::bytea, 'accepted'),
  ('89000000-0000-0000-0000-0000000000b1', '8c000000-0000-0000-0000-0000000000b1', 'issue55-fp-b', '\x00'::bytea, 'accepted');
INSERT INTO public.woocommerce_webhook_rejections (id, connector_id, raw_body, reason)
VALUES
  ('88000000-0000-0000-0000-0000000000a1', '8c000000-0000-0000-0000-0000000000a1', '\x00'::bytea, 'signature_missing'),
  ('88000000-0000-0000-0000-0000000000b1', '8c000000-0000-0000-0000-0000000000b1', '\x00'::bytea, 'signature_missing');
INSERT INTO public.woocommerce_sync_work (id, connector_id, direction, kind, identity_key, state)
VALUES
  ('87000000-0000-0000-0000-0000000000a1', '8c000000-0000-0000-0000-0000000000a1', 'inbound', 'webhook', 'issue55-work-a', 'pending'),
  ('87000000-0000-0000-0000-0000000000b1', '8c000000-0000-0000-0000-0000000000b1', 'inbound', 'webhook', 'issue55-work-b', 'pending');
INSERT INTO public.woocommerce_sync_corrections
  (id, original_work_id, connector_id, correction_key, reason, corrected_payload)
VALUES
  ('86000000-0000-0000-0000-0000000000a1', '87000000-0000-0000-0000-0000000000a1',
   '8c000000-0000-0000-0000-0000000000a1', 'issue55-correction-a', 'operator_repair', '{}'::jsonb),
  ('86000000-0000-0000-0000-0000000000b1', '87000000-0000-0000-0000-0000000000b1',
   '8c000000-0000-0000-0000-0000000000b1', 'issue55-correction-b', 'operator_repair', '{}'::jsonb);
INSERT INTO public.woocommerce_outbound_writes
  (id, connector_id, external_order_id, target_status, origin, idempotency_key)
VALUES
  ('85000000-0000-0000-0000-0000000000a1', '8c000000-0000-0000-0000-0000000000a1', 550001, 'completed', 'accepted', 'issue55-ow-a'),
  ('85000000-0000-0000-0000-0000000000b1', '8c000000-0000-0000-0000-0000000000b1', 550002, 'completed', 'accepted', 'issue55-ow-b');
INSERT INTO public.woocommerce_reconciliation_runs
  (id, connector_id, window_start, window_end, state)
VALUES
  ('84000000-0000-0000-0000-0000000000a1', '8c000000-0000-0000-0000-0000000000a1',
   now() - interval '1 hour', now(), 'succeeded'),
  ('84000000-0000-0000-0000-0000000000b1', '8c000000-0000-0000-0000-0000000000b1',
   now() - interval '1 hour', now(), 'succeeded');
INSERT INTO public.woocommerce_sync_conflicts (id, connector_id, external_order_id, order_id, reason)
VALUES
  ('83000000-0000-0000-0000-0000000000a1', '8c000000-0000-0000-0000-0000000000a1', 550001,
   '8b000000-0000-0000-0000-0000000000a1', 'unsupported_status'),
  ('83000000-0000-0000-0000-0000000000a2', '8c000000-0000-0000-0000-0000000000a1', 550001, NULL, 'stale_external_state'),
  ('83000000-0000-0000-0000-0000000000b1', '8c000000-0000-0000-0000-0000000000b1', 550002,
   '8b000000-0000-0000-0000-0000000000b1', 'unsupported_status');
INSERT INTO public.woocommerce_cutover_runs
  (id, connector_id, mode, webhook_id, webhook_verified_at, watermark, window_start, window_end, state)
VALUES
  ('82000000-0000-0000-0000-0000000000a1', '8c000000-0000-0000-0000-0000000000a1', 'dry_run', 42,
   now(), now(), now() - interval '7 days', now(), 'dry_run_complete'),
  ('82000000-0000-0000-0000-0000000000b1', '8c000000-0000-0000-0000-0000000000b1', 'dry_run', 43,
   now(), now(), now() - interval '7 days', now(), 'dry_run_complete');
INSERT INTO public.woocommerce_cutover_report_items
  (id, run_id, connector_id, match_kind, outcome)
VALUES
  ('81000000-0000-0000-0000-0000000000a1', '82000000-0000-0000-0000-0000000000a1',
   '8c000000-0000-0000-0000-0000000000a1', 'exact', 'already_known'),
  ('81000000-0000-0000-0000-0000000000b1', '82000000-0000-0000-0000-0000000000b1',
   '8c000000-0000-0000-0000-0000000000b1', 'exact', 'already_known');

-- Earlier battery files commit membership-role changes; re-pin the roles this
-- file reasons about so its verdict never depends on run order.
UPDATE public.user_business_access SET role = 'owner'
 WHERE business_id = '11111111-0000-0000-0000-000000000001' AND user_id = '00000000-0000-0000-0000-000000000001';
UPDATE public.user_business_access SET role = 'admin'
 WHERE business_id = '11111111-0000-0000-0000-000000000001' AND user_id = '00000000-0000-0000-0000-000000000003';
UPDATE public.user_business_access SET role = 'manager'
 WHERE business_id = '11111111-0000-0000-0000-000000000001' AND user_id = '00000000-0000-0000-0000-000000000004';
UPDATE public.user_business_access SET role = 'staff'
 WHERE business_id = '11111111-0000-0000-0000-000000000001' AND user_id = '00000000-0000-0000-0000-000000000005';
UPDATE public.user_business_access SET role = 'owner'
 WHERE business_id = '11111111-0000-0000-0000-000000000002' AND user_id = '00000000-0000-0000-0000-000000000006';

-- The connector scope trigger is the pre-condition for everything below: it
-- pins brand.business_id = connector.business_id and the woocommerce order
-- source, and it rejects a mismatched triple.
DO $$
BEGIN
  IF (SELECT count(*) FROM public.woocommerce_connectors
      WHERE id IN ('8c000000-0000-0000-0000-0000000000a1', '8c000000-0000-0000-0000-0000000000b1')) <> 2 THEN
    RAISE EXCEPTION 'FAIL: connector fixtures did not seed' USING ERRCODE = 'P0001';
  END IF;
  BEGIN
    INSERT INTO public.woocommerce_connectors
      (business_id, brand_id, store_id, order_source_id, external_store_url, external_store_key,
       credentials_ref, webhook_secret_ref)
    VALUES ('11111111-0000-0000-0000-000000000001', '8e000000-0000-0000-0000-0000000000b1',
            '8f000000-0000-0000-0000-0000000000a1', '8d000000-0000-0000-0000-0000000000b1',
            'https://woo-x.test', 'https://woo-x.test', 'ISSUE55_X', 'ISSUE55_XS');
    RAISE EXCEPTION 'FAIL: connector accepted a foreign brand/store/source triple' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'FAIL: connector accepted a foreign brand/store/source triple' THEN NULL; ELSE RAISE; END IF;
  END;
END $$;

-- ---------------------------------------------------------------------------
-- AC-1: Biz A members read their own connector rows and zero of Biz B's.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
DO $$
BEGIN
  IF (SELECT count(*) FROM public.woocommerce_connectors
      WHERE business_id = '11111111-0000-0000-0000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'FAIL: member cannot read own-business connectors' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.woocommerce_connectors
      WHERE business_id = '11111111-0000-0000-0000-000000000002') <> 0 THEN
    RAISE EXCEPTION 'FAIL: member read another business''s connector' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.woocommerce_connectors
             WHERE id = '8c000000-0000-0000-0000-0000000000b1') THEN
    RAISE EXCEPTION 'FAIL: member addressed a foreign connector by id' USING ERRCODE = 'P0001';
  END IF;
END $$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- AC-2: the connector-scoped operations tables inherit that boundary. Every one
-- of them is read-only for `authenticated` (SELECT-only policy), so the same
-- session reads its own rows and no foreign row.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
DO $$
BEGIN
  IF (SELECT count(*) FROM public.woocommerce_sync_work
      WHERE connector_id = '8c000000-0000-0000-0000-0000000000a1') <> 1
     OR (SELECT count(*) FROM public.woocommerce_sync_work
         WHERE connector_id = '8c000000-0000-0000-0000-0000000000b1') <> 0 THEN
    RAISE EXCEPTION 'FAIL: sync_work crossed the business boundary' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.woocommerce_sync_conflicts
      WHERE connector_id = '8c000000-0000-0000-0000-0000000000a1') <> 2
     OR (SELECT count(*) FROM public.woocommerce_sync_conflicts
         WHERE connector_id = '8c000000-0000-0000-0000-0000000000b1') <> 0 THEN
    RAISE EXCEPTION 'FAIL: sync_conflicts crossed the business boundary' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.woocommerce_order_identities
      WHERE connector_id = '8c000000-0000-0000-0000-0000000000a1') <> 1
     OR (SELECT count(*) FROM public.woocommerce_order_identities
         WHERE connector_id = '8c000000-0000-0000-0000-0000000000b1') <> 0 THEN
    RAISE EXCEPTION 'FAIL: order_identities crossed the business boundary' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.woocommerce_webhook_deliveries
      WHERE connector_id = '8c000000-0000-0000-0000-0000000000a1') <> 1
     OR (SELECT count(*) FROM public.woocommerce_webhook_deliveries
         WHERE connector_id = '8c000000-0000-0000-0000-0000000000b1') <> 0 THEN
    RAISE EXCEPTION 'FAIL: webhook_deliveries crossed the business boundary' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.woocommerce_webhook_rejections
      WHERE connector_id = '8c000000-0000-0000-0000-0000000000a1') <> 1
     OR (SELECT count(*) FROM public.woocommerce_webhook_rejections
         WHERE connector_id = '8c000000-0000-0000-0000-0000000000b1') <> 0 THEN
    RAISE EXCEPTION 'FAIL: webhook_rejections crossed the business boundary' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.woocommerce_sync_corrections
      WHERE connector_id = '8c000000-0000-0000-0000-0000000000a1') <> 1
     OR (SELECT count(*) FROM public.woocommerce_sync_corrections
         WHERE connector_id = '8c000000-0000-0000-0000-0000000000b1') <> 0 THEN
    RAISE EXCEPTION 'FAIL: sync_corrections crossed the business boundary' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.woocommerce_outbound_writes
      WHERE connector_id = '8c000000-0000-0000-0000-0000000000a1') <> 1
     OR (SELECT count(*) FROM public.woocommerce_outbound_writes
         WHERE connector_id = '8c000000-0000-0000-0000-0000000000b1') <> 0 THEN
    RAISE EXCEPTION 'FAIL: outbound_writes crossed the business boundary' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.woocommerce_reconciliation_runs
      WHERE connector_id = '8c000000-0000-0000-0000-0000000000a1') <> 1
     OR (SELECT count(*) FROM public.woocommerce_reconciliation_runs
         WHERE connector_id = '8c000000-0000-0000-0000-0000000000b1') <> 0 THEN
    RAISE EXCEPTION 'FAIL: reconciliation_runs crossed the business boundary' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.woocommerce_cutover_runs
      WHERE connector_id = '8c000000-0000-0000-0000-0000000000a1') <> 1
     OR (SELECT count(*) FROM public.woocommerce_cutover_runs
         WHERE connector_id = '8c000000-0000-0000-0000-0000000000b1') <> 0 THEN
    RAISE EXCEPTION 'FAIL: cutover_runs crossed the business boundary' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.woocommerce_cutover_report_items
      WHERE connector_id = '8c000000-0000-0000-0000-0000000000a1') <> 1
     OR (SELECT count(*) FROM public.woocommerce_cutover_report_items
         WHERE connector_id = '8c000000-0000-0000-0000-0000000000b1') <> 0 THEN
    RAISE EXCEPTION 'FAIL: cutover_report_items crossed the business boundary' USING ERRCODE = 'P0001';
  END IF;
END $$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- AC-3: the boundary is symmetric — Biz B's owner reads only Biz B.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}';
DO $$
BEGIN
  IF (SELECT count(*) FROM public.woocommerce_connectors
      WHERE business_id = '11111111-0000-0000-0000-000000000002') <> 1 THEN
    RAISE EXCEPTION 'FAIL: Biz B owner cannot read own connector' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.woocommerce_sync_work) <> 1
     OR EXISTS (SELECT 1 FROM public.woocommerce_sync_work
                WHERE connector_id = '8c000000-0000-0000-0000-0000000000a1') THEN
    RAISE EXCEPTION 'FAIL: Biz B owner saw Biz A sync work' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.woocommerce_sync_conflicts
             WHERE connector_id = '8c000000-0000-0000-0000-0000000000a1')
     OR EXISTS (SELECT 1 FROM public.woocommerce_order_identities
                WHERE connector_id = '8c000000-0000-0000-0000-0000000000a1') THEN
    RAISE EXCEPTION 'FAIL: Biz B owner saw Biz A conflicts/identities' USING ERRCODE = 'P0001';
  END IF;
END $$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- AC-4: no authenticated session writes an operations table directly. These
-- tables carry a SELECT-only policy, so the denial is RLS default-deny (42501)
-- even though the table-level DML grants exist — including for an owner/admin,
-- whose write policy exists only on `woocommerce_connectors`.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
DO $$
DECLARE v_rc bigint;
BEGIN
  BEGIN
    INSERT INTO public.woocommerce_webhook_deliveries
      (connector_id, delivery_fingerprint, raw_body, verification_result)
    VALUES ('8c000000-0000-0000-0000-0000000000a1', 'issue55-forged-fp', '\x00'::bytea, 'accepted');
    RAISE EXCEPTION 'FAIL: owner inserted a webhook delivery row' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  BEGIN
    INSERT INTO public.woocommerce_sync_work (connector_id, direction, kind, identity_key, state)
    VALUES ('8c000000-0000-0000-0000-0000000000a1', 'inbound', 'webhook', 'issue55-forged-work', 'pending');
    RAISE EXCEPTION 'FAIL: owner inserted sync work directly' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  BEGIN
    INSERT INTO public.woocommerce_sync_conflicts (connector_id, external_order_id, reason)
    VALUES ('8c000000-0000-0000-0000-0000000000a1', 550003, 'unsupported_status');
    RAISE EXCEPTION 'FAIL: owner inserted a sync conflict directly' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  BEGIN
    INSERT INTO public.woocommerce_order_identities (connector_id, external_order_id, order_id)
    VALUES ('8c000000-0000-0000-0000-0000000000a1', 550004, '8b000000-0000-0000-0000-0000000000a1');
    RAISE EXCEPTION 'FAIL: owner inserted an order identity directly' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  -- UPDATE/DELETE on a SELECT-only table match nothing and affect no row.
  UPDATE public.woocommerce_sync_conflicts SET reason = 'forged'
   WHERE connector_id = '8c000000-0000-0000-0000-0000000000a1';
  GET DIAGNOSTICS v_rc = ROW_COUNT;
  IF v_rc <> 0 THEN
    RAISE EXCEPTION 'FAIL: owner updated % conflict rows directly', v_rc USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.woocommerce_webhook_deliveries
   WHERE connector_id = '8c000000-0000-0000-0000-0000000000a1';
  GET DIAGNOSTICS v_rc = ROW_COUNT;
  IF v_rc <> 0 THEN
    RAISE EXCEPTION 'FAIL: owner deleted % delivery rows directly', v_rc USING ERRCODE = 'P0001';
  END IF;

  -- The conflict state must be exactly as seeded — the direct UPDATE above is
  -- the discriminator that a filtered-out write left no residue.
  IF (SELECT count(*) FROM public.woocommerce_sync_conflicts
      WHERE connector_id = '8c000000-0000-0000-0000-0000000000a1'
        AND resolution IS NULL) <> 2 THEN
    RAISE EXCEPTION 'FAIL: direct writes left conflict residue' USING ERRCODE = 'P0001';
  END IF;
END $$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- AC-5: cutover tables are service_role-only writers — `authenticated` holds
-- SELECT and nothing else (20261110101000), so INSERT fails on privilege rather
-- than on RLS.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    INSERT INTO public.woocommerce_cutover_runs
      (connector_id, mode, webhook_id, webhook_verified_at, watermark, window_start, window_end)
    VALUES ('8c000000-0000-0000-0000-0000000000a1', 'observe', 99, now(), now(),
            now() - interval '1 day', now());
    RAISE EXCEPTION 'FAIL: owner inserted a cutover run' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    INSERT INTO public.woocommerce_cutover_report_items (run_id, connector_id, match_kind, outcome)
    VALUES ('82000000-0000-0000-0000-0000000000a1', '8c000000-0000-0000-0000-0000000000a1',
            'exact', 'matched');
    RAISE EXCEPTION 'FAIL: owner inserted a cutover report item' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- AC-6: `woocommerce_connectors` is the one table with an authenticated write
-- path, and it is owner/admin-only. A non-owner/admin member is refused by the
-- WITH CHECK, so the INSERT raises rather than silently filtering.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    INSERT INTO public.woocommerce_connectors
      (business_id, brand_id, store_id, order_source_id, external_store_url,
       external_store_key, credentials_ref, webhook_secret_ref)
    VALUES ('11111111-0000-0000-0000-000000000001', '8e000000-0000-0000-0000-0000000000a1',
            '8f000000-0000-0000-0000-0000000000a1', '8d000000-0000-0000-0000-0000000000a1',
            'https://woo-mgr.test', 'https://woo-mgr.test', 'ISSUE55_MGR', 'ISSUE55_MGRS');
    RAISE EXCEPTION 'FAIL: non-owner member inserted a connector' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
RESET ROLE;

-- The owner/admin path works, and the scope trigger still guards it.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
DO $$
DECLARE v_rc bigint;
BEGIN
  INSERT INTO public.woocommerce_connectors
    (id, business_id, brand_id, store_id, order_source_id, external_store_url,
     external_store_key, credentials_ref, webhook_secret_ref, status)
  VALUES ('8c000000-0000-0000-0000-0000000000a2', '11111111-0000-0000-0000-000000000001',
          '8e000000-0000-0000-0000-0000000000a1', '8f000000-0000-0000-0000-0000000000a1',
          '8d000000-0000-0000-0000-0000000000a1', 'https://woo-a2.test', 'https://woo-a2.test',
          'ISSUE55_CRED_A2', 'ISSUE55_SECRET_A2', 'paused');
  IF NOT EXISTS (SELECT 1 FROM public.woocommerce_connectors
                 WHERE id = '8c000000-0000-0000-0000-0000000000a2' AND status = 'paused') THEN
    RAISE EXCEPTION 'FAIL: owner could not create a connector' USING ERRCODE = 'P0001';
  END IF;

  -- Cross-business write is filtered, not applied: zero rows, no error.
  UPDATE public.woocommerce_connectors SET status = 'disabled'
   WHERE id = '8c000000-0000-0000-0000-0000000000b1';
  GET DIAGNOSTICS v_rc = ROW_COUNT;
  IF v_rc <> 0 THEN
    RAISE EXCEPTION 'FAIL: Biz A owner updated % foreign connector rows', v_rc USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.woocommerce_connectors WHERE business_id = '11111111-0000-0000-0000-000000000002';
  GET DIAGNOSTICS v_rc = ROW_COUNT;
  IF v_rc <> 0 THEN
    RAISE EXCEPTION 'FAIL: Biz A owner deleted % foreign connector rows', v_rc USING ERRCODE = 'P0001';
  END IF;
END $$;
RESET ROLE;

-- Owner-side survival: the denied cross-business write changed nothing.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.woocommerce_connectors
                 WHERE id = '8c000000-0000-0000-0000-0000000000b1' AND status = 'healthy') THEN
    RAISE EXCEPTION 'FAIL: foreign connector row was modified' USING ERRCODE = 'P0001';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- AC-7: `resolve_woocommerce_sync_conflict` is the only authorized writer of a
-- resolution and admits business owner/admin only. An unauthorized caller is
-- rejected with 'conflict not found or unauthorized' (P0001) — the RPC resolves
-- the tenant server-side, so a foreign conflict id is indistinguishable from a
-- missing one.
-- ---------------------------------------------------------------------------
-- AC-7a: ordinary members and non-members are rejected for their own business.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.resolve_woocommerce_sync_conflict('83000000-0000-0000-0000-0000000000a1', 'dismissed', 'member attempt');
    RAISE EXCEPTION 'FAIL: manager resolved a conflict' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'conflict not found or unauthorized' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.resolve_woocommerce_sync_conflict('83000000-0000-0000-0000-0000000000a1', 'dismissed', 'viewer attempt');
    RAISE EXCEPTION 'FAIL: viewer resolved a conflict' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'conflict not found or unauthorized' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000007","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.resolve_woocommerce_sync_conflict('83000000-0000-0000-0000-0000000000a1', 'dismissed', 'outsider attempt');
    RAISE EXCEPTION 'FAIL: outsider resolved a conflict' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'conflict not found or unauthorized' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;

-- AC-7b: the cross-tenant check — Biz A's owner cannot resolve Biz B's conflict,
-- and Biz B's owner cannot resolve Biz A's.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.resolve_woocommerce_sync_conflict('83000000-0000-0000-0000-0000000000b1', 'dismissed', 'cross tenant');
    RAISE EXCEPTION 'FAIL: Biz A owner resolved a Biz B conflict' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'conflict not found or unauthorized' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.resolve_woocommerce_sync_conflict('83000000-0000-0000-0000-0000000000a1', 'dismissed', 'cross tenant');
    RAISE EXCEPTION 'FAIL: Biz B owner resolved a Biz A conflict' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'conflict not found or unauthorized' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;

-- Nothing above wrote a resolution.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.woocommerce_sync_conflicts WHERE resolution IS NOT NULL) THEN
    RAISE EXCEPTION 'FAIL: a rejected resolution still wrote a decision' USING ERRCODE = 'P0001';
  END IF;
END $$;

-- AC-7c: the authorized path — `admin` of the correct business resolves its own
-- conflict, and the decision is attributed to the caller.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
DO $$
DECLARE v_result jsonb;
BEGIN
  v_result := public.resolve_woocommerce_sync_conflict(
    '83000000-0000-0000-0000-0000000000a1', 'kept_local', 'local fulfilment wins');
  IF v_result->'conflict'->>'resolution' IS DISTINCT FROM 'kept_local' THEN
    RAISE EXCEPTION 'FAIL: admin resolution was not recorded (got %)', v_result->'conflict'->>'resolution'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_result->'conflict'->>'resolved_by' IS DISTINCT FROM '00000000-0000-0000-0000-000000000003' THEN
    RAISE EXCEPTION 'FAIL: resolution was not attributed to the caller' USING ERRCODE = 'P0001';
  END IF;
  IF v_result->>'open_conflict_count' <> '1' THEN
    RAISE EXCEPTION 'FAIL: open_conflict_count was %, expected 1', v_result->>'open_conflict_count'
      USING ERRCODE = 'P0001';
  END IF;
END $$;
RESET ROLE;

-- A second resolution of the same conflict is refused.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.resolve_woocommerce_sync_conflict('83000000-0000-0000-0000-0000000000a1', 'dismissed', 'second opinion');
    RAISE EXCEPTION 'FAIL: an already-resolved conflict was resolved again' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'conflict already resolved' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;

-- AC-7d: the same session resolves Biz B's other conflict — proving the Biz B
-- owner genuinely holds the capability their cross-tenant denial rested on.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}';
DO $$
DECLARE v_result jsonb;
BEGIN
  v_result := public.resolve_woocommerce_sync_conflict(
    '83000000-0000-0000-0000-0000000000b1', 'dismissed', 'operator dismissed');
  IF v_result->'conflict'->>'resolution' IS DISTINCT FROM 'dismissed' THEN
    RAISE EXCEPTION 'FAIL: Biz B owner could not resolve own conflict' USING ERRCODE = 'P0001';
  END IF;
END $$;
RESET ROLE;

-- An unsupported decision is refused before any row changes.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.resolve_woocommerce_sync_conflict('83000000-0000-0000-0000-0000000000a2', 'not_a_resolution', NULL);
    RAISE EXCEPTION 'FAIL: unsupported resolution accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'unsupported conflict resolution' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;

-- Owner-side survival: only the two authorized resolutions persisted.
DO $$
BEGIN
  IF (SELECT count(*) FROM public.woocommerce_sync_conflicts WHERE resolution IS NOT NULL) <> 2 THEN
    RAISE EXCEPTION 'FAIL: unexpected number of persisted resolutions' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.woocommerce_sync_conflicts
                 WHERE id = '83000000-0000-0000-0000-0000000000a2' AND resolution IS NULL) THEN
    RAISE EXCEPTION 'FAIL: refused resolution left residue' USING ERRCODE = 'P0001';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- AC-8: an outsider and a legacy global role see nothing at all.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000007","role":"authenticated"}';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.woocommerce_connectors)
     OR EXISTS (SELECT 1 FROM public.woocommerce_sync_work)
     OR EXISTS (SELECT 1 FROM public.woocommerce_sync_conflicts)
     OR EXISTS (SELECT 1 FROM public.woocommerce_cutover_runs) THEN
    RAISE EXCEPTION 'FAIL: outsider read connector surface data' USING ERRCODE = 'P0001';
  END IF;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.woocommerce_connectors)
     OR EXISTS (SELECT 1 FROM public.woocommerce_sync_conflicts) THEN
    RAISE EXCEPTION 'FAIL: platform admin read connector surface data' USING ERRCODE = 'P0001';
  END IF;
END $$;
RESET ROLE;

ROLLBACK;
