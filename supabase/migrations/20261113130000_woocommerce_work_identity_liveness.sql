-- WooCommerce work identity liveness.
--
-- The previous key was UNIQUE (connector_id, identity_key, state). Because
-- "state" was part of the key it forbade duplicate STATE BUCKETS rather than
-- duplicate identities, and every enqueue used
--   ON CONFLICT (connector_id, identity_key, state) DO NOTHING
-- which only suppresses that exact triple. So as soon as a work row left
-- 'pending' (claimed, finished, retried), the next scheduled reconciliation
-- tick inserted another sibling carrying the SAME identity_key. Any later
-- transition into an already-occupied terminal state then raised
--
--   23505 duplicate key value violates unique constraint
--   "woocommerce_sync_work_connector_id_identity_key_state_key"
--
-- which the worker surfaced as
--   woocommerce_finish_failed: duplicate key value violates unique constraint ...
--
-- Observed in production: 8 identity groups holding more than one row, one
-- 'replayed' row at attempt_count 148, and two dead letters naming this exact
-- constraint. Terminal history must be unbounded; LIVENESS is what has to be
-- unique. This migration replaces the state-inclusive constraint with a partial
-- unique index over the live states, and repoints every writer at it.

ALTER TABLE public.woocommerce_sync_work
  DROP CONSTRAINT IF EXISTS woocommerce_sync_work_connector_id_identity_key_state_key;

-- Fail closed: never install the index over data that would violate it.
DO $$
DECLARE
  offending_groups integer;
  offending_rows integer;
BEGIN
  SELECT count(*), coalesce(sum(amount), 0)::integer
    INTO offending_groups, offending_rows
    FROM (
      SELECT connector_id, identity_key, count(*) AS amount
        FROM public.woocommerce_sync_work
       WHERE state IN ('pending', 'leased', 'retrying')
       GROUP BY connector_id, identity_key
      HAVING count(*) > 1
    ) duplicates;

  IF offending_groups > 0 THEN
    RAISE EXCEPTION
      'cannot install woocommerce_sync_work_live_identity_key: % (connector_id, identity_key) group(s) holding % live row(s) have more than one row in pending/leased/retrying; collapse each group to a single live row before migrating',
      offending_groups, offending_rows;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS woocommerce_sync_work_live_identity_key
  ON public.woocommerce_sync_work (connector_id, identity_key)
  WHERE state IN ('pending', 'leased', 'retrying');

COMMENT ON INDEX public.woocommerce_sync_work_live_identity_key IS
  'At most one live (pending/leased/retrying) work row per connector identity. Terminal states are unbounded history and are deliberately not constrained.';

-- Writers below are byte-identical to their previous definitions apart from the
-- ON CONFLICT arbiter: a partial unique index is inferred with
--   ON CONFLICT (connector_id, identity_key) WHERE <index predicate> DO NOTHING
-- The predicate must be implied by the ON CONFLICT WHERE clause, hence the
-- repeated state list.

CREATE OR REPLACE FUNCTION public.enqueue_woocommerce_reconciliation_work(
  p_connector_id uuid,
  p_external_order_id bigint,
  p_identity_key text,
  p_payload jsonb
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inserted_id uuid;
BEGIN
  INSERT INTO public.woocommerce_sync_work
    (connector_id, direction, kind, external_order_id, identity_key, payload, state)
  VALUES
    (p_connector_id, 'reconciliation', 'order_refresh', p_external_order_id, p_identity_key, coalesce(p_payload, '{}'::jsonb), 'pending')
  ON CONFLICT (connector_id, identity_key) WHERE state IN ('pending', 'leased', 'retrying') DO NOTHING
  RETURNING id INTO inserted_id;
  RETURN inserted_id IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION public.enqueue_woocommerce_reconciliation_work(uuid, bigint, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_woocommerce_reconciliation_work(uuid, bigint, text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.create_woocommerce_work_correction(
  p_original_work_id uuid,
  p_reason text,
  p_payload jsonb,
  p_correction_id uuid DEFAULT gen_random_uuid()
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE original public.woocommerce_sync_work; correction_id uuid; correction_work_id uuid;
BEGIN
  SELECT * INTO original FROM public.woocommerce_sync_work WHERE id = p_original_work_id;
  IF original.id IS NULL OR original.state NOT IN ('dead_letter', 'quarantined', 'succeeded') THEN
    RAISE EXCEPTION 'work is not eligible for correction';
  END IF;
  INSERT INTO public.woocommerce_sync_corrections
    (original_work_id, connector_id, correction_key, reason, corrected_payload, created_by)
  VALUES (original.id, original.connector_id, p_correction_id::text, btrim(p_reason), coalesce(p_payload, '{}'::jsonb), auth.uid())
  ON CONFLICT (connector_id, correction_key) DO UPDATE SET reason = excluded.reason
  RETURNING id INTO correction_id;
  INSERT INTO public.woocommerce_sync_work
    (connector_id, direction, kind, external_order_id, identity_key, payload, state, max_attempts, replay_of)
  VALUES (original.connector_id, original.direction, original.kind, original.external_order_id,
          'correction:' || original.id::text || ':' || p_correction_id::text,
          coalesce(p_payload, original.payload), 'pending', original.max_attempts, original.id)
  ON CONFLICT (connector_id, identity_key) WHERE state IN ('pending', 'leased', 'retrying') DO NOTHING
  RETURNING id INTO correction_work_id;
  UPDATE public.woocommerce_sync_corrections c
  SET correction_work_id = coalesce(correction_work_id, w.id)
  FROM public.woocommerce_sync_work w
  WHERE c.id = correction_id AND w.connector_id = original.connector_id
    AND w.identity_key = 'correction:' || original.id::text || ':' || p_correction_id::text;
  RETURN correction_work_id;
END $$;
REVOKE ALL ON FUNCTION public.create_woocommerce_work_correction(uuid, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_woocommerce_work_correction(uuid, text, jsonb, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_woocommerce_status_write(
  p_connector_id uuid,
  p_external_order_id bigint,
  p_target_status text,
  p_origin text,
  p_expected_external_status text,
  p_local_order_version timestamptz,
  p_local_order_id uuid DEFAULT NULL,
  p_related_local_action text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE write_id uuid; work_id uuid; key text;
BEGIN
  IF p_target_status NOT IN ('processing', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'WooCommerce outbound status is not allowed';
  END IF;
  IF p_origin NOT IN ('accepted', 'entered', 'delivered', 'pre_dispatch_cancel') THEN
    RAISE EXCEPTION 'WooCommerce outbound origin is not allowed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.woocommerce_connectors WHERE id = p_connector_id AND outbound_enabled AND status NOT IN ('paused','disabled','rolled_back','quarantined')) THEN
    RAISE EXCEPTION 'WooCommerce connector is not enabled for outbound writes';
  END IF;
  key := p_external_order_id::text || ':' || p_target_status || ':' || coalesce(p_local_order_version::text, 'unknown');
  INSERT INTO public.woocommerce_outbound_writes
    (connector_id, external_order_id, local_order_id, target_status, origin, related_local_action, expected_external_status, local_order_version, idempotency_key)
  VALUES (p_connector_id, p_external_order_id, p_local_order_id, p_target_status, p_origin, p_related_local_action, p_expected_external_status, p_local_order_version, key)
  ON CONFLICT (connector_id, idempotency_key) DO UPDATE SET updated_at = now()
  RETURNING id INTO write_id;
  INSERT INTO public.woocommerce_sync_work
    (connector_id, direction, kind, external_order_id, identity_key, payload)
  VALUES (p_connector_id, 'outbound', 'status_write', p_external_order_id,
          'outbound:' || key, jsonb_build_object('target_status', p_target_status, 'outbound_write_id', write_id))
  ON CONFLICT (connector_id, identity_key) WHERE state IN ('pending', 'leased', 'retrying') DO NOTHING
  RETURNING id INTO work_id;
  RETURN coalesce(work_id, write_id);
END $$;
REVOKE ALL ON FUNCTION public.enqueue_woocommerce_status_write(uuid, bigint, text, text, text, timestamptz, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_woocommerce_status_write(uuid, bigint, text, text, text, timestamptz, uuid, text) TO service_role;
COMMENT ON FUNCTION public.enqueue_woocommerce_status_write(uuid, bigint, text, text, text, timestamptz, uuid, text) IS 'Enqueues only conservative processing/completed/pre-dispatch-cancelled writes with connector-scoped idempotency.';

CREATE OR REPLACE FUNCTION public.resolve_woocommerce_sync_conflict(
  p_conflict_id uuid,
  p_resolution text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := auth.uid();
  conflict_row public.woocommerce_sync_conflicts;
  connector_row public.woocommerce_connectors;
  resolution_value text := btrim(lower(coalesce(p_resolution, '')));
  note_value text := NULLIF(btrim(coalesce(p_note, '')), '');
  reenqueue boolean := false;
  work_id uuid;
  work_key text;
BEGIN
  -- 1. Authorization + row lock. The conflict is resolved to its connector and
  --    business here; the caller's payload never supplies a tenant id.
  SELECT c.* INTO conflict_row
  FROM public.woocommerce_sync_conflicts c
  JOIN public.woocommerce_connectors wc ON wc.id = c.connector_id
  WHERE c.id = p_conflict_id
    AND EXISTS (
      SELECT 1 FROM public.user_business_access a
      WHERE a.business_id = wc.business_id
        AND a.user_id = actor
        AND a.role IN ('owner', 'admin')
    )
  FOR UPDATE OF c;
  IF conflict_row.id IS NULL THEN
    RAISE EXCEPTION 'conflict not found or unauthorized';
  END IF;
  IF conflict_row.resolution IS NOT NULL THEN
    RAISE EXCEPTION 'conflict already resolved';
  END IF;

  -- The table CHECK still allows the legacy 'pending' value; an operator
  -- decision can never set it, and this RPC is the only authorized writer.
  IF resolution_value NOT IN ('accepted_external', 'kept_local', 'dismissed', 'replayed') THEN
    RAISE EXCEPTION 'unsupported conflict resolution';
  END IF;
  IF note_value IS NOT NULL AND char_length(note_value) > 2000 THEN
    RAISE EXCEPTION 'conflict resolution note is too long';
  END IF;

  SELECT w.* INTO connector_row FROM public.woocommerce_connectors w WHERE w.id = conflict_row.connector_id;

  -- 2. Which resolutions mean "do the sync work again"? Every inbound conflict
  --    reason is repaired the same way — a fresh current-state import of that
  --    one external order, which is exactly what the worker already runs for a
  --    reconciliation work item. `kept_local` and `dismissed` are explicitly a
  --    decision that NO further sync work happens.
  IF resolution_value = 'replayed' THEN
    reenqueue := true;
  ELSIF resolution_value = 'accepted_external' AND conflict_row.reason IN (
    'stale_external_state',
    'external_deleted_after_local_work',
    'external_terminal_after_local_work',
    'external_deleted',
    'outbound_enqueue_failed'
  ) THEN
    reenqueue := true;
  END IF;

  -- Bigint PKs make the column a bigint, but the worker requires a JS-safe
  -- integer; anything beyond that could not be processed, so never enqueue it.
  IF reenqueue AND (
    conflict_row.external_order_id IS NULL
    OR conflict_row.external_order_id > 9007199254740991
    OR conflict_row.external_order_id < -9007199254740991
    OR connector_row.id IS NULL
    OR NOT connector_row.intake_enabled
    OR connector_row.status NOT IN ('healthy', 'degraded')
  ) THEN
    -- A closed/intake-off connector is deliberately contained: the resolution is
    -- still recorded, but no new work is created for it.
    reenqueue := false;
  END IF;

  UPDATE public.woocommerce_sync_conflicts
  SET resolution = resolution_value,
      resolved_at = now(),
      resolved_by = actor,
      resolution_note = note_value
  WHERE id = conflict_row.id;

  -- 3. Re-enqueue as durable local work. `identity_key` follows the correction
  --    convention in src/lib/woocommerceWork.ts (`correction:<work>:<id>`, same
  --    as create_woocommerce_work_correction). A conflict has no originating
  --    work row, so the conflict id is the root:
  --    `correction:conflict:<conflict_id>:<resolution>` yields one replay per
  --    conflict and stays idempotent under the partial live-identity index
  --    woocommerce_sync_work_live_identity_key, which permits at most one
  --    pending/leased/retrying row per identity while leaving terminal history
  --    unconstrained. The payload carries only a pointer to the conflict - the
  --    worker's current-state import is authoritative and never needs replayed
  --    external facts.
  IF reenqueue THEN
    work_key := 'correction:conflict:' || conflict_row.id::text || ':' || resolution_value;
    INSERT INTO public.woocommerce_sync_work
      (connector_id, direction, kind, external_order_id, identity_key, payload, state)
    VALUES
      (conflict_row.connector_id, 'reconciliation', 'order_refresh', conflict_row.external_order_id,
       work_key,
       jsonb_build_object(
         'reason', conflict_row.reason,
         'resolution', resolution_value,
         'conflict_id', conflict_row.id,
         'order_id', conflict_row.order_id),
       'pending')
    ON CONFLICT (connector_id, identity_key) WHERE state IN ('pending', 'leased', 'retrying') DO NOTHING
    RETURNING id INTO work_id;
    IF work_id IS NOT NULL THEN
      UPDATE public.woocommerce_sync_conflicts SET resolution_work_id = work_id WHERE id = conflict_row.id;
    END IF;
  END IF;

  SELECT c.* INTO conflict_row FROM public.woocommerce_sync_conflicts c WHERE c.id = conflict_row.id;

  -- 4. Enough state for the UI to refresh the conflict list and the Order.
  RETURN jsonb_build_object(
    'conflict', jsonb_build_object(
      'id', conflict_row.id,
      'connector_id', conflict_row.connector_id,
      'external_order_id', conflict_row.external_order_id,
      'order_id', conflict_row.order_id,
      'reason', conflict_row.reason,
      'resolution', conflict_row.resolution,
      'resolved_at', conflict_row.resolved_at,
      'resolved_by', conflict_row.resolved_by,
      'resolution_note', conflict_row.resolution_note,
      'resolution_work_id', conflict_row.resolution_work_id
    ),
    'reenqueued_work_id', conflict_row.resolution_work_id,
    'open_conflict_count', (
      SELECT count(*) FROM public.woocommerce_sync_conflicts c2
      WHERE c2.connector_id = conflict_row.connector_id AND c2.resolution IS NULL
    )
  );
END $$;
REVOKE ALL ON FUNCTION public.resolve_woocommerce_sync_conflict(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_woocommerce_sync_conflict(uuid, text, text) TO authenticated;
