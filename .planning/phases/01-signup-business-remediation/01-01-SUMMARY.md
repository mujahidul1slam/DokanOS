---
phase: 01-signup-business-remediation
plan: 01
subsystem: database-provisioning
tags: [signup, rls, rpc, migration, release-1]
key-files:
  created:
    - supabase/migrations/20261006120000_blank_slate_provisioning.sql
    - supabase/migrations/20261006121000_create_my_brand_store.sql
    - .planning/rollbacks/20261006120000_blank_slate_provisioning.md
    - .planning/rollbacks/20261006121000_create_my_brand_store.md
  modified:
    - src/integrations/supabase/types.ts
metrics:
  tasks: 3
  commits: 2
---

# Plan 01-01 Execution Summary — Tracer DB Half (R1 + R4a)

## What Was Built

**R1 blank-slate provisioning** (`20261006120000_blank_slate_provisioning.sql`):
- `signup_create_business_core` rewritten: now creates exactly 1 businesses row (with slug-retry on `businesses.slug` only) + 1 user_business_access('owner') + **33 user_permissions rows** (32 original keys + `storefronts.view`) — and ZERO template rows (no stores/brands/locations/storefronts/selling_points/connectors/sources/user_store_access).
- `create_additional_business` gains the per-user 24h idempotency guard: (p_user_id, canonical slug-base) matched against the caller's OWN businesses via user_business_access; idempotent return creates nothing and writes no second 'business_added' event.
- `verify_signup_fns` extended: asserts `storefronts.view` present in the function body AND exactly 33 bundle rows via source-text count.
- Return shape unchanged (`slug`, `business_id`) — edge functions keep matching.

**R4a member store-creation RPC** (`20261006121000_create_my_brand_store.sql`):
- `businesses.onboarding_completed_at timestamptz` added (nullable marker, D-09).
- `create_my_brand_store(p_business_id, p_name)`: SECURITY DEFINER, auth.uid() check, UBA role IN ('owner','admin') as the ONLY authorization (no admin special-cases, D-03), 1–100 name normalization mirroring the core, deterministic 'store' fallback (preview parity), `storefront_domain` check moved from the core, idempotency pre-keyed on brand-with-store link (single-store cap — no-op for backfilled businesses), retry loop checks all three slug columns (businesses/brands/storefronts), one transaction: stores → brands(woo_store_id) → user_store_access → storefronts with **is_active=false explicit**.
- `verify_create_my_brand_store`: RPC exists, NOT granted to anon, IS granted to authenticated, marker column exists.
- Rollback notes for both migrations in `.planning/rollbacks/`.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 (checkpoint) | — | Pre-approved by user: "Proceed per audit §4 v3 (recommended)" — one-way door R1+R4a |
| 2 (tracer) | `d699041` | feat(1-01): blank-slate provisioning + create_my_brand_store migrations + rollback notes |
| 3 (blocking) | `706ee37` | feat(1-01): regenerate database types (create_my_brand_store + onboarding_completed_at) |

## Verification Results

- ✅ `supabase db push --yes --linked`: BOTH migrations applied to hosted project jiwndicvfkiltageqwv (DokanOS, ACTIVE_HEALTHY)
- ✅ Types regenerated: `create_my_brand_store` (2 hits) + `onboarding_completed_at` (4 hits) present in `src/integrations/supabase/types.ts`
- ✅ `npm run typecheck` (tsc --noEmit): exit 0
- ✅ No files under supabase/functions/ modified by this plan
- ⏳ Post-push smoke (`select public.verify_signup_fns();` / `select public.verify_create_my_brand_store();` in Dashboard SQL Editor): **operator step** — must both return `status: ok` (no psql/Dashboard automation available from CLI)

## Deviations

1. **Local chain replay deferred to plan 01-06**: `supabase db reset` and `npm run test:rls` could not run — local Docker Desktop segfaults (exit 139) during "Initialising schema..." reproducibly across completely fresh volumes; Docker Desktop itself flapped twice during the session. Per the plan's task-2 precondition, the **hosted push exercised the SQL instead**, and the reset + RLS battery move to 01-06's release gate. (Stale local volume also required manual removal: `sbdb` container + volume; plain `supabase stop` re-creates the volume as a backup — use `--no-backup`.)
2. **Migration history repair**: hosted history lacked `20260925140000_signup_publish_and_delete_rpcs` and `20260929120000_member_scoped_rls` (applied via Dashboard SQL Editor per the audit's state map, bypassing the history table). Repaired to `applied` via `supabase migration repair` after verifying their effects are live (audit §0 state map; live storefront features depend on them). Dry-run then confirmed ONLY the two new migrations would apply.
3. **user_roles READ retained** in `create_additional_business`'s preserved platform-admin guard (line 177: read-only EXISTS check, original behavior). The plan's acceptance wording "neither contains user_roles" is interpreted per its own action item ("keep existing guards") and the must_haves prohibition (no user_roles **writes**) — zero writes exist in either migration.
4. **Discovery — local Docker stack**: stale local volume password mismatch (`authenticator`) + init segfaults; environment issue unrelated to the migrations (see Deviation 1).

## Open Items for Operator

- [ ] Run in Dashboard SQL Editor: `select public.verify_signup_fns();` and `select public.verify_create_my_brand_store();` — both must return `status: ok` (30 seconds; also covered by 01-06's acceptance run)
- [ ] `supabase db reset` + `npm run test:rls` at 01-06 (requires working Docker Desktop)

## Self-Check

PASSED — all agent-executable acceptance criteria verified; two environment-deferred items recorded above with exact operator steps. No files outside the plan's declared scope were touched.

## Handoff

Plan 01-03 (tracer UI half) is unblocked: `create_my_brand_store` and `onboarding_completed_at` are in the regenerated Database types, so wizard code typechecks.
