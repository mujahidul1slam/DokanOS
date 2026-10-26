REVISE — 11 actionable findings

# BONIK-ADMIN-CRITIQUE-1 — CRITIC review of BONIK-ADMIN-PARITY-PLAN.md

Cross-checked against repo reality: `src/App.tsx` (routing/layout), `src/pages/StorefrontsPage.tsx` (current 14-tab editor), `src/components/storefront-admin/*` (15 tab components), `src/pages/StorefrontPreviewPage.tsx` + `src/components/storefront-admin/PagesTab.tsx:582` (existing preview), `src/storefront/BrandContext.tsx` (theme plumbing), `src/components/CommandPalette.tsx`, `src/components/DashboardLayout.tsx` + `AppSidebar.tsx`, `supabase/functions/storefront-checkout/index.ts`, and the executed baseline `STOREFRONT-PARITY-CRITIQUE-1..4.md`.

## HIGH

### H1 — Plan never resolves the double-sidebar collision with `DashboardLayout`
- **Where:** Plan Phase A "Implementation shell" (`BONIK-ADMIN-PARITY-PLAN.md:46`); reality `src/App.tsx:94-117`, `src/components/DashboardLayout.tsx:26-38`.
- **Problem:** Every authenticated route renders inside `<DashboardLayout>`, which mounts the global `AppSidebar` on the left. A new `/storefronts/:slug/admin` route would land *inside* that layout, producing two stacked left navs (AppSidebar + the plan's "secondary sidebar") — the opposite of Bonik's single-sidebar shell. The plan doesn't say whether the new shell is full-bleed (the way `StorefrontPreviewPage` escapes via `fixed inset-0 z-[100]`) or nested. AppSidebar also already owns the ⌘K search pill, the dark-mode toggle, and the user chip pinned at the bottom (`AppSidebar.tsx:171,382-392`), so the plan's listed top-bar/sidebar chrome partially duplicates what exists.
- **Required resolution:** State the layout boundary explicitly: either (a) route-level full-screen shell that bypasses DashboardLayout for `/storefronts/:slug/admin*`, or (b) nested content-only pane with no secondary sidebar claim. Then de-duplicate chrome (rely on AppSidebar for user/search/dark-mode, or remove them there for these routes).

### H2 — Four existing admin surfaces are orphaned by the new shell; the PagesTab reuse claim is false
- **Where:** Plan Phase A page breakdown (`BONIK-ADMIN-PARITY-PLAN.md:30-44`) and "no rewrites — tab components are already self-contained" claim (`:46`); reality `src/pages/StorefrontsPage.tsx:114-172` (14 tab triggers), `src/components/storefront-admin/PagesTab.tsx:47-54`.
- **Problem:** The plan maps 10 surfaces to shell items. **ProductsTab, CollectionsTab, SocialPoliciesTab, and PagesTab's actual scope (NavEditor + the full page list incl. custom pages — the Bonik "Landing Pages" equivalent) have no home in the new nav**, and Phase A.1 turns `/storefronts` into a card list, retiring the tabbed editor that currently hosts them. Bonik's Manage Shop explicitly includes policies + social links (that's our SocialPoliciesTab), so they're in-scope for parity yet unmapped. Separately, "Homepage Builder — opens existing PagesTab editor (front page only)" requires splitting `PagesTab` (which bundles nav editing + all pages) into a front-page-only editor — that *is* a rewrite of that component's layout, contradicting the no-rewrites claim.
- **Required resolution:** Produce a complete mapping table: all 14 existing tabs → shell item or explicit "removed". Add Landing Pages (existing custom pages) and Collections/Products-curation entries to the shell nav. Rewrite the Homepage Builder bullet to say "extract front-page editing from PagesTab (the first real tab refactor)".

### H3 — The "live preview" Done-when has no mechanism; current preview can't do it
- **Where:** Plan Phase A **Done when** "operator edits card style on the left and sees the real storefront change instantly-ish" (`:48`); Phase A header/footer/product/card/shop/animations "with preview iframe" (`:37-41`). Reality: `src/components/storefront-admin/PagesTab.tsx:582-587` has the only iframe in the admin suite; `src/pages/StorefrontPreviewPage.tsx` renders `StorefrontApp` from the **saved DB row** (`storefrontOverride`), and the iframe `src` is static — even in PagesTab today the preview does **not** refresh after save. Settings surfaces (card, product page, shop, header/footer, animations) are not pages at all, so the page-slug-shaped preview route has no target for them.
- **Problem:** With "existing tab components mounted as-is" there is no channel from unsaved editor state to the iframe, and no per-surface preview URL (shop grid, a sample product page, home-with-header). The Done-when is unreachable as written.
- **Required resolution:** Pick and spec one mechanism: (a) **save→reload**: each tab's `onUpdate` bumps an iframe `key`/version param, iframe targets per-surface preview URLs on the preview route (cheap, honest, fits "no rewrites" after adding per-surface routes like `/storefronts/preview/:slug/shop`); or (b) **postMessage draft channel** into `BrandProvider` (true unsaved preview, significantly more work per tab). Choose (a) unless effort is re-estimated.

### H4 — "Live preview thumbnail" screenshots have no pipeline, twice
- **Where:** Phase A.1 storefront list cards "live preview thumbnail (screenshot of current published pages)" (`:30`); Phase B theme cards "preview thumbnail (generated from live preview)" (`:56`).
- **Problem:** Nothing in the repo captures screenshots (no edge fn, no storage bucket usage, no headless step). Both phases silently depend on infra that doesn't exist and isn't estimated.
- **Required resolution:** Replace with a zero-infra option: theme cards show a token-swatch/style mock (colors+type from the preset, cheap and arguably more informative), list cards show a live scaled-down iframe or status-only chip. If real screenshots are wanted, add an explicit capture-pipeline phase with owner + cost.

## MEDIUM

### M5 — Shared `EditorHeader` has no contract against 12+ per-tab `save()` closures
- **Where:** Phase E (`:68-71`) vs reality: each tab owns `async function save()` writing different tables (`CardStyleTab.tsx:50`, `PaymentsTab.tsx:98`, `SettingsTab.tsx:32`, `DeliveryTab.tsx:25`, `DomainsTab.tsx:34`, …); `PagesTab` has no single save at all (auto-saves sections with clobber detection, `guardedUpdate :57-77`).
- **Problem:** "Replacing the bare Save buttons" requires every tab to expose dirty state, saved state, and a save handler to the shell. That's an interface change to ~12 components plus the PagesTab special case — the plan lists no contract and counts Phase E at 1 day.
- **Required resolution:** Define the tab→shell contract now (e.g., each editor registers `{dirty, savedAt, onSave}` via a shell-provided context; PagesTab maps to `{dirty: false, onSave: undefined, footer: "auto-saves"}`). Note that "Settings = SettingsTab + DomainsTab merged" also forces two save closures into one header — decide which save the header button calls (both sequentially is the honest answer).

### M6 — "% completeness chip" is an undefined metric; risk of a fabricated number
- **Where:** Phase E "% completeness chip" (`:70`) and intro's "Saved · 83%" (`:12`).
- **Problem:** No field-completeness model exists anywhere in the repo. Shipping a percentage with no defined derivation repeats the exact failure STOREFRONT-PARITY-CRITIQUE-1 F6 flagged (fabricated shopper-facing UI) at the admin layer.
- **Required resolution:** Either define the formula per surface (e.g., configured/total expected fields for that editor's defaults) in the plan, or cut the chip and show "Saved · <time>" only — which is derivable today.

### M7 — Phase C KPI data source is ambiguous; the orders.storefront_id answer already exists
- **Where:** Phase C (`:60-62`): "Data from `orders` table (existing fields) filtered by storefront's store link or future `storefronts.id` linkage."
- **Problem:** The "future linkage" already landed: `orders.storefront_id` exists (migration `20260914150000_checkout_atomic_idempotency.sql:17`) and the checkout edge fn writes it (`supabase/functions/storefront-checkout/index.ts:237`). "Filtered by **store link**" instead would blend POS orders from the linked store into storefront KPIs — a materially different number. "Page views" KPI has no data source at all (no analytics/pageview table in `types.ts`); the plan's own "placeholder" wording is fine but the KPI card list shouldn't claim it as delivered.
- **Required resolution:** State the source as `orders.storefront_id` (web-channel GMV/orders only); drop the store-link alternative or make it an explicit opt-in mode. Keep pageviews card visibly labeled "not tracked yet".

### M8 — Theme-override preview + two new themes are under-plumbed; preset names in the plan are wrong
- **Where:** Phase B (`:50-58`); reality `src/storefront/BrandContext.tsx:52-57` (data-theme = `sf.theme` only, no query-param reader), `src/storefront/themes/storefront.css:22-127` (4 themes: `editorial`(+`enveil` alias), `cinematic`(+`vincent`), `minimal`, `warm`), `shared.tsx:18-23` (THEME_PRESETS), `StorefrontsPage.tsx:205-210` (hardcoded per-preset accent map).
- **Problem:** (a) `?theme=<slug>` override isn't a "reuse" — nothing reads query params in BrandContext; it's new plumbing to write. (b) The plan says "our 4 presets enveil/cinematic/minimal/warm" — the preset key is `editorial`; `enveil` is a CSS alias. Any new `nimbus`/`saffron` preset needs: new `data-theme` token block in storefront.css, a THEME_PRESETS entry, and a new entry in the create-dialog accent map — three synced places the plan mentions zero of. All are feasible; none is identified.
- **Required resolution:** Add a Phase B work item for the q-param reader (in BrandContext or StorefrontPreviewPage override prop), and one line each for the three sync points per new preset. Fix the preset naming in the plan text.

### M9 — New routes omit the permission/registration pattern entirely
- **Where:** Phase A routes (`:26-44`); reality `src/App.tsx:99-114` (every route wrapped in `PermissionGuard`), `src/hooks/usePermissions.tsx:151-152` (`storefronts.view`).
- **Problem:** The plan adds `/storefronts/:slug/admin`, `/storefronts/:slug/admin/insights`, and rewrites `/storefronts`, without stating guards, App.tsx registration, or that route params are slugs while `StorefrontsPage` keys state by `id` today. `CommandPalette` (Phase D) and the AppSidebar "Storefronts" link need no changes only if permission semantics stay equal — worth one sentence.
- **Required resolution:** Add an integration bullet: routes registered with `PermissionGuard permission="storefronts.view"`, slug→row resolution via the existing `loadStorefront`/slug lookup, and id-based state updated to follow the loaded row.

## LOW

### L10 — "New" identity fields: favicon already exists; dark logo has no consumer
- **Where:** Phase A "Store Identity — BrandProfileTab content, plus new fields shown on Bonik (dark logo, favicon guidance)" (`:35`); reality `BrandProfileTab.tsx:86-87` already edits `logo_url` **and `favicon_url`**. No dark-logo field exists — but no dark styles exist either (STOREFRONT-PARITY-CRITIQUE-1 F13: the dark toggle flips an inert class).
- **Required resolution:** Correct the bullet to "dark logo (new column)". Decide whether to ship it with a minimal dark token set in the runtime, or defer — a stored-but-unrendered dark logo would be the same class of dead setting the last cycle was told to remove.

### L11 — Scope honesty: the plan's name says Bonik parity but phases cover only the STOREFRONT slice
- **Where:** Intro evidence (`:5`) vs phases (`:22-71`).
- **Problem:** The intro lists Bonik's full sidebar (MAIN / CATALOG / PEOPLE / MARKETING / MOBILE APP / SETTINGS & BILLING / HELP), dashboard hero carousel, and "renew required" banner; the phases deliver only the storefront-editor slice. Most of MAIN/CATALOG/PEOPLE already exist as top-level DokanOS routes, and MOBILE APP/MARKETING/billing have no equivalent — none of this is stated, so "Bonik-Parity" overpromises to the next reader.
- **Required resolution:** Add a "Not in this plan" line naming the deferred Bonik groups (Landing Pages polish, Marketing integrations, Mobile App, billing/renew banner, dashboard hero carousel) and their DokanOS equivalents where they exist.

## Cross-checks the plan got right (no defect)
- Existing CommandPalette (`src/components/CommandPalette.tsx`) is real and mountable globally; Phase D's "add commands dynamically" is the correct incremental shape. Note it's currently static (`navItems` const) — the dynamic step is real work, plan's 0.5 day is fine.
- Preview route + `storefrontOverride` + `draftPageSlug` (BrandContext.tsx:29-39) is a sound base for admin previews — correct to build on.
- Tab components do accept `{sf, onUpdate}` uniformly (except PagesTab/ProductsTab/CollectionsTab which take `{sf}`) — "self-contained" is half-true; the contract gap is the save lifecycle (M5), not the props.
- Baseline execution quality is real: storefront parity critique converged 17 → 10 → 7 → 1 open item (C4-F1, a one-line server-side `advance_percent` clamp in `supabase/functions/storefront-checkout/index.ts:210`, still open and independent of this plan, but worth scheduling since this plan touches Delivery/Payments surfaces).

## Effort realism note (not a numbered finding)
Phase A at "2 days" bundles: new shell + route, `/storefronts` list redesign, 12 editor mounts, an overview dashboard widget grid, and per-surface preview integration. With H1–H4 decisions pre-made, A alone reads 3–5 days; the 5-day total becomes ~7–9 days. Re-estimate after resolving H1/H3/H4, not before.
