-- Issue 53: wire conservative local Fulfillment changes to outbound writes.
--
-- `public.enqueue_woocommerce_status_write(...)` was defined in
-- 20261110090000_woocommerce_order_connector.sql but had NO caller. This
-- migration is that caller: an AFTER UPDATE OF status trigger on public.orders
-- is the single choke point that sees every local status write (Orders page,
-- POS, bulk actions, payment confirmation, courier callbacks).
--
-- It is a deliberate MIRROR of `src/lib/woocommerceOutbound.ts`
-- (`planWooCommerceOutboundWrite`), which is the executable, unit-tested
-- specification of this guard table. `src/test/woocommerceOutbound.test.ts`
-- asserts that this file still carries every guard; keep both in sync.
--
-- Safety properties (all must hold before an outbound work item is enqueued):
--   * Only orders with a provable `woocommerce_order_identities` row qualify.
--   * Connector must be outbound_enabled and healthy/degraded (rollback
--     containment: paused/disabled/quarantined/rolled_back stop new work).
--   * ADR-0001: an unconfirmed online payment is never advanced.
--   * `delivered -> completed` only when EVERY Fulfillment unit is delivered.
--   * `cancelled` only pre-dispatch (no active consignment / in-flight shipment).
--   * No automatic refunded/partial/returned/post-dispatch-cancel/conflict.
--   * Inbound `upsert_woocommerce_order` never changes `orders.status`, so
--     status echoes from WooCommerce cannot re-trigger an outward write.
--   * An enqueue failure NEVER rolls back the local Fulfillment write; it is
--     recorded as a visible open conflict instead.
--
-- This migration creates only local work/evidence. It performs no external
-- HTTP call; the `woocommerce-worker` Edge Function performs the confirmed
-- write on the managed scheduler cadence.

BEGIN;

CREATE OR REPLACE FUNCTION public.enqueue_woocommerce_outbound_on_order_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  identity_row record;
  connector_row record;
  target_status text;
  origin text;
  normalized_status text;
  has_shipments boolean;
  any_not_delivered boolean;
  any_active_shipment boolean;
  active_consignment boolean;
  all_units_delivered boolean;
BEGIN
  -- 0. Equal old/new status is a no-op (AFTER UPDATE OF status also fires when
  --    `status` is merely present in the SET clause with an unchanged value).
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  -- 1. Never write for a soft-deleted local Order or an externally deleted one.
  IF NEW.deleted_at IS NOT NULL OR NEW.woocommerce_external_deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- 2. Resolve the connector from provable identity, never from payload ids.
  --    UNIQUE (connector_id, order_id) makes at most one row match.
  SELECT oi.connector_id, oi.external_order_id
    INTO identity_row
    FROM public.woocommerce_order_identities oi
   WHERE oi.order_id = NEW.id;
  IF identity_row.connector_id IS NULL THEN RETURN NEW; END IF;

  SELECT c.id, c.outbound_enabled, c.status
    INTO connector_row
    FROM public.woocommerce_connectors c
   WHERE c.id = identity_row.connector_id;
  IF connector_row.id IS NULL
     OR NOT connector_row.outbound_enabled
     OR connector_row.status NOT IN ('healthy', 'degraded') THEN
    RETURN NEW;
  END IF;

  normalized_status := lower(btrim(coalesce(NEW.status, '')));

  -- 3. Conservative status -> origin/target table (mirrors the TS planner).
  IF normalized_status IN ('processing', 'entered', 'accepted') THEN
    -- ADR-0001: a Woo online-payment Order whose payment is not confirmed
    -- cannot be Entered or advanced by an ordinary status change.
    IF coalesce(NEW.payment_status, '') <> 'paid' THEN RETURN NEW; END IF;
    target_status := 'processing';
    origin := CASE
      WHEN lower(btrim(coalesce(OLD.status, ''))) = 'entered' OR normalized_status = 'entered'
        THEN 'entered' ELSE 'accepted' END;
  ELSIF normalized_status = 'delivered' THEN
    IF coalesce(NEW.payment_status, '') <> 'paid' THEN RETURN NEW; END IF;
    target_status := 'completed';
    origin := 'delivered';
  ELSIF normalized_status = 'cancelled' THEN
    target_status := 'cancelled';
    origin := 'pre_dispatch_cancel';
  ELSE
    -- refunded / partial / returned / post-dispatch-cancel / in_transit /
    -- ready_to_ship / on_hold / unresolved-conflict: local Fulfillment stays
    -- authoritative but never produces an automatic external write.
    RETURN NEW;
  END IF;

  -- 4. Fulfillment units. `courier_shipments.canonical_status` is the local
  --    per-unit delivery truth. With no shipment rows the local `delivered`
  --    status itself is the single authoritative unit.
  SELECT count(*) > 0,
         coalesce(bool_or(coalesce(lower(s.canonical_status), '') <> 'delivered'), false),
         coalesce(bool_or(coalesce(lower(s.canonical_status), '') NOT IN ('delivered', 'returned', 'cancelled')), false)
    INTO has_shipments, any_not_delivered, any_active_shipment
    FROM public.courier_shipments s
   WHERE s.order_id = NEW.id;

  active_consignment := (NEW.consignment_id IS NOT NULL AND btrim(NEW.consignment_id) <> '')
                        OR any_active_shipment;
  all_units_delivered := CASE WHEN has_shipments THEN NOT any_not_delivered ELSE true END;

  IF normalized_status = 'delivered' AND NOT all_units_delivered THEN
    RETURN NEW; -- fulfillment_incomplete: partial delivery never completes
  END IF;
  IF normalized_status = 'cancelled' AND active_consignment THEN
    RETURN NEW; -- cancellation_after_dispatch: unsafe post-dispatch cancel
  END IF;

  -- 5. Enqueue the confirmed write. Each work item records origin, expected
  --    external state, local version/freshness, target state and the related
  --    local action. Idempotency is connector-scoped in the RPC.
  BEGIN
    PERFORM public.enqueue_woocommerce_status_write(
      identity_row.connector_id,
      identity_row.external_order_id,
      target_status,
      origin,
      NEW.woocommerce_external_status,
      NEW.updated_at,
      NEW.id,
      left(format('status_change:%s->%s', OLD.status, NEW.status), 200)
    );
  EXCEPTION WHEN OTHERS THEN
    -- A connector-side failure must never abort the operator's local write.
    -- Make the failure visible in bounded operator health instead.
    INSERT INTO public.woocommerce_sync_conflicts
      (connector_id, external_order_id, order_id, reason, external_state, local_state)
    VALUES
      (identity_row.connector_id, identity_row.external_order_id, NEW.id,
       'outbound_enqueue_failed',
       jsonb_build_object('target_status', target_status, 'origin', origin),
       jsonb_build_object('status', NEW.status, 'error', SQLERRM))
    ON CONFLICT (connector_id, external_order_id, reason) WHERE resolution IS NULL DO NOTHING;
  END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_woocommerce_outbound_order_status ON public.orders;
CREATE TRIGGER trg_woocommerce_outbound_order_status
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_woocommerce_outbound_on_order_status();

COMMENT ON FUNCTION public.enqueue_woocommerce_outbound_on_order_status() IS
  'Issue 53 conservative outbound wiring; mirror of src/lib/woocommerceOutbound.ts. Never performs an external HTTP call.';

COMMIT;
