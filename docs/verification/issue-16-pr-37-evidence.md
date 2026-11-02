# Issue #16 / PR #37 — evidence record

Spec: https://github.com/mujahidul1slam/DokanOS/issues/16
PR: https://github.com/mujahidul1slam/DokanOS/pull/37

## Summary

Business switching now scopes operational data (Dashboard, Orders, Products, Analytics) to the active business's stores. Client-side scope via `useActiveBusinessStoreIds()` + `scopeStoreIds()`. Server-side enforcement via `current_business_context()` RLS policies.

## Verification checklist

| Check | Harness/Backend | Result |
| --- | --- | --- |
| Typecheck | tsc | PASS |
| Unit suite | vitest/mocked | 477 passed, 3 skipped |
| Accounts browser suite | playwright/mocked | 30 passed (after is_signup_open harness fix) |
| Smoke on real stack green | manual/real-stack | **PASS** — full journey driven live in the shared browser (details below) |
| RLS battery | rls-battery/real-stack | *requires supabase db reset* |
| verify:env | node script | **PASS** — 7/7 required checks green before the manual session |

### Smoke journey (manual/real-stack, 2026-10-27)

Run against `supabase start` + fresh `supabase db reset` on the integration worktree, Vite dev server with `VITE_SUPABASE_URL=http://127.0.0.1:54321`, browser driven via the DSH shared browser.

1. Signup (`/signup`, real `signup-event` edge fn → 200; user landed in `auth.users`).
2. Create business "Alpha Business" → `businesses` + owner `user_business_access` rows confirmed via psql.
3. Create brand "Alpha Brand" → `brands` row with `woo_store_id IS NULL` confirmed.
4. Create store "Alpha Store" (physical, under Alpha Brand) → `brand_stores` row confirmed.
5. Create product "Smoke Product" (price 100, store = Alpha Store) → `products` row confirmed.
6. Create second business "Beta Business".
7. Switch to Beta → `/products` shows **zero** products (Smoke Product absent); Dashboard shows the fail-closed "No stores in this business" state.
8. Switch back to Alpha → `/products` shows Smoke Product again.
9. `/orders` loads correctly on both businesses.

The two-store-concepts split (#38) is visible in step 4: `brand_stores` rows do not yet feed the legacy `stores` scope, which is why the Dashboard shows the fail-closed empty state — correct behavior, and the reason #38 stays open.

### Follow-up manual session (manual/real-stack, 2026-10-29)

Stack restarted (`supabase start`, `signup_open=true`, existing smoke user retained), Vite dev server on `:5173` pointed at the local gateway. The human completed a manual pass and reported the testing done.

Environment incident during this session: **18 tracked files had been deleted from the worktree on disk** (`src/App.tsx` among them) while git still recorded them — Vite failed to resolve `./App.tsx` and the app rendered a blank page with nothing logged. Recovered with `git restore --worktree -- <paths>` and a clean Vite restart. This is the failure mode `npm run verify:env` exists to catch (the *app shell files present* check) and should be run before every manual session.

## What changed

### Client-side scope seam
- New hook: `src/hooks/useActiveBusinessStoreIds.ts` — derives store IDs from the active business's brands, fails closed (empty = no stores readable, never all stores).
- `scopeStoreIds(query, ids)` applies `.in("store_id", ids)` to any PostgREST query builder.
- `selectedStoreScope(storeId, businessStoreIds)` resolves Dashboard-style "all"/"pos"/specific-store filters against the active business.
- Every operational page (Dashboard, Orders, Products, POS, Analytics, Integrations, Customers) now calls `useActiveBusinessStoreIds()` and passes the result through `scopeStoreIds()`.

### Server-side RLS enforcement
- Migration `20261024100000_active_business_context.sql` — durable per-user active business context table + `current_business_context()` helper.
- Migration `20261026100000_active_business_context_service_role_grants.sql` — service role access for edge functions.
- Migration `20261026120000_active_business_context_operational_rls.sql` — operational table policies read `current_business_context()` instead of allowing cross-business reads.

### Mocked Playwright harness fix
- All 5 spec files in `tests/accounts/` now mock `/rpc/is_signup_open → true` alongside the retired `/app_config` route. Commit 2435c1b moved the signup kill switch to the RPC but the test harness was never updated, causing silent failures.

## Reproduce

```powershell
# Environment check first
npm run verify:env

# Fast checks (no Docker needed)
npm run typecheck
npm test
$env:PLAYWRIGHT_CHANNEL='chrome'; npm run test:browser

# Full stack (requires Docker Desktop running)
supabase start
supabase db reset
npm run test:smoke
node scripts/run-rls-tests.mjs
```

## Evidence labeling

Per `docs/agents/evidence-standards.md`: every result above names its harness and backend. "Smoke on real stack green" is a required line — if it cannot be run (e.g., Docker unavailable), that is recorded explicitly rather than omitted.

## Deployment boundary

PR #37 targets `main` from `integration/accounts-8-15`. No deployed database was changed during verification. The migrations are additive and rollback-safe (drop the context table + restore prior policies).
