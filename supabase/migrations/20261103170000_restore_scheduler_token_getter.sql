-- Hotfix for 20261103160000_retire_woocommerce_integration.
--
-- That migration dropped public.get_sync_worker_cron_token() as part of the Woo
-- teardown, on the assumption that a "sync_*" getter belonged to the Woo
-- machinery. It does not: the function was introduced by
-- 20260901000000_scheduler_auth_and_courier_tokens.sql as the SHARED scheduler
-- auth token, and both pathao-courier (action=track_all) and sync-worker check
-- their x-cron-secret header against it.
--
-- Consequence of the drop, observed on the hosted project immediately after the
-- push: every scheduled Pathao tracking run (.github/workflows/pathao-tracking.yml
-- and the Cloudflare cron worker) calls pathao-courier with an anon bearer plus
-- x-cron-secret. That lands on supabase/functions/pathao-courier/index.ts:604,
-- whose RPC now 404s (PGRST202), so `token` is null and the function returns 401
-- Unauthorized. Pathao tracking silently stops while the workflow only sees a
-- non-200.
--
-- This migration restores the function verbatim (same definition, same
-- service_role-only grant) and re-asserts the vault secret it reads, so a fresh
-- database that replays the whole chain also ends up correct.
--
-- The 16:00 migration's drop list has been corrected in place to stop listing
-- this function, so its behaviour on the hosted project (already applied) is
-- repaired here rather than by editing history that has already run.

begin;

-- The secret is created by 20260901000000; re-assert idempotently so the getter
-- can never return NULL just because that step was skipped on some environment.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'sync_worker_cron_token') then
    perform vault.create_secret(
      'z4i13r8XGeY2ASnPhyabNQ20IviKCGoA',
      'sync_worker_cron_token',
      'Scheduler auth token for sync-worker + pathao track_all (GitHub Actions / Cloudflare cron)'
    );
  end if;
end $$;

create or replace function public.get_sync_worker_cron_token()
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'sync_worker_cron_token' limit 1;
$$;

revoke all on function public.get_sync_worker_cron_token() from public, anon, authenticated;
grant execute on function public.get_sync_worker_cron_token() to service_role;

commit;
