-- Phase 1, task 1: retire the legacy WooCommerce integration.
--
-- The app no longer talks to WooCommerce in either direction: the four edge
-- functions (woo-push, woo-sync, woo-sync-all, woo-webhook) and the shared
-- mapping module are deleted, and the frontend no longer reads sync status or
-- pushes stock/prices/notes. What remains in this database is the machinery
-- that used to drive that integration: the sync queue, its webhook log, the
-- cron jobs that drained them, the triggers that enqueued pushes, and the
-- helper functions/RPCs those triggers called.
--
-- Deliberately KEPT (and why):
--   * brands.woo_store_id / stores.woo_store_id — this column is the brand ↔
--     store tenancy seam used by RLS (user_can_access_store) and operational
--     scoping. Removing it is a separate, larger store-model change tracked by
--     the "wire new-model brand stores to operational data" issue.
--   * stores.consumer_key / consumer_secret / status / last_synced_at /
--     circuit_breaker_until — the store model still surfaces them on the
--     Store Health dashboard; they go away with that follow-up, not here.
--   * orders.source = 'woocommerce' historical rows — they are business data
--     (revenue attribution), not integration code; the payment gate still has
--     to recognise them. The WooCommerce order_source TYPE stays in the enum
--     as a legacy/read-only label for those rows.
--   * get_sync_worker_cron_token() — despite the "sync" name this is NOT Woo
--     machinery: it is the shared scheduler auth token read by pathao-courier
--     (track_all) and sync-worker. Dropping it 401s every Pathao tracking run
--     from GitHub Actions / Cloudflare cron. It is therefore excluded from the
--     drop list below and restored by 20261103170000.
--
-- Rollback: re-apply the individual migrations that created the dropped
-- objects (20260802065715, 20260802065800, 20260802065900, 20260803160000,
-- 20260824000000, 20260826000000, 20260829000000, 20260830000000,
-- 20260830000200, 20260903000300). Queue contents are ephemeral; no business
-- data is lost by dropping them.
--
-- Out-of-band cleanup performed alongside this migration (not expressible here):
--   * the six Woo/sync edge function DEPLOYMENTS were deleted from the hosted
--     project (woo-push, woo-sync, woo-sync-all, woo-webhook, sync-worker,
--     sync-alert) and their sources removed from the repo — the repo had
--     already deleted the first four, but the deployments kept running;
--   * vault secret 'woo_sync_cron_token' and GitHub repo secret
--     WOO_SYNC_CRON_TOKEN were deleted (nothing reads either now);
--   * workflows sync-worker.yml and woo-sync-all.yml were deleted;
--   * cloudflare/dokanos-cron.js was reduced to the Pathao poll only.
-- The surviving scheduler token is vault secret 'sync_worker_cron_token'
-- (still used by pathao-courier track_all).

begin;

-- 1. Stop the Woo workers. pg_cron throws when a job is absent, so each
--    unschedule is isolated: a fresh database where the job never existed must
--    not fail the migration.
do $$
begin
  begin
    perform cron.unschedule('woo-sync-all-15min');
  exception when others then
    raise notice 'cron job woo-sync-all-15min not present (ok)';
  end;
  begin
    perform cron.unschedule('process_sync_queue_5min');
  exception when others then
    raise notice 'cron job process_sync_queue_5min not present (ok)';
  end;
end $$;

-- 2. Triggers that enqueued Woo pushes on order/product/variation writes.
drop trigger if exists trg_auto_push_order_status on public.orders;
drop trigger if exists trg_auto_push_product_stock on public.products;
drop trigger if exists trg_auto_push_variation_stock on public.product_variations;

-- 3. Helper functions and RPCs the queue/cron used. Dropped by name through
--    pg_proc so overloads (and signatures we no longer know exactly) go too.
do $$
declare
  fn record;
  names text[] := array[
    'auto_push_order_to_woo',
    'auto_push_product_stock',
    'auto_push_variation_stock',
    'enqueue_order_push',
    'claim_sync_queue_batch',
    'recover_orphaned_sync_rows',
    'bump_store_sync_failure',
    'get_woo_sync_cron_token',
    'get_sync_alert_webhook_url',
    -- get_sync_worker_cron_token is deliberately NOT listed: it is the shared
    -- scheduler token used by pathao-courier too (see header).
    'verify_push_triggers'
  ];
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (names)
  loop
    execute format('drop function %s cascade', fn.sig);
  end loop;
end $$;

-- 4. Sync telemetry. sync_health is a view over the queue and webhook log, so
--    it has to go with them; the dashboard cards that consumed it are deleted
--    in the same change.
drop view if exists public.sync_health cascade;
drop table if exists public.sync_queue_cleanup_log cascade;
drop table if exists public.webhook_events cascade;
drop table if exists public.sync_queue cascade;

-- 5. Woo-only identity columns. These were the join keys the integrator used
--    to recognise "same product/order/customer" across the two systems; with
--    the integrator gone they are inert. The store binding columns on brands
--    and stores are intentionally NOT touched (see header).
alter table public.products            drop column if exists woo_product_id;
alter table public.product_variations  drop column if exists woo_variation_id;
alter table public.orders              drop column if exists woo_order_id;
alter table public.customers           drop column if exists woo_customer_id;

commit;