REVISE — 3 actionable findings

# ADMIN SHELL CRITIQUE 2 — commit 6f0da0c (cycle 2, fresh-eyes re-verification)

Scope verified by reading code: `StorefrontAdminShell.tsx` (262 l), `App.tsx` (231 l), `AdminPages.tsx` (245 l), `EditorPage.tsx` (57 l), `shared.tsx` (252 l), `StorefrontAdminEditor.tsx` (93 l), `StorefrontPreviewPage.tsx` (75 l), `StorefrontPreviewSurface.tsx` (110 l), `StorefrontApp.tsx` (65 l), `Home.tsx`, `storefront/lib/pages.ts`, `storefront/themes/storefront.css` (319 l). `npx tsc --noEmit` clean.

---

## Cycle-1 fix verification

| # | Fix | Status |
|---|-----|--------|
| 1 | Shell hooks before early returns | ✅ FIXED — all hooks (Shell.tsx:87-118: 3×useState, slug-fetch useEffect, `paletteItems` useMemo, ⌘K useEffect) run before the early returns at 120-125 (comment on line 99). Identical hook order every render — no "Rendered more hooks" crash possible. |
| 2 | Admin routes outside DashboardLayout | ✅ FIXED — 19 shell routes (App.tsx:118-136) are top-level siblings of the catch-all, not nested in DashboardLayout; dashboard routes wrapped via `path="*"` element containing DashboardLayout (139-164). RRv6 ranks by specificity score, so declaration order (shell routes before `*`) is irrelevant — admin URLs always match the shell, never the catch-all. No stacked sidebars. |
| 3 | Preview router branches on ?surface= | ⚠️ PARTIAL — wrapper (App.tsx:43-52) and ThemeGallery link (AdminPages.tsx:211, `?surface=home&theme_override=`) are as specified, and the theme-override preview works end-to-end. But the editor iframe path is still broken — findings 1 and 2. |
| 4 | KPI aggregates | ✅ FIXED as specified — exact count for Total Orders (AdminPages.tsx:30, `count: "exact"`), separate agg rows (31), recent orders from `limit(8)` (33). Residual 500-row cap → finding 4. |
| 5 | iframe src bump | ✅ FIXED — EditorPage.tsx:19-23 rewrites src only when `previewKey > 0`; JSX `src` handles the initial load; no mount double-load. Sandbox doc still open → finding 5. |
| 6 | THEME_PRESETS | ✅ FIXED — 6 presets (shared.tsx:18-25, nimbus/saffron added); css blocks `[data-theme="nimbus"]` @293 and `[data-theme="saffron"]` @306 with full var sets. swatches/labels maps now cover all 6. Flash/leak half of #6 remains → finding 3. |
| 7 | ⌘K wired | ✅ FIXED — Shell.tsx:108-118 keydown listener with cleanup; ⌘K/Ctrl+K toggles, Escape closes. |

---

## Findings

### 1. HIGH — Editor product/shop-page previews still render the homepage (critique-1 #3, half-fixed)

`StorefrontAdminEditor.tsx:65` builds previewUrl **without** `?surface=`:

`/storefronts/preview/${slug}/_product_page` → App.tsx:47-48 wrapper reads `params.get("surface")` → null → renders `StorefrontPreviewPage` → `StorefrontApp(draftPageSlug="_product_page")` → StorefrontApp.tsx:58 catch-all `Navigate to basePath` → `Home` → `getDraftPage(sf.id, "_product_page")` → null (pages.ts:94 — no builder draft has that slug) → the operator sees the homepage, not the product/shop page. Affects surfaces `product-page`, `product-card`, `shop-page` (StorefrontAdminEditor.tsx:29-37).

The comment at App.tsx:40-42 claims "`_`-prefixed surfaces … go to the direct-render StorefrontPreviewSurface" — the code branches on the query param only and does not implement the comment.

**Fix:** in the App.tsx wrapper, branch on the path prefix as its own comment claims — `const { pageSlug } = useParams(); return (params.get("surface") || pageSlug?.startsWith("_")) ? <Surface.default /> : <Page.default />` — AND fix finding 2; both spots are needed for the editor iframe to reach `SurfaceFrame` with the right surface.

### 2. HIGH — StorefrontPreviewSurface can only ever render Home

It reads `useParams().surface` (StorefrontPreviewSurface.tsx:25), but it is mounted only under `/storefronts/preview/:slug/:pageSlug` (App.tsx:156-157) — the route param is named `pageSlug`, so `surface` is **always undefined** → `<SurfaceFrame surface={surface || "home"}>` (line 51) → always `"home"`. The `_product_page`, `_shop_page`, `_builder`, `_identity` cases (lines 76-101) are unreachable dead code. The ThemeGallery preview only works because its `surface=home` param coincides with the `|| "home"` fallback.

**Fix:** read `useParams().pageSlug` (or accept a `surface` prop passed by the wrapper). Combined with fix 1, the editor chain becomes: `_product_page` URL → wrapper → Surface → `SurfaceFrame("_product_page")` → first-product load → real Product preview.

### 3. MODERATE — ThemeGallery flash + missing alive guard unchanged (critique-1 #6, half-fixed)

`AdminPages.tsx:151` initializes `sf` as `null`; line 173 returns "Storefront not found." with no loading state → a brief "Storefront not found." flash on every theme-page mount. The `useEffect` (154-157) has no `alive` cleanup → `setSf` after unmount. Same pattern in `shared.tsx:60-62` (`StoreLink` fetch, no guard). Every other fetch in the shell has the guard; these two are the stragglers.

**Fix:** start `sf` as `undefined` + spinner (or add a `loading` state), add the `alive` guard — mirror `StorefrontOverview` (AdminPages.tsx:21-43).

### 4. MINOR — KPI aggregates cap at 500 rows (residual of critique-1 #4)

`AdminPages.tsx:31` agg query `.limit(500)` — "Total Revenue" and the status counters undercount at >500 orders while "Total Orders" (line 30, `count: "exact"`) shows the true number — internally inconsistent cards. **Fix:** `sum`/status aggregates via an RPC or PostgREST aggregate (`select=sum(total)`), or document the 500-order window on the card.

### 5. MINOR — hygiene + docs

- `npm run lint` fails on the admin-shell files: `react-hooks/rules-of-hooks` on the misnamed local `useTheme` (AdminPages.tsx:159, called at 214 — rename it, it is not a hook) + ~19 `@typescript-eslint/no-explicit-any` (pre-existing debt class; `tsc` is clean).
- Stale doc comments: StorefrontPreviewSurface.tsx:14-23 ("Rendered DIRECTLY by StorefrontPreviewPage — no StorefrontApp") contradicts the App.tsx lazy wrapper; App.tsx:40-42 contradicted by the `?surface=` code.
- EditorPage.tsx:45 sandbox (`allow-scripts allow-same-origin allow-forms`) unchanged — decorative for a same-origin first-party preview; critique-1 #5's option (a) (document the trust boundary in the doc comment) still not done.
- Cosmetic dupes from critique-1 #8 unchanged: "Store Identity" twice (Shell.tsx:31/35), `List` icon reused for Products + Shop Page (43/57); accent_hex still hardcoded `sw[0]` per preset with no THEME_PRESETS link (AdminPages.tsx:214).

---

## Verified OK (no action)

- `<Navigate to="dashboard" replace>` as shell children (App.tsx:118): relative resolution against the `/storefronts/:slug/admin` route → `/storefronts/:slug/admin/dashboard`. Correct.
- Shell routes listed before `path="*"`: RRv6 ranks by specificity, not declaration order — no shadowing.
- Nested `<Routes>` inside the catch-all element (App.tsx:143-161): standard splat-descend pattern; inner routes match the full pathname.
- Shell keydown effect has proper cleanup; palette search filter + Escape both work; `search` resets on palette navigation.
- EditorPage: `previewKey > 0` guard means remounts across surfaces never double-load; `iframeRef.current &&` guard intact.
- `mergeSettings` unused import removed (AdminPages.tsx:8 now imports THEME_PRESETS).
- StorefrontOverview: loading state + alive guard + exact counts — clean.
- StorefrontPreviewSurface `_product_page` first-product effect has alive cleanup; no loop.
- ThemeGallery theme_override preview chain end-to-end: `?surface=home&theme_override=X` → Surface → `effectiveSf` (Surface.tsx:44-47) → BrandProvider override → Home with the picked preset. Works.
