REVISE — 8 findings (cycle 4: C3-F1/F2/F6/F7 resolved; C4-F1 half-fixed with the load-bearing sentence dropped; C4-F2/F3/F6 untouched; C4-F4/C4-F5 mutated into self-contradictions; 3 new defects introduced by the cycle-4 edits)

# BONIK-ADMIN-CRITIQUE-5 — CRITIC cycle 5 of BONIK-ADMIN-PARITY-PLAN.md

Re-verified against repo: `src/App.tsx:111` (`/storefronts/preview/:slug/:pageSlug`, plural), `src/pages/StorefrontPreviewPage.tsx:68` (`basePath={`/storefront/${sf.slug}`}` — singular, live in shipped code), `src/storefront/StorefrontApp.tsx:46-58` (inner routes + `*` → `<Navigate to={basePath} replace />`), `src/storefront/lib/brand.ts:97` (path regex `^/storefront/{slug}` — does not match `/storefronts/preview/…` initially, matches after the redirect), `src/components/storefront-admin/PagesTab.tsx:584` (existing iframe), `src/storefront/lib/settings.ts:86,230` (`show_dark_toggle`: still zero readers in `src/`), `src/storefront/pages/Home.tsx:51-52` (`getDraftPage(storefront.id, draftPageSlug)`).

## Cycle-4 verification

| # | Status | Evidence |
|---|--------|----------|
| C4-F1 preview scaffold broken | **PARTIAL** | New paragraph (lines 75-84) fixes the mechanism: stableBasePath keeps the catch-all inside preview (pt 1), pageSlug→component mapping (pt 2), settingsOverride merge (pt 3). **But the one sentence critique-4 required verbatim is missing:** no statement that preview URLs/basePath must never start with `/storefront/` or `detectBrand` (`brand.ts:97`) hijacks the session. `stableBasePath`'s *value* is never named; an implementer passing `/storefront/{slug}` (the existing prop's value at `StorefrontPreviewPage.tsx:68`) reproduces the exact bug being fixed |
| C4-F2 duplicate `/pages` route | **OPEN** | Lines 36 and 49 both define `/storefronts/:slug/admin/pages` — verbatim untouched since cycle 3 (line 36 "custom pages, nav links, list of all pages"; line 49 "PagesTab (full editor incl. nav links to pages)") |
| C4-F3 builder content source | **OPEN** | Line 35 unchanged: still no `frontPageOnly` prop, no `home` page-row pointer (`getDraftPage(sf.id, "home")` per `Home.tsx:51-52`), no 0.5 d extraction inside Phase A |
| C4-F4 dark-mode field | **MUTATED — self-contradiction** | Deferral note added (line 97: "deferred … landed in P1") but line 37 still ships "dark-mode-variations" in the identity route's field list. Same field is in-scope and out-of-scope in one plan |
| C4-F5 effort floor | **OPEN + new contradiction** | Table re-estimated (line 99 / 146-154: A 3 d, total 6 d) — still below the 3.5–4 d / ~7 d floor after absorbing the scaffold work. AND the phase headers now disagree with the table: line 27 "Phase A — … (2 days)" vs line 99 "Phase A 3 d"; line 117 "Phase C — … (1 day)" vs 0.5 d in the table |
| C4-F6 stale wording | **OPEN** | Both nits untouched: line 47 still "ProductsTab (unchanged, orphaned surface)" while sidebar line 57 houses Products under CATALOG; line 29 still garbled "via `Navigate from _` catch-all" |

Cycle-3 re-check: C3-F1 (plural URLs — all mapping rows read `/storefronts/preview/`), C3-F6 (`src/pages/StorefrontsPage.tsx` pointer, line 109), C3-F7 (mailto, line 59) all hold resolved. C3-F2 folds into C4-F1's fix and is now **RESOLVED**: interception lives in StorefrontPreviewPage's pre-render map (pt 2) and the placeholder source is named ("adds a mock product", line 90 — a stated stub fallback).

## MEDIUM (new)

### C5-F1 — Two mapping tables, and the "ratified" one silently drops a param
- Lines 62-71 keep the original per-surface table; lines 86-94 add a second titled "**unchanged from above**" — but it isn't: the animations row loses `?animations_override=1` (line 70 has it, line 93 doesn't). Two overlapping specs for the same thing, one labeled as identical to the other while differing.
- **Fix:** delete one table; keep the animations override in whichever survives.

### C5-F2 — Phase headers vs effort table disagree (C4-F5 residual, new surface)
- Line 27 "(2 days)" vs line 99/148 "3 d" for Phase A; line 117 "(1 day)" vs "0.5 d" for Phase C. A reader quoting the doc gets two totals depending on which half they read.
- **Fix:** sync the four numbers; while there, close C4-F5 (A 3.5-4 d, total ~7 d).

## LOW (new)

### C5-F3 — "Phase A/O" garble joins the stale-wording class
- Line 101: "Phase A/O still works" — reads as a typo (Phase A); same class as C4-F6's `Navigate from _` (line 29), still unfixed.
- **Fix:** one-word correction; bundle with C4-F6.

## Cross-checks the plan got right this cycle
- The preview scaffold paragraph names the real failure surfaces (catch-all, pageSlug dispatch, settings override merge) in the right components — the fix shape is correct; only the detectBrand guard sentence is missing (C4-F1 residual).
- C3-F2's interception point and stub source are now genuinely specced.
- The grandfathering fallback (line 101: editors work without preview until scaffold lands) is an honest degradation story.

## Effort realism note
Every open finding is mechanical (delete a row, sync a number, add one sentence). The only substantive one remains C4-F1's missing guard sentence — without it the scaffold fix can be implemented wrong while following the plan exactly. A 0.5-day correction pass closes all 8.
