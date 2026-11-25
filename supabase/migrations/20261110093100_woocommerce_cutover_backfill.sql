-- Issue 54: webhook-first, exactly-seven-day cutover and historical backfill.
-- This migration creates only local evidence/work. It never performs external writes.

CREATE TABLE IF NOT EXISTS public.woocommerce_cutover_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id uuid NOT NULL REFERENCES public.woocommerce_connectors(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('dry_run', 'backfill')),
  webhook_id bigint NOT NULL,
  webhook_verified_at timestamptz NOT NULL,
  watermark timestamptz NOT NULL,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  pages integer NOT NULL DEFAULT 0 CHECK (pages >= 0),
  requests integer NOT NULL DEFAULT 0 CHECK (requests >= 0),
  discovered integer NOT NULL DEFAULT 0 CHECK (discovered >= 0),
  enqueued integer NOT NULL DEFAULT 0 CHECK (enqueued >= 0),
  exact_matches integer NOT NULL DEFAULT 0 CHECK (exact_matches >= 0),
  review_candidates integer NOT NULL DEFAULT 0 CHECK (review_candidates >= 0),
  unmapped integer NOT NULL DEFAULT 0 CHECK (unmapped >= 0),
  failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  conflict_count integer NOT NULL DEFAULT 0 CHECK (conflict_count >= 0),
  state text NOT NULL DEFAULT 'running'
    CHECK (state IN ('running', 'dry_run_complete', 'backfill_complete', 'partial', 'failed', 'cancelled')),
  page_metadata jsonb NOT NULL DEFAULT '[]'::jsonb,
  report_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  error_class text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT woocommerce_cutover_exactly_seven_days
    CHECK (window_end = window_start + interval '7 days'),
  CONSTRAINT woocommerce_cutover_window_before_watermark
    CHECK (window_start < window_end AND window_end = watermark)
);
CREATE INDEX IF NOT EXISTS woocommerce_cutover_connector_idx
  ON public.woocommerce_cutover_runs (connector_id, started_at DESC);

CREATE TABLE IF NOT EXISTS public.woocommerce_cutover_report_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.woocommerce_cutover_runs(id) ON DELETE CASCADE,
  connector_id uuid NOT NULL REFERENCES public.woocommerce_connectors(id) ON DELETE CASCADE,
  external_order_id bigint,
  external_status text,
  match_kind text NOT NULL CHECK (match_kind IN ('exact', 'review', 'unmapped')),
  local_order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  fuzzy_candidate_ids uuid[] NOT NULL DEFAULT '{}',
  fuzzy_signals text[] NOT NULL DEFAULT '{}',
  outcome text NOT NULL CHECK (outcome IN ('queued', 'already_known', 'review', 'unmapped', 'failed', 'unsupported', 'incomplete')),
  work_id uuid REFERENCES public.woocommerce_sync_work(id) ON DELETE SET NULL,
  failure_class text,
  failure_detail text,
  external_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS woocommerce_cutover_report_run_idx
  ON public.woocommerce_cutover_report_items (run_id, outcome);
CREATE INDEX IF NOT EXISTS woocommerce_cutover_report_external_idx
  ON public.woocommerce_cutover_report_items (connector_id, external_order_id);

CREATE OR REPLACE FUNCTION public.create_woocommerce_cutover_run(
  p_connector_id uuid,
  p_mode text,
  p_watermark timestamptz DEFAULT now()
)
RETURNS public.woocommerce_cutover_runs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result public.woocommerce_cutover_runs;
BEGIN
  IF p_mode NOT IN ('dry_run', 'backfill') THEN RAISE EXCEPTION 'invalid cutover mode'; END IF;
  SELECT * INTO result FROM public.woocommerce_cutover_runs WHERE false;
  INSERT INTO public.woocommerce_cutover_runs
    (connector_id, mode, webhook_id, webhook_verified_at, watermark, window_start, window_end)
  SELECT c.id, p_mode, c.expected_webhook_id, coalesce(c.last_webhook_verified_at, now()), p_watermark,
         p_watermark - interval '7 days', p_watermark
  FROM public.woocommerce_connectors c
  WHERE c.id = p_connector_id
    AND c.intake_enabled
    AND c.expected_webhook_id IS NOT NULL
    AND c.webhook_status = 'active'
    AND c.status IN ('healthy', 'degraded');
  IF NOT FOUND THEN RAISE EXCEPTION 'active verified WooCommerce webhook is required before cutover'; END IF;
  SELECT * INTO result FROM public.woocommerce_cutover_runs
  WHERE connector_id = p_connector_id ORDER BY started_at DESC LIMIT 1;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.create_woocommerce_cutover_run(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_woocommerce_cutover_run(uuid, text, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.finish_woocommerce_cutover_run(
  p_run_id uuid,
  p_state text,
  p_pages integer,
  p_requests integer,
  p_discovered integer,
  p_enqueued integer,
  p_exact_matches integer,
  p_review_candidates integer,
  p_unmapped integer,
  p_failure_count integer,
  p_conflict_count integer,
  p_page_metadata jsonb DEFAULT '[]'::jsonb,
  p_report_metadata jsonb DEFAULT '{}'::jsonb,
  p_last_error text DEFAULT NULL,
  p_error_class text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_state NOT IN ('dry_run_complete', 'backfill_complete', 'partial', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'invalid cutover terminal state';
  END IF;
  UPDATE public.woocommerce_cutover_runs
  SET state = p_state, pages = greatest(0, p_pages), requests = greatest(0, p_requests),
      discovered = greatest(0, p_discovered), enqueued = greatest(0, p_enqueued),
      exact_matches = greatest(0, p_exact_matches), review_candidates = greatest(0, p_review_candidates),
      unmapped = greatest(0, p_unmapped), failure_count = greatest(0, p_failure_count),
      conflict_count = greatest(0, p_conflict_count), page_metadata = coalesce(p_page_metadata, '[]'::jsonb),
      report_metadata = coalesce(p_report_metadata, '{}'::jsonb), last_error = p_last_error,
      error_class = p_error_class, completed_at = now()
  WHERE id = p_run_id AND state = 'running';
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.finish_woocommerce_cutover_run(uuid, text, integer, integer, integer, integer, integer, integer, integer, integer, integer, jsonb, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_woocommerce_cutover_run(uuid, text, integer, integer, integer, integer, integer, integer, integer, integer, integer, jsonb, jsonb, text, text) TO service_role;

ALTER TABLE public.woocommerce_cutover_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.woocommerce_cutover_report_items ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.woocommerce_cutover_runs, public.woocommerce_cutover_report_items TO authenticated, service_role;
DROP POLICY IF EXISTS "Woo cutover members can read runs" ON public.woocommerce_cutover_runs;
CREATE POLICY "Woo cutover members can read runs" ON public.woocommerce_cutover_runs
  FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.woocommerce_connectors c WHERE c.id = connector_id AND public.is_business_member(c.business_id)));
DROP POLICY IF EXISTS "Woo cutover members can read report" ON public.woocommerce_cutover_report_items;
CREATE POLICY "Woo cutover members can read report" ON public.woocommerce_cutover_report_items
  FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.woocommerce_connectors c WHERE c.id = connector_id AND public.is_business_member(c.business_id)));

COMMENT ON TABLE public.woocommerce_cutover_runs IS 'Reproducible webhook-first cutover evidence; every run covers exactly the seven days before its watermark.';
COMMENT ON TABLE public.woocommerce_cutover_report_items IS 'Dry-run and backfill duplicate-match report; fuzzy candidates are review-only and never auto-merged.';
COMMIT;
