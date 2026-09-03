-- Revamp Phase 1: scheduler ownership prep + courier token caching.
--
-- 1.3: vault token `sync_worker_cron_token` + getter RPC used by sync-worker
--      and pathao-courier(track_all) to authenticate scheduler invocations
--      (GitHub Actions today, Cloudflare Worker cron when deployed). The old
--      get_woo_sync_cron_token pattern is reused verbatim.
-- 1.2: courier_tokens — persistent, expiry-aware token cache for Pathao.
--      Every cold edge-function start currently issues a fresh aladdin token;
--      this table lets warm AND cold starts share one token until it expires.
-- 1.6: webhook_events retention — sync-worker sweeps rows older than 30 days
--      (the table currently grows forever).

DO $$
BEGIN
  -- Idempotent create: re-running must not fail on the unique secret name.
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'sync_worker_cron_token') THEN
    PERFORM vault.create_secret(
      'z4i13r8XGeY2ASnPhyabNQ20IviKCGoA',
      'sync_worker_cron_token',
      'Scheduler auth token for sync-worker + pathao track_all (GitHub Actions / Cloudflare cron)'
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.get_sync_worker_cron_token()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, vault
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'sync_worker_cron_token' LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_sync_worker_cron_token() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_sync_worker_cron_token() TO service_role;

-- 1.2: persistent courier token cache.
-- provider: forward-looking (pathao today); integration_id nullable because
-- env-var-based legacy credentials have no DB row to point at.
CREATE TABLE IF NOT EXISTS public.courier_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      text NOT NULL DEFAULT 'pathao',
  integration_id uuid REFERENCES public.pathao_integrations(id) ON DELETE CASCADE,
  token         text NOT NULL,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- one row per (provider, integration): the newest token replaces the old.
  UNIQUE (provider, integration_id)
);

CREATE INDEX IF NOT EXISTS idx_courier_tokens_expiry
  ON public.courier_tokens (expires_at);

-- Grant-based protection (webhook_events pattern): only service_role (edge
-- functions) can touch this table — it holds live Pathao bearer tokens.
REVOKE ALL ON TABLE public.courier_tokens FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.courier_tokens TO service_role;

CREATE TRIGGER set_courier_tokens_updated_at
  BEFORE UPDATE ON public.courier_tokens
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();
