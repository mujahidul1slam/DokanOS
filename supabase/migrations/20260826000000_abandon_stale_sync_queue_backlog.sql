-- Abandon the accumulated WooCommerce push backlog WITHOUT sending it.
--
-- CONTEXT
-- pg_cron has dispatched nothing since 2026-07-29 14:00 UTC, so sync-worker was
-- never invoked and push_order rows piled up untouched -- ~159 of them, the
-- oldest created 2026-08-08, every one still at attempts = 0 (proof the worker
-- never so much as picked one up).
--
-- WHY NOT JUST DRAIN IT
-- woo-push maps delivered AND returned to WooCommerce "completed" (a deliberate
-- business rule -- see reverseMapStatus in supabase/functions/woo-push). A
-- WooCommerce order entering "completed" fires the "Completed order" customer
-- email by default. Draining therefore meant up to ~159 customers receiving
-- "your order is complete" for orders as much as 18 days old.
--
-- DECISION (2026-08-26, by the merchant)
-- Abandon the backlog instead of sending it. The historical orders keep whatever
-- status they currently hold in WooCommerce; only deliveries recorded from now
-- on will push. This trades permanent staleness on ~159 old orders for zero
-- misleading customer emails.
--
-- WHY 'skipped' AND NOT 'completed'
-- Nothing here was actually delivered to WooCommerce, so marking these rows
-- 'completed' would make the table lie about what happened. sync-worker selects
-- only 'pending'/'failed', so 'skipped' is terminal without pretending success.
-- The error_log records why, because a bare status change is exactly the kind of
-- silent state this whole fix series exists to eliminate.
UPDATE public.sync_queue
SET status = 'skipped',
    next_retry_at = NULL,
    error_log = 'Abandoned 2026-08-26: accumulated while pg_cron was down. '
             || 'Pushing would have emailed customers about orders up to 18 days old.',
    updated_at = now()
WHERE status IN ('pending', 'failed');
