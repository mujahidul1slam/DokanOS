-- ============================================================================
-- Fix Pathao order-status auto-tracking.
--
-- Three independent faults stopped the 15-minute refresh from ever updating an
-- order, while the manual "Update Tracking" button kept working:
--
--   1. AUTH. 20260802075500_fix_pathao_cron.sql dropped the Authorization
--      header from the cron body. pathao-courier is not listed in
--      config.toml, so it runs with verify_jwt = true and the Edge Function
--      gateway rejected every firing with
--          401 {"code":"UNAUTHORIZED_NO_AUTH_HEADER"}
--      before any function code ran -- which is why the in-function
--      `isSystemTrackAll` bypass never helped. The manual button worked
--      because supabase.functions.invoke() attaches the caller's JWT.
--
--   2. A JAMMED POLL WINDOW. track_all reads 50 orders ordered by
--      updated_at ASC, and only UPDATEs a row when the status changed. Orders
--      that will never change again therefore keep their original updated_at
--      and hold the window forever. Measured before this migration: 146
--      eligible orders, and the 50-row window contained 31 Pickup Cancel,
--      9 Partial Delivery, 6 Pickup Failed and 4 Exchange -- zero live
--      shipments. last_tracked_at below is stamped on every poll (even a
--      no-change poll) so the window round-robins instead of deadlocking.
--
--   3. WRONG STATUS MAPPING. "Pickup Cancel" and "Pickup Failed" mapped to
--      "shipped", holding ~83 dead orders permanently open, and
--      "Pickup On Hold" was not mapped at all.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Round-robin cursor for track_all
-- ---------------------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS last_tracked_at timestamptz;

COMMENT ON COLUMN public.orders.last_tracked_at IS
  'Last time pathao-courier polled this consignment. Stamped on every poll, '
  'including no-change and failed polls, so track_all rotates through all '
  'active consignments instead of re-reading the same oldest 50 forever.';

CREATE INDEX IF NOT EXISTS idx_orders_last_tracked_at
  ON public.orders (last_tracked_at NULLS FIRST)
  WHERE consignment_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. One-time repair of statuses left wrong by the old mapping
--
-- trg_auto_push_order_status fires on every status change and POSTs to
-- woo-push. 69 of the affected orders are Woo-linked and some date back to
-- 2026-05-01, so replaying these transitions would push months-old changes
-- into the live store and can trigger WooCommerce customer emails. The
-- trigger is therefore disabled for this correction only: DokanOS is brought
-- in line with reality, WooCommerce is deliberately left untouched.
--
-- Doing this here also keeps the fix cheap: these orders leave the eligible
-- set immediately, so track_all stops spending Pathao API calls on them.
-- ---------------------------------------------------------------------------
ALTER TABLE public.orders DISABLE TRIGGER trg_auto_push_order_status;

-- Pickup never happened -> the shipment does not exist.
UPDATE public.orders
   SET status = 'cancelled'
 WHERE consignment_id IS NOT NULL
   AND status NOT IN ('delivered', 'completed', 'cancelled', 'returned')
   AND lower(regexp_replace(coalesce(tracking_status, ''), '[_-]+', ' ', 'g'))
       IN ('pickup cancel', 'pickup cancelled', 'pickup failed');

-- Goods reached the customer.
UPDATE public.orders
   SET status = 'delivered'
 WHERE consignment_id IS NOT NULL
   AND status NOT IN ('delivered', 'completed', 'cancelled', 'returned')
   AND lower(regexp_replace(coalesce(tracking_status, ''), '[_-]+', ' ', 'g'))
       IN ('delivered', 'partial delivery', 'partial delivered',
           'payment invoice');

-- Awaiting a decision -> needs attention, not "shipped".
UPDATE public.orders
   SET status = 'processing'
 WHERE consignment_id IS NOT NULL
   AND status NOT IN ('delivered', 'completed', 'cancelled', 'returned')
   AND lower(regexp_replace(coalesce(tracking_status, ''), '[_-]+', ' ', 'g'))
       IN ('pickup on hold', 'on hold', 'on hold by customer request', 'hold');

ALTER TABLE public.orders ENABLE TRIGGER trg_auto_push_order_status;

-- ---------------------------------------------------------------------------
-- 3. Reschedule the cron with auth and a realistic timeout
--
-- The Authorization value is the project anon key. It is already public (it
-- ships in the frontend bundle as VITE_SUPABASE_PUBLISHABLE_KEY) and is the
-- same key 20260802065900_auto_push_order_status.sql already uses, so this
-- introduces no new exposure -- it only satisfies the gateway's verify_jwt
-- check. track_all takes no user input and only writes courier status.
--
-- timeout_milliseconds: 50 orders paced at 350ms is ~18s of work, but pg_net
-- defaults to ~5s and was aborting the request mid-loop (visible as a
-- FAILED/TIMEOUT row in net._http_response). 120s leaves headroom.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM cron.unschedule('pathao-track-all-15min');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'pathao-track-all-15min',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://jiwndicvfkiltgageqwv.supabase.co/functions/v1/pathao-courier',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imppd25kaWN2ZmtpbHRnYWdlcXd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzMjg5OTcsImV4cCI6MjEwMDkwNDk5N30.zWbTtxLYD1hw-vQ7qZdxm1NgUSWYHsS-0wWXg89_7MY'
    ),
    body := jsonb_build_object('action', 'track_all'),
    timeout_milliseconds := 120000
  ) AS request_id;
  $$
);
