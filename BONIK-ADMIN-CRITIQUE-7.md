# BONIK-ADMIN-CRITIQUE-7 — CRITIC cycle 7 of BONIK-ADMIN-PARITY-PLAN.md (save-then-reload rewrite)

Mechanism change assessed: postMessage draft sync deleted; preview = editor saves → iframe reloads → iframe reads DB state. This genuinely removes the wire (verified: zero `postMessage` / `preview-draft` hits in `src`), removes the C6-F5 inflation driver on Phase E, and removes several cycle-6 nits. It does **not** touch the routing problem, and one leftover sentence reintroduces the rejected mechanism inside the headline section.

## Cycle-6 verification (F1–F5)

| Finding | Status |
|---|---|
| C6-F1 (preview routing/catch-all) | **NOT resolved** — save-reload changes data flow, not routing (7-F1) |
| C6-F2 (builder content source) | **Partially** — `storefront_pages` now named; component/record/scoping still absent (7-F3) |
| C6-F3 (ProductsTab orphan) | **NOT resolved, regressed** — no route, and the non-goals block the fix lived in was deleted (7-F4) |
| C6-F4 (mislabeled preview-mapping row) | **Resolved** — table now carries a correct Settings-key column (:89-104); the false "no visual changes" row is gone |
| C6-F5 (effort) | **Partially** — postMessage inflation legitimately gone from E; A and the total still below floor (7-F5) |

## HIGH

### 7-F1 — C6-F1, fifth cycle: the catch-all still fires on every iframe load *and every save-reload*; no plan line names it

- **Where:** Plan :81-82 ("Iframe routes through `/storefronts/preview/:slug/:pageSlug`… a *stopped* view: no scroll-to-lock link follow, no location-history updates… disables link/tab bars"). Repo: `StorefrontPreviewPage.tsx:66-71` mounts `StorefrontApp` with `basePath={/storefront/${sf.slug}}`; `StorefrontApp.tsx:45-58` declares only `${basePath}`-prefixed routes and `*:58 <Navigate to={basePath} replace />`; `App.tsx:121-135` (`Root` → `detectBrand()` → public `StorefrontApp` with no `storefrontOverride`/`draftPageSlug`).
- **Problem:** The iframe URL `/storefronts/preview/<slug>/<page>` matches no inner route, so the router's own `*` fallback emits `<Navigate>` to `/storefront/<slug>`; the frame re-enters as the **public** storefront via `detectBrand()` — no `storefrontOverride`, no `draftPageSlug`, published home. This happens identically on first load and on every "save → iframe reloads" cycle (:85). Save-then-reload therefore previews **the live public home**, not the saved draft of the surface being edited. The :82 guards (disabled links, no history updates, `position: fixed`) still target link-following — the wrong mechanism, exactly as flagged in C6-F1. The plan section whose "done when" is "Editing settings shows in preview on save, no address bar redirects" (:125) cannot pass on master as routed.
- **Required resolution:** Phase E must name the fix: preview-mounted `StorefrontApp` resolves `/storefronts/preview/:slug/:pageSlug` directly (preview route set keyed by `draftPageSlug`, or `StorefrontPreviewPage` renders the surface with an explicit `<Routes location>`), and the catch-all is suppressed when `draftPageSlug` is present. One sentence; it is the plan's critical path and now the *only* thing standing between the design and working.

### 7-F2 — Plan :83 contradicts the headline mechanism in its own section

- **Where:** :83 — "Settings inside the editor are transferred by **posting messages directly to the iframe** (`new URL(iframe.src).pathname = <surface-specific-draft-page>` on transition…)". Two lines later, :85 — "we're not trying to synchronize 18 kb of JSON through postMessage. Instead we instruct editors to save the draft, iframe reloads."
- **Problem:** :83 is leftover text from the rejected design and literally instructs the implementer to rebuild postMessage — the exact pseudo-slug dispatch C4-C6 killed. It is also technically nonsense (assigning `URL.pathname` navigates nothing). A reader of the "critical setting" section gets two mutually exclusive contracts.
- **Fix:** delete :83's first clause; replace with the real behavior — "Editor switches preview surface by setting the iframe `src` to `/storefronts/preview/:slug/<pageSlug>`; unsaved editor state is never transmitted to the iframe."

## MEDIUM

### 7-F3 — C6-F2, fourth cycle: builder source *table* now named; mount point, record, and scoping still unstated

- **Where:** :36 (`/admin/builder`) and :93 (`storefront_pages` + sections tables).
- **Repo state:** `storefront_pages` / `storefront_page_sections` confirmed real (`PagesTab.tsx:58,161`; types :2534). `frontPageOnly`: **zero hits** — no builder component or prop exists. The front-page record is the `storefront_pages` row slug `home` (`Home.tsx:51-54` reads `getDraftPage/getPublishedPage(storefront.id, "home")`).
- **Fix (one sentence, third cycle requested):** builder mounts existing `PagesTab` with a new `frontPageOnly` prop scoped to the `home` row; ~0.5 d inside Phase A.

### 7-F4 — C6-F3 regressed: ProductsTab fate unspoken *and* the non-goals block was deleted

- **Where:** route table (:33-50) has no `/products`; the rewrite contains **no non-goals section at all** (C6 credited it at old :7). Repo: `ProductsTab.tsx` exists and is mounted today at `StorefrontsPage.tsx:171` inside the tab UI this shell replaces.
- **Problem:** dropping the route plus deleting the non-goals means a shipped component loses its mount with no trace — the orphan class from C1-H2/C6-F3, now with the safeguard removed.
- **Fix:** restore either the route (Bonik CATALOG slot) or the one-line non-goal ("per-storefront product curation stays in the main dashboard Products page; ProductsTab removal tracked separately") — and restore the non-goals block itself.

### 7-F5 — C6-F5: E's inflation driver gone, totals still below floor

- **Where:** :129-136 (A 2 d, E 1 d, total 5.5 d).
- **Assessment:** The postMessage deletion is a legitimate reduction — C6-F5's "channel + listener + merge + dispatch" work is genuinely gone. But E=1 d must now absorb 7-F1's routing fix across ~12 editors plus device toggle, zoom, reset chrome; A=2 d for shell + 17 routes + palette remains under the 3.5-4 d floor set in C3/C4 and unrebutted since.
- **Fix:** A 3.5-4 d, E 2 d, total ~7 d. The gap is now 1.5 d, not 2-3 — close it or state the cut.

## LOW

### 7-F6 — Residual bundle (all one-line fixes)

1. **Save↔preview read-model contract unstated:** preview must read the working-copy rows each editor's Save writes (`getDraftPage` path, `Home.tsx:51-52`), or reload shows the *published* state — say which, in Phase E's contract.
2. **`:pageSlug` vocabulary unspecified:** the preview route has one param, but collections/pages carry their own slugs (`/collections/:slug`, `/pages/:slug` — `StorefrontApp.tsx:49,57`); one line listing the slug vocabulary per surface.
3. **Unified-save contract (C1-M5/C6-F6.3) now load-bearing:** preview rides on every editor's Save writing the right rows; the 12+ differing `save()` implementations still unaddressed anywhere.

## Resolved this cycle (for the record)

- C6-F4 (mapping mislabel) — table now carries an accurate Settings-key column.
- C6-F6.1 (PAGE LAYOUT label) — consistent in route table (:37-38).
- C6-F6.2 (`_home` vs `home`) — `_home` gone; only `:pageSlug` remains.
- C6-F6.4 ("server-side surface") — gone.
- C6-F6.5 (orphaned "new columns" work) — replaced by explicit "Nothing is stored in new tables" (:106).
- C6-F6.6 (`/admin/help` undefined) — now "Mailto support link" (:50), defined.
- Verified real: `storefront_pages` schema, `draftPageSlug` plumbing (`StorefrontPreviewPage.tsx:70`, `Home.tsx:37,51`), zero postMessage residue in `src`.

## Verdict

The mechanism change is real and correct as architecture; the rewrite is one routing sentence (:81/:85 cannot pass without naming the `StorefrontApp.tsx:58` catch-all), one self-contradiction (:83), one restored non-goals block, and one re-estimate away from convergence.
