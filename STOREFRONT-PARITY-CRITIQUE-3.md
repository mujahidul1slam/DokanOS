REVISE — 7 actionable findings

# CRITIC — Cycle 3 (final pass)

Scope: verify the 10 cycle-2 fixes landed; final sweep of the 9 touched files. Verified by direct file reads, TS typecheck (`tsc --noEmit` — clean), and targeted ESLint (`no-unused-vars`).

## HIGH

None.

## MEDIUM

### C3-F1 — Shop.tsx — "Newest" sort does not sort by newness
- **File:** `src/storefront/pages/Shop.tsx:82` + `src/storefront/lib/catalog.ts:68-76`
- **Defect:** `sort === "newest"` orders by `position` descending. But `listStorefrontProducts` never selects `created_at`: for store-linked storefronts (primary path) the query orders by `is_featured` desc, `sales_count` desc, then assigns `position` = array index (catalog.ts:76); for the curated path `position` is the merchant's manual curation order. So "Newest" = reverse of featured/sales ranking (or reverse curation) — provably unrelated to product recency. User-facing mislabeled behavior.
- **Evidence:** Shop.tsx:82 `else if (sort === "newest") list.sort((a, b) => (b.position ?? 0) - (a.position ?? 0));` — catalog.ts:70 select list contains no `created_at`; catalog.ts:76 `mapProduct(p, { position: i })`.
- **Required fix:** add `created_at` to both product selects in catalog.ts, extend `StorefrontProduct` with `created_at`, and in Shop.tsx sort `"newest"` by `created_at` desc (fallback `position`).

## LOW

### C3-F2 — ProductCard.tsx — unused `Heart` import (residue of wishlist removal)
- **File:** `src/storefront/components/ProductCard.tsx:2`
- **Defect:** `Heart` imported but never referenced after the wishlist button was deleted.
- **Evidence:** ESLint `2:46 'Heart' is defined but never used`; grep of file body shows 0 `Heart` usages outside the import.
- **Required fix:** remove `Heart` from the lucide-react import.

### C3-F3 — DeliveryTab.tsx — unused `Slider` import (residue of free-shipping slider removal)
- **File:** `src/components/storefront-admin/DeliveryTab.tsx:8`
- **Defect:** `Slider` imported but never used after the slider was removed per cycle-2 item 7.
- **Evidence:** ESLint `8:10 'Slider' is defined but never used`; grep shows 0 usages outside the import.
- **Required fix:** delete line 8.

### C3-F4 — AnimationsTab.tsx — unused Select imports
- **File:** `src/components/storefront-admin/AnimationsTab.tsx:7`
- **Defect:** `Select, SelectContent, SelectItem, SelectTrigger, SelectValue` imported, none used.
- **Evidence:** ESLint 5 × `no-unused-vars` errors at line 7.
- **Required fix:** remove the Select import line.

### C3-F5 — Product.tsx — unused `ParsedAttr`, unused `loc`, expression-statement in handleShare
- **File:** `src/storefront/pages/Product.tsx:8, 25, 132`
- **Defect:** `type ParsedAttr` imported but never used; `const loc = useLocation()` assigned but never read; line 132 `(await navigator.clipboard?.writeText(url).catch(...)) || undefined;` is an expression statement (lint error, works but sloppy).
- **Evidence:** ESLint `8:63`, `25:9`, `132:5 no-unused-expressions`.
- **Required fix:** drop `ParsedAttr` from the import; delete line 25; rewrite handleShare as `try { await navigator.clipboard?.writeText(url); } catch {}` then toast.

### C3-F6 — settings.ts — unused `base` local in mergeSettings
- **File:** `src/storefront/lib/settings.ts:285`
- **Defect:** `const base = DEFAULT_STOREFRONT_SETTINGS;` never read (function builds the result object literally).
- **Evidence:** ESLint `285:9 'base' is assigned a value but never used`.
- **Required fix:** delete line 285 (or use `base` if spread was intended — verify against intent).

### C3-F7 — storefront-checkout — `advance_percent` never range-clamped server-side
- **File:** `supabase/functions/storefront-checkout/index.ts:209-211` (also `src/storefront/lib/settings.ts` validate, `DeliveryTab.tsx:91`)
- **Defect:** Server trusts `settings.delivery.advance_percent` with only a `> 0` gate. Nothing clamps it to ≤100 anywhere: DeliveryTab relies on `Input max={50}` (not enforced for typed input) and `validateStorefrontSettings` has no advance checks. A saved value >100 yields `serverAdvanceAmount > total` → negative `amount_to_collect`.
- **Evidence:** checkout:209-211 computes without clamp; settings.ts:347-351 validate covers only min_order/free_threshold/per_page; DeliveryTab:91 plain number Input.
- **Required fix:** clamp at compute time (`Math.min(100, Math.max(0, pct))`) and add a bounds rule to `validateStorefrontSettings` (0–100).

---

## Cycle-2 resolution table

| # | Cycle-2 item | Verdict | Evidence |
|---|---|---|---|
| 1 | Advance payment validated server-side; amount_to_collect = total − advance; COD blocked when advance required | RESOLVED | checkout/index.ts:209-221 (enabled check, COD 400 at 214-216, client/server mismatch 400 at 217-219, due-on-delivery 221, `amount_to_collect` 261) |
| 2 | No free_threshold duplication in delivery; shipping is single source | RESOLVED | settings.ts — free_threshold only at type:144, merge:294, default:329, validate:350; StorefrontDeliverySettings (106-117) has none |
| 3 | Shop.tsx: sort full filtered list before pagination; band reset; .sf-shop-grid scoping; JSX structure | RESOLVED | Shop.tsx: filter 60-75 → sort 77-84 → paginate 86-87; band reset 43-45; scoped grid style 195-199 (no global `.grid`); `tsc --noEmit` clean |
| 4 | Product.tsx Buy Now fillCls fallback; dead wishlist/rating/sold blocks removed | RESOLVED | Product.tsx:279 `fillCls(sp.buy_fill)` + style override 280; zero grep hits for wishlist/rating/sold/★ outside intended UI |
| 5 | ProductCard.tsx: no fake ★ rating, no dead wishlist button | RESOLVED | Full read: no rating/wishlist render; residue tracked as C3-F2 (unused import only) |
| 6 | StorefrontLayout: memoized mergeSettings, footer external links, announcement from settings only | RESOLVED | StorefrontLayout.tsx:19 useMemo; 46/93-97/149-152/207-211 isExternal handling incl. footer; 56-61 announcement = settings.announcement |
| 7 | DeliveryTab: free-shipping slider removed, cross-referenced | RESOLVED | DeliveryTab.tsx:58-61 pointer text to Settings → Shipping; slider UI gone; residue tracked as C3-F3 (unused import) |
| 8 | animations.ts observer covers [data-sf-anim] AND [data-sf-anim-cascade] | RESOLVED | animations.ts:57 combined selector; MutationObserver re-scan 72-73 |
| 9 | AnimationsTab preview tiles render with keyframe names wired | RESOLVED | AnimationsTab.tsx:40/207 `animationName: pre-${effect}`; keyframes 94-104; replay via key/tick |
| 10 | Final scan for remaining functional bugs | DONE | 1 MEDIUM (C3-F1 newest sort), 6 LOW (dead imports/locals, unclamped advance percent) found above |

**Cycle 2 tally: RESOLVED: 10, PARTIALLY: 0, NOT: 0**

Typecheck: `tsc --noEmit -p tsconfig.app.json` — clean. Default ESLint run shows only pre-existing `no-explicit-any` style errors (project-wide pattern, not cycle-2 regressions).
