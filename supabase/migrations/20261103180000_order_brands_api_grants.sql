-- Fix: order_brands shipped with no table privileges, so the Orders page could
-- not load at all.
--
-- 20261103162000_legacy_pool_pos_attribution.sql created public.order_brands and
-- enabled RLS with two read/write policies, but never granted the table to any
-- API role. New Supabase projects do not grant Data API privileges implicitly,
-- so pg_class.relacl for the table was NULL: not even service_role could read
-- it. The Orders grid embeds `order_brands(brand_id, is_primary, brands(...))`
-- in its select, so the whole embed failed with
--   42501 permission denied for table order_brands
-- and useOrdersData surfaced it as the page-level banner
--   "Couldn't load all orders. permission denied for table order_brands"
-- with 0 of 4114 orders listed. The policies were correct; only the grants were
-- missing, which is why the bug was invisible until a client actually queried.
--
-- Grants follow the established convention for operational tables
-- (20261031140000_courier_services.sql:44, 20261031180000_payment_accounts.sql:50,
-- 20261102090000_business_onboarding.sql:411): full DML to authenticated and
-- service_role, with RLS remaining the authority on which rows are reachable.
--
-- refresh_order_brands is also revoked from the client roles. It is a SECURITY
-- DEFINER function that deletes and re-inserts attribution rows, it is called
-- only by the order_items trigger, and it was reachable over RPC by an
-- unauthenticated caller (POST /rest/v1/rpc/refresh_order_brands returned 204
-- for the anon key). No client code calls it, so removing the default PUBLIC
-- execute grant closes that primitive without changing behaviour.

begin;

grant select, insert, update, delete on public.order_brands
  to authenticated, service_role;

revoke execute on function public.refresh_order_brands(uuid)
  from public, anon, authenticated;

commit;
