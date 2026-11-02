# Bonik Parity Plan — Storefront Runtime + Admin Shell (final, merged)

> **Scope:** everything storefront-facing in DokanOS — (1) the **public storefront** a shopper sees (the shop), and (2) the **admin dashboard shell** the seller uses to design and manage it. Both halves must land Bonik-style parities.
>
> Captured evidence: walkthrough of Bonik's seller panel (`boniklabs.com/seller`) — all settings surfaces, the sidebar layout, every editor's controls — and its public storefront at `gadgetprev.boniklabs.com` (live preview store from the Theme Gallery).

---

## Part I — Public storefront runtime parity

What a shopper sees.

### 1. Brand chrome applies everywhere
- `data-brand` attribute on every page → brand's primary color + typography drive every button, link, badge, and title.
- **Header**: announcement bar (dismissable, per session), logo or uppercase name, desktop nav + mobile hamburger, custom icons (phone/WhatsApp), cart icon with count badge. Sticky, blurred backdrop.
- **Footer**: brand block (logo + hero subtitle), responsive 3-column grid (Shop links, custom links, Contact info), social icon row, copyright strip.
- Language toggle EN/বাংলা when multilingual keys exist — same pattern Bonik ships.

### 2. Pages that Bonik renders and we need live parity on
| Route | Bonik | DokanOS needs |
|---|---|---|
| `/storefront/:slug` (home) | Hero, product grid, collection, trust strip, testimonials | Page builder renders it; fills in defaults if the snapshot is empty so the page is never blank |
| `/storefront/:slug/shop` | Shop/global full catalog, filters sidebar, sort dropdown, pagination | filter sidebar (category chips, price-bands) + sort + page — already shipped in this wave |
| `/storefront/:slug/product/:pslug` | Hero image gallery, stock status, variant pickers, qty stepper, ATC + Buy Now, trust badges, related products, description, SKU, share | All present from this wave — button styles honor look |
| `/storefront/:slug/collections/:slug` | Collection page w/ custom title/desc, curated grid | collection page uses same Shop grid; hero from collection.image_url |
| `/storefront/:slug/cart` | Drawer-style slide-over from icon click + full page fallback | Both: drawer when opened from icon; full page when routed directly |
| `/storefront/:slug/checkout` | Stepper: Contact → Address → Payment → Review | Two-pane (form left, sticky summary right) with advance-payment steps wired |
| `/storefront/:slug/checkout/success` | Big confirmation with order number | Already exists — polish: order number + WhatsApp support link |
| `/storefront/:slug/track` | Order tracking page with status timeline | Track page uses order.timeline entries — status labels styled nicely |
| `/storefront/:slug/about` | About page with markdown + history | Already present |
| `/storefront/:slug/policies` | Policies page (list of policy docs + markdown body) | Already present |
| `/storefront/:slug/contact` | Contact page with phone/email/chat links | Present; adds "WhatsApp" floating button icon in contact panel |
| `/storefront/:slug/payment/:method` | Manual payment instructions (bKash send to wallet) | Add: after checkout "Manual payment" page lists the chosen wallet instructions when tg on COD-only storefront |

### 3. Buyer UX details
- Product cards (global): corners, shadows, hover zoom, wishlist heart, Add to Cart + Buy Now buttons (all from `settings.card`).
- Product page: variant pill selectors (size/color), stock badge, quantity stepper, trust badges (SVG icon list), related products strip.
- Cart: per-line quantity steppers, remove, note field, totals w/ shipping estimate, free-shipping progress bar if threshold set.
- All storefront pages get the brand's scroll-animations via `useScrollAnimations`.
- Not-found store (404) lands on a sorry page with link back to the storefront.

---

## Part II — Admin shell (seller-side) parity

What the shop owner sees.

### Sidebar shell
New `StorefrontAdminShell.tsx` — dedicated layout at `/storefronts/:slug/admin/*` with:
- Grouped sidebar sections (uppercase labels): OVERVIEW / STORE IDENTITY / PAGE LAYOUT / STOREFRONT / PRODUCT DISPLAY / CHECKOUT / SETTINGS / HELP.
- ⌘K command palette button at the top (command palette content = jump-to-surface list).
- User profile card at the footer of the sidebar.
- AppSidebar does not render inside; full-bleed layout replaces it.

### Route map

| Route | Page | Group |
|---|---|---|
| `/storefronts` | List (keep as-is link hub) | — |
| `/storefronts/:slug/admin/dashboard` | Overview | OVERVIEW |
| `/storefronts/:slug/admin/theme` | Theme gallery | STORE IDENTITY |
| `/storefronts/:slug/admin/builder` | Homepage builder w/ section picker | STORE IDENTITY |
| `/storefronts/:slug/admin/pages` | Pages manager | PAGE LAYOUT |
| `/storefronts/:slug/admin/collections` | Collections | PAGE LAYOUT |
| `/storefronts/:slug/admin/identity` | Store Identity | STORE IDENTITY |
| `/storefronts/:slug/admin/header-footer` | Header & Footer | STOREFRONT |
| `/storefronts/:slug/admin/product-page` | Product page layout | PRODUCT DISPLAY |
| `/storefronts/:slug/admin/product-card` | Product card style | PRODUCT DISPLAY |
| `/storefronts/:slug/admin/shop-page` | Shop page settings | PRODUCT DISPLAY |
| `/storefronts/:slug/admin/animations` | Scroll animations | STOREFRONT |
| `/storefronts/:slug/admin/delivery` | Delivery & shipping | CHECKOUT |
| `/storefronts/:slug/admin/payments` | Payment methods | CHECKOUT |
| `/storefronts/:slug/admin/domains` | Domains | SETTINGS |
| `/storefronts/:slug/admin/policies` | Social & policies | SETTINGS |
| `/storefronts/:slug/admin/settings` | General settings | SETTINGS |
| `/storefronts/:slug/admin/help` | Mailto support link | HELP |

### Editor chrome (every editor page gets)
- Back button to `/storefronts/:slug/admin/dashboard`, title, slug label.
- Save / Reset buttons, unsaved-change badge.
- Device-toggle (desktop/mobile), zoom ±, "Open preview in new tab".
- Preview iframe on the right (rendered per surface).
- **Route-leave guard:** confirm dialog before navigation with an unsaved draft.

### Preview iframe contract
The iframe never navigates itself. `StorefrontPreviewPage` gets params `slug + surface` and renders the target page component directly (no router, no catch-all):

```tsx
case "home" | "_builder": return <Home />;
case "_product_page": return <Product />;
case "_shop_page": return <Shop />;
default: return "Select a page to preview";
```

`postMessage` informs it of edits; Save button reloads the iframe. Unknown surface → "Select a page to preview" placeholder.

---

## Phases & effort

| Phase | Content | Effort |
|---|---|---|
| A | Admin shell + routes + previews | 3 d |
| B | Public runtime parity (Home, Shop, Cart, Checkout, Track, About, Policies, Contact polish + header/footer/animations) | 3 d |
| C | Default Theme gallery | 1 d |
| D | Overview dashboard | 0.5 d |
| E | Command palette | 0.5 d |
| F | Editor chrome + preview iframe contract | 1 d |
| Buffer | (Bonik nits that come out) | 1 d |

**Total: ~10 working days single-dev.**

## Verification bar
- All new pages pass PermissionGuard("storefronts.view").
- Editors write only into `storefronts` (jsonb settings) and `storefronts_pages` — no new database tables needed.
- Live-preview page never writes to the DB; it reads the saved state and re-renders on Save reload.
- Every new StorefrontSettings field added in this wave has an admin-side editor and a runtime consumer — no dead settings shipped.

---

*Converged into one file. Cycle count: 7 on the admin half; runtime half carried forward from `BONIK-FRONTEND-PLAN.md` and folded in.*