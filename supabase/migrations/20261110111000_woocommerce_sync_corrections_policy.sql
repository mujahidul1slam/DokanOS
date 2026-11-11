-- Issue 55 follow-up: the missing tenant boundary on sync corrections.
--
-- 20261110090000 enabled RLS and granted SELECT/INSERT/UPDATE/DELETE on all
-- nine WooCommerce operations tables (:555), but the companion loop that
-- installs a "Woo scoped members read <table>" SELECT policy (:574) listed
-- only seven tables and omitted `woocommerce_sync_corrections`. With RLS
-- enabled and zero policies, default-deny silently blocked every
-- `authenticated` read of the table even though the grants existed — caught
-- by AC-2 of woocommerce_connector_boundaries_test.sql.
--
-- Fix forward (migrations may already be applied in production) with the
-- exact sibling template: re-running is safe via DROP IF EXISTS.

DROP POLICY IF EXISTS "Woo scoped members read woocommerce_sync_corrections"
  ON public.woocommerce_sync_corrections;
CREATE POLICY "Woo scoped members read woocommerce_sync_corrections"
  ON public.woocommerce_sync_corrections FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.woocommerce_connectors c
    WHERE c.id = woocommerce_sync_corrections.connector_id
      AND public.is_business_member(c.business_id)
  ));
