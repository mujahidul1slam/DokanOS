# Rollback — 20261006121000_create_my_brand_store.sql

Removes the member-callable store-creation RPC and the onboarding marker
column.

```sql
DROP FUNCTION IF EXISTS public.create_my_brand_store(uuid, text);
DROP FUNCTION IF EXISTS public.verify_create_my_brand_store();
ALTER TABLE public.businesses DROP COLUMN IF EXISTS onboarding_completed_at;
```

## Frontend note

Plans 01-03/01-04/01-05 call this RPC from the onboarding wizard
(`/onboarding` step 1) and read `businesses.onboarding_completed_at` for the
resume guard — roll back the Release-1 frontend bundle in the same action, or
onboarding breaks.

## Data note

Store / brand / user_store_access / storefront rows created by the RPC are
**NOT** removed by this rollback. If they must go too, delete them explicitly
per business (storefronts → brands.store link → user_store_access → stores),
in that dependency order.
