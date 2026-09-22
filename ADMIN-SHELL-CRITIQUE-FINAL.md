# ADMIN-SHELL-CRITIQUE-FINAL.md — Convergence pass

**VERDICT: CONVERGED — no actionable findings. All 4 verification points pass; cycle-3 F1/F2 fixes verified landed in ba87533; 2 residual notes are documented non-blocking edge cases.**

Scope: commit ba87533 (touches App.tsx, StorefrontAdminShell.tsx, ADMIN-SHELL-CRITIQUE-3.md only). Files reviewed: src/App.tsx, src/components/storefront-admin/StorefrontAdminShell.tsx, src/pages/StorefrontPreviewSurface.tsx, plus integration points: storefront/lib/settings.ts, storefront/lib/catalog.ts, storefront/components/StorefrontLayout.tsx, storefront/pages/Product.ts.

## Verification results

### 1. App.tsx routing structure — PASS

- Preview routes exist ONLY in the full-bleed block: `/storefronts/preview/:slug/:pageSlug` (App.tsx:118) and `/storefronts/preview/:slug` (App.tsx:119), both wrapped in `PermissionGuard permission="storefronts.view"`. No duplicates — the inner catch-all `<Routes>` (App.tsx:148-164) contains no `/storefronts/preview/...` entries.
- Admin shell routes full-bleed: all 19 `/storefronts/:slug/admin/*` routes (App.tsx:123-141) are top-level siblings, outside `<DashboardLayout>`. No stacked sidebars.
- Dashboard catch-all wraps everything else: `path="*"` (App.tsx:144-167) contains `<DashboardLayout>` + `<CommandPalette>` + nested `<Routes>` (dashboard pages, `/storefronts` listing, `/reset-password`, `/login` redirect, inner `*` → NotFound). Only the matching `<Routes>` tree renders.
- No route conflicts: preview paths carry a literal `preview` segment, shell paths a literal `admin` segment — RRv6 static-segment ranking resolves cleanly; 4-segment preview URLs cannot match any shell route.

### 2. StorefrontAdminShell palette search reset — PASS (cycle-3 F2 fixed)

All four close paths reset `search`:

| Close path | Location | Resets search |
|---|----------|---------------|
| Escape keydown | StorefrontAdminShell.tsx:114 | `setSearch("")` |
| Backdrop click | StorefrontAdminShell.tsx:223 | `setSearch("")` |
| X button | StorefrontAdminShell.tsx:234 | `setSearch("")` |
| Palette nav item | StorefrontAdminShell.tsx:246 | `setSearch("")` |

Reopening the palette always shows the unfiltered list. The shell-level Escape no-op when the palette is already closed is harmless (React bails out on identical state — search is always "" while closed).

### 3. StorefrontPreviewSurface — PASS

- StorefrontLayout-wrapped pages via MemoryRouter: `home`/`_builder` (StorefrontPreviewSurface.tsx:81-84), `_shop_page` (:95-97), `_identity` (:101-103) each render `<MemoryRouter><StorefrontLayout><Home|Shop /></StorefrontLayout></MemoryRouter>`. `StorefrontLayout({ children })` renders children (StorefrontLayout.tsx confirmed); MemoryRouter keeps the iframe address bar frozen.
- Product preview loads first product: effect at StorefrontPreviewSurface.tsx:64-73 guards on `surface === "_product_page"`, uses `alive` cleanup, calls `listStorefrontProducts(storefront.id)` (exists in catalog.ts), sets `all[0].slug`; renders `<Product slugOverride={firstProductSlug} />` (Product.tsx signature matches) inside a MemoryRouter at :87-89.
- Unknown surface → placeholder: default case renders a plain "Select a page to preview" div (:105-110) — no `<Navigate>` anywhere in the file. `!sf` also renders a placeholder (:44-45), never a redirect.
- Null-safety: `mergeSettings(raw)` uses `raw?.checkout` (settings.ts) — safe for a null settings column.

### 4. No remaining functional bug in the shell — PASS

- Hooks-order rule holds in both components: shell hooks (useState ×3, slug-fetch effect, `paletteItems` useMemo, ⌘K effect — StorefrontAdminShell.tsx:87-118) all precede the early returns at :120-125; Surface hooks (useState, fetch effect — StorefrontPreviewSurface.tsx:31-39) precede early returns at :41-46. No "Rendered more hooks" crash possible.
- Cycle-3 fix verification (both landed in ba87533):
  - **F1 — LANDED.** Both preview routes hoisted into the full-bleed block (App.tsx:117-119) with their own `PermissionGuard permission="storefronts.view"`. Editor iframe and ThemeGallery preview now render with no AppSidebar/topbar/padding around the storefront page.
  - **F2 — LANDED.** Search reset in all close handlers (see check 2).
- Full fix chain across cycles 1→3 verified: hooks-order crash fixed, no double sidebar (admin routes + preview routes both full-bleed), editor URLs carry `?surface=`, Surface reads `pageSlug` + query param, router branches `_`-prefix, KPI aggregates exact, iframe no double-load, ⌘K wired, nimbus/saffron themes shipped, ThemeGallery loading/alive/applyTheme clean.

## Residual notes (non-blocking, no action required)

- **N1 — Known edge case (from critique 1, never re-raised):** a store with zero products previewing `_product_page` shows a spinner indefinitely (StorefrontPreviewSurface.tsx:90-92) instead of an empty-state message. Product preview works for any store with ≥1 product; catalog fetch failure also lands on the spinner. Cosmetic UX gap in an edge case.
- **N2 — Known tradeoff (critique 3 F3):** "Total Revenue" KPI aggregates the latest 500 orders client-side (AdminPages.tsx). Documented deliberate tradeoff for free-plan egress.
- Pre-existing debt class unchanged and out of scope: `no-explicit-any` count in admin files (tsc clean), decorative iframe sandbox attribute, "Store Identity" label dupe in the sidebar (Shell.tsx:31/35) — cosmetic, surfaced in critique 1 #8.
