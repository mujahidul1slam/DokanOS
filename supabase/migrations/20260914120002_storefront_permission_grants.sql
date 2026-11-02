-- ============================================================================
-- Storefront Phase 1: permission grants (M3) — migration 2 of the L5 split.
--
-- NOTE (executor, verified against the repo): the plan §4.1 names
-- `public.role_permissions`, which does NOT exist in this schema. The system
-- roles table carrying `permissions app_permission[]` + `is_system` is
-- `public.custom_roles` (created 20260420112330; system seeds 'Cashier',
-- 'Order Manager', 'Inventory Manager'). The grant below applies the plan's
-- exact predicate shape against that real table. Admins already get every
-- enum value automatically via get_user_permissions → enum_range.
--
-- This migration may compare 'storefronts.view' freely because the ADD VALUE
-- happened in a separate transaction (20260914120001). Re-runs safely: the
-- NOT @> guard makes the UPDATE a no-op once granted.
-- ============================================================================

UPDATE public.custom_roles
SET permissions = array_append(permissions, 'storefronts.view'::app_permission)
WHERE is_system = true
  AND permissions @> ARRAY['stores.view']::app_permission[]
  AND NOT permissions @> ARRAY['storefronts.view']::app_permission[];
