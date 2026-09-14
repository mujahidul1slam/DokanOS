-- ============================================================================
-- RT RLS battery: realtime publication membership. §2.5 AC-1 (idempotency).
-- ============================================================================

-- AC-1: after all migrations, user_business_access is in supabase_realtime;
--        running the additive migration logic twice does not error.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'user_business_access'
  ) THEN
    RAISE EXCEPTION 'FAIL: RT-AC1 user_business_access missing from supabase_realtime'
      USING ERRCODE = 'P0001';
  END IF;
END $$;

-- Idempotency: simulate the migration's DO block again — must not error.
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