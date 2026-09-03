-- Revamp 3.4: enable Realtime (WAL/replication) on stores + orders +
-- courier_shipments so the frontend's postgres_changes subscriptions receive
-- events. Without the publication membership, subscriptions silently deliver
-- nothing (the fallback poll covers it, but the point is instant updates).

ALTER PUBLICATION supabase_realtime ADD TABLE public.stores;
ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.courier_shipments;
