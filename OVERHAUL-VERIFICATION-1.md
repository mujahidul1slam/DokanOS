# OVERHAUL-VERIFICATION-1.md — DokanOS Storefront Overhaul

**GAPS FOUND — 13 of 14 verified** (3.3 PARTIAL: landing pages still render storefront header/footer)

Verification pass: every item checked against actual code (frontend + backend), file:line evidence. Paths adjusted to real locations where the task file used shorthand (Home.tsx, lib/pages.ts, settings.ts live under `src/storefront/`).

---

## 1.1 Checkout non-200 — **PASS**
- **Product gating mirrors lib/catalog.ts** (junction OR store-linked): `supabase/functions/storefront-checkout/index.ts:98-122` — builds `allowedSet` from `storefront_products` junction (99-103), adds store-linked catalog products `products.store_id = sf.store_id AND is_active` (107-116), rejects unknown ids with 400 (118-122). Header comment 90-97 documents the old junction-only bug. Mirror confirmed in `src/storefront/lib/catalog.ts:61-93` (`listStorefrontProducts` same two-source logic).
- **manage_stock=false skips stock accounting**: `supabase/migrations/20260925000000_checkout_rpc_manage_stock.sql` — Case A location FIFO only when `manage_stock` (232), direct decrements gated `(NOT manage_stock OR stock_quantity >= v_qty)` (294, 361, 373), validation still gated (217, 223). Header 13-16 states accounting skip + validation preserved.
- **Live**: verified by orchestrator (order EE-4269W, dedupe + stock untouched) — code does not contradict.

## 1.2 Keystroke re-render — **PASS**
- `src/components/storefront-admin/PagesTab.tsx` `PropForm` (310): local `useState` draft (320 `dirtyRef`, 325 `draftRef.current = draft`), 600ms debounce (355 `setTimeout(flush, 600)`), flush on unmount via cleanup effect (335-342, captures refs), adopts server state only when not dirty (344-347).
- Inputs bind to draft, not value: 449, 452 (`value={draft[field.key]}`), 457, 472 (select).

## 1.3 Live preview — **PASS**
- `src/pages/StorefrontPreviewSurface.tsx`: message listener (53-69: `preview-storefront` 57, `preview-refresh` 60, `preview-ping` 62), ack handshake (63, 69 `preview-ack`), `refreshKey` remount (40, 85 `<SurfaceFrame key={refreshKey}>`).
- `src/components/storefront-admin/EditorPage.tsx`: postMessage to iframe (35) with retry until ack (39, max ~15s; ack listener 23-26); no reload (doc comment 8-11, 74 "no reload needed").
- Home reads `draftPageSlug` from BrandContext: `src/storefront/pages/Home.tsx:47` (useBrand destructure), 61-69 (`getDraftPage(storefront.id, draftPageSlug)`); provider wires it at `src/storefront/BrandContext.tsx:167`. (Task file said `src/pages/Home.tsx`; real file is `src/storefront/pages/Home.tsx`.)

## 2.1 Admin unified — **PASS**
- `src/App.tsx`: all 20 admin routes (158-178) render INSIDE `<DashboardLayout>` (141-186; comment 137-139 "storefront admin panel (2.1) now lives INSIDE this shell as an in-content panel"). Main sidebar `Storefronts` item exists (`src/components/AppSidebar.tsx:66`).
- `src/components/storefront-admin/StorefrontAdminShell.tsx:131`: in-content panel `flex h-[calc(100vh-7rem)] min-h-[32rem] rounded-xl border border-border` — no min-h-screen full-bleed. Sub-sidebar (grouped nav) preserved (132-178).
- Cosmetic nit (not a functional gap): stale comment at App.tsx:93-94 still says "admin shell routes live outside DashboardLayout" — the wrapper is real (Suspense boundary, 99-109) and routes are inside.

## 2.2 Brand model — **PASS**
- `supabase/migrations/20260925130000_storefront_brand_link.sql`: `ADD COLUMN IF NOT EXISTS brand_id uuid REFERENCES public.brands(id) ON DELETE SET NULL` (11), index (13), column comment (15).
- `src/pages/StorefrontsPage.tsx` `CreateStorefrontDialog` (232): auto-creates brand under active business — `useBusinessContext` (233), inserts into `brands` with `business_id` (275-278), links via `brand_id: brandId` (291).

## 3.1 Pages list — **PASS**
- `src/components/storefront-admin/PagesTab.tsx`: rows have Edit buttons (226-229 for system pages; content pages get the editor button at 230+).
- `SYSTEM_PAGES` set (43: home/shop/cart/product/checkout) + `SYSTEM_ROUTE` map (204-210: home→builder, shop→shop-page, cart→delivery, product→product-page, checkout→delivery).
- System pages never open the inline PageEditor: 262-263 (`isSystem → null` instead of `<PageEditor>`); row click disabled for system (215).

## 3.2 Drag-and-drop — **PASS**
- `PagesTab.tsx` PageEditor section cards draggable: `onDragStart` (743-744, `text/sf-section`), `onDragOver` (747-748, type check), `onDrop` (753-760, `moveSectionTo(dragged, toIdx)`).
- `moveSectionTo` (578-596) renumbers ALL positions: splice reorder then loop 585-594 updates every row whose `position !== i` via `guardedUpdate`, with conflict handling.

## 3.3 Scaffolding + landing + AI — **PARTIAL** (1 gap)
- **PASS**: `src/storefront/lib/pages.ts` `scaffoldStorefront` (119) — idempotent (skips existing slugs, 117, 120-124), inserts Home + themed hero/featured sections (135-147) + Contact (149-153); hero copy per blueprint (127-133 via `themeToBlueprint` 156-164). (Task file said `lib/pages.ts`; real path `src/storefront/lib/pages.ts`.)
- **PASS**: StorefrontsPage create dialog calls it (301-302).
- **PASS**: `storefront_pages` type includes `"landing"` (`src/storefront/lib/pages.ts:24`: `type: "home" | "custom" | "landing"`).
- **PASS**: `StorefrontApp.tsx:61` has `/lp/:slug` route with `<LandingPage standalone />` (outside the dashboard app).
- **PASS**: `CustomPage` standalone prop (`src/storefront/pages/CustomPage.tsx:14`; skips title header 63-67).
- **PASS**: `supabase/functions/generate-storefront-content/index.ts` `mode: "sections"` (35, 73) returns sections JSON (156 `{ sections }`, tool schema 104-127).
- **PASS**: PagesTab AI button (701 `setAiOpen(true)`, dialog 805-815) + `AiSectionsForm` (813, 821) → `generateSections` (503-517) inserts sections with positions.
- **GAP — landing chrome not removed**: `/lp/:slug` route is rendered INSIDE `<StorefrontLayout>` (`StorefrontApp.tsx:44-65` wraps all routes incl. line 61), and `src/storefront/components/StorefrontLayout.tsx` renders the header unconditionally (82-180) and footer unconditionally (186+). A repo-wide scan of `src/storefront/` finds NO `/lp` pathname check or chrome suppression — the only references are the route itself and the comment `CustomPage.tsx:13` claiming "rendered without the storefront chrome by the /lp/:slug route", which the code contradicts. Task 3.3 requires "standalone, no header/footer".

## 4.1 Blueprints — **PASS**
- `src/storefront/pages/Home.tsx` `getLayoutStyle` (22): nimbus/tech/gadget/digital → `minimal` (31-32), saffron/food/grocery → `warm` (34-35); layouts implemented at 217 (minimal) and 264 (warm).
- Scaffold hero copy per blueprint: `src/storefront/lib/pages.ts:127-133` (digital/gadgets/fashion/food heroCopy) + Home comment 27-28.
- Distinct data-theme CSS blocks: `src/storefront/themes/storefront.css` — `[data-theme="nimbus"]` (293-305, blue-600 accent, Inter, 0.5rem radius) vs `[data-theme="saffron"]` (306-318, orange-600 accent, Poppins, 0.75rem radius). (Task file said `themes/storefront.css`; real path `src/storefront/themes/storefront.css`.)

## 4.2 Token customizer — **PASS**
- `src/storefront/lib/settings.ts`: `StorefrontTokens` (148), `DEFAULT_TOKENS` (377), `mergeTokens` (408), wired into `StorefrontSettings` (362 `tokens: mergeTokens(raw?.tokens)`).
- `src/storefront/BrandContext.tsx`: applies tokens as CSS vars (100-131: primary/secondary/surface/text/muted/border/accent via `setProperty` + `hexToHslTriplet` 116; fonts 120-128; radius 130-131) + `loadGoogleFont` (7-13, called 123, 128).
- `ThemeTokensEditor.tsx` exists with fonts (79-88 headings/body), colors (103-109: primary/secondary/surface/text/muted/border/accent), radius (118-121 slider), shadow (123-124), width (133-134). Registered: App.tsx route `/admin/tokens` (161), shell GROUPS "Design tokens" (StorefrontAdminShell.tsx:49), `StorefrontAdminEditor.tsx:82` (`case "tokens"`).

## 5.1 Checkout fields — **PASS**
- `src/storefront/lib/settings.ts` `StorefrontCheckoutFields` (137-145: show_email/company/address2/postal_code + inside/outside_dhaka_required) with defaults 313-319 and merge 322-329.
- `src/storefront/pages/Checkout.tsx` honors toggles — conditional inputs (310 show_email, 313-314 company, 345-348 address2, 353-354 postal_code); `zoneRequired` logic (172, validation 191-192); payload includes address2/company/postal (230-232, composed into address string).
- DeliveryTab Checkout fields card: `src/components/storefront-admin/DeliveryTab.tsx:105-135` (all 6 switches bound to `StorefrontCheckoutFields`, persisted via setField 27-34).

## 5.2 Settings dedup — **PASS**
- `BrandProfileTab.tsx`: NO theme select/accent color input in the form — only a pointer note (66-70: "Theme & accent moved to the Theme & Styling group (overhaul 5.2)… Identity keeps brand info only"); `theme`/`accent_hex` persist existing values in the save payload (40, 42) but expose no UI control.
- `StorefrontAdminShell.tsx` GROUPS (25-71) = GENERAL (27) / IDENTITY (40) / THEME & STYLING (46) / CHECKOUT & SHIPPING (59) / DOMAINS (66) only — exactly 5 groups.

## 6.1 Health panel — **PASS**
- `src/components/storefront-admin/HealthPanel.tsx` exists: page TTFB checks (52-61, `performance.now()` timing + status), image asset HEAD checks + payload (66-90, samples up to 12, `Content-Length` → sizeKb), checkout config flags (103-116: methods configured, min order amount, missing-image/404 detection 105-106/114, hero/logo 116); UI sections for Page load TTFB (149-156) and image payload (166-176).
- Registered: App.tsx route `/storefronts/:slug/admin/health` (178), sub-sidebar item "Health" (StorefrontAdminShell.tsx:36).

---

## Summary
| # | Item | Verdict |
|---|------|---------|
| 1.1 | Checkout non-200 | PASS |
| 1.2 | Keystroke re-render | PASS |
| 1.3 | Live preview | PASS |
| 2.1 | Admin unified | PASS |
| 2.2 | Brand model | PASS |
| 3.1 | Pages list | PASS |
| 3.2 | Drag-and-drop | PASS |
| 3.3 | Scaffolding + landing + AI | **PARTIAL** |
| 4.1 | Blueprints | PASS |
| 4.2 | Token customizer | PASS |
| 5.1 | Checkout fields | PASS |
| 5.2 | Settings dedup | PASS |
| 6.1 | Health panel | PASS |

**Only gap**: 3.3 landing chrome — `/lp/:slug` still renders inside StorefrontLayout's header/footer (`StorefrontApp.tsx:61` inside the layout at 44-65; `StorefrontLayout.tsx:82` header, `:186` footer, no /lp suppression). Per the done-when loop: fix → re-verify.
