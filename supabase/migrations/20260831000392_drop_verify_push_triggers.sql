-- Drop the temporary Phase-1 verification harness (recreated by 20260831000391
-- after 20260831000390's drop ran too early). All trigger tests passed; the
-- function must not remain executable in production.
DROP FUNCTION IF EXISTS public.verify_push_triggers();