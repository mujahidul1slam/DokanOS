# ADMIN-SHELL-CRITIQUE-3.md — Final cycle

**VERDICT: NOT CONVERGED — all 3 cycle-2 fixes verified landed (plus ThemeGallery loading/alive/applyTheme); 1 new functional bug found (fresh eyes), 1 minor nit, 1 known-tradeoff note.**

Scope: commit 9d221ec. Files reviewed: StorefrontAdminEditor.tsx, StorefrontPreviewSurface.tsx, App.tsx, AdminPages.tsx (ThemeGallery/Overview/Help), StorefrontAdminShell.tsx, EditorPage.tsx, StorefrontPreviewPage.tsx.

## Cycle-2 fix verification (all landed)

1. **StorefrontAdminEditor.tsx:64-67 — LANDED.** `previewUrl` now appends `?surface=${previewSurface}` (e.g. `/storefronts/preview/{slug}/_product_page?surface=_product_page`), so the App.tsx router's `params.get("surface")` branch fires and routes to `StorefrontPreviewSurface`.
2. **StorefrontPreviewSurface.tsx:25-29 — LANDED.** Single `useParams()` destructuring (`slug, pageSlug` — no duplicate params declaration); reads `?surface=` from `window.location.search` with `pageSlug` fallback (`params.get("surface") || pageSlug || "home"`); `theme_override` still read at line 49-50.
3. **App.tsx:43-53 — LANDED.** Lazy `StorefrontPreview` router branches `params.get("surface") || pageSlug.startsWith("_")` → `Surface.default` (direct render); else `Page.default` (existing StorefrontPreviewPage). `detectBrand` (brand.ts:97, `/^\/storefront\//`) correctly does NOT match `/storefronts/preview/...`, so no StorefrontApp hijack.
4. **ThemeGallery (AdminPages.tsx:149-176) — LANDED.** `sf === undefined` → spinner (line 175), `alive` guard in the fetch effect (lines 155-158), `applyTheme` renamed from the colliding `useTheme` (line 161).

## New findings

### F1 — MEDIUM (functional/visual): preview routes render inside DashboardLayout — admin chrome wraps the storefront preview in the iframe

App.tsx:157-158 puts `/storefronts/preview/:slug/:pageSlug` under the `*` catch-all, which is wrapped in `<DashboardLayout>` (App.tsx:140-165). When EditorPage's iframe loads the preview URL, the full app boots inside the iframe → auth passes (same-origin localStorage) → catch-all → DashboardLayout renders **AppSidebar (w-64), QuickShortcuts, BottomNav, InstallBanner, and p-6 padding** around the preview router. StorefrontPreviewPage masks this with a `fixed inset-0 z-[100]` cover (StorefrontPreviewPage.tsx:53); **StorefrontPreviewSurface has no such cover** — it renders plain `flex min-h-screen` content (StorefrontPreviewSurface.tsx:41-56), so the storefront page (Home/Shop/Product + StorefrontLayout) renders beside the admin sidebar inside the editor's preview iframe. Same root cause hits ThemeGallery's "Preview" link (AdminPages.tsx:214): the new tab shows Surface.default wrapped in dashboard chrome. This is the same class of bug cycle 2 fixed for the admin routes ("no double sidebar"), now inside the iframe.

**Fix (pick one):**
- Hoist the two preview routes (App.tsx:157-158) into the full-bleed block next to the admin shell routes (App.tsx:117-137) with their own `PermissionGuard permission="storefronts.view"` — both Page and Surface then render outside DashboardLayout. StorefrontPreviewPage's fixed-inset cover and Exit-preview link work unchanged outside it. Cleanest.
- Or: wrap StorefrontPreviewSurface's return in the same `fixed inset-0 z-[100] overflow-auto bg-background` container StorefrontPreviewPage uses.

### F2 — LOW (nit): command palette keeps a stale `search` after X/backdrop close

StorefrontAdminShell.tsx:223 (backdrop onClick) and :234 (X button) close the palette without resetting `search`; only navigation (:246) resets it. Reopening the palette (⌘K or sidebar button) shows a stale filtered list. Fix: `setSearch("")` in the close handlers.

### F3 — NOTE (known tradeoff, prior cycle): "Total Revenue" KPI sums only the latest 500 orders

AdminPages.tsx:31 fetches `.limit(500)` and aggregates in JS; stores with >500 orders silently undercount the KPI labeled "Total Revenue" (line 71). Deliberate cycle-1 tradeoff (egress guard). Consider an RPC `sum(total)` head-query if it matters at scale, or relabel ("Last 500 orders").

## Not flagged (checked, clean)

- EditorPage save-then-reload: `previewKey > 0` guard prevents double-load; `?surface=` + `&_k=` appends correctly (EditorPage.tsx:19-23).
- StorefrontAdminEditor surfaces without a preview entry (identity, policies, settings, delivery, payments, products, pages, collections) pass `previewUrl=undefined` → EditorPage renders tabs only — matches `surfacePages` map in the shell.
- `PREVIEW_SURFACE["theme"]: "home"` is dead code (the theme route uses ThemeGallery, not StorefrontAdminEditor) — harmless.
- Shell hooks-order rule holds: all hooks precede early returns (StorefrontAdminShell.tsx:100-118 before :120).
- SurfaceFrame product preview: first-product loader with alive guard, spinner while resolving (StorefrontPreviewSurface.tsx:64-73, 85-92).
- Overview: alive guards throughout, `count: exact, head: true` for KPIs, recent-orders list distinct/keyed.
