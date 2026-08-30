-- Migration: Add orders.attach_courier permission and UNIQUE index for consignment_id
-- 1. New permission: orders.attach_courier
ALTER TYPE public.app_permission ADD VALUE IF NOT EXISTS 'orders.attach_courier';

-- 2. UNIQUE index on consignment_id to prevent double-linking.
-- NULLs are ignored by partial index, so only non-NULL values are checked.
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_consignment_id_unique
  ON public.orders (consignment_id) WHERE consignment_id IS NOT NULL;
