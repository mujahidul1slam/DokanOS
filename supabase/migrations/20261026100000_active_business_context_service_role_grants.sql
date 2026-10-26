-- Follow-up to 20261024100000_active_business_context.sql: grant EXECUTE on the
-- active-business-context functions to service_role.
--
-- Why this is needed: `service_role` bypasses RLS, but it does NOT bypass
-- PostgreSQL EXECUTE privileges on a SECURITY DEFINER function. The S1
-- migration revoked EXECUTE from PUBLIC/anon and granted only to
-- `authenticated`, so a server-side caller using the service key (Edge
-- Function, admin script, background sync) gets "permission denied for
-- function" rather than a validated result.
--
-- This aligns the two functions with the repo convention established in
-- 20260929120000_member_scoped_rls.sql (`GRANT EXECUTE ... TO authenticated,
-- service_role`) and repeated across the later account/business migrations.
--
-- Scope: service_role only. `anon` stays revoked, the table stays
-- SELECT/INSERT/UPDATE/DELETE-revoked for PUBLIC/anon/authenticated, and FORCE
-- ROW LEVEL SECURITY stays in place. `current_business_context()` is keyed on
-- auth.uid(), so a service-role call without a JWT claim returns NULL rather
-- than another tenant's business — the membership join in the function body
-- remains the authority for every caller.

GRANT EXECUTE ON FUNCTION public.set_active_business_context(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.current_business_context() TO service_role;

--------------------------------------------------------------------------------
-- ROLLBACK (manual only):
-- REVOKE EXECUTE ON FUNCTION public.set_active_business_context(uuid) FROM service_role;
-- REVOKE EXECUTE ON FUNCTION public.current_business_context() FROM service_role;
--------------------------------------------------------------------------------
