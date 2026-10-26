-- Retire the former combined brand + legacy connector + storefront wizard RPC.
-- Keep its definition/data contract in place for the documented rollback window,
-- but no authenticated client may create new legacy combined-setup records.
REVOKE EXECUTE ON FUNCTION public.create_my_brand_store(uuid, text)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.create_my_brand_store(uuid, text) IS
  'Retired combined onboarding RPC. Execute is revoked; retained only for the reviewed rollback/cleanup boundary.';
