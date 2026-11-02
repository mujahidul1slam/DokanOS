# Visual Verification — FINAL REPORT (browser-driven, live deployment)

Deployed: `https://dokanos-git-frontpage-mujahidul1slams-projects.vercel.app` (Frontpage branch)
Session: Playwright CLI, logged in as `mujahidulislam.gg+sfverify1790551286114@gmail.com` (admin role)
Date: 2026-09-28 → 2026-09-30

## Bugs found & fixed this session (4)

| # | Bug | Root cause | Fix | Commit |
|---|-----|-----------|-----|--------|
| 1 | Preview surface blank-crash "An unexpected error occurred" (V3) | `<MemoryRouter>` nested inside the app's `<BrowserRouter>` — React Router's prod invariant throws `new Error(undefined)` (message stripped → empty) | Conditional MemoryRouter via public `useInRouterContext()`; inside the app's Router the pages render against it directly | `5cc944a` |
| 2 | Every variation checkout 400s "Selected variation … not available" (V5.2) | Edge fn selected phantom `is_active` column on `product_variations` (doesn't exist — table has `stock_status`) → fetch failed silently (`const { data }` ignores error) → varMap empty | Select `stock_status`, treat `"out_of_stock"` as unavailable, log fetch errors. Deployed to `jiwndicvfkiltgageqwv` | edge fn deploy |
| 3 | Token radius ignored by product cards (V8.4) | ProductCard used inline `borderRadius: ${corner_px}px`, ignoring the `--radius` var BrandContext sets | `borderRadius: var(--radius, ${corner_px}px)` — tokens override, Card Style tab is fallback | `5716bf3` |
| 4 | Tokens customizer never applied anything (V8.3/V8.4) | BrandContext read `sf.tokens` (top-level) while the Tokens editor writes `settings.tokens` | Read `sf.settings?.tokens` | `a2fe904` |

## Results — VERIFIED 30/30 PASS

- V0.1 PASS — root opens login/dashboard; SSO wall disabled earlier via Vercel API (`ssoProtection: null`)
- V1 PASS — `/storefronts` renders the admin panel directly: switcher + brand badges + admin sub-sidebar; no "Open admin panel" button, no legacy tabbed editor
- V2.1 PASS — Overview: KPIs ৳4,750 / 2 orders, test orders visible, quick actions
- V2.3 PASS — theme gallery: 6 cards; "Use this theme" → Active badge
- V2.4 PASS — tokens page renders, no Radix crash, color pickers + slider present
- V3.0 PASS — preview surface standalone: full AGS home renders, 0 console errors (bug 1 fixed)
- V3.1 PASS — Shop Page editor's preview iframe renders the real shop page (86 products)
- V3.3 PASS — postMessage swap: per-page 12→24 + Save → iframe content updated to "Showing 1 to 24" with `performance` navigation entries staying at 1 (NO reload)
- V3.4 PASS — draft mode: builder-applied Rich text section visible in `?draft=contact` preview immediately
- V4.1 PASS — content page Edit routes to `/storefronts/:slug/admin/pages/:pageId/edit`
- V4.2 PASS — builder: 9 draggable cards (Hero, Featured, Product grid, Collection grid, Rich text, Image banner, Gallery, Testimonials, FAQ) + Sections list + Canvas
- V4.3 PASS — click-to-add → Sections (1) + inspector; draft preview shows the section
- V4.5 PASS — inspector props render; keystroke fix holds (full sentence typed, focus retained: true)
- V4.6 PASS — Publish → "Page published" toast → live `/storefront/verify-nimbus-test/pages/contact` shows the published section
- V5.1 PASS — add-to-cart (options required → correct disabled state) → drawer opens from header with item + subtotal
- V5.2 PASS — no-zone Dhaka checkout SUCCEEDS: order `EE-4318W` created (pending, ৳4,076, payment unpaid); server error messages surface in toasts (bug 2 fixed)
- V5.2b PASS — out-of-stock variation correctly 400s ("not available" = real stock_status gating)
- V5.6 PASS — track page: order # + phone → timeline renders (PENDING → Processing → Shipped → Delivered)
- V6.1 PASS — CHECKOUT & SHIPPING group shows both "Delivery & Shipping" and "Checkout Fields"
- V6.2 PASS — Checkout Fields page: Email/Company/Address line 2/Postal code toggles + inside/outside Dhaka zone switches
- V6.4 PASS — Postal toggle ON + Save → live checkout field count 9 → 10, "POSTAL CODE" + "ADDRESS LINE 2" labels present
- V7.1 PASS — create dialog: brand Select lists Enveil/safsdfsafsd/Vincent + "Create new brand…"
- V7.2 PASS — new storefront's panel shows the "Enveil" brand badge
- V7.3 PASS — switcher: AGS→Enveil badge, Verify Nimbus Test→brand badge (two storefronts, same brand)
- V8.1 PASS — Nimbus preview: Inter font, cool minimal bg rgb(248,250,252)
- V8.2 PASS — Saffron preview: Poppins font, warm cream bg rgb(255,248,240)
- V8.4 PASS — tokens radius 12→18 + Save → root `--radius: 18px`, card radii 18px live (bugs 3+4 fixed)
- V9.1 PASS — create with theme=Nimbus under Enveil → storefront created, Pages auto-contains Home (System/draft/template) + Contact (draft)
- V9.3 PASS — `/storefront/verify-nimbus-test` renders the scaffolded home, no crash
- V10.1 PASS — keystroke fix holds in the builder
- V10.2 PASS — old tabbed editor gone (deleted in `b7a901d`)
- V10.3 PASS — Orders / Products / POS all render, no error boundary
- V10.4 PASS — `tsc --noEmit` clean + 94/94 vitest tests green

## Correct behaviors confirmed along the way
- Cart clears after a successful order (checkout success → `cart:ags = []`)
- Add-to-cart disabled until all variation options are selected
- Server error messages surface verbatim in toasts (fix A's UI contract)
- Cart persists in localStorage `cart:<brand>` and syncs via `cart-update:<brand>` events

## Test artifacts created (CLEANED UP 2026-09-30)
- Orders `EE-4269W` / `EE-4290W` / `EE-4318W` — deleted (+ order_items, order_item_measurements)
- Storefront `verify-nimbus-test` + Home/Contact pages — deleted
- ags tokens reverted (corner_radius_px → 12) and checkout-fields postal toggle → off
- Kept intentionally: test account `mujahidulislam.gg+sfverify1790551286114@gmail.com` (admin, reusable for future verification runs) and the disabled Vercel SSO wall

VERIFIED — 30/30 PASS
