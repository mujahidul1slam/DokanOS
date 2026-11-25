-- Safely terminalize a duplicate leased work row when its connector+identity
-- already has a succeeded row. The original work row remains intact and the
-- duplicate retains auditable linkage in payload metadata.
CREATE OR REPLACE FUNCTION public.finish_woocommerce_sync_work(
  p_work_id uuid,
  p_owner text,
  p_state text,
  p_error_class text DEFAULT NULL,
  p_error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  updated_count integer;
  existing_succeeded public.woocommerce_sync_work;
BEGIN
  IF p_state NOT IN ('succeeded', 'retrying', 'quarantined', 'dead_letter', 'cancelled') THEN
    RAISE EXCEPTION 'invalid WooCommerce work completion state';
  END IF;

  IF p_state = 'succeeded' THEN
    IF EXISTS (
      SELECT 1
      FROM public.woocommerce_sync_work duplicate
      JOIN public.woocommerce_sync_work prior
        ON prior.id = CASE
          WHEN duplicate.payload->'duplicate_finish'->>'replayed_to' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
          THEN (duplicate.payload->'duplicate_finish'->>'replayed_to')::uuid
          ELSE NULL
        END
       AND prior.state = 'succeeded'
      WHERE duplicate.id = p_work_id
        AND duplicate.state = 'replayed'
        AND duplicate.error_class = 'duplicate_succeeded'
        AND duplicate.payload ? 'duplicate_finish'
    ) THEN
      RETURN true;
    END IF;
    SELECT prior.* INTO existing_succeeded
    FROM public.woocommerce_sync_work current_work
    JOIN public.woocommerce_sync_work prior
      ON prior.connector_id = current_work.connector_id
     AND prior.identity_key = current_work.identity_key
     AND prior.state = 'succeeded'
     AND prior.id <> current_work.id
    WHERE current_work.id = p_work_id
      AND current_work.state = 'leased'
      AND current_work.lease_owner = p_owner
    ORDER BY prior.updated_at, prior.id
    LIMIT 1;

    IF existing_succeeded.id IS NOT NULL THEN
      UPDATE public.woocommerce_sync_work
      SET state = 'replayed', lease_owner = NULL, lease_expires_at = NULL,
          heartbeat_at = NULL, error_class = 'duplicate_succeeded',
          last_error = jsonb_build_object(
            'reason', 'duplicate_succeeded',
            'replayed_to', existing_succeeded.id,
            'prior_state', existing_succeeded.state
          )::text,
          payload = payload || jsonb_build_object(
            'duplicate_finish', jsonb_build_object(
              'reason', 'duplicate_succeeded',
              'replayed_to', existing_succeeded.id,
              'finished_by', p_owner
            )
          ),
          updated_at = now()
      WHERE id = p_work_id AND state = 'leased' AND lease_owner = p_owner;
      GET DIAGNOSTICS updated_count = ROW_COUNT;
      RETURN updated_count = 1;
    END IF;
  END IF;

  UPDATE public.woocommerce_sync_work
  SET state = CASE
        WHEN p_state = 'retrying' AND attempt_count >= max_attempts THEN 'dead_letter'
        ELSE p_state
      END,
      lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
      error_class = p_error_class, last_error = p_error,
      next_attempt_at = CASE WHEN p_state = 'retrying' AND attempt_count < max_attempts
        THEN now() + make_interval(secs => (least(900::numeric, greatest(1::numeric, power(2::numeric, least(attempt_count, 8)) * (0.75 + random() * 0.5))))::double precision)
        ELSE next_attempt_at END,
      updated_at = now()
  WHERE id = p_work_id AND state = 'leased' AND lease_owner = p_owner;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count = 1;
END $$;

REVOKE ALL ON FUNCTION public.finish_woocommerce_sync_work(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_woocommerce_sync_work(uuid, text, text, text, text) TO service_role;

