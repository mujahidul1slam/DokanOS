REVISE — 6 findings (cycle 3: C3-F1/F6/F7 resolved, C3-F5 half-moved, C3-F2/F4 untouched, C3-F3 mutated into a new defect; 1 NEW HIGH found in the preview scaffold the plan builds on)

# BONIK-ADMIN-CRITIQUE-4 — CRITIC cycle 4 of BONIK-ADMIN-PARITY-PLAN.md

Re-verified against repo: `src/App.tsx:111` (preview route, plural), `src/pages/StorefrontPreviewPage.tsx:66-71` (basePath + draftPageSlug wiring), `src/storefront/StorefrontApp.tsx:45-58` (inner routes + catch-all), `src/storefront/lib/brand.ts:89-101` (`detectBrand` path rule), `src/components/storefront-admin/PagesTab.tsx:582-586` (existing iframe URL), `src/storefront/lib/settings.ts:86,230` (`show_dark_toggle` field), `src/storefront/pages/{Home,CustomPage,About,Policies}.tsx` (`draftPageSlug → getDraftPage` flow).

## Cycle-3 verification (C3-F1 … C3-F7)

| # | Status | Evidence |
|---|--------|----------|
| C3-F1 singular `/storefront/preview/` URLs | RESOLVED | Zero occurrences left in the plan; mapping table (lines 63-70) and sync paragraph (line 76) all plural, matching `App.tsx:111` |
| C3-F2 pseudo-slugs half-specced | **OPEN** | `_product_page`/`_shop_page` still listed (lines 65-67) with only "(new route, sample product placeholder)"; still no statement of where interception lives (StorefrontApp routing, not `getDraftPage`) nor the placeholder product source |
| C3-F3 PagesTab double-claim | **MUTATED — new defect** | `/builder` no longer names PagesTab (line 35), but `/pages` now appears TWICE in the route list — line 36 ("Pages (custom pages, nav links…)") and line 49 ("PagesTab (full editor…)"); the front-page extraction refactor (frontPageOnly prop, ~0.5 d) is gone rather than scheduled, and the builder's content source (which record holds the home page's blocks) is never stated |
| C3-F4 dark-mode field, no consumer | **OPEN** | Line 36 still ships "dark-mode-variations" in identity; Phase B gained no dark bullet, effort table has none. Runtime evidence got stronger: `show_dark_toggle` exists in `settings.ts:86,230` with **zero consumers** in `src/` — the codebase already carries exactly this class of dead setting |
| C3-F5 effort not re-estimated | **PARTIAL** | Table moved (A 2→3 d, total 5→6 d) but stays below critique-3's own floor (A 3.5–4 d, ~7 d) while Phase A's scope grew again this cycle (C4-F1 below + C3-F2 + builder extraction) |
| C3-F6 `defaultAccents` pointer | RESOLVED | Line 87 now cites `src/pages/StorefrontsPage.tsx` — pointer is real |
| C3-F7 HELP dead item | RESOLVED | Line 59: mailto link instead of a `/docs` stub |

## HIGH (new)

### C4-F1 — The preview scaffold Phase A builds on is broken as shipped; plan line 77's premise is false

Static trace, no runtime test performed:

1. `StorefrontPreviewPage` mounts `StorefrontApp` with `basePath={`/storefront/${sf.slug}`}` (line 68) while the iframe URL is `/storefronts/preview/:slug/:pageSlug` (this is exactly what `PagesTab.tsx:584` already iframes today).
2. `StorefrontApp`'s inner routes are all `${basePath}…` = `/storefront/<slug>[…]` (`StorefrontApp.tsx:46-57`). None match `/storefronts/preview/<slug>/<page>`, so the catch-all fires: `*` → `<Navigate to={basePath} replace />` (line 58) — a full navigation **out of the preview route** to `/storefront/<slug>`.
3. `detectBrand()` matches `/storefront/<slug>` in the path (`brand.ts:96-99`), so `Root` (`App.tsx:145-151`) switches into public-storefront mode and renders `StorefrontApp` **without** `storefrontOverride`/`draftPageSlug` — anon-RLS, published data.
4. Net behavior: the iframe flashes preview chrome, redirects, and ends on the **published** storefront. `draftPageSlug` never governs a render; the passing of the props (line 66-71) is dead code on this path. Even the non-pseudo slugs (`home`, `policies`, custom pages) don't render drafts today.

Consequences for the plan: the per-surface preview mapping table (lines 62-70), the `useEditorPreview` postMessage target (line 76), and the `?draft=1` flag all point at a route that self-ejects. Phase A's headline feature — editors with live preview — rests on this.

- **Fix (one paragraph in Phase A):** pass a preview-aware base path (`basePath={`/storefronts/preview/${slug}`}`) and give StorefrontApp a `/:pageSlug` route (or a `previewPageSlug` short-circuit) so the inner Routes never reach the catch-all under preview; note the side condition that preview URLs must never begin with `/storefront/` or `detectBrand` will hijack the session. Resolving this *is* resolving C3-F2: pseudo-slugs (`_shop_page`, `_product_page`) get intercepted in that same preview routing layer, with the placeholder-product source named there (e.g., most recently updated product, stub fallback).

## MEDIUM

### C4-F2 — Duplicate `/pages` route (C3-F3 residual)
- Route list carries `/pages` twice (lines 36 and 49) with overlapping descriptions. As written the route table is not a spec — an engineer must guess which row is real.
- **Fix:** delete line 36 or 49; keep one `/pages` row.

### C4-F3 — Builder content source still unnamed (C3-F3 residual)
- Line 35's "home-page section editor — edit the front page's blocks" never says which record the front page lives in (the `pages` row the runtime loads via `getDraftPage(storefront.id, "home")`, per `Home.tsx:51-52`) or that the build is the extractor-refactor out of PagesTab (critique-1 H2) with effort inside Phase A.
- **Fix:** one sentence — builder = PagesTab with `frontPageOnly` over the `home` page row; ~0.5 d inside Phase A.

### C4-F4 — Dark-mode field still ships with no consumer (C3-F4 carried, evidence hardened)
- Line 36 unchanged in substance; Phase B unchanged; and the repo proves the risk pattern: `show_dark_toggle` (`settings.ts:86,230`) is a stored setting with zero readers. `Home.tsx:24`'s `t.includes("dark")` matches theme *names*, not a dark variant system.
- **Fix (unchanged):** defer "dark-mode-variations" out of scope, or add a minimal dark `data-theme` bullet to Phase B with effort.

## LOW

### C4-F5 — Effort table still under the critique's own floor
- A moved 2→3 d against a stated 3.5–4 d floor, after Phase A absorbed C4-F1's routing fix + pseudo-route support + the builder extraction. Total reads 6 d vs the ~7 d computed last cycle.
- **Fix:** re-estimate once more after C4-F1 lands (A realistically 3.5–4 d, total ~7 d).

### C4-F6 — Two stale-wording nits
- Line 47 still calls `/products` an "orphaned surface" while the sidebar (line 57) houses it under CATALOG — the F3 fix landed in the sidebar but the route row's label wasn't updated.
- Line 29 "via `Navigate from _` catch-all" is garbled phrasing; line 51 already states the catch-all cleanly. Delete the garbled clause.

## Cross-checks the plan got right this cycle
- C3-F1's mechanical URL pass landed cleanly — plan and `App.tsx:111` agree.
- C3-F6's pointer and C3-F7's HELP item are real fixes, not wording shuffles.
- The critique-3 table (F8 void via `storefront-checkout/index.ts:210`) remains sound; nothing reopened.

## Effort realism note
The blocking item this cycle is not estimation — it is C4-F1: a load-bearing premise ("preview already renders live") is false in the shipped code. One paragraph in Phase A collapses C4-F1, C3-F2, and clarifies the mapping table; until it lands, every preview row in the plan describes a 404-then-redirect. All 6 findings are mechanical or single-paragraph fixes.
