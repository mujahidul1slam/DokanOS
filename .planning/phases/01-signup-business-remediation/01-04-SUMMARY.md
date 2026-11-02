---
phase: 01-signup-business-remediation
plan: 04
subsystem: onboarding-wizard
tags: [onboarding-wizard, guard-predicates, member-policy-inserts, publish-my-storefront-rpc, onboarding-completed-at, create-business-mode, d-17-seam-tests]
status: complete
requires: [useBusinessContext (0528baa baseline), create_my_brand_store RPC + R4a-reserved storefront (plan 01-01), supabase-js client, sonner, shadcn ui, vitest]
provides: [pure guard predicates (decideRoute/deriveStartStep), BusinessGuards render helper, onboardingGuards seam tests, Step2Locations, Step3SellingPoints, Step4Storefront, completed 4-step Onboarding shell with finish marker + create-business mode, Business.onboarding_completed_at + sellingPointsCount/onboardingCompletedAt context values]
affects:
  - src/pages/Onboarding.tsx
  - src/components/onboarding/guards.ts
  - src/components/onboarding/BusinessGuards.tsx
  - src/components/onboarding/Step2Locations.tsx
  - src/components/onboarding/Step3SellingPoints.tsx
  - src/components/onboarding/Step4Storefront.tsx
  - src/hooks/useBusinessContext.tsx
  - src/components/CreateBusinessDialog.tsx
tech-stack:
  added: []
  patterns: [pure-guard-predicates-no-react-imports, derive-start-step-from-server-state, skip-affords-zero-writes, insert-then-rpc-assertion-chain, controlled-dialog-full-page-mode]
key-files:
  created:
    - src/components/onboarding/guards.ts
    - src/components/onboarding/BusinessGuards.tsx
    - src/test/onboardingGuards.test.ts
    - src/components/onboarding/Step2Locations.tsx
    - src/components/onboarding/Step3SellingPoints.tsx
    - src/components/onboarding/Step4Storefront.tsx
  modified:
    - src/pages/Onboarding.tsx
    - src/hooks/useBusinessContext.tsx
decisions:
  - "guards.ts is pure (no React imports): decideRoute evaluates loading → memberships === 0 → marker → !hasStore → !hasSellingPoints in that exact order; deriveStartStep treats locations as a NON-resume trigger (audit R4) — only store and selling-point state gate the resume step"
  - "The Onboarding shell derives its start step from server state via deriveStartStep (brands length > 0 = store exists; sellingPointsCount > 0; onboardingCompletedAt from the loaded active business) — a returning owner with a store but no selling points resumes at step 3"
  - "When the shell mounts fresh mid-wizard (no step-1 result in state), it re-derives the { store_id, brand_id, storefront_id, slug } resolution from the loaded brand's woo_store_id plus a storefronts query for the store — steps 2-4 never re-invoke the step-1 RPC"
  - "Steps 2 and 3 insert plain member-policy rows (supabase.from('locations') / from('selling_points')) with business_id + brand_id — no RPC, no service role, no user_roles writes; 'Skip for now' advances WITHOUT any insert (D-09 zero rows on skip) and step-3 copy points at the StoresHub Connect CTAs as the later path"
  - "Step 4 attaches the dokanos_storefront selling point (type 'dokanos_storefront', storefront_id = the R4a-reserved placeholder, woo_store_id = the store id) THEN invokes publish_my_storefront — NO new storefront INSERT anywhere in the step (critique-2 #4); publish is optional and disabled fail-closed when the reserved storefront cannot be located"
  - "Finish writes businesses.onboarding_completed_at via the existing owner UPDATE policy (no new RPC), fires a sonner success toast, and navigates to '/'; finish is disabled when no store exists (brands.length === 0)"
  - "Create-business mode (D-04/D-12): decideRoute 'create-business' renders CreateBusinessDialog full-page (controlled open state); the dialog's internal refresh() + setActive(business_id) transitions the shell into the wizard at step 1; a close WITHOUT creation falls back to a re-anchor panel — no navigation race with the dialog's own close-then-refresh sequence"
  - "useBusinessContext Business interface gains onboarding_completed_at (from the regenerated types' Row, plan 01-01) plus derived sellingPointsCount (exact-count head query) and onboardingCompletedAt context values; membership loading, realtime subscription, and persistence are otherwise untouched"
patterns-established:
  - "Pure guard predicates: all /onboarding branching lives in guards.ts; components only translate decisions to Navigate/render"
  - "Skip affordance contract: skippable wizard steps advance with zero writes; resume state is re-derived from server state, never from local step history"
  - "Insert-then-publish: step 4 inserts the selling point that satisfies publish_my_storefront's 4-assertion chain, then flips the R4a-reserved row"
requirements-completed: [R4]
coverage:
  - delivers: "Guard predicates with seam tests (D-17): decideRoute + deriveStartStep pure functions, vitest-covered in src/test/onboardingGuards.test.ts"
    files: [src/components/onboarding/guards.ts, src/test/onboardingGuards.test.ts]
  - delivers: "Wizard steps 2-3 (D-09): skippable locations/selling-points inserts via plain member-policy rows with prominent skip affordance and StoresHub Connect copy"
    files: [src/components/onboarding/Step2Locations.tsx, src/components/onboarding/Step3SellingPoints.tsx]
  - delivers: "Step 4 (audit R4): optional storefront publish on the R4a-reserved row via selling_points insert + publish_my_storefront RPC, no new storefront INSERT"
    files: [src/components/onboarding/Step4Storefront.tsx]
  - delivers: "Finish flow + create-business mode (D-09/D-12): server-side onboarding_completed_at marker via owner UPDATE policy, sonner toast, dashboard navigation, zero-membership CreateBusinessDialog mount"
    files: [src/pages/Onboarding.tsx, src/hooks/useBusinessContext.tsx]
deviations:
  - "Commit 0528baa (Task 1 guards + BusinessContext extension) was mislabeled 'feat(03-02):' by the executor that produced it; scope content is correct (guards.ts, BusinessGuards.tsx, onboardingGuards.test.ts, useBusinessContext.tsx) — left as-is, not rewritten"
  - "Task 1 and the Task 3 hook extension landed in 0528baa in one commit (the executor merged them); Tasks 2 and 3 are separate atomic commits (d2a7712, c32620a)"
  - "Executed inline by the orchestrator after repeated subagent spawn failures (malformed tool calls + free-model quota cap) — sequential main-working-tree mode per the workflow's fallback rule; no worktrees (project config use_worktrees: false)"
---

# Plan 01-04: Wizard expansion (R4) — Execution Summary

## What was built

The /onboarding wizard is now complete: 4 steps in fixed order, skippable steps 2/3 with zero-write skips, a marker-gated finish flow, optional storefront publish on the R4a-reserved row, and the zero-membership create-business surface — all under the member JWT via existing policies and RPCs.

## Tasks

### Task 1 — Guard predicates + BusinessGuards + seam tests (commit 0528baa)

- `src/components/onboarding/guards.ts`: pure `decideRoute(ctx)` (order: loading → memberships === 0 → marker set → !hasStore → !hasSellingPoints) and `deriveStartStep(ctx)` (locations NOT a resume trigger; store + no selling points → 3; otherwise → 4).
- `src/components/onboarding/BusinessGuards.tsx`: render helper translating guard decisions.
- `src/test/onboardingGuards.test.ts`: 74 lines of vitest seam tests (D-17).
- `src/hooks/useBusinessContext.tsx`: Business interface gains `onboarding_completed_at`; context exposes `sellingPointsCount` + `onboardingCompletedAt`.

### Task 2 — Steps 2 + 3: skippable member inserts (commit d2a7712)

- `Step2Locations.tsx`: name/type/is_default form mirroring the LocationsPanel dialog; inserts via `supabase.from("locations")` with active business_id + step-1 brand_id; prominent "Skip for now" that advances with zero writes.
- `Step3SellingPoints.tsx`: type + name form mirroring the SellingPointsPanel type set (minus dokanos_storefront, step 4's job); inserts via `supabase.from("selling_points")`; copy points at the StoresHub Connect CTAs as the later path; skip advances without writing.
- `Onboarding.tsx`: start step derived via `deriveStartStep` from server state (brands.length, sellingPointsCount, onboardingCompletedAt); step-1 resolution passed down; when mounting fresh mid-wizard the shell re-derives ids from the loaded brand's `woo_store_id` + a storefronts query.

### Task 3 — Step 4 + finish marker + create-business mode (commit c32620a)

- `Step4Storefront.tsx`: dokanos_storefront selling-point insert (storefront_id = R4a placeholder, woo_store_id = store id) then `publish_my_storefront` RPC; NO new storefront INSERT; optional — disabled fail-closed when the reserved storefront cannot be located; read-only URL preview from the same app_config surface step 1 reads.
- `Onboarding.tsx` finish flow: writes `businesses.onboarding_completed_at` via the owner UPDATE policy, sonner success toast, navigates to `/`; finish disabled when no store exists. Skipped items are NOT re-trapped — the marker stops the resume predicate.
- `Onboarding.tsx` create-business mode (D-04/D-12): `decideRoute` "create-business" renders `CreateBusinessDialog` full-page; on the dialog's internal `refresh()` + `setActive(business_id)` the shell enters the wizard at step 1; close-without-creation falls back to a re-anchor panel.

## Verification

- `npm run typecheck`: green (no TS errors).
- `npm test -- --run`: 15 files, 125 tests, all passed (includes onboardingGuards.test.ts, createMyBrandStoreWrapper.test.ts, useStoresList.test.tsx).
- `git grep publish_my_storefront -- Step4Storefront.tsx`: present (docstring + rpc call); zero `from("storefronts")` inserts in the step.

## Deferred

- CreateBusinessDialog's copy rewrite + false-preview fix — plan 01-05's job (this plan only wires the mount, per plan spec).
