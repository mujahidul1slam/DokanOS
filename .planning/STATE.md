# Project State

## Position

**Phase:** 01-signup-business-remediation
**Current Plan:** 04 (next)
**Status:** Plans 01-03 complete; 01-03 SUMMARY committed at 2387a8c

## Progress

| Phase | Plan | Status | Summary |
|-------|------|--------|---------|
| 01-signup-business-remediation | 01 | ✅ complete | 01-01-SUMMARY.md |
| 01-signup-business-remediation | 02 | ✅ complete | 01-02-SUMMARY.md |
| 01-signup-business-remediation | 03 | ✅ complete | 01-03-SUMMARY.md |
| 01-signup-business-remediation | 04 | ⏳ pending | — |
| 01-signup-business-remediation | 05 | ⏳ pending | — |
| 01-signup-business-remediation | 06 | ⏳ pending | — |

## Decisions

- **01-03 / slug parity:** `generateStoreSlug` truncates at 60 with deterministic literal `"store"` fallback to match RPC `left(v_slug_base, 60)`; random/timestamped fallback removed.
- **01-03 / wrapper idempotency:** `createMyBrandStore` keeps per-business in-flight promise + resolved-result memo; second invoke for same business returns cached result without a second RPC call.
- **01-03 / route placement:** `/onboarding` mounted lazy in authenticated branch OUTSIDE DashboardLayout (same as `/welcome`); no existing route altered — `/welcome` retirement deferred to plan 01-05.
- **01-03 / Step1Store preview:** pre-fills name from active business, renders read-only live reservation preview via `generateStoreSlug`, NO editable slug field; on success displays ACTUAL slug from RPC return superseding the preview.
- **01-03 / fail-closed stores list:** `useStoresList` returns `[]` when no business context or zero brand-stores; never issues stores query. Scopes via `.in("id", woo_store_ids)`. Brand→`woo_store_id` mapping extracted to `brandStoreIdsOf()` for R2a generalization.
- **01-03 / StoresHub leakage fix:** three NULL-brand `.or(...brand_id.is.null...)` filters rewritten to plain `.eq("brand_id", brand.id)`; zero-brands copy points at wizard with CTA; four empty states replaced with dialog-opening or wizard-link CTAs; status-keyed badges kept untouched.

## Performance Metrics

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 01-signup-business-remediation | 01 | ~20min | 3 | 5 |
| 01-signup-business-remediation | 02 | ~15min | 2 | 3 |
| 01-signup-business-remediation | 03 | ~45min | 3 | 9 |

## Session

**Last session:** 2026-10-10
**Stopped at:** Completed 01-03-PLAN.md
**Resume file:** None

## Issues

None open.