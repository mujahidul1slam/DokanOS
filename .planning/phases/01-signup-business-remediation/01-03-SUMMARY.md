---
phase: 01-signup-business-remediation
plan: 03
subsystem: frontend-tracer-slice
tags: [onboarding-wizard, create-my-brand-store-rpc, fail-closed-stores-list, storeshub-connection-truth, d-17-seam-tests]
status: complete
requires: [useBusinessContext, create_my_brand_store RPC (plan 01-01), supabase-js client, vitest + @testing-library/react]
provides: [createMyBrandStore wrapper, generateStoreSlug parity helper, /onboarding route, Step1Store, Onboarding shell, fail-closed useStoresList, StoresHub blank-slate render]
affects:
  - src/lib/slug.ts
  - src/lib/createMyBrandStore.ts
  - src/test/createMyBrandStoreWrapper.test.ts
  - src/pages/Onboarding.tsx
  - src/components/onboarding/Step1Store.tsx
  - src/App.tsx
  - src/hooks/useStoresList.ts
  - src/test/useStoresList.test.tsx
  - src/pages/StoresHub.tsx
tech-stack:
  added: []
  patterns: [typed-rpc-wrapper-with-per-business-memo, read-only-live-preview-superseded-by-server-value, fail-closed-query-shape, module-mock-seam-test]
key-files:
  created:
    - src/lib/createMyBrandStore.ts
    - src/test/createMyBrandStoreWrapper.test.ts
    - src/pages/Onboarding.tsx
    - src/components/onboarding/Step1Store.tsx
    - src/test/useStoresList.test.tsx
  modified:
    - src/lib/slug.ts
    - src/App.tsx
    - src/hooks/useStoresList.ts
    - src/pages/StoresHub.tsx
decisions:
  - "slug.ts truncates at 60 with deterministic literal 'store' fallback (under-2-char bases) to match left(v_slug_base, 60) in the RPC; random/timestamped fallback removed"
  - "createMyBrandStore keeps a per-business in-flight promise + resolved-result memo; second invoke for same business returns cached result without a second RPC call"
  - "/onboarding mounted lazy in the authenticated branch OUTSIDE DashboardLayout (same placement as /welcome); no existing route altered (/welcome retirement deferred to plan 01-05)"
  - "Step1Store pre-fills name from active business, renders read-only live reservation preview via generateStoreSlug, NO editable slug field; on success displays the ACTUAL slug from the RPC return superseding the preview"
  - "useStoresList fails closed: active business + zero brand-store ids -> [] with NO stores query; outside-provider/null-active -> [] without querying; brand->woo_store_id mapping extracted to brandStoreIdsOf() for R2a generalization (Release-2 constraint 2)"
  - "StoresHub NULL-brand leakage fixed by rewriting the three .or(...) filters to plain .eq('brand_id', brand.id); zero-brands copy rewritten to point at the wizard with a CTA; four empty states replaced with dialog-opening or wizard-link CTAs; status-keyed badges kept untouched"
metrics:
  duration: ~45min
  tasks: 3
  commits: 3
  completed: 2026-10-09
actuals:
  tokens: 9500
  tasks: 3
  commits: 3
  plan_head_before: ba38c1a7ecb30ac4308b1a4f76360332e8577f6d
---

# Phase 01 Plan 03: Tracer Slice UI Half — Wizard + Fail-Closed Stores List Summary

End-to-end tracer completion: /onboarding wizard creates the first store/brand via the typed `create_my_brand_store` RPC under the owner JWT with a truthful reservation preview, and StoresHub renders a blank business honestly — fail-closed `useStoresList`, own-brand rows only, Connect CTAs, honest zero-brands copy.

## What Was Built

### Task 1 — Lib slice: slug parity + createMyBrandStore wrapper + idempotency test (commit `ba38c1a`)

- **`src/lib/slug.ts`** — `generateStoreSlug` aligned to the RPC derivation: lowercase, collapse non-alphanumerics to `-`, trim edges, truncate at **60** (was 48), deterministic literal `"store"` fallback for under-2-char cleaned bases. No random or timestamped fallback remains. Export name unchanged — `CreateBusinessDialog` and the new preview consumers both keep working.
- **`src/lib/createMyBrandStore.ts`** — `createMyBrandStore(businessId, name): Promise<CreateMyBrandStoreResult>` wrapping exactly one `supabase.rpc("create_my_brand_store", { p_business_id, p_name })` call site against the regenerated types. Per-business in-flight-promise + resolved-result memo: two awaits for the same business issue ONE rpc call; different business id → new call. Surfaces RPC errors (including P0001 FORBIDDEN) to the caller. Contains no `supabase.from(...).insert(...)` — creation is RPC-only.
- **`src/test/createMyBrandStoreWrapper.test.ts`** — D-17 seam tests (TDD RED→GREEN): slug parity (60-char truncation, Bangla-only → `"store"`), wrapper happy path, per-business idempotency, error surfacing. Module-mocks `@/integrations/supabase/client` per the `invoiceHtml.test.ts` precedent.

### Task 2 — Wizard slice: /onboarding shell + step 1 + route (commit `c5fd0cf`)

- **`src/components/onboarding/Step1Store.tsx`** — Store-name input pre-filled from the active business name (RESEARCH OQ2 recommendation); read-only live reservation preview derived via the aligned `generateStoreSlug`; NO editable slug field. Submit calls `createMyBrandStore(active.id, name)` — never `supabase.rpc` directly. On success displays the ACTUAL reserved slug from the RPC return, superseding the preview. Errors (P0001 etc.) rendered inline — real error handling, no silent catches.
- **`src/pages/Onboarding.tsx`** — Thin full-page wizard shell: renders nothing while `useBusinessContext.loading` is true (RESEARCH Pitfall 5); 4-step indicator (fixed order 1→4); mounts `Step1Store`; parses `slug`/`business_id`/`error` query params (future AuthConfirm contract, plan 01-05); derives past-step-1 from `brands.length > 0`. Steps 2–4 are explicit "coming in plan 01-04" placeholder panels — architecturally stable mount points, no business logic. Anti-god-component: shell holds layout + step routing only.
- **`src/App.tsx`** — Lazy `/onboarding` route added in the AUTHENTICATED branch, OUTSIDE `DashboardLayout` (same placement pattern as `/welcome`). Every pre-existing route string unchanged — `/welcome` retirement deferred to plan 01-05 (RESEARCH Pitfall 7).

### Task 3 — R3: fail-closed useStoresList + StoresHub connection-truth (commit `a47c138`)

- **`src/hooks/useStoresList.ts`** — Fails CLOSED (R3-a / audit T-03-01): active business + zero brand-store ids → `[]` with NO stores query at all; no business context (outside provider or null active) → `[]` without querying; ids present → `.in("id", activeStoreIds)` only. Brand→`woo_store_id` mapping extracted to exported `brandStoreIdsOf()` so R2a's `useBusinessStores` generalizes rather than rewrites (Release-2 constraint 2). Stable `NO_BRANDS` empty-array constant prevents effect-dep reference churn. Does NOT read `usePermissions.storeIds` / `hasStoreAccess` (prohibition respected).
- **`src/pages/StoresHub.tsx`** — Connection truth (R3, audit F2.2):
  - Three NULL-brand leakage filters rewritten from `.or(...brand_id.is.null...)` to plain `.eq("brand_id", brand.id)` (connectors, product_sources, customer_sources) — no id interpolation into `.or` strings (T-03-02). Locations and selling_points already filtered correctly — left alone.
  - Zero-brands copy rewritten: false "brands are created automatically when a WooCommerce store is connected" claim removed; states first store/brand is created in the onboarding wizard with a Button navigating to `/onboarding`.
  - Four per-tab empty states ("No locations.", "No selling points.", "No connectors.", "No sources registered.") replaced with CTAs: locations/selling-points open their existing add-dialogs; connectors/sources offer wizard-step links (D-09 skip rationale respected in copy).
  - Badges: existing `status === "connected"` keyed rendering kept untouched — truthful for real rows.
  - Surgical discipline: no other behavior, query, or styling changes.
- **`src/test/useStoresList.test.tsx`** — D-17 seam tests (TDD RED→GREEN): fail-closed (zero brand-stores → `[]`, `from` never called), scoped (`.in("id", ["s1"])` issued), no-context (null active AND thrown-outside-provider both yield `[]` without querying). Module-mocks `@/hooks/useBusinessContext` + `@/integrations/supabase/client`; chainable builder mock resolves like supabase-js.

## Verification Results

```
✓ src/test/useStoresList.test.tsx (3 tests) 146ms   ← Task 3 seam tests
✓ src/test/createMyBrandStoreWrapper.test.ts (5 tests) ← Task 1 seam tests (green at commit ba38c1a)
npx tsc --noEmit → clean (no error TS output)        ← typecheck after Task 3
git grep "brand_id.is.null" -- src/pages/StoresHub.tsx → 0 matches  ← leakage literal gone
git grep "created automatically when a WooCommerce" -- src/pages/StoresHub.tsx → 0 matches ← false copy gone
git grep "onboarding" -- src/pages/StoresHub.tsx → 7 hits (CTA buttons + wizard link)      ← wizard CTA present
Badge lines still key on status === "connected" (verified :199, :611, :686)                ← truthful badges kept
```

## Deviations from Plan

None material — plan executed as written. One cosmetic note: the Task 3 commit was initially authored with scope `(04-01)` and its summary briefly landed in a fabricated `.planning/phases/04-stores-hub-fail-closed/` directory. Both corrected before this SUMMARY: commit amended to `a47c138 feat(1-3): StoresHub blank-slate render + fail-closed useStoresList`, stray directory removed, ledger recreated at the correct `01-03` base (`ba38c1a`). No code changed during the correction; tests re-passed post-amend.

## Known Stubs

| Stub | File | Reason | Resolved by |
|------|------|--------|-------------|
| Steps 2–4 placeholder panels ("coming in plan 01-04") | src/pages/Onboarding.tsx | Architecturally stable mount points intentionally left as placeholders — the shell's step registry is the seam plan 01-04 fills | Plan 01-04 |
| `slug`/`business_id` query-param contract parsed but unused beyond display | src/pages/Onboarding.tsx | Future AuthConfirm success contract — wired here so plan 01-05 needs no shell change | Plan 01-05 |

Both stubs are intentional seams declared by the plan, not gaps preventing this plan's goal. The tracer slice's own path (/onboarding → step 1 → RPC → truthful StoresHub) is fully wired.

## Threat Mitigations Delivered

| Threat | Disposition | Evidence |
|--------|-------------|----------|
| T-03-01 Information Disclosure (fail-open stores list) | mitigated | Fail-closed branch + seam test asserts `from("stores")` never called with zero brand-stores |
| T-03-02 Tampering (.or() interpolation) | mitigated | Three leakage filters rewritten to plain `.eq("brand_id", …)`; negative grep confirms `brand_id.is.null` absent |
| T-03-03 EoP (client wrapper appearing to authorize) | mitigated | Wrapper performs no authorization; RPC re-asserts UBA role server-side (plan 01-01); client myRole UX-only |
| T-03-04 Spoofing (preview divergence) | mitigated | Preview mirrors RPC derivation exactly (60 truncation, 'store' fallback); replaced by RPC-returned slug after invoke |
| T-03-SC Supply chain | accepted | No packages installed |

No new security-relevant surface introduced beyond the plan's threat model — no Threat Flags.

## Requirements Covered

- **R3** — StoresHub connection-truth (own-brand rows only, Connect CTAs, honest copy, truthful badges) ✓
- **R3-a** — useStoresList fails closed ✓
- **R4** — First user-visible path end-to-end: /onboarding → step 1 → create_my_brand_store RPC → StoresHub ✓
- **R4a** — Member-callable store creation via RPC only (no direct INSERT) ✓
- **R4a-b** — D-17 wrapper-idempotency seam test ✓

## Commits

| Hash | Scope | Message |
|------|-------|---------|
| ba38c1a | 1-3 | feat(1-3): slug-RPC parity + createMyBrandStore wrapper with per-business idempotency |
| c5fd0cf | 1-3 | feat(1-3): /onboarding wizard shell + step 1 store creation + route |
| a47c138 | 1-3 | feat(1-3): StoresHub blank-slate render + fail-closed useStoresList |

Measured from ledger base `ba38c1a`: `git rev-list --count ba38c1a..HEAD` = 2 at SUMMARY-write time (the third, this docs commit, follows immediately after — total plan commits: 3).

## Self-Check: PASSED

All created files verified on disk: `src/lib/createMyBrandStore.ts`, `src/test/createMyBrandStoreWrapper.test.ts`, `src/pages/Onboarding.tsx`, `src/components/onboarding/Step1Store.tsx`, `src/test/useStoresList.test.tsx`. All three plan commits verified in history: `ba38c1a`, `c5fd0cf`, `a47c138`.