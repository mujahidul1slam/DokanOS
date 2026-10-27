-- Recreate public.courier_tokens: the persistent Pathao token cache.
-- The original migration (20260901000000) never landed because it also
-- referenced public.trigger_set_timestamp(), which does not exist in this
-- database, so the edge functions' cross-instance token cache has been
-- silently dead. Without it, every cold start re-issues an aladdin token
-- while other instances keep using retired cached tokens -> 401
-- "verify-auth-token: user not found".
-- This version is self-contained: table + grants + RLS, no external trigger.

CREATE TABLE IF NOT EXISTS public.courier_tokens (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider       text NOT NULL DEFAULT 'pathao',
  integration_id uuid REFERENCES public.pathao_integrations(id) ON DELETE CASCADE,
  token          text NOT NULL,
  expires_at     timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, integration_id)
);

CREATE INDEX IF NOT EXISTS idx_courier_tokens_expiry
  ON public.courier_tokens (expires_at);

-- Holds live courier bearer tokens: only service_role (edge functions) may
-- touch it. RLS enabled with no policies locks anon/authenticated out;
-- service_role bypasses RLS by design.
REVOKE ALL ON TABLE public.courier_tokens FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.courier_tokens TO service_role;

ALTER TABLE public.courier_tokens ENABLE ROW LEVEL SECURITY;