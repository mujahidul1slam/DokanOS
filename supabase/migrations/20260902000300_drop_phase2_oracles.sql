-- Drop the temporary Phase 2 verification oracles (verification complete).
DROP FUNCTION IF EXISTS public.verify_phase2_schema();
DROP FUNCTION IF EXISTS public.verify_phase2_runtime();
