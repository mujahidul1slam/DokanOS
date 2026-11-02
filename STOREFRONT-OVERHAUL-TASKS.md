# DokanOS Storefront Overhaul — Task List (canonical)

Source: user audit (image transcription). Execute top-to-bottom; verifier agent must confirm every item before development ends.

## 1. Critical Bug Fixes & State Management
- [ ] 1.1 Checkout order submission returns non-200 — audit payload validation, inventory checks, payment handshake, order-creation transaction; must return 200 with order confirmation payload.
- [ ] 1.2 Page editor re-renders / loses focus on every keystroke in section text fields — debounce text state, isolate local input state from canvas state, memoize section components.
- [ ] 1.3 Live preview broken for theme previews, page previews, homepage builder — re-architect preview comms (postMessage / shared iframe state); deterministic draft rendering without full reloads.

## 2. Navigation, Admin Consolidation & Brand Architecture
- [ ] 2.1 Remove the detached/hidden storefront admin panel. "Storefronts" in the main sidebar renders the unified Storefront management view INSIDE the main app shell (AppSidebar visible), keeping the ergonomic sub-sidebar layout.
- [ ] 2.2 Brand model: brand = root container; every storefront must explicitly belong to a brand and inherit its parameters; remove standalone storefront wrappers.

## 3. Page Builder & Pages Routing Overhaul
- [ ] 3.1 Pages list = clean list + Edit button. Content page → standard editor. System/theme page (Home, Shop, Cart, Product) → visual site panel editor for that template.
- [ ] 3.2 Drag-and-drop visual builder: left drawer (draggable component registry: hero, product grid, slider, testimonials, rich text, FAQ, spacer/divider + inspection controls), right canvas (real-time interactive preview).
- [ ] 3.3 Storefront creation auto-generates essential pages (Home, Shop, Cart, Checkout, Contact) per selected theme. Landing-page creator (standalone, no header/footer). AI page generation (prompt → section layout + copy).

## 4. Theme Engine & Industry Presets
- [ ] 4.1 Niche layout templates, not just color swaps: Digital Goods, Electronics & Gadgets, Fashion & Apparel, Food & Grocery — each with distinct layout blueprint + typography.
- [ ] 4.2 Theme/token customizer: font families (headings vs body), granular color tokens (primary/secondary/surface/text/muted/border/accent), corner radius, card shadows, container widths.

## 5. Checkout Field Manager & Settings Deduplication
- [ ] 5.1 Checkout customization: toggle default fields (Company, Address 2, Postal Code); regional delivery presets (Inside/Outside Dhaka) with dependent city/district requirements.
- [ ] 5.2 Settings audit: single source of truth; remove theme/styling from Identity tab; groups = Identity, Theme & Styling, Checkout & Shipping, Domains, General.

## 6. Storefront Health Dashboard
- [ ] 6.1 /storefront/health diagnostics: uptime/HTTP status, Core Web Vitals (TTFB, LCP, CLS, INP), page load speed, image asset payload, missing assets/404 links, broken checkout flags.

## Done-when
Verifier agent checks frontend + backend for every item above; development ends only when all items verified fixed. Otherwise loop: do → verify → fix.
