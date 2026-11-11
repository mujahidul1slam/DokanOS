-- Issue 55 follow-up: the operator remedy for a sync conflict.
--
-- `public.woocommerce_sync_conflicts` rows are written by several call sites
-- (upsert_woocommerce_order, record_woocommerce_external_deletion,
-- record_woocommerce_sync_observation, the outbound enqueue trigger) but the
-- `resolution` column was READ by get_woocommerce_connector_health and the
-- woocommerce-admin `health` action and never WRITTEN. A conflict therefore
-- blocked its Order forever with no operator remedy.
--
-- This migration adds the single authorized write path:
-- `public.resolve_woocommerce_sync_conflict(uuid, text, text)`.
--
-- Authorization mirrors transition_woocommerce_connector: the conflict ->
-- connector -> business -> membership chain is resolved server-side from
-- auth.uid(); the caller cannot smuggle a tenant id, and an ordinary member is
-- rejected before any row is touched.
--
-- A resolution may re-create local work (see the per-resolution comments in the
-- function). Re-enqueueing only inserts a local `woocommerce_sync_work` row in
-- the reconciliation shape the pipeline already produces
-- (`direction = 'reconciliation'`, `kind = 'order_refresh'`, integer
-- `external_order_id`; see enqueue_woocommerce_reconciliation_work), and NEVER
-- performs an external HTTP call. Whether a resolution mirrors the local
-- fulfilment state back to WooCommerce is the job of the (deliberately
-- out-of-scope) outbound planner.

BEGIN;

-- `resolved_at` / `resolved_by` already exist (20261110090000); the operator's
-- free-text explanation was the only missing column. Additive expand-phase.
ALTER TABLE public.woocommerce_sync_conflicts
  ADD COLUMN IF NOT EXISTS resolution_note text,
  ADD COLUMN IF NOT EXISTS resolution_work_id uuid REFERENCES public.woocommerce_sync_work(id) ON DELETE SET NULL;

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
  --    conflict and stays idempotent under the UNIQUE
  --    (connector_id, identity_key, state) constraint. The payload carries only
  --    a pointer to the conflict — the worker's current-state import is
  --    authoritative and never needs replayed external facts.
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
    ON CONFLICT (connector_id, identity_key, state) DO NOTHING
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

COMMENT ON COLUMN public.woocommerce_sync_conflicts.resolution_note IS
  'Operator explanation captured with the decision; the RPC is the only authorized writer.';
COMMENT ON COLUMN public.woocommerce_sync_conflicts.resolution_work_id IS
  'Re-enqueued sync work created by the resolution, when the decision means "do the work again".';
COMMENT ON FUNCTION public.resolve_woocommerce_sync_conflict(uuid, text, text) IS
  'Owner/admin-only conflict remedy; records the decision and optionally re-enqueues reconciliation work.';

COMMIT;