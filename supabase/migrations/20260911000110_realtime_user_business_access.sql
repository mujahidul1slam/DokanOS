-- user_business_access was never in the realtime publication; the frontend's
-- postgres_changes subscription on it has silently delivered nothing. Additive,
-- idempotent (ALTER PUBLICATION ... ADD TABLE has no IF NOT EXISTS).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'user_business_access'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.user_business_access';
  END IF;
END $$;
