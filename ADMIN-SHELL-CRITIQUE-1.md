# ADMIN SHELL CRITIQUE 1 — commit f962ecb

**VERDICT: BLOCKER — the shell crashes on load (Rules of Hooks violation), renders two stacked sidebars, and StorefrontPreviewSurface is dead code (never routed), which breaks product-page preview and the theme_override preview path. Do not ship until #1–#3 are fixed.**

Scope reviewed: `src/components/storefront-admin/StorefrontAdminShell.tsx`, `EditorPage.tsx`, `StorefrontAdminEditor.tsx`, `AdminPages.tsx`, `src/pages/StorefrontPreviewSurface.tsx`, `src/pages/StorefrontPreviewPage.tsx`, routes in `src/App.tsx`, plus `DashboardLayout.tsx`, `src/storefront/StorefrontApp.tsx`, `Home.tsx`, `Product.tsx`, `shared.tsx`, `supabase/migrations/20260914150000_checkout_atomic_idempotency.sql`, `src/integrations/supabase/types.ts`.

---

## 1. CRITICAL — Rules of Hooks violation: shell crashes when data arrives

`StorefrontAdminShell.tsx:109` calls `useMemo(...)` for `paletteItems` **after** the early returns at lines 99–104 (`if (sf === undefined) return ...`, `if (!sf) return ...`).

- First render: `sf === undefined` → early return at line 100 → `useMemo` never runs (hook count N).
- Second render (Supabase resolves, `setSf` fires): same N hooks, then `useMemo` runs (N+1) → React throws **"Rendered more hooks than during the previous render."**
- Result: every `/storefronts/:slug/admin/*` page shows the spinner, then crashes into ErrorBoundary. The entire admin shell is non-functional as landed.

**Fix:** move the `useMemo` (line 109–114) and the pure derivations (`surfacePages`, `currentSurface`, `base`) above the early returns, so hook order is identical on every render.

## 2. HIGH — Two stacked sidebars confirmed

- `App.tsx:100–144`: all 19 admin shell routes are nested **inside** `<DashboardLayout>`.
- `DashboardLayout.tsx:26`: `<AppSidebar />` renders unconditionally (no pathname-based hide anywhere in DashboardLayout).
- `StorefrontAdminShell.tsx:129`: the shell renders its own `<aside>` sidebar.

Net effect on `/storefronts/:slug/admin/theme`: AppSidebar (left) + shell sidebar stacked side-by-side, plus DashboardLayout's topbar and CommandPalette rendered above the shell's own header. The shell's doc comment ("AppSidebar never renders inside") is contradicted by the route nesting.

**Fix:** move the shell routes (`App.tsx:119–137`) outside the `</DashboardLayout>` wrapper — e.g. render a sibling `<Routes>` block beside `<DashboardLayout><Routes>…</Routes></DashboardLayout>`. Both `<Routes>` trees see the same location; only the matching one renders, and the admin routes keep their AuthProvider/PermissionsProvider context (those come from `Root`, not DashboardLayout).

## 3. HIGH — StorefrontPreviewSurface is dead code; product preview and theme_override are broken

- `App.tsx:38` lazy-imports `StorefrontPreviewSurface` but **no route renders it**. Both preview routes (`App.tsx:117–118`) point to `StorefrontPreviewPage`.
- `StorefrontPreviewPage.tsx:66–71` renders `StorefrontApp` with `draftPageSlug={pageSlug}` — it never delegates to `StorefrontPreviewSurface`, despite that component's doc comment claiming "Rendered DIRECTLY by StorefrontPreviewPage".
- Consequences for the editor iframe (`StorefrontAdminEditor.tsx:29–37`):
  - `_product_page` / `_shop_page` URLs hit `StorefrontApp`'s catch-all (`StorefrontApp.tsx:58`) → `Navigate` to basePath → `Home` renders with `draftPageSlug="_product_page"` → `getDraftPage(sf.id, "_product_page")` (`Home.tsx:51–52`) fetches a nonexistent page-builder draft → null → the operator sees the **homepage**, not the product/shop page.
  - The component itself is correct: `Product({ slugOverride })` exists (`Product.tsx:16,18`), MemoryRouter + first-product load (`StorefrontPreviewSurface.tsx:82–89`) with `alive` cleanup and no loop — but it never renders. Minor gap: if the store has zero products the product-page preview spins forever instead of showing an empty-state message.
- **theme_override is read only by the dead component** (`StorefrontPreviewSurface.tsx:44–47`). `ThemeGallery`'s Preview button (`AdminPages.tsx:206`) opens `/storefronts/preview/:slug/home?theme_override=…` → `StorefrontPreviewPage` → `StorefrontApp` → nothing reads the param → the preview shows the **saved** theme, not the picked preset. Silent wrong behavior.

**Fix:** in `StorefrontPreviewPage`, branch on `pageSlug?.startsWith("_")` and render `StorefrontPreviewSurface` for underscore surfaces (it already reads `theme_override`, handles `_product_page`/`_shop_page`/`_builder`); keep the current `StorefrontApp` path for named pages (`home`, `about`, …).

## 4. MODERATE — Overview KPIs are computed from the limit-8 orders page

`AdminPages.tsx:30`: the single query is `.eq("storefront_id", …).order("created_at", { ascending: false }).limit(8)`.

- `orders.storefront_id` **does exist** — added by `supabase/migrations/20260914150000_checkout_atomic_idempotency.sql` (`ADD COLUMN IF NOT EXISTS storefront_id uuid REFERENCES public.storefronts(id) ON DELETE SET NULL`), and the checkout function inserts it. `customer_name` is also inserted by the same function. Schema concern: none.
- But every KPI derives from that same 8-row page: `revenue7` (AdminPages.tsx:48) sums only the 8 most recent orders while the card labels it "Total Revenue"; `orders.length` (line 67) caps "Total Orders" at 8; the status counters (line 50) also cap at 8. Any store with >8 orders shows wrong numbers.
- Status values used (`delivered/pending/shipped/cancelled`) are valid per the orders CHECK constraint (`'pending','processing','shipped','delivered','cancelled','returned'`).

**Fix:** fetch real aggregates separately (`supabase.from("orders").select("total", { count: "exact", head: true })` per status, or a single group-by RPC) and keep the `limit(8)` query only for the Recent orders list. Rename `revenue7` or compute a true 7-day window (`created_at >= now() - interval '7 days'`).

## 5. MODERATE — EditorPage iframe sandbox: allow-scripts + allow-same-origin nullifies the sandbox

`EditorPage.tsx:42`: `sandbox="allow-scripts allow-same-origin allow-forms"`. The preview loads a **same-origin** page (the authenticated storefront app), so with both flags the framed document can remove its own sandbox and reach the parent DOM, `localStorage`, and the admin session — the sandbox attribute is decorative here.

Dropping `allow-same-origin` would break the preview (the Supabase client inside the iframe needs localStorage and credentialed fetch; an opaque origin blocks both). So the practical options: (a) document the trust boundary — the iframe renders first-party code behind the same `storefronts.view` session, so it gains nothing it doesn't already have, but any future third-party/UGC rendering inside storefront pages would inherit admin-surface access; or (b) serve the preview from a separate origin (subdomain) later. Keep `allow-forms` only if checkout preview needs form submission; `scripts`+`forms` without `same-origin` is the safer end state once the preview can self-fetch.

Also: `previewKey` reload is **not a loop** (key bump → one src set), but the effect (`EditorPage.tsx:16–20`) fires on mount with `previewKey=0` and rewrites `src` to `?_k=0` — the iframe loads the URL **twice on every mount** (once from the JSX `src`, once from the effect). Fix: initialize `previewKey` at 1 and only set `src` when `k > 1`, or render the initial `src` with `_k` included. Note `device` prop defaults to "desktop" — `StorefrontAdminEditor` never passes it; harmless.

## 6. MODERATE — ThemeGallery: flash bug, dead preset entries, accent drift

- **Flash:** `AdminPages.tsx:146` initializes `sf` as `null` and line 168 returns "Storefront not found." with no loading state → a brief "Storefront not found." flash on every theme page mount (the shell's own fetch doesn't help; this is a separate query).
- **Leak:** the `useEffect` at lines 149–152 has no `alive` cleanup → `setSf` after unmount if the query resolves post-navigation (React 18 won't warn, but it's the only fetch in the commit missing the guard — every other one has it).
- **Dead entries:** `THEME_PRESETS` (`shared.tsx:19–22`) has exactly 4 presets — `editorial, cinematic, minimal, warm`. The `swatches` and `labels` maps (`AdminPages.tsx:171–186`) also define `nimbus` and `saffron` — unreachable dead code (fallback `swatches[t.value] || swatches.editorial` covers the rest). Swatch/label keys otherwise match preset values correctly.
- **Accent pairing is arbitrary:** `useTheme` writes `theme + accent_hex` (line 159) — both columns exist on `storefronts` (types.ts) and `BrandContext.tsx:65–69` applies the accent correctly — but the accent is hardcoded `sw[0]` per preset with no source-of-truth link to `THEME_PRESETS`. Active state is correct (`sf.theme === t.value`, ring-2, button disabled).

**Fix:** add a `loading` state (or start `sf` as `undefined` with a spinner), add the `alive` guard, and move `swatches`/`labels` into `THEME_PRESETS` (or a shared map keyed off it) so accent hex travels with the preset. Delete the nimbus/saffron entries or ship the presets.

## 7. MINOR — ⌘K advertised but not wired

`StorefrontAdminShell.tsx:146` shows a ⌘K kbd hint, but there is no `keydown` listener anywhere in the shell — the palette opens only via button click, and closes only via outside-click or the X button (no Escape). Wire a `useEffect` keydown handler for Cmd/Ctrl+K (open) and Escape (close).

## 8. MINOR — Unused import + cosmetic dupes

- `AdminPages.tsx:8`: `mergeSettings` imported, never used — will trip `noUnusedLocals`/lint.
- `StorefrontAdminShell.tsx:25–80`: "Store Identity" appears twice (group label line 31 and item label line 35); the `List` icon is reused for both "Products" and "Shop Page". Cosmetic only.

## 9. Verified OK (no action)

- `/storefronts/:slug/admin` → shell + `<Navigate to="dashboard" replace>` (App.tsx:119) is safe: the shell loads `sf` first, then the Navigate child renders.
- Every storefront fetch except ThemeGallery's has the `alive` unmount guard.
- `PermissionGuard("storefronts.view")` wraps all 19 shell routes consistently.
- StorefrontPreviewSurface's `_product_page` first-product effect has correct cleanup; no leak in the (currently dead) path.
- EditorPage guards `iframeRef.current && previewKey !== undefined` before touching `src` — surfaces without a preview can't hit a null ref.
- Home-ish editor surfaces (`header-footer`, `builder`, `theme`, `animations` → draft `home`) do work through the live `StorefrontPreviewPage` → `StorefrontApp` path today (getDraftPage(sf.id, "home") is a real builder draft).
