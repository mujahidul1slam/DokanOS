-- Drop the temporary Phase 1 verification oracles (verification complete):
--  - verify_webhook_signatures (created 20260901000100)
--  - verify_phase1_final      (created as ...190 after the ...150 rename+repair)
--  - verify_phase1_retention  (created 20260901000200)
-- These exposed RLS-blocked data to anon for testing; they must not live on.

DROP FUNCTION IF EXISTS public.verify_webhook_signatures();
DROP FUNCTION IF EXISTS public.verify_phase1_final();
DROP FUNCTION IF EXISTS public.verify_phase1_retention();
