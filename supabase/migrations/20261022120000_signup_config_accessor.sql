-- Expose only the public signup kill switch; do not grant table-wide SELECT.
CREATE OR REPLACE FUNCTION public.is_signup_open()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT coalesce(
    (SELECT value IN ('true'::jsonb, '"true"'::jsonb)
       FROM public.app_config
      WHERE key = 'signup_open'),
    false
  );
$function$;

REVOKE ALL ON FUNCTION public.is_signup_open() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_signup_open() TO anon, authenticated, service_role;
