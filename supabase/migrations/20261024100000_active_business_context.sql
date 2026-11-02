-- S1: server-owned active business context for hybrid tenancy enforcement.
--
-- This is deliberately a per-user durable context because PostgREST requests do
-- not share transaction-local settings. The active business is therefore shared
-- by concurrent sessions for the same user; callers must switch immediately
-- before using business-scoped APIs. A JWT/custom-claims context would remove
-- that limitation, but is outside this migration-only foundation.

CREATE TABLE public.active_business_context (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_active_business_context_business
  ON public.active_business_context (business_id);

ALTER TABLE public.active_business_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.active_business_context FORCE ROW LEVEL SECURITY;

-- No direct client reads or writes: all access goes through the narrowly
-- validated functions below. Explicit revokes also protect against default
-- privilege changes in a future project.
REVOKE ALL ON TABLE public.active_business_context FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_active_business_context(p_business_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication is required to set an active business'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.user_business_access AS access
      JOIN public.businesses AS business ON business.id = access.business_id
     WHERE access.user_id = v_user_id
       AND access.business_id = p_business_id
       AND business.is_active = true
  ) THEN
    RAISE EXCEPTION 'user is not an active member of the requested business'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.active_business_context (user_id, business_id)
  VALUES (v_user_id, p_business_id)
  ON CONFLICT (user_id) DO UPDATE
    SET business_id = EXCLUDED.business_id,
        updated_at = now();

  RETURN p_business_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_active_business_context(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_active_business_context(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.current_business_context()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT context.business_id
    FROM public.active_business_context AS context
    JOIN public.businesses AS business ON business.id = context.business_id
    JOIN public.user_business_access AS access
      ON access.business_id = context.business_id
     AND access.user_id = context.user_id
   WHERE context.user_id = auth.uid()
     AND business.is_active = true;
$$;

REVOKE ALL ON FUNCTION public.current_business_context() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_business_context() TO authenticated;

COMMENT ON TABLE public.active_business_context IS
  'Server-owned durable active business per user; concurrent sessions share this context until JWT claims are available.';
COMMENT ON FUNCTION public.set_active_business_context(uuid) IS
  'Selects an active business only after validating auth.uid membership and business.is_active.';
COMMENT ON FUNCTION public.current_business_context() IS
  'Returns the caller''s active business only while membership and business activity remain valid.';

-- No operational RLS policies are changed in S1. Later migrations may use
-- public.current_business_context() as the tenant predicate.
--------------------------------------------------------------------------------
-- ROLLBACK (manual only):
-- DROP FUNCTION IF EXISTS public.current_business_context();
-- DROP FUNCTION IF EXISTS public.set_active_business_context(uuid);
-- DROP TABLE IF EXISTS public.active_business_context;
--------------------------------------------------------------------------------
