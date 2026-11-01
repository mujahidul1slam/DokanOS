-- Operational-store provisioning bridge (option B, 2026-11-01 user decision).
--
-- THE GAP: nothing in the UI ever created rows in the operational `stores`
-- space. `useStoresList` scopes every store list to `brands.woo_store_id`, and
-- `products.store_id` is a FK → `stores.id` gated by `user_can_access_store()`
-- (20261026120000: brand link + user_business_access membership + SELECTED
-- active business). A fresh business therefore saw "No stores in this business"
-- and could not CSV/manual-add products. The only provisioner that ever
-- existed — the `create_my_brand_store` RPC (20261006121000) — was REVOKE'd
-- (20261020100000).
--
-- OPTION B closes the gap at the source:
--   1. `order_sources.legacy_woo_store_id` — when a WooCommerce order source
--      is created, the app provisions a transitional `stores` row carrying the
--      source's URL + consumer credentials (the legacy sync workers read
--      `stores`) and stamps its id here. Mirrors `brand_stores.legacy_woo_store_id`
--      (20261019180000:27). Not UNIQUE: this is new provenance, not a Task-8
--      legacy-row mapping key.
--   2. A member INSERT leg on `stores`. Today a fresh member cannot INSERT a
--      stores row at all: 'Admins can manage stores' is FOR ALL TO
--      authenticated USING/WITH CHECK has_role('admin') (20260929120000:63-83)
--      and real accounts carry NO user_roles row, while the member legs are
--      SELECT/UPDATE only. The new leg follows the operator-write ladder
--      (owner/admin/manager — 20261101090000:554-562) bound to the SELECTED
--      active business, the activeBusinessRlsContract discipline
--      (current_business_context() in every non-has_role operational policy).
--
-- NO `user_store_access` grant rows are provisioned: `user_can_access_store()`
-- stopped consulting that table in 20261026120000 (it gates on the brand link),
-- and `usePermissions` treats an empty grant set as unrestricted
-- (src/hooks/usePermissions.tsx:12,84). The table is on the Task-16 drop list.
--
-- Sync safety: provisioned local-only rows (`url = local://…`) are created with
-- status 'disconnected' so the woo-sync-all cron (which selects
-- status='connected', 20260830000500) can never pick them up; the woo-sync and
-- woo-push and woo-webhook functions additionally refuse non-http(s) store URLs
-- outright (supabase/functions/_shared/store-url-guard.ts).

-- ---------------------------------------------------------------------------
-- 1. Source → store provenance stamp.
-- ---------------------------------------------------------------------------
ALTER TABLE public.order_sources
  ADD COLUMN IF NOT EXISTS legacy_woo_store_id uuid
  REFERENCES public.stores (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS order_sources_legacy_woo_store_id_idx
  ON public.order_sources (legacy_woo_store_id)
  WHERE legacy_woo_store_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Membership-scoped INSERT leg on stores (the provisioning path).
-- ---------------------------------------------------------------------------
-- Stores rows carry no brand/business column — the tenant binding is the
-- brand link created right after the insert (guarded UPDATE of
-- brands.woo_store_id, link-when-free) — so this leg keys the caller's
-- SELECTED active business through current_business_context() and requires the
-- operator ladder (owner/admin/manager). Staff and context-less sessions fail
-- closed. Cross-business rows cannot be claimed through this leg: each caller
-- provisions their own fresh row.
DROP POLICY IF EXISTS "Members can provision stores" ON public.stores;
CREATE POLICY "Members can provision stores" ON public.stores
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_business_access membership
      WHERE membership.user_id = auth.uid()
        AND membership.business_id = public.current_business_context()
        AND membership.role = ANY (ARRAY['owner'::text, 'admin'::text, 'manager'::text])
    )
  );
