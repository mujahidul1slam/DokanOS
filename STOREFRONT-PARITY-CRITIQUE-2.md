# STOREFRONT-PARITY-CRITIQUE-2 — CRITIC review of commit 4512669 (fix cycle R1)

**Verdict: REVISE — 10 actionable findings (1 HIGH, 5 MEDIUM, 4 LOW)**

Scope re-read in full after the fix commit: `settings.ts`, `Shop.tsx`, `Product.tsx`, `Checkout.tsx`, `ProductCard.tsx`, `StorefrontLayout.tsx`, `DeliveryTab.tsx`, `HeaderFooterTab.tsx`, `ShopPageTab.tsx`, `PaymentsTab.tsx`, `animations.ts`, `storefront.css` (animation block), `supabase/functions/storefront-checkout/index.ts`, plus repo-wide greps for every disputed key. Note: **no `Booking.css` exists anywhere in src/ or git history** — that fresh-eyes target does not exist.

## Per-fix verification

| # | Status | Evidence |
|---|--------|----------|
| F1 | RESOLVED | `DeliverySettings.free_threshold` deleted (settings.ts); Checkout.tsx:162 reads only `shippingQuote?.free_threshold || settings.shipping.free_threshold` — both server-fed, single source. |
| F2 | RESOLVED (guard skipped, see L4) | Shop.tsx:70-72 band = `[bands[i], bands[i+1] ?? Infinity)`; labels `৳lo–৳hi` / `৳lo+` (99-103). 6-chip/NaN bugs gone. |
| F3 | RESOLVED | Shop.tsx:77-87 sorts `filtered` first, slices after. |
| F4 | PARTIAL — HIGH residue | See N1 below. |
| F5 | PARTIAL | COD toggle, free-shipping slider, non-refundable, per-product, simple-address rows all removed; pointer note to Payments/Settings is accurate (PaymentsTab/`checkout.methods.cod` verified). But `default_charge` + `default_label` inputs remain editable (DeliveryTab.tsx:40-51) with copy claiming they apply — still zero readers anywhere in `src/` or `supabase/` (grep-verified). |
| F6 | RESOLVED (one residue, L5) | Fake rating, wishlist (card + product page), sold-count removed. size-chart / compare-at / sku now gated on data — but those fields are never selected in catalog.ts (`sku` not in any `select()`), so the toggles are inert; acceptable as "gated", listed as L5 for cleanup. |
| F7 | RESOLVED | Product.tsx:324-325 — `PHONE_COLS`/`PC_COLS` literal records; Tailwind compiles them. |
| F8 | NOT FIXED | See N2 below. |
| F9 | PARTIAL | Page reset on band change landed (Shop.tsx:43-45). `pagination === "load-more"` still renders only prev/next (208-246); ShopPageTab.tsx:132 still offers "Load more button". |
| F10 | RESOLVED | StorefrontLayout.tsx:21,56-61 — single source `settings.announcement`; header.* fields deleted from type+defaults; HeaderFooterTab shows pointer note; SettingsTab untouched owner. |
| F11 | NOT FIXED | See N3 below. |
| F12 | NOT FIXED | See N4 below. |
| F13 | RESOLVED | Admin shows disabled switch + honest "Not rendered yet" note (HeaderFooterTab.tsx:54-61); storefront renders nothing (layout block deleted). |
| F14 | RESOLVED | Search icon + `show_search` gone from runtime, admin, type, defaults. |
| F15 | RESOLVED | StorefrontLayout.tsx:19 — `useMemo(() => mergeSettings(...), [storefront.settings])`. |
| F16 | NOT FIXED | HeaderFooterTab.tsx:13 keeps `["Phone","WhatsApp","Messenger","Mail"]`; layout still maps everything non-"Phone" to `MessageCircle` (StorefrontLayout.tsx:114) and force-opens `tel:` links in a new tab (`target="_blank"`, line 113). Claimed "Phone vs Chat" relabel absent. |
| F17 | NOT FIXED | index.ts:80-82 unchanged — legacy `checkout.enabled_payment_methods` array still outranks the `methods` map; mergeSettings still strips it. Same LOW behavior-flip hazard as cycle 1. |

**Score: RESOLVED 9 · PARTIAL 3 (F4, F5, F9) · NOT 5 (F8, F11, F12, F16, F17)**

## Remaining + new findings

### N1 (HIGH, F4 residue) — Advance payment is client-theatre; the edge fn ignores it and the courier collects ৳0
`Checkout.tsx:229-238` now sends `payment.advance_amount` / `advance_due_on_delivery`, and the sidebar box + COD-blocking toast landed. But `storefront-checkout/index.ts` was untouched: the `CheckoutBody.payment` type has no advance fields, nothing reads them, and `amount_to_collect: paymentMethod === "cod" ? total : 0` (line 242). Advance flow = wallet payment → order records the **full** total as `pending_verification` with `amount_to_collect: 0`. The shopper was promised "Pay ৳X now, ৳Y on delivery"; the courier is instructed to collect **nothing**; the merchant's verified-payment check compares the trx against the full total, not the advance. The store silently loses Y on every advance order.
Client-side residue: `advanceAllowed` (Checkout.tsx:171) is computed and never used; because `advanceEnabled` no longer excludes COD, selecting COD renders the sidebar box "Pay now (COD) ৳X / On delivery ৳Y" and the order total stays full — only a submit-time toast blocks it.
**Fix**: edge fn must read `delivery.advance_payment_enabled/percent` server-side, recompute the advance itself (never trust the client amount), set `amount_to_collect = total - advance` and record both figures in `payment_meta`; reject COD when advance is enabled. Client: hide/disable the COD option when advance is on and gate the sidebar box on the wallet branch (use `advanceAllowed`).

### N2 (MEDIUM, F8) — Buy Now still breaks on solid + blank color
Product.tsx:277-278 unchanged: `buy_fill === "solid"` contributes class `""` and inline `background: sp.buy_color || undefined` → transparent, unstyled primary CTA when the merchant leaves color blank (admin copy says "blank = accent"). `fillCls()` exists one line up and is only wired to ATC.
**Fix**: give the solid branch `bg-primary text-primary-foreground hover:opacity-90` as the class fallback; keep inline style only as override.

### N3 (MEDIUM, F11) — Cascade is still inert end-to-end; admin preview unchanged
CSS parent rule updated at some point (`[data-sf-anim-cascade].sf-anim-in > *`, storefront.css:263), but (a) no element in `src/` carries `data-sf-anim-cascade`, (b) `useScrollAnimations` scans only `[data-sf-anim]` (animations.ts:54) so no cascade container ever receives `.sf-anim-in`, and (c) the AnimationsTab preview is unchanged and still gated behind `html[data-sf-anim-root]`, which admin never sets — merchants still pick effects blind. The cascade toggle + gap slider write settings nothing reads.
**Fix**: apply `data-sf-anim-cascade` + `data-sf-anim` semantics to the shop/related grids when `a.cascade` is on (extend the scan selector to include `[data-sf-anim-cascade]`), or delete the toggle; add unprefixed keyframe CSS for the admin preview.

### N4 (MEDIUM, F12) — Footer still renders external links as router Links
StorefrontLayout.tsx:204-208: the "Shop" footer column maps the **same `nav` array** the header builds — including external `custom_links` and external nav rows — into `<Link to="https://wa.me/…">`. `isExternal` is used in desktop nav (94) and mobile menu (146) but not the footer. Clicking an external footer link navigates to a garbage in-app route.
**Fix**: branch on `isExternal` in the footer map, same as the header.

### N5 (MEDIUM, new) — Shop page injects a global `.grid` stylesheet that restyles the layout footer
Shop.tsx:201: `<style>{`@media (min-width:1024px){ .grid { grid-template-columns: repeat(${shop.columns_pc}, minmax(0,1fr)) !important; } }`}</style>`. The selector is unscoped — at ≥1024px it overrides **every** `.grid` on the page via `!important`, including StorefrontLayout's footer (`grid md:grid-cols-3`, line 178). Footer's 3 columns collapse into the shop's product column count (e.g. 4-5) on the shop page; any future `.grid` child on that page inherits it too.
**Fix**: give the product grid a dedicated class (e.g. `sf-shop-grid`) and target that in both the base style and the media query.

### N6 (MEDIUM, F5 residue) — `default_charge` / `default_label` remain editable dead fields
DeliveryTab.tsx:40-51 keeps both inputs with copy "Applied when no zone/product-specific charge overrides it." Grep across `src/` + `supabase/`: zero readers — checkout hardcodes `shippingQuote?.rate ?? 150` and the shipping-quote fn never touches them. A merchant edits the charge, saves, nothing changes.
**Fix**: remove the card (or make it an informational pointer to wherever shipping rates actually live), and delete the keys from `StorefrontDeliverySettings`/defaults.

### N7 (LOW, F16) — see table; icon choices/glyphs/`tel:` + `_blank` unchanged.

### N8 (LOW, F17) — see table; array-over-map precedence unchanged in index.ts:80-82.

### N9 (LOW, F9 residue) — "load-more" pagination option still selectable, still unimplemented (ShopPageTab.tsx:132 → Shop.tsx renders plain prev/next). Remove the option or implement append.

### N10 (LOW, new) — Price-band input not normalized for order
ShopPageTab.tsx:113 parses the comma list but never sorts; "5000, 100" persists as `[5000,100]` → chips render "৳5000–৳100" (can match nothing) then "৳100+" (actually 100–∞). Cycle-1's guard note unaddressed. One-line fix: `.sort((a, b) => a - b)` before set.

### Cleanup note (no action required for convergence)
- `show_category_label` now renders the permanent literal string "Product" (Product.tsx:189-193) — a toggle named "Category label" that can only ever say "Product". Recommend removing the toggle next pass.
- `show_sku` reads `(p as any).sku`; `sku` is in no catalog select → toggle can never display. Same class of dead toggle as F6's cleared items.
- `advanceAllowed` unused (noUnusedLocals is off, so no build break).

---
Checked and cleared this cycle: F1, F2(core), F3, F6(core), F7, F10, F13, F14, F15 — verified landed as claimed; no regressions found in the touched hunks (button-window pagination math correct for totalPages<7 and >7; band filter `[lo,hi)` semantics consistent; Payments/Settings tabs both writing `checkout.methods` rebase safely).
