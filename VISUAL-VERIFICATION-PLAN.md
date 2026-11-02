# Visual Verification Plan — DokanOS Storefront (browser-agent protocol)

The verifier agent drives the REAL deployed app in Chrome via OpenCLI (preferred; binds the user's logged-in session) or Playwright CLI (fresh profile; logs in with test credentials). It clicks through EVERY element below, screenshots each surface, captures console errors and failing network calls, and writes a pass/fail per step. A feature is DONE only when its checklist passes here.

Target: the branch preview deployment (behind Vercel SSO — use the user's Chrome profile via OpenCLI, or authenticate once).

---

## V0 — Boot health (before anything else)
1. Open the deployment root → expect the DokanOS login or dashboard (no Vercel SSO wall, no error boundary).
2. Open DevTools-equivalent capture (console + network) for the entire session.
3. Any red console error on any step below = automatic FAIL for that step; record the exact message.

## V1 — Storefronts entry (fix C)
1. Click **Storefronts** in the main left sidebar.
2. EXPECT: the new admin panel renders IMMEDIATELY inside the dashboard shell (AppSidebar still visible; admin sub-sidebar visible; overview/dashboard content). No "Open admin panel" button, no legacy tabbed editor.
3. Storefront switcher present in the panel header; switching storefronts reloads the panel for the new slug.
4. "New Storefront" opens the create dialog (see V9).

## V2 — Admin panel surfaces (per surface: click sidebar item → content renders → no error boundary)
Verify each renders with its real controls, and take a screenshot per surface:
1. **Dashboard (Overview)** — KPI cards, order status, recent orders, quick actions.
2. **Store Identity** — name, hero fields, logo/favicon, contact; NO theme select, NO accent color (dedup check), pointer to Theme & Styling.
3. **Theme** (gallery) — 6 theme cards render; "Preview" opens a working themed preview; "Use this theme" persists (check active badge after click).
4. **Design tokens** — page renders with NO Radix crash; heading/body font Selects open and list "Theme default" + families; every color token row has picker + clear; radius slider moves; Save persists (reload page → values retained).
5. **Homepage Builder** — left: section list + Add + AI button; right: preview iframe (V3).
6. **Pages** — list with Edit buttons; system pages (Home/Shop/Cart/Product) show "System" badge and Edit routes to the template editor (builder/shop-page/product-page/delivery); content pages Edit → visual builder (V4).
7. **Collections / Products** — lists render, add/remove works.
8. **Header & Footer / Product Page / Product Card / Shop Page / Animations** — each editor renders with its preview iframe (V3) and Save works.
9. **Delivery & Shipping** — delivery config + **Checkout Fields** section present (V6).
10. **Payment Methods** — wallet cards with toggles, account fields, Save.
11. **Domains / Social & Policies / Settings** — render + Save.
12. **Health** — "Run checks" executes: page TTFB rows appear, image assets rows appear, config flags all OK.
13. **Support** — mailto link.

## V3 — Preview iframes (fix B) — the core regression
For each editor that has a preview iframe (Homepage Builder, Header & Footer, Product Page, Product Card, Shop Page, Animations, Theme preview):
1. The iframe shows the actual storefront page (home / shop / product), NOT an error screen, NOT the admin chrome (no sidebar inside the iframe).
2. Console inside the iframe is clean (no uncaught errors).
3. Change a setting (e.g., card corner radius) → Save → the preview updates WITHOUT a full iframe reload (postMessage swap; watch network: no new document request).
4. Homepage Builder: `?draft` mode — add a section in the editor → preview shows the DRAFT section immediately.
5. Theme preview: each theme's Preview link opens a new tab rendering home with THAT theme's look (6 themes × distinct visuals).
6. Iframe fills its pane (no fixed 640px letterbox; canvas-like presentation in the builder).

## V4 — Visual page builder (fix E)
1. From Pages → Edit on a content page → route `/admin/pages/:pageId/edit`.
2. Left drawer: draggable element cards (hero, product grid, rich text, image banner, gallery, testimonials, FAQ, spacer/divider) + section list + inspector.
3. Drag a card onto the right canvas → section is ADDED and appears in the canvas immediately.
4. Reorder via drag in the list → canvas order updates live.
5. Select a section → inspector shows its props; editing text does NOT lose focus (re-check 1.2) and the canvas reflects changes after save.
6. Publish → the live storefront at /storefront/:slug/pages/:slug shows the published page.
7. Landing page: create with type=landing → served at /lp/:slug with NO header/footer; verify in a new tab.

## V5 — Checkout end-to-end (fix A)
On the public storefront (/storefront/:slug):
1. Add a product to cart → cart drawer opens from header icon with the item + free-shipping progress (if threshold set).
2. Go to checkout → fill the form as a **Dhaka customer WITHOUT selecting a zone** → submit.
   - EXPECT: order succeeds (200), success page with order number; orders table shows the order.
3. Repeat with zone selected → also succeeds.
4. Wallet method (bKash): shows account number + instructions; TrxID field present; submit succeeds (pending_verification).
5. If any submission fails: capture the EXACT response body from the network tab (the UI must now display the server's error message, not the generic supabase-js string).
6. Track page: enter the created order number + phone → timeline renders with the current status.

## V6 — Checkout fields & settings discoverability (fix G)
1. Admin → CHECKOUT & SHIPPING group shows TWO items: "Delivery & Shipping" and "Checkout Fields".
2. Checkout Fields page: toggles for Email / Company / Address line 2 / Postal code + Inside/Outside Dhaka zone-required switches.
3. Toggle OFF "Email" + Save → storefront checkout no longer shows the Email field (verify live).
4. Toggle ON "Postal code" + Save → postal field appears on checkout.
5. Set zone optional inside Dhaka → checkout submits fine without zone (ties to V5.2).

## V7 — Brand model visibility (fix D)
1. Create Storefront dialog: brand Select listing existing brands (of the active business) with "Create new brand…" option; creating under an existing brand links it.
2. Storefront switcher/list shows each storefront's brand name (badge or subtitle).
3. Two storefronts under one brand → both show the same brand.

## V8 — Theme engine (fixes 4.1/4.2 end-to-end)
1. Nimbus theme preview: minimal catalog-style home (distinct layout), Inter typography.
2. Saffron theme preview: warm rounded home (distinct layout), Poppins typography.
3. Design tokens: set heading font to "Playfair Display" + primary color → storefront (preview + live) reflects both without code changes.
4. Radius slider change → cards on the storefront visibly change radius after save.

## V9 — Create flow (scaffold + brand)
1. New Storefront with theme=Nimbus → storefront created; Pages list auto-contains Home (with themed hero + featured products sections) and Contact.
2. New storefront appears under the chosen brand (V7).
3. The new storefront's public URL renders the scaffolded home.

## V10 — Regression sweep
1. Keystroke fix still holds: type a full sentence in a section text field without focus loss or error toasts.
2. Old tabbed editor is GONE (search the whole admin; only the new panel exists).
3. Dashboard rest of app (Orders, Products, POS) still loads — the 2.1 unification didn't break sibling pages.
4. `npm run typecheck` + `npm test` green.

---

## Verifier output format
Per step: `V<step>.<n> PASS/FAIL — <one-line evidence>` + screenshot paths + console/network error excerpts for any FAIL. End with: `VERIFIED — N/N PASS` or `FAILED — list`.
