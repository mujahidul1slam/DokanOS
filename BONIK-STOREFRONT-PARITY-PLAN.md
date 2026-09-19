# Bonik Storefront Parity Plan — How Bonik Labs Built Their Storefront System, and How DokanOS Matches It

**Date:** 2026-09-17
**Source:** Live walkthrough of `boniklabs.com/seller` (full admin sidebar, storefront editors, settings pages) + live preview at `enveil.boniklabs.com`.
**Goal:** Make DokanOS storefronts functionally equivalent to Bonik's — same themes, same options, same settings sections, same architecture.

---

## 1. How Bonik organizes the storefront (the mental model we should copy)

Bonik does NOT treat "the storefront" as one page of settings. It's a **family of dedicated editors**, each owning one surface. The sidebar hierarchy:

```
STOREFRONT
  Store Identity          → name/tagline/logos/color presets
  Homepage Builder        → block-based page editor for the whole home page
  Default Theme           → 6 prebuilt industry themes
  Header & Footer         → navigation, announcement bars, menus, contact widgets
  Scroll Animations       → global entrance-animation system
  Landing Pages (Beta)    → standalone campaign pages

PRODUCT DISPLAY
  All Products Page       → shop-grid layout, filters, sorting, pagination
  Product Page Layout     → per-product-page layout, buttons, visibility
  Product Card Style      → the card shared everywhere (grid, related, search)

SETTINGS & BILLING
  Manage Shop             → policies, checkout fields, fraud, SEO, socials
  Delivery & Shipping     → charges, zones, COD, free-shipping threshold
  Payment Methods         → per-gateway config, manual vs automatic
```

**Pattern:** every surface = one editor, and every editor has the same chrome: **header with Save + percent-saved indicator + device/Preview toggle + live iframe preview** of the real storefront (`enveil.boniklabs.com`) rendered at that viewport. DokanOS should adopt exactly this one-editor-per-surface model.

---

## 2. Page-by-page: what they ship (exactly)

### 2.1 Store Identity (`/seller/edit-store`)
- **Name & Tagline** — store name + short tagline (shown in header, invoices, order emails)
- **Logo & Favicon**
  - Store Logo: recommended 200×60px, 10:3 ratio, transparent PNG
  - Dark Mode Logo: optional; falls back to light logo
  - Favicon: 32×32px, PNG/ICO
- **Color Presets (light):** Midnight, Ocean, Forest, Rose, Slate, Violet, Amber, Pure Black — apply a full palette in one click
- **Brand Colors (light):** Primary, Secondary, Accent, Button, Text, Background
- **Dark Mode Colors:** 8 dark presets (Midnight, Charcoal, Deep Sea, Forest, Rose, Violet, Amber, Pure Dark) + per-token override (primary, button, button-hover, secondary, accent, text, background); each defaults to "Auto — inherits light mode"
- **Live preview** of "Your Store" hero mockup that updates as you pick
- Header actions: Preview Store + Save

### 2.2 Homepage Builder (`/seller/builder`)
- **Draft slots:** Main Draft + Draft 2–5 (five parallel homepages; "publish any draft to make it live")
- Draft row shows name, element count, "Start" (opens editor)
- Editor chrome includes: draft-saved indicator with sync timestamp, live store URL, zoom %, Publish button, Layers tab, Blocks tab

**The block palette — 46 blocks, 6 groups:**

| Group | Blocks |
|---|---|
| **HERO & HEADER (4)** | Announcement Bar, Announcement Ticker, Hero Banner, Multi-Step Hero |
| **COMMERCE (11)** | Products, Recently Viewed Products, Category Grid, Collection Spotlight Cards, Shop the Look, Product Comparison Table, Build a Bundle, Reorder / Subscribe Block, Single Product Details, Direct Checkout Form, Pricing Table |
| **CONVERSION (9)** | Sticky Promo Bar, CTA Banner, Countdown Timer, Limited Stock Meter, Stats Strip, Delivery Estimator, Newsletter Signup, Lead Form, Promo Codes |
| **TRUST (7)** | Top Vendors, Partner Logo Slider, Features & Trust Badges, FAQ, Testimonials, Product Reviews, Guarantee Section |
| **MEDIA (6)** | Image + Text Section, Image, Before vs After Slider, Video Block, Testimonial Video Carousel, Instagram UGC Wall |
| **CONTENT (9)** | Size Guide Finder, Rich Text, Story Timeline, Spacer, Process Steps, Service Icons Bar, Social Links, Store Location Map, Divider |

### 2.3 Default Theme (`/seller/store-theme`)
Six prebuilt themes, each shown as a card with its own public demo store URL:

| Theme | Niche | Demo URL | Design vibe |
|---|---|---|---|
| **Nimbus** | Tech & Gadgets | techprev.boniklabs.com | Crisp blues, electronics/audio/smart |
| **Saffron** | Food & Beverage | foodprev.boniklabs.com | Warm, appetizing tones, bakery/restaurants |
| **Lumière** | Beauty & Cosmetics | beautyprev.boniklabs.com | Soft elegant pinks, boutique/jewelry |
| **Haven** | Home & Living | homeprev.boniklabs.com | Warm stone neutrals, furniture/decor |
| **Bazaar** | Mega Store | marketprev.boniklabs.com | High-density, category-driven, marketplace |
| **GadgetShob** | Gadgets & Electronics | gadgetprev.boniklabs.com | White catalog + deep-crimson accent + gold sale highlights |

Each card: "6 features" link, Preview, Use this theme; footer line "More themes coming soon — Modern, Minimal, Bold, Elegant".

### 2.4 Header & Footer (`/seller/header-footer`)
- Tabs: **Header / Footer / Mobile Bar / Sidebar**
- **Announcement Bar** on/off
- **Layout & Style** (size, spacing, behaviour)
- **Colors** (override theme colors)
- **Typography** (navigation menu font)
- **Header Content** (what appears in nav bar)
- **Light & Dark Mode** toggle path for shoppers
- **Categories in Header** — choose ALL or pick exactly which categories show
- **Custom Menu Links** — add your own (About, Blog, Contact)
- **Custom Icons** — icon buttons in header: phone, WhatsApp, socials
- Editor header: Back, Saved %, Desktop/Mobile preview toggle, zoom out/zoom in, Reload preview, Open preview in new tab, Hide settings, **Save**

### 2.5 Scroll Animations (`/seller/scroll-animations`)
- One entrance effect applies store-wide to every section as it scrolls into view
- **12 effects:** Fade In, Rise Up, Drop Down, Slide From Left, Slide From Right, Zoom In, Zoom Out, Blur In, Flip Up, Tilt In, Curtain Reveal, Bounce Up
- **Timing:** Speed (Slow / Normal / Fast, default 700ms), Strength (Subtle / Medium / Strong)
- **Product grids:** Cascade on/off (cards animate one after another) + gap in ms (default 70)
- **Behaviour:**
  - Play only once per page
  - Animate on page load toggle
  - Animate on phones toggle (they warn phones are low-power)
  - Hard safeties: **never runs on /cart, /checkout, /order-success, /track-order**; respects `prefers-reduced-motion`

### 2.6 Landing Pages (Beta) (`/seller/landing-pages`)
- Create/manage standalone pages for campaigns, product launches, seasonal sales
- Page list with Published count; CTA "Create Your First Page"

### 2.7 All Products Page (`/seller/all-products`)
- **Products per page:** 8/12/16/20/24/32/40/48 (default 12, max 48)
- **Columns on PC:** 2/3/4/5; **Columns on phone:** 1/2
- Page heading + optional heading description
- Result count text ("Showing 1 to 12 of 40 products") — toggleable
- Sorting dropdown options count
- **Filters** (6) — sidebar filters shoppers narrow with
- **Price Ranges** — default bands in ৳
- **Pagination** style
- Live preview (PC/Phone toggle), Reset to defaults, Save

### 2.8 Product Page Layout (`/seller/product-page`)
- **Layout:** Classic / Split Focus / Gallery Left
- **Image shape:** Landscape / Square / Portrait
- **Video style:** Video First / Below Images
- **Info panel style:** Card / Open
- **Related products per row:** 3/4/5 (PC); 1/2/3 (phones)
- **Accent color** override for the product page
- **Button style** (for Add to Cart AND Buy Now): corners (Rounded/Pill/Square), height (Compact/Default/Large), arrangement (Stacked/Side-by-side), "Price in Button" toggle, fill (Solid/Outline/Tinted), button color + text color
- **Visibility elements (7 toggles):** Category Label, Wishlist heart, Size Chart, SKU, Quantity Selector, Price Breakdown, Stock Status — each independently shown/hidden
- **Sold Count & Sharing:** sold count on/off, share button on/off (WhatsApp, Facebook, copy link)
- **Trust Badges** (3 badges)
- Customer Reviews link, Related Products config, Shipping & Returns policy copy
- **Apply to All Products** + **Save Default Settings** — settings fan out to every product

### 2.9 Product Card Style (`/seller/product-card`)
- **Card Appearance:** card style (Classic/Minimal/Bordered/Elevated), corners (px radius), shadow (None/Soft/Medium), image ratio (1:1 / Tall / Wide), hover effect (Zoom / Lift / None)
- **Card content elements:** Wishlist, Category, Price, Rating, Add to Cart, Buy Now — each toggleable; per-color overrides (card background, card border, price text), each defaulting to "Theme"
- **Action buttons:** layout (side-by-side/stacked), position (Below details / On image hover), per-button icon choice (Add to Cart: Cart/Bag/Plus/None; Buy Now: None/Zap/Arrow/Bag/Card), per-button background, text, border color
- **Card font** dropdown: Default / Inter / Poppins / Montserrat / Playfair / Lora / Space Grotesk / DM Sans + per-card spacing
- Live preview of two sample cards

### 2.10 Manage Shop (`/seller/manage-shop`) — the settings hub
- **Shop Settings** — business name, contact, address, currency, language, checkout preferences
- **Shop Domain** — subdomain or custom domain with DNS verification
- **Shop Policy** — About Us, Privacy Policy, Terms & Conditions, Return & Refund, Shipping Policy (five editable markdown fields)
- **Checkout Fields** — rename, reorder, hide, require standard fields; add custom questions
- **Fraud Prevention** — block phone numbers/IPs, require valid BD phones, cap orders per phone per day, minimum order amount
- **SEO & Marketing** — GTM, GA4, Google Search Console, Microsoft Clarity, Meta Pixel, TikTok Pixel (single IDs field each)
- **Social Links** — footer social entries + floating contact widget (phone/WhatsApp/Messenger)

### 2.11 Delivery & Shipping (`/seller/delivery-shipping`)
- Tabs: Delivery / Zones / Couriers / Fraud Prevention
- Default charge + label + COD toggle
- Delivery charge non-refundable toggle
- **Charge per product** toggle (per-product charges stack and replace the store charge once any product sets its own)
- **Free shipping threshold** with cart progress bar
- **Address & checkout:** show upazilla field / allow simple address
- **Advance payment** — collect partial amount upfront

### 2.12 Payment Methods (`/seller/payment-methods`)
- Active: bKash / Nagad / Rocket / Upay / mCash / COD
- Per gateway: payment type (Send Money / Payment / Cash Out), account name, account number, customer instructions, ask-for-customer-phone toggle
- **BUILT-IN ONLINE GATEWAY: bKash Online Payment — AUTOMATIC** (customers pay on bKash and are verified automatically, no manual transaction ID)
- COD with custom customer instructions

---

## 3. What's actually different about their architecture (the key insight)

Bonik's power isn't the block count. It's that **every dimension of the storefront is either **(a)** a saved settings object applied globally, or **(b)** a per-surface editor that writes to a dedicated store.** Concretely:

- **Global theme layer** — one `theme` object (colors, fonts, buttons, corners, shadows) applied everywhere; every editor can override a specific token and fall back to the theme value ("Theme" default shown in every color picker)
- **Per-surface editors** — product page, product card, all-products page, header/footer each get a dedicated editor writing to a dedicated saved artifact
- **Builder** — homepage is its own draft-based editor with 5 saved drafts, publish-to-live
- **Identity layer** — name/logo/colors feed everything else
- **Commerce settings** — delivery, payments, fraud, checkout fields are separate pages feeding the checkout flow
- **Marketing integrations** — one place for GTM/GA4/Clarity/Meta/TikTok pixel IDs, one for socials/contact widget, one for popups/blog/email

DokanOS so far has: theme preset + 4 layouts, brand profile + colors, a sections/page builder (new), collections, product display as variations editor. Missing: the product-page editor, product-card editor, global header/footer editor, shop settings hub, delivery/shipping config, payment methods config, fraud prevention, marketing integrations, landing pages.

---

## 4. How DokanOS storefronts should be organized (the plan)

Adopt Bonik's **one-editor-per-surface** model. Concrete DokanOS structure, reusing what exists and adding the missing editors:

### Route map (all under `/storefronts` in admin, plus `/storefront/:slug/*` runtime)

| Surface | Admin page | Runtime surface | Data store |
|---|---|---|---|
| Identity | `/storefronts` (existing StorefrontsPage → tabs) | Header/footer, favicon | `storefronts` (name/tagline/logo/favicon/color presets) |
| Theme | New: `/storefronts/:slug/theme` | — | `storefront_themes` (or `storefronts.theme_config`) |
| Homepage Builder | `/storefronts/:slug/builder` | `/storefront/:slug` (home) | `storefront_pages` (home) + `storefront_page_sections` + draft slots |
| Header & Footer | `/storefronts/:slug/header-footer` | Header/footer on every page | `storefront_header_config` + `storefront_footer_config` (or one `header_footer` jsonb) |
| Product Page | `/storefronts/:slug/product-page` | `/storefront/:slug/product/:pslug` | `storefront_product_page_config` |
| Product Card | `/storefronts/:slug/product-card` | Cards everywhere | `storefront_card_config` |
| Shop/All Products | `/storefronts/:slug/shop-page` | `/storefront/:slug/shop` | `storefront_shop_config` |
| Landing Pages | `/storefronts/:slug/landing-pages` | `/storefront/:slug/p/:slug` | `storefront_pages` (type=landing) |
| Scroll Animations | `/storefronts/:slug/animations` | Entire storefront | `storefront_animations` |
| Shop Settings (hub) | `/storefronts/:slug/settings` | — | `storefronts.settings` jsonb (policies, checkout fields, fraud, SEO, socials) |
| Delivery & Shipping | `/storefronts/:slug/delivery` | Checkout shipping step | `storefront_delivery_config` |
| Payment Methods | `/storefronts/:slug/payments` | Checkout payment step | `storefront_payment_methods` |

### Shared editor chrome (build once, reuse everywhere)
- Header: context (e.g., "Product Page"), % complete indicator, device toggle (PC / Phone), zoom %, reload preview, open preview in new tab, hide/show settings, **Save + Saved state**
- Preview pane: live iframe rendering the real storefront at the chosen device width, receiving draft config via postMessage
- Left/rail: editor controls grouped into clearly-labeled sections (Layout / Colors / Buttons / Content / Visibility / Behaviour)
- Bottom bar: Reset to defaults, Save

### Phase the work

**P0 — must elevate immediately (Bonik parity baseline):**
1. Adopt the one-surface-one-editor navigation structure exactly (sidebar grouping: Identity → Homepage Builder → Default Theme → Header & Footer → Animations → Landing under STOREFRONT; All Products → Product Page → Card under PRODUCT DISPLAY; settings pages under SETTINGS)
2. **Product Page Layout editor** (highest-leverage missing piece)
3. **Product Card Style editor** (affects every listing surface)
4. **Header & Footer editor** (announcement bar, menus, categories-in-header, contact icons)
5. **All Products Page editor** (columns, per-page, filters, sorting, pagination, price ranges)
6. **Store Identity editor page** (full logo set + light/dark palettes today we only have accent)
7. **Delivery & Shipping page** (charge/label/COD/free-shipping/override-per-product)
8. **Payment Methods page** (based on our checkout)

**P1 — parity plus:**
9. Theme store page (six named themes with preview links)
10. Manage Shop hub (policies editor, checkout fields editor, fraud prevention, SEO/marketing ids, social links)
11. Scroll Animations page
12. Landing Pages (create/list/publish)

**P2 — beyond parity (DokanOS differentiators to layer on top):**
13. Marketplace/vendor mode (Bonik has it, we have POS+Woo — we already win on ops)
14. Mobile-app surface (Bonik has "Your App" + Push; DokanOS could expose storefront-as-PWA settings)
15. Fraud scorer tie-in with our existing `verification` stack

---

## 5. What to reuse vs build

**Reuse from the current build:**
- Draft/publish + preview iframe already exists (from the recent page-builder work) — extract into `src/components/storefront/EditorShell.tsx` so every surface editor gets it
- The sections/block registry (`src/storefront/sections/registry.ts`) — expand to Bonik's 46-block palette; the schema (types + props jsonb) is compatible
- `storefront_pages` + `storefront_page_sections` (already shipped)
- Identity settings partially exist (hero, accent, logo) — pull the rest in (dark presets, tagline, favicon guidance, presets gallery)

**Build new:**
- `EditorShell` + per-surface editor pages: 7 new editors (product page, product card, all-products page, header/footer, all-products, animations, theme store)
- New settings tables or jsonb columns listed in Section 4
- Live preview iframe with a `?previewToken=` param, and a "draft→publish" flow for every surface (currently only the homepage builder has drafts)

**Copy Bonik's safety defaults verbatim:**
- Animations never run on cart/checkout/order-success/track-order + respect prefers-reduced-motion
- Per-product page settings can "Apply to All Products"
- Every editor has Reset to Defaults / Save

---

## 6. TL;DR

Bonik wins not by having more settings but by giving **every visual surface its own editor with a live preview** — identity, theme, homepage, header/footer, product page, product card, shop grid, animations. DokanOS already has the hard parts (sections engine, drafts, publish, RLS, checkout). The work now is **surface-by-surface editors** and the matching settings pages, not new infrastructure.
