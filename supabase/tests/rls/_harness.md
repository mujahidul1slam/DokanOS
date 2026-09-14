# RLS Battery Harness

Run: `npm run test:rls` (requires Docker Desktop + local Supabase stack).
The runner seeds fixtures, then executes `supabase/tests/rls/*_test.sql` in filename order.

## Assertion shapes (copy-paste — no macros in plain SQL)

### Shape A — denial-by-exception (WITH CHECK / RPC raise / trigger)
Expected denial genuinely raises. Absorb the expected SQLSTATE; unexpected success raises FAIL.

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"<UUID>","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    <statement>;
    RAISE EXCEPTION 'FAIL: <id> unexpectedly succeeded' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;  -- per-assertion expected errcode
  END;
END $$;
ROLLBACK;
```

### Shape A′ — deny-by-invisibility (USING-side UPDATE/DELETE)
Two MANDATORY discriminators: (1) in-block rowcount assert; (2) owner-side value-pinned survival.

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"<UUID>","role":"authenticated"}';
DO $$
DECLARE v_rc bigint;
BEGIN
  BEGIN
    <UPDATE/DELETE statement>;
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;  -- error-world denial: expected
    WHEN OTHERS THEN RAISE;                 -- harness defects fail loudly
  END;
  GET DIAGNOSTICS v_rc = ROW_COUNT;         -- MANDATORY
  IF v_rc <> 0 THEN
    RAISE EXCEPTION 'FAIL: <id> was mutable (rowcount %)', v_rc USING ERRCODE = 'P0001';
  END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM <table> WHERE <value-pinned survival>) THEN
    RAISE EXCEPTION 'FAIL: <id> survival' USING ERRCODE = 'P0001';
  END IF;
END $$;
ROLLBACK;
```

### Shape B — allow + verify as connection owner + paired cleanup
### Shape C — SELECT narrowing (count assert + own-row positive control)

See `user_business_access_test.sql` for live examples of all four.

## Fixture matrix (seeded by scripts/run-rls-tests.mjs)

| Fixture | UUID | user_roles | user_business_access |
|---|---|---|---|
| ADMIN | …00a | admin | — |
| STAFF_NO | …00b | staff | — (app_settings actor) |
| STAFF_MGMT | …00c | staff | — (+ settings.manage override) |
| OWNER_A | …001 | staff | owner of BIZ_A |
| OWNER_A2 | …002 | staff | co-owner of BIZ_A |
| UBA_ADMIN_A | …003 | staff | admin of BIZ_A |
| MEMBER_A | …004 | staff | member of BIZ_A |
| VIEWER_A | …005 | staff | viewer of BIZ_A |
| OWNER_B | …006 | staff | owner of B_other |
| OUTSIDER | …007 | staff | — |
| SPARE_A | …008 | staff | — (INSERT target only) |
| SPARE_B | …009 | staff | — (INSERT target only) |

Businesses: `BIZ_A` 11111111-…-01 'Biz A Fixture', `B_other` 11111111-…-02 'Biz B Fixture'.
`BIZ_THROWAWAY` is created in-file by `businesses_test.sql` (slug `harness-throwaway-a`), never restored.
`BIZ_A` is never deleted by any battery statement.

## Step 0.5 — denial-mode calibration (manual, once per stack)

Run the §4.2 probe (OUTSIDER UPDATEs a business it cannot see) and record the outcome:

- (a) no error, 0 rows → silent-skip world (standard Supabase default grants — expected)
- (b) 42501 permission denied → error world (grants revoked somewhere)

Observed: ___________ (record date + result here after first local run)

## Step 0.6 — negative control (one-time)

Re-introduce the v2-class bug (drop the USING last-owner guard on
`Managers can update member roles`), re-run the battery.
Expected: W1a AC-9 fails with `FAIL: W1a-AC9 sole-owner row was mutable (rowcount 1)`,
AC-8b fails likewise, runner exits non-zero. Restore with `supabase db reset`, confirm green.

Observed: ___________ (record here after first local run)

## AC-13 concurrency step (manual, two psql sessions)

Two co-owners of BIZ_A (OWNER_A, OWNER_A2) concurrently self-delete (then, second run, self-demote).
At most one commits; the other deadlock-aborts (40P01) or silently affects 0 rows
(READ COMMITTED re-evaluates USING against the committed state). Business retains ≥1 owner.

Checklist:
1. Session A: `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims TO '{"sub":"…001",…}';`
2. Session B: same with `…002`.
3. Both run `DELETE FROM user_business_access WHERE business_id='<BIZ_A>' AND user_id=<self>;` within ~1s.
4. Verify: exactly one committed OR one aborted 40P01; BIZ_A still has ≥1 owner row.
