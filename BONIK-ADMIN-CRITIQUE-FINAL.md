# CRITIQUE — FINAL PASS

**Verdict: REVISE** — architecture is correct and converged (7-F1 architecture resolved); 5 mechanical gore items remain. No structural blockers. Est. fix time: ~20 minutes, all single-line/single-paragraph edits.

---

## Confirmed resolved (verified against plan)

| Carryover | Status |
|---|---|
| 7-F1 routing decision | Plan :82–91 names direct surface render — no `StorefrontApp`, no router, no catch-all, no `detectBrand` inside the preview. Real and named. |
| Preview contract | Plan :95/:99 state save-then-reload, saved-state-only, explicitly no live typing. Matches C1-M5 direction. |
| Products route | Plan :38 — `/storefronts/:slug/admin/products` restored to the route table. |
| Effort | Plan :146–153 — A=3 d, total **7 working days**, meets the 7 d floor. |
| Dark-mode logo | Dropped from scope entirely — neither shipped nor half-specced. Resolved by removal. |
| Duplicate routes (C4-F2) | Route table :33–51 has no duplicated `/pages` row. |

## REVISE items (all mechanical)

1. **Default branch contradicts itself — iframe can still navigate itself (same failure class as 7-F1).**
   Code :91 says `default: return <Redirect to={`/storefronts/admin/${slug}/dashboard`} />`; prose :101 says unknown slugs fall back to a "Select a page to preview" sheet. The code wins if pasted, and the Redirect target is also wrong-shaped (real route is `/storefronts/:slug/admin/dashboard`). An editor hand-typing a bad surface name would load the entire admin shell inside the iframe.
   *Fix:* delete the Redirect; default renders the "Select a page to preview" sheet. One line.

2. **Allowed-surface list ≠ switch cases.** :101 allows 5 names (`home`, `_product_page`, `_shop_page`, `_identity`, `_collection_page`); the switch (:86–91) handles 4 — `_collection_page` silently falls to default.
   *Fix:* add the `_collection_page` case or drop it from :101. One line.

3. **Preview read-model unnamed for page-content surfaces.** :95 says the preview loads `select * from storefronts`; :109 says builder/pages write `storefront_pages` + sections (draft rows via the `getDraftPage` path); :37 says pages have drafts. For settings surfaces save-then-reload works (settings live on the storefronts row); for builder/home, reload from the `storefronts` row shows **published**, not just-saved, content.
   *Fix:* one sentence in the preview section — after Save, home/pages surfaces re-render from the same draft rows the editor just wrote (the `getDraftPage` read path), not the published row.

4. **Component name split.** :82 names `StorefrontPreviewPage` (existing repo file); :85 code header names `StorefrontPreviewSurface.tsx` (new). The plan can't have both.
   *Fix:* pick one name — repurpose the existing `StorefrontPreviewPage.tsx`, drop the separate new file.

5. **C2 carryover still absent: route-leave guard for unsaved edits.** Phase E (:141/:151) names "drift-guard" (the iframe-stays-put guard) but the critique-2-required confirmation on leaving an editor with unsaved changes is nowhere. Draft lives in the editor form (:99), so navigating away silently discards it.
   *Fix:* one bullet under editor chrome (:68–76): route-leave confirmation when the editor has unsaved changes.

---

**Bottom line:** the six things this campaign fought over for seven cycles are all correctly resolved. The five items above are paste-fidelity bugs in a FINAL document, each a one-liner — fix them and this plan converges.
