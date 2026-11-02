# Rollback: 20261014120000_create_business_first_business.sql

## What it changed

`public.create_additional_business(uuid, text)` — removed the PROVISION_NOT_MEMBER
member-guard (and its admin/staff special-case) so zero-membership confirmed
accounts can create their first business through the CreateBusinessDialog
surface (D-04). Everything else byte-identical to 20261006120000:145-219.

## Rollback

Re-apply the previous definition from migration
`20261006120000_blank_slate_provisioning.sql` (section 2, lines 145-219) —
the CREATE OR REPLACE of `create_additional_business` including the
PROVISION_NOT_MEMBER block. Paste that section in the SQL Editor, or:

```sql
-- Verify current shape first (guard comment present = new version):
select pg_get_functiondef('public.create_additional_business(uuid,text)'::regprocedure);
```

## Risk notes

- Rolling back re-breaks the D-04 zero-membership surface: the dialog returns
  PROVISION_NOT_MEMBER for exactly the users it is mounted for, and older
  confirmed accounts (>24h) have no self-serve recovery (re-anchor path is
  PROVISION_EXPIRED).
- No data changes are involved — pure function definition swap.
