-- Phase 1, task 2: pending-order cleanup + state-transition safeguards.
--
-- Two separate problems are fixed here.
--
-- A. Stuck/orphaned pending rows. The Woo importer and older checkout code
--    wrote free-text statuses ("new", "dispatched", "complete", an empty
--    string) and, on the dispatch path, could persist a consignment while the
--    status update failed — leaving a parcel that is already with the courier
--    parked in "pending" forever. Those rows never surface in an operational
--    tab and never get tracked, so they rot. This migration normalises the
--    values that have unambiguous canonical meanings and repairs the
--    consignment/status mismatch.
--
-- B. Future writes cannot recreate the mess. A BEFORE INSERT/UPDATE trigger
--    canonicalises the status on every write and refuses to move a merged
--    source order back into an active state (that would resurrect the absorbed
--    money and re-inflate the merged total, the bug Task 13 fixes in the
--    aggregates).
--
-- Statuses are intentionally NOT whitelisted: the app evolves them (pre-order
-- stages, courier-derived statuses). The trigger only maps the aliases we know
-- and enforces the two invariants; anything else is preserved verbatim so a
-- new status never gets silently rewritten.
--
-- Rollback: drop the trigger and function; the data normalisation is
-- one-directional but only touches spellings that were already broken.

begin;

-- ── A. Backfill ────────────────────────────────────────────────────────────

-- Empty / whitespace / NULL status → pending (the column default).
update public.orders
set status = 'pending'
where status is null or btrim(status) = '';

-- Alias spellings written by the importer and pre-revamp checkout.
update public.orders
set status = case lower(btrim(status))
  when 'new' then 'pending'
  when 'pending_payment' then 'payment_pending'
  when 'ready' then 'ready_to_ship'
  when 'dispatched' then 'shipped'
  when 'handed_over' then 'shipped'
  when 'in-transit' then 'in_transit'
  when 'out-for-delivery' then 'out_for_delivery'
  when 'complete' then 'completed'
  when 'completed_order' then 'completed'
  when 'success' then 'completed'
  when 'returned_to_merchant' then 'returned'
  when 'cancel' then 'cancelled'
  when 'canceled' then 'cancelled'
  else lower(btrim(status))
end
where status <> lower(btrim(status))
   or lower(btrim(status)) in (
     'new','pending_payment','ready','dispatched','handed_over','in-transit',
     'out-for-delivery','complete','completed_order','success',
     'returned_to_merchant','cancel','canceled'
   );

-- Already handed to a courier but still "pending": the parcel is not pending,
-- it is waiting for pickup. (DispatchDialog writes pickup_pending on success;
-- rows that lost that write are repaired here.)
update public.orders
set status = 'pickup_pending'
where status = 'pending'
  and consignment_id is not null
  and btrim(consignment_id) <> '';

-- A merged source order that was never linked to its parent is orphaned: the
-- merged order exists, but the history chain does not. Leave the status alone
-- (the money was already counted once in the parent) — just make the missing
-- link visible to operators via the audit trail instead of silently dropping
-- it. Nothing to rewrite; documented here so the behaviour is intentional.

alter table public.orders alter column status set default 'pending';

-- ── B. Guard ───────────────────────────────────────────────────────────────

create or replace function public.normalize_order_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s text;
begin
  s := lower(btrim(coalesce(new.status, '')));

  if s = '' then
    s := 'pending';
  else
    s := case s
      when 'new' then 'pending'
      when 'pending_payment' then 'payment_pending'
      when 'ready' then 'ready_to_ship'
      when 'dispatched' then 'shipped'
      when 'handed_over' then 'shipped'
      when 'in-transit' then 'in_transit'
      when 'out-for-delivery' then 'out_for_delivery'
      when 'complete' then 'completed'
      when 'completed_order' then 'completed'
      when 'success' then 'completed'
      when 'returned_to_merchant' then 'returned'
      when 'cancel' then 'cancelled'
      when 'canceled' then 'cancelled'
      else s
    end;
  end if;

  -- Invariant 1: a parcel with a consignment is never "pending".
  if s = 'pending'
     and new.consignment_id is not null
     and btrim(new.consignment_id) <> '' then
    s := 'pickup_pending';
  end if;

  -- Invariant 2: a merged source order stays merged. Un-merging would make the
  -- absorbed money visible again next to the merged parent's total.
  if tg_op = 'UPDATE'
     and old.status = 'merged'
     and s <> 'merged' then
    raise exception
      'order % is a merged source order; its status cannot change from "merged" to "%"',
      new.id, s
      using hint = 'Merge is one-way. Create a new order instead of reviving an absorbed one.';
  end if;

  new.status := s;
  return new;
end;
$$;

drop trigger if exists trg_orders_normalize_status on public.orders;
create trigger trg_orders_normalize_status
  before insert or update of status, consignment_id on public.orders
  for each row execute function public.normalize_order_status();

-- ── C. Indexes for the Orders page (task 4a) ──────────────────────────────
-- The list query is "everything in scope, newest first"; without these the
-- planner sorts the whole table on every visit. IF NOT EXISTS keeps re-runs
-- cheap, and CONCURRENTLY is deliberately avoided so this can run inside the
-- migration transaction.

create index if not exists idx_orders_created_at_id on public.orders (created_at desc, id);
create index if not exists idx_orders_business_created on public.orders (business_id, created_at desc);
create index if not exists idx_orders_store_created on public.orders (store_id, created_at desc);
create index if not exists idx_orders_source_created on public.orders (order_source_id, created_at desc);
create index if not exists idx_orders_status_created on public.orders (status, created_at desc);
create index if not exists idx_order_items_order_id on public.order_items (order_id);
create index if not exists idx_product_categories_product on public.product_categories (product_id);

commit;