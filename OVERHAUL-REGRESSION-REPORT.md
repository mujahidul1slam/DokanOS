# Storefront Overhaul — Regression Report (visual verification round)

Date: 2026-09-27
Inputs: user's visual pass on the deployed branch preview + code-level root-cause diagnosis.
Purpose: analyze WHY each reported issue still exists, and define the fix plan. **No code changes in this round.**

---

## Issue-by-issue root causes

### A. Checkout still fails with "Edge Function returned a non-2xx status code"

**What happens:** Placing an order from the real storefront UI returns non-2xx; the UI shows only supabase-js's generic message.

**Root cause (confirmed in code — a regression I introduced in task 5.1):**
- Frontend `Checkout.tsx:191` now allows submitting **without a zone** when the regional preset says zone is optional (`inside_dhaka_required` defaults to **false**).
- The edge function `storefront-checkout/index.ts:58` still **hard-requires** `zone_id` → returns `400 {"error":"Missing customer fields"}`.
- `Checkout.tsx` catch block only shows `err.message` — supabase-js's `FunctionsInvokeError.message` is the generic string; the real error body (`{error:"Missing customer fields"}`) sits in `err.context` and is never surfaced. So the user can't see the actual reason.

**Why the earlier verification missed it:** the "live" test bypassed the UI — it posted a synthetic payload WITH zone_id=1 directly to the function. The regression lives in the *frontend → backend contract*, which no static or synthetic check exercised.

**Fix plan:**
1. Align the contract: make the edge function accept a null zone when the storefront's regional preset says it's optional (read `settings.checkout.fields.inside/outside_dhaka_required`, same logic as the frontend). The RPC must also tolerate `pathao_recipient_zone = null`.
2. Surface real errors: in Checkout's catch, read `err.context.body` / JSON and show the server's `error` message instead of the generic one.
3. Verify by placing a real order through the UI as a Dhaka customer with no zone selected.

### B. All preview windows (Page Builder, Homepage Builder, Theme preview) show "An unexpected error occurred"

**What happens:** every editor's right-hand preview iframe crashes to the app ErrorBoundary; its fallback text "An unexpected error occurred" (ErrorBoundary.tsx) appears when the thrown error has an empty message.

**Root cause analysis (two confirmed contributors + one to confirm live):**
1. **Theme/D tokens page crash is confirmed:** `ThemeTokensEditor.tsx` renders `<SelectItem value="">` (FONT_FAMILIES[0] is `""`) — **Radix Select throws "A `<Select.Item />` must have a value prop that is not an empty string"**. That is exactly the error the user saw on the design page (issue F). Any surface rendering this component dies.
2. **Preview iframe architecture conflict:** in the 2.1 unification I moved the preview routes INSIDE `DashboardLayout` — so the iframe doesn't render a clean storefront page; it boots the whole admin app (sidebar, command palette, providers) around the preview surface. Any failure in that chain (session restore inside a sandboxed iframe, dashboard providers) crashes the whole iframe to the ErrorBoundary. Preview should be a chrome-free route.
3. **Possible SSO interference:** the branch preview sits behind Vercel SSO ("all_except_custom_domains"). The iframe request may hit the SSO redirect; the sandboxed iframe loading a cross-origin login page can dead-end. Needs live confirmation via browser console.

**Why the earlier verification missed it:** the verifier only read code statically ("PropForm has debounced state… PASS"). No one ever loaded the iframe in a browser. The Radix empty-value crash and the iframe/SSO behavior are runtime-only failures.

**Fix plan:**
1. Replace the empty font value with a sentinel (`"__theme"`) in ThemeTokensEditor (immediate, unblocks the tokens page).
2. Move preview routes back OUT of DashboardLayout to a chrome-free full-bleed layout (they were full-bleed before 2.1; the unification accidentally regressed this).
3. Diagnose the iframe live (see verification plan §V3): open the editor, read the iframe console, fix what it shows (candidate: pass the supabase session via the postMessage handshake or make the preview route resilient without a session for public data).
4. Once iframes work: implement the true visual builder canvas (see E).

### C. Storefronts click should BE the admin panel; the old tabbed editor must go

**What happens:** clicking "Storefronts" shows the old list page with a tabbed editor plus an "Open admin panel" button. The user must click through to the new admin.

**Root cause:** I kept BOTH systems side by side (old StorefrontsPage editor + new /admin routes) and only added an entry button. The task said the old panel "is not needed anymore — replace it." I never deleted the legacy editor.

**Fix plan:**
1. `/storefronts` becomes a thin launcher: loads the storefront list; if storefronts exist, immediately render the new admin panel for the most recently selected storefront (persisted selection), with a storefront switcher in the panel header. No separate page, no button.
2. Delete the legacy tabbed StorefrontEditor (vertical-rail tab content) from StorefrontsPage; keep only storefront create/delete/domain-status actions in the switcher.

### D. Brand model: can't see or choose which brand a storefront belongs to

**What happens:** creating a storefront doesn't offer existing brands; no UI shows the storefront→brand relationship.

**Root cause:** I implemented only the database half (brand_id column + auto-create a NEW brand named after the storefront). The visible half — a brand picker in the create dialog and a brand badge on each storefront in the switcher/list — was never built. Also, since every storefront auto-creates its own brand, brands duplicate instead of grouping.

**Fix plan:**
1. Create dialog: brand `<Select>` listing brands of the active business (default to the most recent brand; "Create new brand" option at the end).
2. Storefront switcher rows show the brand name under the storefront name; optional grouping by brand.
3. Backfill: merge duplicate auto-created brands (brand named = storefront named) into one brand per business — data migration script.

### E. The "visual page editor" doesn't exist — no palette → canvas drag-and-drop builder

**What happens:** "Edit" on a page opens the same list-style editor (sections below, a fixed 640px iframe above with odd aspect). No left element drawer, no drag-to-canvas.

**Root cause:** task 3.2 was implemented as "drag to REORDER the section list," not "drag elements FROM a palette ONTO a canvas." The right pane was an EditorPage iframe of fixed height instead of a full-height interactive canvas. Since the iframes are broken anyway (issue B), nothing visual works end-to-end.

**Fix plan (real two-pane builder at `/storefronts/:slug/admin/pages/:pageId/edit`):**
1. **Left drawer:** registry blocks (hero, product grid, rich text, image banner, gallery, testimonials, FAQ, spacer/divider) as draggable cards + the section list (order/visibility/delete) + inspector for the selected section.
2. **Right canvas:** full-pane iframe (fixed height, fills viewport) showing the DRAFT page via the postMessage pipeline; dropping a palette card posts "add section of type X at index N" to the canvas (or inserts + the canvas reflects it); reordering in the list posts the new order.
3. **"Edit" on a content page routes here**; system pages keep routing to their template editors (already done in 3.1).
4. Canvas interactions: click a section in the canvas → selects it in the inspector (element tagging via data-sf-section-id in the preview renderer).

### F. Design/tokens page: Radix Select crash (CONFIRMED exact match)

**Root cause:** `ThemeTokensEditor.tsx` FONT_FAMILIES includes `""` for "Theme default" and renders `<SelectItem value="">` — Radix forbids empty-string values → throws → the page dies with exactly the error text the user pasted.

**Fix:** use a sentinel value (`"__theme"` → label "Theme default"), map back to `""` on save. Same audit for every Select in the admin suite (any other empty-string options would crash identically).

### G. Checkout field options "not present or can't be found"

**Analysis:** the Checkout-fields card (email/company/address2/postal/zone-required toggles) IS in DeliveryTab (delivered with the same batch as the keystroke fix the user confirmed seeing). Most likely: the user looked in the OLD tabbed editor (which we're deleting anyway) or expected it as its own item under "Checkout & Shipping" rather than a card inside "Delivery & Shipping". Also the tokens-page crash (F) may have aborted their exploration of the admin.

**Fix plan:**
1. Rename/restructure: split "Checkout fields" into its own admin item ("Checkout Fields") under the CHECKOUT & SHIPPING group so it's discoverable.
2. Confirm with the visual verifier after the rebuild (see plan §V6).

---

## Why the previous verification methodology failed

| Verification used | Why it missed real breakage |
|---|---|
| Static code reading (file:line "PASS") | Proves code exists, not that it runs. Missed: Radix empty-value crash, iframe/SSO runtime failures, route/chrome conflicts. |
| Synthetic API test (direct fetch to edge fn) | Bypassed the UI contract — frontend now sends zone=null; my synthetic payload sent zone=1. The regression was in the contract, not the endpoint. |
| `npm run typecheck` / unit tests | Type-level and logic-level only. No component renders, no Radix rules, no browser. |
| Never logged into the deployed app | All "verified live" claims were made without a single click in the real UI. |

**The new rule:** every fix is verified by a browser agent (OpenCLI/Playwright) clicking through the deployed app — see `VISUAL-VERIFICATION-PLAN.md`. A feature is DONE only when the visual verifier passes its checklist.
