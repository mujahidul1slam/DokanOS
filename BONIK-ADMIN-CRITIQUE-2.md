REVISE — 8 remaining findings (cycle 1's 11 are resolved or folded; no architectural blockers left)

# BONIK-ADMIN-CRITIQUE-2 — CRITIC cycle 2 of BONIK-ADMIN-PARITY-PLAN.md

Cycle-1 check: H1 (layout boundary), H3 (preview mechanism), H4 (thumbnails), M5 (save contract), M6 (% chip), M7 (KPI source), M8 (3-place theme contract), M9 (guards/slugs), L11 (scope honesty) — all resolved in the revised plan. What remains are residual gaps and new inconsistencies introduced by the revision.

## MEDIUM

### F1 — Per-surface preview targets are still unmapped (H3 residual)
- Plan specifies the postMessage channel (`useEditorPreview`) but never says *which page* the iframe loads per editor. Product Card / Product Page / Shop / Header & Footer are not pages — there is no `pageSlug` that isolates them, and Product Page needs a sample product context the preview route has no slot for.
- **Fix:** add a surface→preview-target table (e.g., card→home page, product-page→`/storefronts/preview/:slug/p/<sample-product-slug>` or a deterministic "first product" fallback, header-footer→home, shop→shop page slug) and state who owns picking the sample product.

### F2 — Two wrong preview URL shapes; Phase B's link is broken as written
- Plan Phase A posts to `/storefront/preview/:slug/:pageSlug?draft=1` — actual route is `/storefronts/preview/:slug/:pageSlug` (`src/App.tsx:111`); Phase B's Preview opens `/storefronts/:slug/preview/:themeName`, which matches no existing or proposed route, and `:themeName` is not a `pageSlug`, so the link 404s.
- **Fix:** correct both to the real route; for theme preview, keep the page segment (e.g., `/storefronts/preview/:slug/home?theme=<preset>`) and state that explicitly.

### F3 — Two routed surfaces have no sidebar home (H2 residual)
- Routes exist for `/products` (plan line 46) and `/policies` (line 45), but the sidebar structure (lines 53–57) lists neither. Bonik's Manage Shop includes policies/social links; an orphan route re-creates the trap critique-1 flagged.
- **Fix:** place Products + Policies in the sidebar map (e.g., CATALOG: Products, Collections; STOREFRONT SETTINGS: Policies) or mark the routes "direct-link only" deliberately.

### F4 — Dark-mode logo still ships with no consumer (L10 residual)
- Phase A identity bullet keeps Bonik's dark-mode logo field, but no dark token set exists in the storefront runtime. Storing an unrendered setting is the dead-UI class prior critiques removed.
- **Fix:** either add a minimal dark `data-theme` handling bullet to Phase B (the theme phase is the natural owner) with effort, or defer the field out of this plan.

## LOW

### F5 — No unsaved-draft guard on sidebar navigation
- Editors hold drafts in local `useState`; the new shell makes lateral navigation one click. EditorHeader tracks `hasChanges` but nothing blocks route change, so drafts are silently dropped — worse UX than today's tabs, which at least keep state mounted.
- **Fix:** one line in Phase E: route-leave confirmation when `hasChanges` (hook into router blocker or the shell's nav click handler).

### F6 — Garbled spec: `/settingURI` query param
- Phase B reads "adding a handoff to BrandContext that reads `/settingURI` query param" — not a parseable contract.
- **Fix:** state the param explicitly (e.g., `?theme=<presetKey>`, read in `StorefrontPreviewPage`, passed as override prop to BrandProvider).

### F7 — Effort not re-estimated per cycle-1 instruction
- Critique 1's realism note said re-estimate after resolving H1/H3/H4 (A alone read 3–5 d). Plan still totals 5 days. With F1/F4/F5 added, A is ~3 d, B ~1.5 d.
- **Fix:** update the effort table (~7 days total).

### F8 — Cycle-1 carryover still unscheduled: C4-F1
- The server-side `advance_percent` clamp in `supabase/functions/storefront-checkout/index.ts:210` remains open, and this plan touches the Payments/Delivery admin surfaces that configure it.
- **Fix:** add a one-line work item to Phase A (payments/delivery routes) or explicitly defer with an owner.

## Verified against repo
- Preview route shape (`src/App.tsx:110-111`), existing iframe usage (`PagesTab.tsx:584`), and preview page contract (`StorefrontPreviewPage.tsx:10`) match this critique's claims.
