-- Issue 54 follow-up: the cutover Edge Function writes report items with the
-- service-role client. service_role bypasses RLS, but it still needs table
-- privileges; the original cutover migration granted SELECT only.
GRANT INSERT, UPDATE ON public.woocommerce_cutover_runs TO service_role;
GRANT INSERT, UPDATE ON public.woocommerce_cutover_report_items TO service_role;
