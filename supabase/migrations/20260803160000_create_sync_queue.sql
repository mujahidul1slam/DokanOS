-- Create sync_queue table
CREATE TABLE IF NOT EXISTS public.sync_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    payload JSONB,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    error_log TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add indexes for queue processing
CREATE INDEX IF NOT EXISTS idx_sync_queue_status_next_retry 
ON public.sync_queue (status, next_retry_at);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_timestamp ON public.sync_queue;
CREATE TRIGGER set_timestamp
BEFORE UPDATE ON public.sync_queue
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();

-- Create cron job to process the queue every 5 minutes
DO $$
BEGIN
  PERFORM cron.unschedule('process_sync_queue_5min');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

  SELECT cron.schedule(
    'process_sync_queue_5min',
    '*/5 * * * *',
    $$
    SELECT net.http_post(
      url := 'https://jiwndicvfkiltgageqwv.supabase.co/functions/v1/sync-worker',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imppd25kaWN2ZmtpbHRnYWdlcXd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzMjg5OTcsImV4cCI6MjEwMDkwNDk5N30.zWbTtxLYD1hw-vQ7qZdxm1NgUSWYHsS-0wWXg89_7MY'
      ),
      body := '{}'::jsonb
    );
    $$
  );
