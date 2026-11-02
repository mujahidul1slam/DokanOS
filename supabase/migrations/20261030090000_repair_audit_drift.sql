-- Repair: drift between the live database and the migration chain
-- (read-only audit 2026-10-30, tasks/audit/prod-vs-repo.json).
--
-- 1) orders.payment_meta exists on the live database (jsonb, nullable, no
--    default) but NO migration in the chain creates it — it was added out of
--    band. The checkout RPCs INSERT it (20260914150000_checkout_atomic_idempotency.sql,
--    20260925000000_checkout_rpc_manage_stock.sql), so a fresh build breaks at
--    checkout runtime. Add it with the exact live definition.
--
-- 2) webhook_events.created_at/status_code/topic are NOT NULL in the chain
--    (defaults now()/200/-) but nullable on the live database: the live table
--    predates 20260802065800_create_webhook_events.sql, so
--    20260830000600_repair_webhook_events.sql's CREATE TABLE IF NOT EXISTS was
--    a no-op there. Live has 0 NULL rows (885 total, audited 2026-10-30);
--    guarded backfills make convergence safe even if NULLs appear before apply.
--
-- Idempotent on both sides.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_meta jsonb;

UPDATE public.webhook_events SET created_at = now() WHERE created_at IS NULL;
UPDATE public.webhook_events SET status_code = 200 WHERE status_code IS NULL;
UPDATE public.webhook_events SET topic = 'unknown' WHERE topic IS NULL;

ALTER TABLE public.webhook_events
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN status_code SET DEFAULT 200,
  ALTER COLUMN status_code SET NOT NULL,
  ALTER COLUMN topic SET NOT NULL;
