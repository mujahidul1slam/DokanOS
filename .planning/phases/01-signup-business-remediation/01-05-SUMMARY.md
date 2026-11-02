---
phase: 01-signup-business-remediation
plan: 05
subsystem: navigation-routing
tags: [authconfirm-retarget, welcome-route-retirement, dashboard-guards, blank-slate-copy, reservation-preview, wizard-hand-off, d-10, d-11, d-12]
status: complete
requires: [Onboarding shell query-param contract (plan 01-03), BusinessGuards + guards.ts (plan 01-04), generateStoreSlug (plan 01-03 alignment), create-business edge fn]
provides: [all four post-confirm navigations on /onboarding, retired welcome routes + deleted pages, BusinessGuards-wrapped DashboardLayout wildcard, truthful CreateBusinessDialog with wizard hand-off]
affects:
  - src/pages/AuthConfirm.tsx
  - src/App.tsx
  - src/components/CreateBusinessDialog.tsx
  - src/components/onboarding/BusinessGuards.tsx
tech-stack:
  added: []
  patterns: [single-decideRoute-guard-wrapper, no-dead-navigation-strings, shared-slug-derivation-across-surfaces]
key-files:
  created: []
  modified:
    - src/pages/AuthConfirm.tsx
    - src/App.tsx
    - src/components/CreateBusinessDialog.tsx
    - src/components/onboarding/BusinessGuards.tsx
  deleted:
    - src/pages/Welcome.tsx
    - src/pages/SetupFailed.tsx
decisions:
  - "All four AuthConfirm navigation sites retargeted to /onboarding (D-10): both success sites carry slug + business_id (provision_owner_business returns both on fresh and idempotent paths — verified in 20260925120100_signup_provision_fns.sql :214/:252); both failure sites carry error=<code> + message (the shell's error panel renders the code; no separate failure route per OQ1 recommendation)"
  - "The signup-event email_confirmed invoke, signup-provision nonce invoke, the reanchor branch's business-name + Turnstile logic, and all PROVISION_* error mappings are byte-identical — the retarget is a pure navigation-string change at four sites"
  - "The welcome-family routes removed from BOTH App.tsx branches; Welcome.tsx + SetupFailed.tsx deleted (Welcome carried an unscoped cross-tenant storefront read — critique-1 #6 closed by removal); zero dangling imports remain"
  - "DashboardLayout wildcard wrapped by BusinessGuards: zero-membership sessions redirect to /onboarding (create-business mode renders CreateBusinessDialog, D-04/D-12); abandoned-onboarding owners resume into the wizard (D-09); /onboarding sits outside the guard — loop-free; guards render null while loading (Pitfall 5)"
  - "BusinessGuards adapted to a children-based wrapper (was Outlet-based, which cannot wrap the DashboardLayout element in a wildcard route's element prop) and its create-business redirect changed from /onboarding?error=no-business to plain /onboarding — the error param would have routed the zero-membership redirect into the shell's error panel instead of the create-business mode"
  - "CreateBusinessDialog copy states the blank-slate truth: business + owner access + permission bundle, then the wizard — the 'default showroom, warehouse, online storefront, and POS' claim is gone (R4/D-12)"
  - "CreateBusinessDialog preview derives via the shared generateStoreSlug helper with reservation wording ('reserved when the wizard creates your store') — no hardcoded .stores.dokanos.app literal, no editable slug field (D-11)"
  - "CreateBusinessDialog success path navigates to /onboarding after refresh() + setActive — wizard hand-off for all three mount sites (AppSidebar, BusinessAccountTab x2) via the one component; when mounted inside the onboarding shell's create-business mode the navigation is a harmless same-route no-op and the shell enters the wizard at step 1"
patterns-established:
  - "Guard wrapper contract: BusinessGuards wraps dashboard children and renders them only on decideRoute 'app' — guards tolerate loading by rendering null"
  - "Reservation-preview contract: every slug preview derives from generateStoreSlug and says 'reserved', never 'live' or 'published'"
requirements-completed: [R4]
coverage:
  - delivers: "All four post-confirm navigations retargeted to /onboarding with correct params (D-10); cross-device reanchor journey survives"
    files: [src/pages/AuthConfirm.tsx]
  - delivers: "Welcome-family routes retired everywhere; pages deleted; dashboard wrapped by the zero-membership + resume guards (D-04/D-12/D-09)"
    files: [src/App.tsx, src/components/onboarding/BusinessGuards.tsx]
  - delivers: "CreateBusinessDialog blank-slate copy + reservation preview + wizard hand-off (R4/D-11/D-12)"
    files: [src/components/CreateBusinessDialog.tsx]
deviations:
  - "BusinessGuards ships as ONE combined decideRoute-driven guard component rather than the plan's RequireBusiness + RequireOnboarding pair — same decisions (create-business redirect, wizard resume redirect, app passthrough, null-while-loading) in a single wrapper; named-pair split was not needed for a children-based wrapper"
  - "BusinessGuards.create-business redirect retargeted from /onboarding?error=no-business to plain /onboarding during this plan's wiring — the ?error= param is the AuthConfirm failure contract and would have misrouted the zero-membership redirect into the shell's error panel instead of CreateBusinessDialog"
  - "Executed inline by the orchestrator (subagent free-model quota exhausted; workflow fallback rule) — sequential main-working-tree mode; no worktrees (project config use_worktrees: false)"
---

# Plan 01-05: Navigation surgery (R4 completion, D-10) — Execution Summary

## What was built

The post-confirm funnel now lands on /onboarding from every path (provision success/failure, cross-device reanchor success/failure); the retired welcome routes and pages are gone with zero dangling references; the dashboard is wrapped by the zero-membership and resume guards; and CreateBusinessDialog tells the blank-slate truth, previews a reservation (not a publication), and hands off to the wizard on success.

## Tasks

### Task 1 — Retarget all four AuthConfirm navigations (commit 6151746)

- Both success sites → `/onboarding?slug=…&business_id=…` (kept the preceding localStorage.removeItem calls byte-identical).
- Both failure sites → `/onboarding?error=<code>&message=…` (the shell's error panel renders the recovery actions; no new route/page).
- signup-event + signup-provision invokes and all PROVISION_* handling unchanged — pure navigation-string change, negative grep proves zero welcome-family strings remain.

### Task 2 — Retire routes + delete pages + wire dashboard guards (commit 7c76eae)

- Removed both welcome-family routes from the unauthenticated branch and both from the authenticated branch; removed their lazy imports; deleted Welcome.tsx + SetupFailed.tsx (confirmed no other module imports them).
- DashboardLayout wildcard wrapped by `BusinessGuards` (adapted to a children-based wrapper; create-business redirect fixed to plain `/onboarding`); /onboarding and the unauthenticated routes sit outside the guard — no redirect loop; no admin special-cases (D-03).

### Task 3 — CreateBusinessDialog truth + hand-off (commit 7ebb1a8)

- Copy rewritten to blank-slate truth (business + owner access + permission bundle, then the wizard).
- Preview derived via generateStoreSlug with reservation wording; hardcoded domain literal removed; no editable slug field.
- Success path navigates to /onboarding after refresh() + setActive — propagates to all three mount sites unchanged.

## Verification

- `npm run typecheck`: green after each task.
- `npm test -- --run`: 15 files, 125 tests, all passed.
- Negative greps: zero welcome-family strings in AuthConfirm.tsx and App.tsx (only a comment documenting the retirement); zero dangling imports of the deleted pages across src/.
- Positive greps: 2 × `onboarding?slug` in AuthConfirm.tsx; `RequireOnboarding`-equivalent BusinessGuards wired into App.tsx; `generateStoreSlug` used by the dialog preview; hardcoded domain literal gone.

## Deferred

- Full signup → confirm → wizard funnel UAT — the operator gate in plan 01-06.
