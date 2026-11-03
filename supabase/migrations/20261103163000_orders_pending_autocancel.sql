-- Pending-order cancellation: one-time backlog clear + standing auto-cancel.
--
-- Decision (2026-11-03): every order parked in "pending" is dead weight — the
-- backlog gets cancelled once, and a scheduled job keeps it from rebuilding by
-- cancelling any future order that sits in "pending" for over 72 hours.
--
-- What counts as "pending": status 'pending' plus its legacy importer spelling
-- 'new' (the state-guard migration maps 'new' → 'pending'; this works with or
-- without that migration applied).
--
-- Deliberately NOT cancelled (each exclusion mirrors an app behaviour):
--   * consignment_id set  — the parcel is physically with the courier; the
--     state guard reclassifies those to 'pickup_pending' (Orders.tsx shows them
--     under Pickup Pending, not New).
--   * deleted_at set      — soft-deleted orders stay deleted, untouched.
--   * COD orders containing pre-order items — the Orders page auto-promotes
--     exactly those to 'pre_order_pending' on load (Orders.tsx "auto:
--     cod_pre_order"); cancelling them would fight the app.
--   * payment_status 'paid' or 'partial' — money is already attached; cancelling
--     a paid order is a refund decision, not a cleanup job. These are reported
--     in the result so a human can review them.
--
-- Every cancellation writes an order_timeline row ("Status changed from
-- "pending" to "cancelled" (auto: …)") so the order detail sheet shows why.
--
-- Rollback: cancelled is a normal status — orders can be moved back manually;
-- drop the function and cron.unschedule('auto-cancel-stale-pending-orders') to
-- stop the job.

begin;

-- Mass status changes must never feed the WooCommerce push pipeline. The retire
-- migration (20261103160000) drops this trigger with the rest of the Woo
-- machinery; dropping it here too keeps this file safe to run on a database
-- where the retire migration has not landed yet — otherwise every cancellation
-- below would enqueue a push_order row and the Woo cron would try to push them.
drop trigger if exists trg_auto_push_order_status on public.orders;

-- ── A. The cancellation routine ────────────────────────────────────────────
-- p_older_than_hours = 0 means "everything pending right now" (the one-time
-- backlog clear); the cron job calls it with 72.

create or replace function public.auto_cancel_stale_pending_orders(
  p_older_than_hours integer default 72
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hours            integer := greatest(coalesce(p_older_than_hours, 72), 0);
  v_preorder_cats    uuid[];
  v_reason           text;
  v_cancelled        integer;
  v_skipped_consigned integer;
  v_skipped_preorder integer;
  v_skipped_paid     integer;
begin
  -- Pre-order category ids from app_settings, expanded to include descendants
  -- (same rule the app applies: selecting a parent covers its children).
  with recursive roots as (
    select el::text::uuid as id
    from public.app_settings s,
         jsonb_array_elements_text(coalesce(s.value -> 'ids', '[]'::jsonb)) el
    where s.key = 'preorder_category_ids'
  ),
  expanded as (
    select id from roots
    union
    select c.id from public.categories c join expanded e on c.parent_id = e.id
  )
  select coalesce(array_agg(id), array[]::uuid[])
  into v_preorder_cats
  from expanded;

  if v_hours = 0 then
    v_reason := 'bulk_cancel';
  else
    v_reason := 'stale_pending_auto_cancel';
  end if;

  -- Diagnostics only: how many pending rows each guard skipped, so the caller
  -- can see what was deliberately left alone.
  select count(*) into v_skipped_consigned
  from public.orders o
  where o.status in ('pending', 'new')
    and o.deleted_at is null
    and o.created_at < now() - make_interval(hours => v_hours)
    and o.consignment_id is not null and btrim(o.consignment_id) <> '';

  select count(*) into v_skipped_paid
  from public.orders o
  where o.status in ('pending', 'new')
    and o.deleted_at is null
    and o.created_at < now() - make_interval(hours => v_hours)
    and (o.consignment_id is null or btrim(o.consignment_id) = '')
    and o.payment_status in ('paid', 'partial');

  select count(*) into v_skipped_preorder
  from public.orders o
  where o.status in ('pending', 'new')
    and o.deleted_at is null
    and o.created_at < now() - make_interval(hours => v_hours)
    and (o.consignment_id is null or btrim(o.consignment_id) = '')
    and o.payment_status not in ('paid', 'partial')
    and (coalesce(o.payment_method, '') ilike '%cod%' or coalesce(o.payment_method, '') ilike '%cash on delivery%')
    and v_preorder_cats <> array[]::uuid[]
    and exists (
      select 1 from public.order_items oi
      join public.product_categories pc on pc.product_id = oi.product_id
      where oi.order_id = o.id and pc.category_id = any(v_preorder_cats)
    );

  with targets as (
    select o.id, o.status
    from public.orders o
    where o.status in ('pending', 'new')
      and o.deleted_at is null
      and o.created_at < now() - make_interval(hours => v_hours)
      and (o.consignment_id is null or btrim(o.consignment_id) = '')
      and o.payment_status not in ('paid', 'partial')
      and not (
        (coalesce(o.payment_method, '') ilike '%cod%' or coalesce(o.payment_method, '') ilike '%cash on delivery%')
        and v_preorder_cats <> array[]::uuid[]
        and exists (
          select 1 from public.order_items oi
          join public.product_categories pc on pc.product_id = oi.product_id
          where oi.order_id = o.id and pc.category_id = any(v_preorder_cats)
        )
      )
  ),
  upd as (
    update public.orders o
    set status = 'cancelled',
        updated_at = now()
    from targets t
    where o.id = t.id
    returning o.id, t.status as old_status
  ),
  ins as (
    insert into public.order_timeline (order_id, event, description, metadata)
    select upd.id,
           'status_changed',
           format('Status changed from "%s" to "cancelled" (auto: %s)',
                  upd.old_status,
                  case when v_hours = 0 then 'bulk cancel'
                       else 'stale pending over ' || v_hours || 'h' end),
           jsonb_build_object(
             'from', upd.old_status,
             'to', 'cancelled',
             'auto', true,
             'reason', v_reason,
             'older_than_hours', v_hours,
             'user_name', 'system'
           )
    from upd
  )
  select count(*) into v_cancelled from upd;

  return jsonb_build_object(
    'cancelled', v_cancelled,
    'skipped_with_consignment', v_skipped_consigned,
    'skipped_paid_or_partial', v_skipped_paid,
    'skipped_cod_preorder', v_skipped_preorder,
    'older_than_hours', v_hours,
    'reason', v_reason
  );
end;
$$;

-- The job runs as the scheduling role with no user attached; keep the function
-- out of reach of the API roles so an anon/authenticated caller can never
-- trigger a mass cancellation over RPC.
revoke execute on function public.auto_cancel_stale_pending_orders(integer)
  from public, anon, authenticated;

-- ── B. Standing hourly job: cancel pending orders older than 72 hours ──────

do $$
begin
  perform cron.unschedule('auto-cancel-stale-pending-orders');
exception when others then null;  -- absent job is fine
end $$;

select cron.schedule(
  'auto-cancel-stale-pending-orders',
  '23 * * * *',  -- hourly at :23, off the busy :00 minute
  $$ select public.auto_cancel_stale_pending_orders(72); $$
);

-- ── C. One-time backlog clear ──────────────────────────────────────────────
-- Cancels every order currently sitting in pending (minus the guards above).
-- Guarded by an app_settings flag so re-running this file — in the SQL editor
-- today, or via `supabase db push` months later — never cancels a second
-- batch: the flag is set only after the first successful run.

do $$
declare
  v_result jsonb;
  v_done   boolean;
begin
  select coalesce((v.value ->> 'done')::boolean, false)
  into v_done
  from public.app_settings v
  where v.key = 'pending_order_backfill_cancel';

  if v_done then
    raise notice 'One-time pending-order cancel already ran; skipping.';
  else
    v_result := public.auto_cancel_stale_pending_orders(0);

    insert into public.app_settings as s (key, value, updated_at)
    values (
      'pending_order_backfill_cancel',
      jsonb_build_object('done', true, 'ran_at', now(), 'result', v_result),
      now()
    )
    on conflict (key) do update
      set value      = excluded.value,
          updated_at = now();

    raise notice 'One-time pending-order cancel: %', v_result;
  end if;
end $$;

commit;
