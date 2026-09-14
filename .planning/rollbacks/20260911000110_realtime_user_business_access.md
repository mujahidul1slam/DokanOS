# Rollback — 20260911000110_realtime_user_business_access.sql

Removes user_business_access from the realtime publication (returns the
membership switcher to silent-zero-events behavior — the pre-fix state).

```sql
ALTER PUBLICATION supabase_realtime DROP TABLE public.user_business_access;
```

Additive migration; this rollback is only needed if realtime WAL volume becomes
a problem or the publication must match an older frontend contract.
