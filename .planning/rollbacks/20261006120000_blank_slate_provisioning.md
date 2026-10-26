# Rollback — 20261006120000_blank_slate_provisioning.sql

Restores the pre-R1 provisioning contract: `signup_create_business_core`
creates the 9 template row groups again and `create_additional_business`
loses its 24h idempotency guard.

**Data note:** template rows for businesses provisioned under R1 are **NOT
backfilled** — this rollback restores code, not data. Undo requires re-running
the pre-R1 function bodies, which live in git history:

```bash
git show e063c8b^:supabase/migrations/20260925120100_signup_provision_fns.sql
# (any commit before the Release-1 push; the operative pre-R1 file is
#  20260925120100_signup_provision_fns.sql at commit c3f6afc)
```

## 1. Restore functions

Because every object here is `CREATE OR REPLACE`, rollback = re-apply the
pre-R1 definitions (sections 2, 4, and 7 of the pre-R1
`20260925120100_signup_provision_fns.sql`):

- `signup_create_business_core` — full template-row body (9 row groups,
  three-column slug retry, `storefront_domain` read, `order_sources` fb check,
  store-access assertion)
- `create_additional_business` — without the 24h idempotency guard
- `verify_signup_fns` — without the 33-key / `storefronts.view` assertion
  (the pre-R1 core grants 32 keys)

No DROP is required. `REVOKE`/`GRANT` tails are included in the restored file.

## 2. Frontend note

None — R1 preserves the `{slug, business_id}` return shape and the
`PROVISION_*` error codes, so no edge function or client change is needed.
Businesses provisioned under the blank-slate contract keep their
business + owner + 33-key bundle rows; they simply never receive template rows
(retroactive creation is out of scope by design).
