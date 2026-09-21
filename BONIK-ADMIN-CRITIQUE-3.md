REVISE — 7 findings (cycle 2: F1/F3/F5/F6 resolved, F8 void, F2 half-fixed, F4/F7 untouched; 2 new residuals introduced)

# BONIK-ADMIN-CRITIQUE-3 — CRITIC cycle 3 of BONIK-ADMIN-PARITY-PLAN.md

Re-verified against repo: `src/App.tsx:111` (preview route), `src/pages/StorefrontPreviewPage.tsx`, `src/storefront/StorefrontApp.tsx` + `pages/{Home,About,CustomPage,Policies}.tsx` (draftPageSlug flow), `src/storefront/lib/brand.ts:89-101` (query-param surface), `src/pages/StorefrontsPage.tsx:205-218` (accent map), `supabase/functions/storefront-checkout/index.ts:209-211` (advance clamp).

## Cycle-2 verification (F1–F8)

| # | Status | Evidence |
|---|--------|----------|
| F1 per-surface preview map | RESOLVED | Mapping table at plan lines 60-70 (`_product_page` sample placeholder named) |
| F2 wrong URL shapes | **PARTIAL** | Phase B link fixed (`/storefronts/preview/{slug}/home?theme_override=`, line 88) — but Phase A mapping table (lines 63-69) and sync paragraph (line 76) still use singular `/storefront/preview/…`; real route is plural (`src/App.tsx:111`). 8 URLs wrong. |
| F3 orphaned routes | RESOLVED | Products under CATALOG, Policies under STOREFRONT SETTINGS (lines 56-57) |
| F4 dark-mode logo, no consumer | **OPEN** | Identity bullet still lists "dark-mode logo" (line 36); Phase B adds no dark handling; no dark token consumer exists in the runtime |
| F5 unsaved-draft guard | RESOLVED | Line 78 (route-leave confirm on dirty state) |
| F6 garbled `/settingURI` | RESOLVED | `theme_override` param, consistent between lines 68 and 88 |
| F7 effort not re-estimated | **OPEN** | Table still totals 5 d; Phase A gained preview plumbing, pseudo-route, draft guard, yet stays 2 d |
| F8 `advance_percent` clamp carryover | **VOID** | Clamp already present server-side: `Math.min(100, Math.max(0, Number(…)))` at `storefront-checkout/index.ts:210`. Critique-2's premise was stale; nothing to schedule |

## MEDIUM (carried / residual)

### C3-F1 — F2 residual: singular `/storefront/preview/` persists in Phase A (8 URLs)
- Mapping table lines 63-69 and sync mechanism line 76 all read `/storefront/preview/…`; iframe srcs would 404 as written. Only Phase B was corrected.
- **Fix:** one mechanical pass — `/storefront/preview` → `/storefronts/preview` everywhere in Phase A.

### C3-F2 — Pseudo-slug preview targets are half-specced
- `_product_page` is flagged "(new route, sample product placeholder)" (line 64); `_shop_page` (lines 65-66) is the same class of non-page but unflagged. More importantly neither says where preview-side handling lives: `draftPageSlug` flows into `getDraftPage(storefront.id, slug)` in Home/CustomPage (`Home.tsx:52`, `CustomPage.tsx:20`) — a pseudo-slug resolves to nothing there today.
- **Fix:** one bullet: pseudo-slugs `_shop_page`/`_product_page` intercepted in StorefrontApp routing (not `getDraftPage`); name the placeholder product source (e.g., most recently updated product, stub fallback).

### C3-F3 — PagesTab is claimed by two routes with no refactor scheduled
- `/builder` mounts "existing PagesTab content" (line 35) and `/pages` mounts "PagesTab (full editor)" (line 48). Either the same component mounts twice (then builder is not front-page-only) or the front-page extraction critique-1's H2 demanded ("extract front-page editing from PagesTab — the first real tab refactor") happens unscheduled.
- **Fix:** state it: builder mounts PagesTab with a `frontPageOnly` prop (name the refactor, ~0.5 d inside Phase A), pages mounts it unfiltered.

### C3-F4 — F4 carried: dark-mode logo still ships with no consumer
- Line 36 unchanged; no `data-theme` dark handling added to Phase B; runtime has no dark consumer (`storefront.css` blocks are per-theme, no dark variant; BrandContext flips nothing).
- **Fix:** pick one — defer the column out of this plan, or add a minimal dark `data-theme` bullet to Phase B with effort.

### C3-F5 — F7 carried: effort still not re-estimated
- Phase A still 2 d despite absorbing: dedicated layout, 15 route mounts, per-surface postMessage plumbing, pseudo-route support, draft-leave guard, plus C3-F3's extraction. Realistic: A ~3.5-4 d, total ~7 d.
- **Fix:** re-estimate the table.

## LOW

### C3-F6 — Sync-point-3 pointer names a file that doesn't exist
- Plan line 86: "`defaultAccents` map in CreateStorefrontDialog" — no such component; the map lives at `StorefrontsPage.tsx:205-218` (inside the create dialog JSX there). An engineer following the pointer finds nothing.
- **Fix:** correct the pointer to `StorefrontsPage.tsx` (or extract into `shared.tsx` and say so).

### C3-F7 — HELP sidebar item ships dead UI
- "Documentation stub (target `/docs` or placeholder)" (line 58) is a nav item to nowhere — the same dead-UI class prior cycles removed from storefront surfaces.
- **Fix:** cut the item until `/docs` exists, or hide behind a flag.

## Cross-checks the plan got right this cycle
- F1's mapping table, F5's draft guard, F6's `theme_override` — landed cleanly.
- `advance_percent` clamp confirmed present server-side (`index.ts:210`); F8 closed without plan action.
- Per-theme 3-part contract (lines 86-90) now names the real sync points; only the file pointer is wrong (C3-F6).

## Effort realism note
With C3-F2/F3 added to Phase A's scope, A alone reads 3.5-4 days; total ~7 days. No architectural blockers remain — all 7 findings are mechanical or single-paragraph fixes.
