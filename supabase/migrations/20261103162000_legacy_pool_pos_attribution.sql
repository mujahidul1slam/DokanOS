-- Phase 1, task 4b: legacy-pool POS orders and customers — multi-brand
-- attribution, and migration of the remaining POS rows out of the pool.
--
-- The legacy pool is structural: an order whose store_id, storefront_id AND
-- order_source_id are all NULL (and a customer with store_id and
-- origin_order_source_id NULL) predates the unified order-source model. The
-- brief says every remaining row of that kind is a POS order: POS carts can mix
-- products from several brands of one business, so a POS order must show POS as
-- its source while still showing EVERY brand it sold — a single order_source_id
-- cannot express that.
--
-- This migration therefore:
--   1. creates public.order_brands (order ⇄ brand with the money and quantity
--      each brand contributed), derived from order items → products.store_id →
--      brands.woo_store_id;
--   2. keeps it fresh with a trigger on order_items;
--   3. attributes every existing order (not just pool ones) so the Orders grid
--      can show multi-brand POS orders;
--   4. moves remaining pool POS orders onto the brand's POS order source and
--      its stock store, choosing the brand that contributed the most money as
--      the primary attribution;
--   5. does the same for remaining pool customers through their orders.
--
-- It is idempotent: re-running refreshes attribution and re-checks only rows
-- still in the pool. Nothing is deleted.

begin;

-- ── 1. Attribution table ───────────────────────────────────────────────────

create table if not exists public.order_brands (
  order_id   uuid not null references public.orders(id) on delete cascade,
  brand_id   uuid not null references public.brands(id) on delete cascade,
  line_total numeric not null default 0,
  item_count integer not null default 0,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (order_id, brand_id)
);

create index if not exists idx_order_brands_brand on public.order_brands (brand_id);

alter table public.order_brands enable row level security;

-- Reads follow the same tenancy as the order itself: the EXISTS subquery is
-- evaluated with public.orders' own RLS, so a member of another business never
-- sees a row. Writes are restricted to the same visibility; all legitimate
-- writers are service-role/admin paths (trigger, reassignment, merge).
drop policy if exists "order_brands can read visible orders" on public.order_brands;
create policy "order_brands can read visible orders"
  on public.order_brands for select
  using (exists (select 1 from public.orders o where o.id = order_brands.order_id));

drop policy if exists "order_brands can write visible orders" on public.order_brands;
create policy "order_brands can write visible orders"
  on public.order_brands for all
  using (exists (select 1 from public.orders o where o.id = order_brands.order_id))
  with check (exists (select 1 from public.orders o where o.id = order_brands.order_id));

-- ── 2. Derivation + refresh ────────────────────────────────────────────────

create or replace function public.refresh_order_brands(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.order_brands where order_id = p_order_id;

  insert into public.order_brands (order_id, brand_id, line_total, item_count, is_primary)
  select
    oi.order_id,
    b.id,
    sum(coalesce(oi.line_total, 0))::numeric,
    sum(coalesce(oi.quantity, 0))::int,
    false
  from public.order_items oi
  join public.products p on p.id = oi.product_id
  join public.brands b on b.woo_store_id = p.store_id
  where oi.order_id = p_order_id
    and oi.product_id is not null
  group by oi.order_id, b.id;

  -- Primary brand = the one that contributed the most money (ties: name), so a
  -- multi-brand POS order still has one deterministic source/store while every
  -- brand stays listed.
  update public.order_brands ob
  set is_primary = true
  from (
    select brand_id
    from public.order_brands
    where order_id = p_order_id
    order by line_total desc, brand_id
    limit 1
  ) pick
  where ob.order_id = p_order_id and ob.brand_id = pick.brand_id;
end;
$$;

create or replace function public.order_items_refresh_order_brands()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_order_brands(old.order_id);
    return old;
  end if;
  perform public.refresh_order_brands(new.order_id);
  if tg_op = 'UPDATE' and old.order_id is distinct from new.order_id then
    perform public.refresh_order_brands(old.order_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_order_items_refresh_brands on public.order_items;
create trigger trg_order_items_refresh_brands
  after insert or update of product_id, order_id, quantity, line_total or delete
  on public.order_items
  for each row execute function public.order_items_refresh_order_brands();

-- ── 3. Backfill attribution for every order that has items ────────────────

insert into public.order_brands (order_id, brand_id, line_total, item_count, is_primary)
select
  oi.order_id,
  b.id,
  sum(coalesce(oi.line_total, 0))::numeric,
  sum(coalesce(oi.quantity, 0))::int,
  false
from public.order_items oi
join public.products p on p.id = oi.product_id
join public.brands b on b.woo_store_id = p.store_id
where oi.product_id is not null
group by oi.order_id, b.id
on conflict (order_id, brand_id) do update
set line_total = excluded.line_total,
    item_count = excluded.item_count;

-- Primary flag for the whole table (one per order).
update public.order_brands ob
set is_primary = false
where ob.is_primary;

update public.order_brands ob
set is_primary = true
from (
  select distinct on (order_id) order_id, brand_id
  from public.order_brands
  order by order_id, line_total desc, brand_id
) pick
where ob.order_id = pick.order_id and ob.brand_id = pick.brand_id;

-- Orders with no items but an order_source already know their brand.
insert into public.order_brands (order_id, brand_id, line_total, item_count, is_primary)
select o.id, os.brand_id, 0, 0, true
from public.orders o
join public.order_sources os on os.id = o.order_source_id
where not exists (select 1 from public.order_brands ob where ob.order_id = o.id)
  and os.brand_id is not null
on conflict (order_id, brand_id) do nothing;

-- ── 4. Move remaining pool POS orders onto POS attribution ────────────────
-- A pool order (store_id, storefront_id, order_source_id all NULL) with a
-- derivable primary brand is a POS order: attach the brand's POS source and its
-- stock store, and stamp source='pos' so POS reporting sees it.

with pool_orders as (
  select id
  from public.orders
  where store_id is null
    and storefront_id is null
    and order_source_id is null
),
primary_brand as (
  select ob.order_id, ob.brand_id
  from public.order_brands ob
  join pool_orders p on p.id = ob.order_id
  where ob.is_primary
),
pos_source as (
  select distinct on (os.brand_id) os.brand_id, os.id as source_id
  from public.order_sources os
  where os.type in ('showroom', 'physical_store', 'manual')
  order by os.brand_id,
           case os.type when 'showroom' then 0 when 'physical_store' then 1 else 2 end,
           os.created_at
)
update public.orders o
set order_source_id = src.source_id,
    store_id = b.woo_store_id,
    source = coalesce(nullif(btrim(o.source), ''), 'pos')
from primary_brand pb
join public.brands b on b.id = pb.brand_id
join pos_source src on src.brand_id = pb.brand_id
where o.id = pb.order_id
  and b.woo_store_id is not null;

-- ── 5. Move remaining pool customers onto the same attribution ────────────
-- A pool customer's brand is the brand that took the most money across their
-- orders; origin_kind stays 'legacy' so the "legacy migration" provenance tag
-- (and the reports that read it) keep working.

with pool_customers as (
  select id
  from public.customers
  where store_id is null
    and origin_order_source_id is null
),
customer_brand as (
  select o.customer_id, ob.brand_id, sum(ob.line_total) as weight
  from public.orders o
  join public.order_brands ob on ob.order_id = o.id
  join pool_customers pc on pc.id = o.customer_id
  where o.customer_id is not null
  group by o.customer_id, ob.brand_id
),
ranked as (
  select distinct on (customer_id) customer_id, brand_id
  from customer_brand
  order by customer_id, weight desc, brand_id
),
pos_source as (
  select distinct on (os.brand_id) os.brand_id, os.id as source_id
  from public.order_sources os
  where os.type in ('showroom', 'physical_store', 'manual')
  order by os.brand_id,
           case os.type when 'showroom' then 0 when 'physical_store' then 1 else 2 end,
           os.created_at
)
update public.customers c
set origin_order_source_id = src.source_id,
    origin_kind = 'legacy',
    store_id = b.woo_store_id
from ranked r
join public.brands b on b.id = r.brand_id
join pos_source src on src.brand_id = r.brand_id
where c.id = r.customer_id
  and b.woo_store_id is not null;

commit;