-- Minimum service-role privileges for the public signup audit and rate limiting.
--
-- The public signup and resend Edge Functions write these rows with the
-- service-role client. This local migration baseline grants only the verbs
-- those functions use; it does not grant anonymous/authenticated access,
-- table-wide app_config reads, or blanket privileges on public tables.
GRANT INSERT ON public.signup_events TO service_role;
GRANT USAGE ON SEQUENCE public.signup_events_id_seq TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.rate_limit_hits TO service_role;
