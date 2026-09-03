-- Drop the temporary multi-business verification/recon oracles (Phase 0 verified).
DROP FUNCTION IF EXISTS public.verify_multi_business_foundation();
DROP FUNCTION IF EXISTS public.recon_multi_business();
