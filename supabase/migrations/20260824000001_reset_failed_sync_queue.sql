-- Reset all failed items in the sync_queue back to pending so that the next sync-worker run processes them.
UPDATE public.sync_queue 
SET status = 'pending', attempts = 0, next_retry_at = NOW(), error_log = NULL 
WHERE status = 'failed';
