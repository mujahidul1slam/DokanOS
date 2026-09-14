# Rollback — 20260911000130_create_business_with_owner.sql

Removes the atomic business-creation RPC.

```sql
DROP FUNCTION IF EXISTS public.create_business_with_owner(text, text, text, text, text);
```

Frontend note: `CreateBusinessForm` (BusinessAccountTab.tsx) calls this RPC —
roll back the Release-1 frontend bundle in the same action, or creation breaks.
