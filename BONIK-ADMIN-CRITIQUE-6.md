# BONIK-ADMIN-CRITIQUE-6 — CRITIC cycle 6 of BONIK-ADMIN-PARITY-PLAN.md (final rewrite)

## Cycle-5 verification

C5-F1 (two mapping tables) fixed — one table remains (plan :96-102), animations shares the `home` row, no dropped param. C5-F2 (header/table effort mismatch) fixed — headers and table agree. C5-F3 ("Phase A/O") and C4-F6 garbles gone. Identity rows are dark-logo-free. Non-goals block (:7) is explicit. `BONIK-FRONTEND-PLAN.md` reference resolves.

## HIGH (residual, mechanism now confirmed wrong)

### C6-F1 — C4-F1 residual, fourth cycle: the preview scaffold is still broken, and the plan's only guard targets the wrong mechanism

- **Where:** Plan :94 ("the preview iframe must not steer away to the storefront's public URL… never link from inside the iframe"). Repo: `StorefrontPreviewPage.tsx:68` mounts `StorefrontApp` with `basePath={/storefront/${sf.slug}}`; `StorefrontApp.tsx:46-57` declares only `${basePath}`-prefixed routes and `*:58` `<Navigate to={basePath} replace />`; `App.tsx:121-149` (`Root` → `detectBrand()` → public `StorefrontApp` with no `storefrontOverride`).
- **Problem:** The escape is not caused by links *inside* the iframe. The iframe URL `/storefronts/preview/<slug>/<page>` matches no inner route, so the `*` catch-all itself emits `<Navigate>` to `/storefront/<slug>` — a client-side navigation that occurs regardless of linking behavior. The frame then re-enters via `detectBrand()` as the **public** storefront (no `storefrontOverride`, no draft merge). A "no links" rule cannot prevent a `Navigate` rendered by the router's own fallback. Neither `detectBrand` nor the catch-all is named in the plan — the fix locus is unstated, so nothing schedules it.
- **Required resolution:** Name the fix explicitly in Phase E: (a) preview-mounted `StorefrontApp` must resolve the preview URL (second basePath or preview-mode route set) and suppress the catch-all when `draftPageSlug` is present; (b) state who applies the postMessage draft — `StorefrontPreviewPage` needs a `message` listener threading the draft through the existing `mergeSettings` (`lib/settings.ts:284`); (c) keep the merge-sequencing note consistent with this — as written (:122) admin lands first with preview broken, since the pseudo-slug dispatch and draft merge do not exist on master today.

## MEDIUM

### C6-F2 — C3-F3/C4-F3 residual, third cycle: Homepage Builder's content source is back to completely unnamed

- **Where:** :30 (`/admin/builder | Homepage Builder`) and :46 ("The components exist already — we're just renaming + re-routing each tab").
- **Problem:** No `frontPageOnly`/builder component exists (grep: none). `PagesTab` is the full multi-page editor; mounting it unchanged at `/builder` contradicts the Bonik homepage-builder goal, and the plan no longer even claims the extraction. The record the front page lives in (`pages` row `home`, per `Home.tsx:51-52`) is unstated.
- **Fix:** one sentence — builder mounts `PagesTab` with a new `frontPageOnly` prop over the `home` page row; ~0.5 d inside Phase A. Silent dropping of a twice-raised fix is worse than the original omission.

### C6-F3 — `ProductsTab` silently orphaned: the rewrite dropped the route without landing it in the non-goals

- **Where:** Route table (:25-44) has no `/products`; `src/components/storefront-admin/ProductsTab.tsx` still exists with no mount. The non-goals (:7) exclude "orders, catalog CRUD, customers" — a product-curation tab for the storefront is not obviously any of those.
- **Problem:** Prior cycles (C2-F3, C4-F6) treated this surface as in-plan; the rewrite deletes it with no trace. A shipped tab component with no route is the orphan class C1-H2 flagged.
- **Fix:** either restore the route (Bonik "Manage Shop" — sidebar CATALOG) or add one non-goal line: "shop-floor product management lives in the main dashboard Products page; the per-storefront curation tab is removed here, deletion tracked separately."

### C6-F4 — The single mapping table now mislabels its "no visual changes" row: pages, collections, and policies editors all change rendered storefront output

- **Where:** :102 (`every other editor → none (no visual changes)`). Repo: `/pages/:slug` → `CustomPage.tsx` + `CollectionsTab.tsx` → `/collections/:slug` (`StorefrontApp.tsx:49,57`), `/policies`. These editors mutate exactly what those routes render.
- **Problem:** The most preview-worthy editor in the set — the pages manager — maps to "no preview" while product-card gets one. Implementers following the table ship worse-than-today behavior (PagesTab already iframes a preview at `:584`).
- **Fix:** three rows: pages → `/storefronts/preview/:slug/<editedPageSlug>`; collections → `/storefront/:slug/collections/:slug` (or a `_collection` pseudo-slug); policies → `/storefront/:slug/policies`. Mark settings/delivery/payments/domains as the true no-preview set.

### C6-F5 — Effort still at pre-critique numbers; the evidence against them strengthened this cycle

- ****Where:**** :19 (A 2 d), :74 (E 1 d), :115-120 (total 5 d).
- **Problem:** C3/C4 sets A's floor at 3.5-4 d and total ~7 d; the rewrite reverts to 2 d/5 d after *absorbing* more Phase E work (device toggle, guard, contract). New fact: there is zero preview-channel code in `src` today — no `postMessage`, no `preview-draft`, no pseudo-slug dispatch anywhere. Phase E therefore builds the channel, the listener, the draft merge, the surface dispatch, per-editor headers, and the dirty guard across ~12 editors in one day. That is not a one-day phase; paired with C6-F1 it is the plan's critical path.
- **Fix:** A 3.5-4 d, E 2 d, total ~7-8 d; or descope E (draft preview for `home` + `_shop_page` only) and state the cut.

## LOW

### C6-F6 — Spec nit bundle (each individually small; all cheap)

1. **Sidebar label mismatch:** :31 puts Pages under "STORE LAYOUT"; the canonical group list (:48) has only "PAGE LAYOUT". Pick one.
2. **`_home` vs `home`:** :92 lists `_home` as a special slug; :98 and the codebase (`draftPageSlug` default `"home"`, `Home.tsx:51-52`) use `home`. `_home` resolves to nothing via `getDraftPage`.
3. **"Save (disabled) toggle"** (:77): decorative header Save is dead chrome; if the intent is per-tab save closures retained, say so — the unified-save contract (C1-M5, 12+ differing `save()` implementations) is still unspecified anywhere in the rewrite.
4. **"server-side surface"** (:92): the app is a client SPA; `mergeSettings` runs in-browser. The term sends an engineer hunting for SSR that does not exist.
5. **Deliverable-only work:** :109 adds "a couple new columns (header/footer data)" with no owning phase or migration line — contradicting :46's "no rewrites, just re-routing" premise.
6. **`/admin/help`** (:44): route exists, content undefined — one line of spec or cut until `/docs` exists (C3-F7 class).

## Cross-checks the rewrite genuinely fixed

- Deduplicated route table, single preview mapping table, explicit non-goals, removed dark-logo, theme names now match `storefront.css` selectors (`editorial`/`cinematic`/`minimal`/`warm` + legacy aliases), `defaultAccents` pointer lands on `StorefrontsPage.tsx:205`, Phase C data source (`orders.storefront_id`) verified in `storefront-checkout/index.ts`, `BONIK-FRONTEND-PLAN.md` reference resolves, effort headers match table.
- `mergeSettings` ("existing settings merge", :89) is real (`lib/settings.ts:284`) — the draft-merge hook point is buildable as described.

## Effort realism note

Internal coherence is achieved; accuracy is not. The delta between 5 d and the ~7 d floor persists with new evidence (zero existing preview plumbing, C6-F1's routing fix unscheduled). Re-estimate, don't just align headers to table.
