---
phase: 01-signup-business-remediation
plan: 02
subsystem: verification-artifacts
tags: [sql, acceptance, detection, release-1]
key-files:
  created:
    - .planning/detect-window-businesses.sql
    - .planning/phases/01-signup-business-remediation/COVERAGE.md
  modified:
    - scripts/test_signup_rpc.sql
metrics:
  tasks: 2
  commits: 1
---

# Plan 01-02 Execution Summary — Verification Artifacts (R0 + Acceptance Script)

## What Was Built

**R0 detector** (`.planning/detect-window-businesses.sql`):
- Block 1: one row per matching business with all D-07 evidence columns (owner email via auth.users, placeholder URL derived from the app_config `storefront_domain` key, `storefront_published` warning flag for window businesses whose owner published, per-table counts, real-data counts) ordered by `created_at` ascending.
- Match predicate is purely signature-based — no date logic anywhere (D-05): exactly-one store/brand/location ("Main" showroom)/storefront (slug = business slug), selling-point types within the template set (3 or 4, conditional Facebook handled as "no type outside the set" plus the three unconditional types present), exactly one channel/woocommerce disconnected connector, exactly one WooCommerce catalog two_way product source, exactly one WooCommerce customers import source, exactly one owner UBA and one user_store_access, AND zero orders/products/customers.
- Block 2: explicit empty-case summary (literal `0 businesses matched` line).
- Verified: zero destructive keywords in the entire file (grep gate), balanced parentheses, only SELECT statements.

**COVERAGE.md**: the exact no-external-API declaration for the seal-time api-coverage gate.

**Acceptance script** (`scripts/test_signup_rpc.sql`, full rewrite):
- R1-a: bundle = exactly 33 keys + `storefronts.view` presence check; forbidden four keys asserted absent.
- R1-b: nine zero-row asserts for all template tables scoped to the fresh provision.
- R1-c: idempotent re-invoke re-asserts bundle size 33 (carried over + strengthened).
- R1-d (5a/5b/5c): create_additional_business triple — same-name same-id (and no `business_added` event), different-name new business, user-B-never-gets-user-A's-business with user B owning their new business.
- R4a section: jwt-simulated owner creates the store; asserts store url/status, brand link with woo_store_id, user_store_access for caller, storefront inactive with slug equality; second invoke returns the same store (single-store cap, no duplicates); deny matrix — member denied, viewer denied, cross-tenant owner denied (all P0001 FORBIDDEN, no rows left behind).
- R4-d4: publish test re-pointed at the R4a-reserved storefront with the wizard-step-4 selling point attached.
- Gate-regression: provisioned owner correctly denied by delete_unprovisioned_self (DELETE_DENIED_PROVISIONED), all five gate RPCs present (get_purge_candidates, run_data_retention_cleanup, publish_my_storefront, delete_unprovisioned_self, create_my_brand_store), signup_open still false, zero user_roles across all self-side fixtures.
- Fixture hygiene scoped to fixture user ids only (no broad business-name deletes that could touch real tenants).
- Old template-shape asserts fully removed (no "exactly 32"/"all 11 tables" strings — grep-verified).

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | `cd2191f` | feat(1-02): R0 window-business detector + Release-1 acceptance script + COVERAGE declaration |

## Verification Results

- ✅ R0 destructive-keyword grep: 0 matches
- ✅ R0 signature/ordering/empty-case greps: green
- ✅ Acceptance script greps: create_my_brand_store (10), storefronts.view (1), FORBIDDEN (3), user_roles (4); old-shape strings 0
- ⏳ Live execution of both scripts is the operator's release-gate step in plan 01-06 (D-08 ordering: run the detector BEFORE the acceptance script)

## Deviations

None. (Both scripts are authored artifacts; their live execution is by design deferred to the plan 01-06 operator gate.)

## Self-Check

PASSED — all acceptance criteria verified by the plan's grep gates plus structural checks. No files outside the plan's declared scope were touched.

## Handoff

Wave 1 complete (01-01 + 01-02). The operator can now run the detector against hosted to identify window businesses before the wizard work begins (D-08). Plan 01-03 (tracer UI half) is next.
