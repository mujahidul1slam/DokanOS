-- Backfill existing WooCommerce order rows through the same deterministic
-- formatter and customer snapshot rules as future imports. This repairs rows
-- created before 20261112130000 without mutating unrelated/manual orders.
CREATE OR REPLACE FUNCTION public.backfill_woocommerce_order_snapshots()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count integer;
BEGIN
  WITH desired AS (
    SELECT
      identity_row.order_id,
      public.format_order_number(
        connector.store_id,
        'woo',
        format(
          'WC-%s-%s',
          identity_row.connector_id::text,
          coalesce(nullif(identity_row.external_order_number, ''), identity_row.external_order_id::text)
        )
      ) AS desired_order_number,
      customer.name AS snapshot_name,
      customer.email AS snapshot_email,
      customer.phone AS snapshot_phone,
      customer.address AS snapshot_address,
      customer.city AS snapshot_city
    FROM public.woocommerce_order_identities AS identity_row
    JOIN public.woocommerce_connectors AS connector
      ON connector.id = identity_row.connector_id
    JOIN public.orders AS target
      ON target.id = identity_row.order_id
    LEFT JOIN public.customers AS customer
      ON customer.id = target.customer_id
    WHERE target.source = 'woocommerce'
  )
  UPDATE public.orders AS target
  SET order_number = CASE
        WHEN target.order_number IS DISTINCT FROM desired.desired_order_number
          AND NOT EXISTS (
            SELECT 1
            FROM public.orders AS other
            WHERE other.order_number = desired.desired_order_number
              AND other.id <> target.id
          )
        THEN desired.desired_order_number
        ELSE target.order_number
      END,
      customer_name = coalesce(nullif(target.customer_name, ''), nullif(desired.snapshot_name, '')),
      customer_email = coalesce(nullif(target.customer_email, ''), nullif(desired.snapshot_email, '')),
      customer_phone = coalesce(nullif(target.customer_phone, ''), nullif(desired.snapshot_phone, '')),
      customer_address = coalesce(nullif(target.customer_address, ''), nullif(desired.snapshot_address, '')),
      customer_city = coalesce(nullif(target.customer_city, ''), nullif(desired.snapshot_city, ''))
  FROM desired
  WHERE target.id = desired.order_id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

DO $$
DECLARE
  target regprocedure;
BEGIN
  SELECT p.oid::regprocedure INTO target
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'backfill_woocommerce_order_snapshots'
    AND p.pronargs = 0;
  IF target IS NULL THEN
    RAISE EXCEPTION 'backfill_woocommerce_order_snapshots function was not created';
  END IF;
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', target);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', target);
END $$;

-- Apply the reviewed repair once as part of the migration. The function is
-- retained service_role-only so a future reviewed rerun can be audited.
SELECT public.backfill_woocommerce_order_snapshots();
