-- Repair: the first full-queue drain tripped Supabase's Edge Functions rate
-- limit. 713 rows were marked "failed" with an attempt burned for a PLATFORM
-- throttle, not a data failure — without this they would dead-letter after 5
-- such drains. Reset every rate-limit-marked row to pending, attempts
-- restored to 0, ready for immediate retry.
UPDATE public.sync_queue
SET status = 'pending',
    attempts = 0,
    next_retry_at = now(),
    error_log = 'requeued: platform rate limit, not a data failure',
    updated_at = now()
WHERE status = 'failed'
  AND error_log LIKE 'woo-push responded 429%Rate limit exceeded%';

UPDATE public.sync_queue
SET status = 'pending',
    attempts = 0,
    next_retry_at = now(),
    error_log = 'requeued: platform rate limit, not a data failure',
    updated_at = now()
WHERE status = 'failed'
  AND error_log LIKE '%Rate limit exceeded for trace%';