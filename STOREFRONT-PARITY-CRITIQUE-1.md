# STOREFRONT-PARITY-CRITIQUE-1 — CRITIC review of commit 4633010

**Verdict: REVISE — 17 actionable findings (6 HIGH, 9 MEDIUM, 2 LOW)**

Scope read in full: all 7 new tabs (`CardStyleTab`, `ProductPageTab`, `ShopPageTab`, `HeaderFooterTab`, `AnimationsTab`, `DeliveryTab`, `PaymentsTab`), `src/storefront/lib/settings.ts`, runtime consumers (`ProductCard.tsx`, `Product.tsx`, `Shop.tsx`, `StorefrontLayout.tsx`, `Checkout.tsx`), `src/storefront/lib/animations.ts` + `storefront.css` animation block, `supabase/functions/storefront-checkout/index.ts`, plus cross-reference greps for every new settings key.

## HIGH

### F1 — Checkout free-shipping threshold is split-brained across two settings keys (client/server disagree on the charge)
- **Files**: `src/storefront/pages/Checkout.tsx:162`, `src/components/storefront-admin/DeliveryTab.tsx:104`, `supabase/functions/storefront-checkout/index.ts:193`, `supabase/functions/storefront-shipping-quote/index.ts:62`
- **What's wrong**: The Delivery tab edits `delivery.free_threshold`, and the checkout client prefers it (`delivery.free_threshold > 0 ? delivery.free_threshold : ...shipping.free_threshold`). But the order-time edge fn and the shipping-quote fn read **only** `settings.shipping.free_threshold` (edited in SettingsTab). `settings.ts:120` comments "duplicated with shipping.free_threshold; kept in sync there" — nothing syncs them. Merchant sets threshold in the Delivery tab → shopper sees "Free" shipping and a "Free" total, and the server **charges shipping anyway**. Displayed total ≠ charged total.
- **Fix**: Single source of truth: on DeliveryTab save, also write `shipping.free_threshold = d.free_threshold` (and drop the client-side prefer-delivery branch), or make the edge fn read `delivery.free_threshold` too. Do not keep both keys live.

### F2 — Shop price-band chips are broken at both ends (garbage label + NaN filter)
- **File**: `src/storefront/pages/Shop.tsx:96-104` (labels) and `65-70` (filter)
- **What's wrong**: Label loop runs `i <= price_bands.length`. With default `[0,500,1000,2000,5000]` it renders **6** chips: first is `৳0–৳0` (i=0: `lo=0, hi=bands[0]=0`), last is `৳5000–৳undefined`. The filter at i=5 computes `high = Number(bands[5]) = NaN`, so `p.price <= NaN` is always false → selecting the "5k+" band shows **zero products**. The i=0 chip matches only price==0.
- **Fix**: Ranges should be bands[i]→bands[i+1], last open-ended: labels `hi = i === bands.length ? "+" : bands[i]`, filter `high = i === bands.length ? Infinity : bands[i]`, and start the loop so the first chip is `0–500` not `0–0`. Also guard against unsorted band input (admin accepts any comma list; unsorted edges produce empty/degenerate ranges).

### F3 — Shop sorting sorts only the current page, not the result set
- **File**: `src/storefront/pages/Shop.tsx:74-85`
- **What's wrong**: `filtered` is sliced into `paged` (page N's 12 items) and *then* `sorted` sorts that slice. "Price: Low to High" reorders within the current page only — page 1 is not actually the 12 cheapest products. Any sort besides "Featured" is materially wrong.
- **Fix**: Sort `filtered` first, then slice for pagination.

### F4 — "Advance payment" is a dead setting with money semantics
- **Files**: `src/components/storefront-admin/DeliveryTab.tsx:130-147`, `src/storefront/pages/Checkout.tsx:168-170`, `supabase/functions/storefront-checkout/index.ts` (no advance handling; `amount_to_collect: total` for COD, `0` otherwise)
- **What's wrong**: Merchant enables advance payment and a percent; client computes `advanceAmount`/`amountDueOnDelivery` but **never renders them** (no JSX usage), and the edge fn ignores the setting entirely — wallet orders stay `pending_verification` for the stated amount logic and COD collects the full total. The feature the merchant configured silently does not exist.
- **Fix**: Render the advance breakdown in the checkout summary, pass it in the payload, and enforce/record it server-side — or remove the toggle until implemented.

### F5 — DeliveryTab ships dead and self-contradicting controls (incl. a COD toggle checkout ignores)
- **Files**: `src/components/storefront-admin/DeliveryTab.tsx`, `src/storefront/pages/Checkout.tsx:320-328`
- **What's wrong** (verified by repo-wide grep — these keys are written but never read): `default_charge`, `default_label`, `per_product`, `non_refundable`, `simple_address`, and `delivery.cod_instructions`. Worse, `cod_enabled` actively contradicts the real COD control: checkout visibility/enforcement is driven solely by `checkout.methods.cod` (Payments/Settings tabs), so disabling "Allow COD" in the Delivery tab leaves COD fully active at checkout. There are also two COD-instruction fields (`delivery.cod_instructions` unused vs `payments.cod.instructions` shown). The "progress bar in cart" the tab promises for the free-shipping slider does not exist (Cart.tsx has no threshold UI).
- **Fix**: Wire `delivery.cod_enabled` to `checkout.methods.cod` (single COD toggle), delete or implement the unread fields, and drop the progress-bar claim or build it.

### F6 — Toggles that render fabricated or dead shopper-facing UI
- **Files**: `src/storefront/components/ProductCard.tsx:94-102,135-140`, `src/storefront/pages/Product.tsx:189-217,246-250,303-307`, `src/storefront/lib/catalog.ts:12-27`
- **What's wrong**:
  - `show_rating` renders hardcoded `★★★★☆ (0)` — fabricated social proof shown to real shoppers.
  - `show_wishlist` (card heart + product-page "♡ Wishlist" link) has no handler — click does nothing (bare `preventDefault`).
  - `show_sold_count`, `show_category_label`, `show_size_chart`, and the `compare_at_price` price-breakdown read `(p as any).sold_count / .category / .size_chart_url / .compare_at_price`, none of which exist on `StorefrontProduct` or in its query — these toggles can never display anything (category falls back to the literal word "Product").
- **Fix**: Remove the rating/wishlist affordances until backed by data; delete or gate the sold_count/category/size-chart/compare-at toggles on fields that are actually selected. Never ship a hardcoded 4-star readout.

## MEDIUM

### F7 — Related-products phone columns use an uncompilable dynamic Tailwind class
- **File**: `src/storefront/pages/Product.tsx:338` — `` `grid grid-cols-${sp.related_per_row_phone}` ``
- **What's wrong**: Tailwind scans literal strings; `grid-cols-1` and `grid-cols-3` appear nowhere literally in `src/`, so selecting 1 or 3 columns on phone emits a class that doesn't exist in the built CSS → grid collapses to a single column. (`grid-cols-2` works only coincidentally because Home/sections use it literally.)
- **Fix**: Map the number to literal classes, as `colsCls` already does for desktop (`1 → grid-cols-1`, `2 → grid-cols-2`, `3 → grid-cols-3`).

### F8 — Buy Now button breaks when fill = "solid" with blank color
- **File**: `src/storefront/pages/Product.tsx:277-284`
- **What's wrong**: For `buy_fill === "solid"` the className contributes no background class and the inline style is `background: buy_color || undefined` — but ProductPageTab's field says "blank = accent". Choosing Solid and leaving color blank yields a transparent, unstyled primary CTA. The ATC button beside it handles this correctly via `fillCls()` (`bg-primary` fallback).
- **Fix**: Give the solid branch the same `bg-primary text-primary-foreground hover:opacity-90` class fallback; keep inline override only when a color is set.

### F9 — "Load more" pagination style is unimplemented; page index not reset on filter change
- **File**: `src/storefront/pages/Shop.tsx:209-247`, `:29`
- **What's wrong**: The pagination block renders Previous/Next plus conditional button-window (`buttons`) or "Page x of y" (`numbers`); `pagination === "load-more"` renders just prev/next arrows — the admin-chosen style silently does nothing. Separately, `setActivePriceBand` does not `setPage(1)`: apply a band while on a later page and the slice is empty → false "No products match these filters" with the pager hidden.
- **Fix**: Implement a real load-more (append pages) or drop the option; reset `page` to 1 when `activePriceBand` changes.

### F10 — Two competing announcement sources; new toggle can silently kill an existing banner
- **Files**: `src/storefront/components/StorefrontLayout.tsx:55-61`, `src/components/storefront-admin/HeaderFooterTab.tsx` vs `SettingsTab.tsx:105-125`, `settings.ts` (`header.show_announcement/announcement_text` vs legacy `announcement.enabled/text`)
- **What's wrong**: Two independent announcement configs exist. Effective-banner logic prefers `header.*` whenever `show_announcement` is true — including when `announcement_text` is empty — so a merchant with a live legacy announcement who flips the new toggle on (before typing text) sees the bar disappear. Nothing in either tab tells the merchant the other source exists.
- **Fix**: Pick one source (recommend `header.*`), migrate legacy values into it on first merge, and delete the SettingsTab announcement block.

### F11 — AnimationsTab preview is inert; "Cascade product cards" toggle is dead
- **Files**: `src/components/storefront-admin/AnimationsTab.tsx:43,192`, `src/storefront/lib/animations.ts`, `src/storefront/themes/storefront.css:226-287`
- **What's wrong**: (a) The tile/demo previews use `sf-anim-bg`/`sf-anim-demo` classes and `data-effect` hooks, but every animation rule in storefront.css is gated behind `html[data-sf-anim-root]` — which is only set inside the storefront runtime. In the admin app the attribute is never set, so clicking tiles / Replay shows a static box; merchants choose effects blind. (b) The cascade toggle writes `a.cascade`, but the runtime never reads it and no element anywhere carries `data-sf-anim-cascade` (grep: only the CSS comment block + stylesheet) — the toggle and its gap slider change nothing.
- **Fix**: Add standalone, unprefixed keyframe CSS for the admin previews; apply `data-sf-anim-cascade` to the shop/related grids when `cascade` is on (and observe those containers), or remove the toggle.

### F12 — Footer renders external custom links as react-router `<Link>` → broken navigation
- **File**: `src/storefront/components/StorefrontLayout.tsx:222-227`
- **What's wrong**: The header nav correctly branches on `isExternal(`)` to use `<a href>`, but the footer's "Shop" column wraps the same `nav` array — including external `custom_links` (e.g. an `https://wa.me/...` custom menu link) — in `<Link to>`. React Router treats those as internal paths and navigates to a garbage in-app route.
- **Fix**: Reuse the same `isExternal` branch in the footer.

### F13 — "Dark mode toggle" has no dark styles to switch to
- **Files**: `src/storefront/components/StorefrontLayout.tsx:117-130`, `src/storefront/themes/storefront.css`, grep `dark:` across `src/storefront`
- **What's wrong**: The toggle flips `.dark` on `<html>`, but the storefront theme is driven by `data-theme`/`sf-*` custom CSS — the only `dark:` classes in the entire storefront are the toggle's own sun/moon icons. Shoppers click it and nothing changes; the admin promises "Let shoppers switch light/dark".
- **Fix**: Implement an actual dark token set for the storefront, or remove the toggle.

### F14 — "Store search" toggle renders a fake affordance
- **File**: `src/storefront/components/StorefrontLayout.tsx:112-116`
- **What's wrong**: `show_search` renders a magnifier icon that is a plain link to `/shop`. No search input, overlay, or query param exists anywhere in the storefront. Shoppers clicking "search" just reload the catalog they were already browsing.
- **Fix**: Remove the icon until search exists, or wire it to a real search UI.

### F15 — Animation runtime torn down and rebuilt on every layout render
- **Files**: `src/storefront/components/StorefrontLayout.tsx:19-20`, `src/storefront/lib/animations.ts:29-79`
- **What's wrong**: `mergeSettings(storefront.settings)` runs inline (no `useMemo`), so `settings.animations` is a new object identity on every render; `useScrollAnimations` has `[a, loc.pathname]` deps, so each render disconnects the IntersectionObserver + MutationObserver, strips `data-sf-observed` from the whole DOM, and re-runs a full `querySelectorAll` scan — on cart-count changes, menu toggles, any state update. Continuous DOM-wide churn on exactly the low-end phones the feature is meant to protect.
- **Fix**: `const settings = useMemo(() => mergeSettings(storefront.settings), [storefront.settings])` in StorefrontLayout (same pattern Product/Checkout already use).

## LOW

### F16 — Custom header icons mislabel their glyph; phone links open a new tab
- **Files**: `src/components/storefront-admin/HeaderFooterTab.tsx:37-40`, `src/storefront/components/StorefrontLayout.tsx:131-135`
- **What's wrong**: Admin offers Phone/WhatsApp/Messenger/Mail, but both the admin preview and the header render `MessageCircle` for everything except "Phone". A "Mail" or "WhatsApp" icon shows a generic chat bubble. All icons also get `target="_blank"` — including `tel:` hrefs, which should not open a new tab.
- **Fix**: Map each choice to a real glyph (or trim choices to Phone + chat), and only force `_blank` for http(s) links.

### F17 — Legacy `enabled_payment_methods` array silently outranks the methods map, then gets stripped on save
- **Files**: `supabase/functions/storefront-checkout/index.ts:79-85`, `src/storefront/lib/settings.ts:301-307`
- **What's wrong**: The edge fn prefers `checkout.enabled_payment_methods` when present, but nothing in the app writes that array and `mergeSettings()` drops it — so for any row that carries it, admin edits to the methods map have no effect server-side until some other tab save silently deletes the array (behavior flips with no warning). Only reachable for rows written outside this codebase, hence LOW.
- **Fix**: Delete the array branch (the map is the written format) or have mergeSettings preserve it until removal.

---

## Checked and cleared (no defect)

- **Edge-fn default path (the flagged regression risk)**: NOT a regression. With `settings={}`, `methodsMap={}` → `enabledMethods=[]`, and the enforcement is guarded by `enabledMethods.length > 0` (`index.ts:83`), so unmigrated shops keep checking out. New default is *more* permissive than before (all methods allowed instead of cod/bkash/nagad), but the client only offers admin-enabled methods, so no checkout break.
- **`pick()` in `mergeSettings`**: handles shape mismatches acceptably — arrays only pass through when the default is an array, objects walk default keys, enum garbage degrades to safe fallbacks in the runtime ternaries. NaN cannot arrive via JSON. `validateSettings` still gates `per_page` on SettingsTab saves.
- **Tab `save()` / store-switch**: `sf.id` always exists (editor only renders for a loaded storefront); every new tab re-inits state via `useEffect([sf])`, and saves rebase onto `mergeSettings(sf.settings)` then overwrite only their own group — no cross-tab clobbering of `checkout.methods` vs `payments` (PaymentsTab explicitly spreads `prev.checkout` before writing).
- **Dark patterns not found**: all new Save buttons have `disabled={saving}`; PaymentsTab blocks saving with zero methods enabled; overlay card buttons `preventDefault` correctly.
