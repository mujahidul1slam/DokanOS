# STOREFRONT UI REVIEW — 6-Pillar Visual Audit

**Scope:** Storefront admin panel (21 surfaces) + public storefront runtime (6 themes)
**Method:** Live-deployment screenshots (`.audit-ux/01–11`, deployed preview build `99ffd34`) + full code read (`src/storefront/**`, `src/components/storefront-admin/**`)
**Baseline:** No UI-SPEC exists — audited against abstract 6-pillar standards + the Bonik-parity intent documented in `BONIK-PARITY-PLAN.md`
**Note:** The functional audit (21/21 surfaces, saves, previews, draft pipeline) ran earlier this session — this review is the *visual/polish* layer on top. One functional bug found during this audit was fixed immediately (see Experience Design, F6).

---

## Overall: 14/24

| Pillar | Score | Verdict |
|--------|-------|---------|
| Copywriting | 3/4 | Storefront copy is warm and merchant-grade; admin has junk-text leaks |
| Visuals | 2/4 | Public storefront is genuinely polished; admin editors have real blemishes |
| Color | 3/4 | Theme engine works and reads intentional; token editor UI is awkward |
| Typography | 2/4 | Theme fonts land; admin-side legibility fails (truncated labels) |
| Spacing | 2/4 | Storefront breathes; admin editor column gets crushed at laptop width |
| Experience Design | 2/4 | Nav feedback was broken (now fixed); several double-chrome confusions remain |

---

## Copywriting — 3/4

**Good (evidence: 06, 07, 08)**
- Storefront voice is consistent and human: "Welcome to AGS", "Shop new arrivals", "We'll contact you shortly to confirm the order and arrange delivery", "Your bag is empty" + "Continue shopping".
- Product page states are plain and correct: "In stock", "SIZE: SELECT", "Add to cart".
- Admin helper text is genuinely useful: "Draft, preview, then publish. Visitors see the previous version until you publish." (PagesTab), "Blank = inherit the theme's value. Set a token to override it store-wide." (ThemeTokensEditor), "Fewer loads faster; more means less clicking. 48 max." (ShopPageTab).
- Empty states point to the next action: "No orders yet. Share your store link to start getting orders."

**Findings**
- **C1 (Low): Floating "brand" text in the switcher list** (01) — `safsdfsafsd | brand` shows the literal word "brand" as a badge; it names nothing. `StorefrontAdminShell.tsx:158` renders the static string "brand" whenever `brand_id` exists instead of the brand's name.
- **C2 (Medium): Raw markup leaks into product descriptions** (08) — imported descriptions render visible `<div class="html-div xdj266r…">` junk. Whatever the data, the UI must never print markup; strip/sanitize at render or at import.
- **C3 (Low): Test-data leakage in production surfaces** — "Dhakaaaaaaaa" and "Nahid" districts in the checkout city list (from earlier live testing); "safsdfsafsd" storefront visible in every switcher. Not code, but the demo reads sloppy.
- **C4 (Low): Draft preview shows registry defaults as headings** (04) — "Hero" / "Featureda" render as literal section titles in the builder preview when sections still carry default props. A "(default)" hint or friendlier placeholder copy would read better.

## Visuals — 2/4

**Good (evidence: 06, 07, 09, 11)**
- The theme system visibly produces six distinct, credible storefaces: Saffron (warm cream + orange, heavy display), Nimbus (cool slate + blue, Inter), Editorial (serif magazine). This is the strongest visual asset of the phase.
- Hero (06) and shop grid (07) are shippable-quality: image-forward hero, clean 4-col grid, price hierarchy with ৳, proper text truncation on product names.
- Cart drawer, size pills, KPI cards all read as intentional design, not defaults.

**Findings**
- **V1 (High): Product-card editor labels are crushed into gibberish** (05) — labels render as "Ca sty", "Sh", "Im rat", "Hc eff", "La", "Po" at 1280×720. The EditorPage fixed left column (`EditorPage.tsx:50`, `grid xl:grid-cols-[minmax(0,520px)_1fr]`) plus two nested sidebars leaves the form column too narrow; `Row label` + control flex rows truncate instead of wrapping.
- **V2 (Medium): Product page prints raw HTML as body text** (08) — same root cause as C2; visually it's the single worst production-facing blemish.
- **V3 (Low): Theme cards duplicate their own name** (02) — card shows "Editorial (Light)" as the select label *and* "Editorial" as the card title, then a description; cramped and redundant.
- **V4 (Low): Hero image bleeds past its container** (06) — the hero photo is cropped by the viewport edge rather than a frame; looks accidental at some widths.

## Color — 3/4

**Good**
- Six theme palettes are coherent and distinct (verified live: saffron `rgb(255,248,240)` + Poppins; nimbus `rgb(248,250,252)` + Inter; editorial serif). Accent hexes per theme are defined at creation (`StorefrontsPage.tsx` defaultAccents) and flow through buttons, links, active states.
- Dark admin panel: KPI cards, toasts, destructive buttons all use the shadcn token system consistently — no rogue hexes found in the admin code.
- Checkout fields/policies/delivery surfaces keep neutral admin chrome so content stands out.

**Findings**
- **F1 (Medium): Tokens color rows look unfinished** (03) — each color row shows a hard square swatch plus a bare text input displaying "theme" (placeholder). No hex preview, no contrast hint, no "clear" affordance visible. The page works (V8.4 verified) but looks like a debug form.
- **F2 (Low): Active theme ring is the only signal** (02) — the "Active" state is a 2px ring + disabled button; a check badge on the card would read faster.
- **F3 (Low): Admin preview iframes show the storefront's cream theme against the admin's near-black chrome** — deliberate contrast, but the seam (traffic-light bar) could be tightened to feel less like an embedded foreign app.

## Typography — 2/4

**Good**
- Theme fonts actually load and apply store-wide (Google Fonts loader in `BrandContext.tsx`, verified live per theme).
- Display/body split inside themes works: heavy display for heroes, quiet sans for product meta.
- Price typography on cards and product page is consistent (tabular, ৳ prefix, sale/pair hierarchy).

**Findings**
- **T1 (High): Mid-word truncation in admin editors** (05) — same root as V1; when a label can't fit, it must wrap or ellipsize on a word boundary — never chop into "Im rat"/"Hc eff". This is the biggest legibility failure in the phase.
- **T2 (Medium): Triple "Dashboard" title collision** (01) — outer app sidebar, inner admin sidebar, and content header all say "Dashboard" simultaneously; combined with the old stuck-header bug it made orientation impossible. Header now tracks the surface (fixed this audit) but the inner sidebar label could be "Overview" to stop the collision.
- **T3 (Low): Theme-card descriptions wrap awkwardly** (02) — long em-dash descriptions break into 2-3 cramped lines inside narrow cards; clamp to one line + tooltip, or widen cards.
- **T4 (Low): Search boxes advertise the same shortcut twice** (01) — outer chrome "Search… ⌘K" and inner panel "Search… ⌘K" both bind ⌘K; the inner one intercepts per its listener. One search should win.

## Spacing — 2/4

**Good**
- Public storefront spacing is confident: hero padding, section rhythm (py-16 on PublishedPageView sections), shop grid gaps (`gap-4 lg:gap-6`), product card internal padding all read professionally.
- Cart drawer and checkout forms use consistent 4/8px rhythm; stepper (CART → DETAILS → DONE) is clear.

**Findings**
- **S1 (High): Admin content column is starved** (05) — at 1366–1440 laptop widths the stack is: outer sidebar (~256px) + admin sub-sidebar (224px/w-56) + EditorPage's fixed 520px form column + preview. The form column overflows its grid track and truncates labels (root cause of V1/T1). EditorPage needs a responsive form column (`minmax(0,1fr)` stacking below `xl`, not `520px` fixed) and the shell should drop to a single breakpoint-aware layout.
- **S2 (Medium): Fixed 640px preview iframe** (`EditorPage.tsx:66`, `h-[640px]`) letterboxes tall pages — home heroes and shop grids clip with no scroll affordance in the chrome bar. Should be `h-full` within a fixed pane or a taller default with internal scroll.
- **S3 (Low): Product-page info column has one very long untouched block** (08) — description runs edge-to-edge under the price; a max-width measure would help.
- **S4 (Low): 420px preview iframe in the inline page editor** (`PagesTab.tsx`) is short for judging a full page.

## Experience Design — 2/4

**Good**
- The live-preview-while-editing model is the right design and now works end-to-end: change → save → iframe swaps without reload (verified: shop per-page 12→24 live; section text landing in draft preview with zero navigations).
- Draft → preview → publish flow is coherent and the stepper on checkout communicates state.
- Switcher + brand picker + create-dialog flow matches the Bonik mental model (verified live this session).

**Findings**
- **F6 (CRITICAL — fixed during this audit): no navigation feedback** — `StorefrontsPage` never passed `surface` to the shell, so the content header always read "Dashboard" and the sidebar active-highlight never moved — the exact "clicking doesn't select the option I click" complaint. Fixed in `6c45c89`; verified visually post-fix.
- **E1 (High): Double-chrome confusion** (01) — two sidebars + two search boxes + two "Dashboard" labels. The inner sub-sidebar should drop its search (the outer ⌘K palette already exists) and rename its Dashboard item.
- **E2 (Medium): Full page reloads inside the SPA** — PagesTab's Edit buttons use `window.location.assign` (3 call sites), dumping the whole app state to route to the same app. Should be `navigate()`.
- **E3 (Medium): Health panel needed its own slug-resolution path** — worked standalone, dead in-shell (fixed `99ffd34`); pattern risk remains for any future tab that self-resolves via `useParams` inside the wildcard route.
- **E4 (Low): "View Store" opens the live storefront, not a preview context** — fine once themes are set, but during theme exploration the gallery's per-card "Preview" (new tab) is the only sandboxed look; consider wiring the editor chrome's button to the current surface's preview when one exists.
- **E5 (Low): Collections surface creates collections nothing surfaces automatically** — only a Collection-grid section on a page makes them visible; the empty state should say so ("Add a Collection grid section to your home page to feature these").

**needs_human_review: true** — theme-card copy tone (02), the cream-vs-dark admin/storefront seam (F3), and whether the switcher belongs in the sub-sidebar header or the content header are brand-judgment calls.

---

## Top Fixes (ranked by impact)

1. **Responsive editor layout** — kill the fixed 520px form column in `EditorPage.tsx` (stack below `xl`, `minmax(0,1fr)`), fix `Row` label wrapping in `shared.tsx`. Kills V1/T1/S1 together. *High.*
2. **Sanitize product descriptions** — strip/render HTML safely on the storefront product page (and strip on import). Kills V2/C2. *High.*
3. **De-duplicate admin chrome** — drop inner search box, rename inner "Dashboard" → "Overview", show real brand names instead of the literal "brand" string (`StorefrontAdminShell.tsx:158`). Kills E1/T2/C1. *Medium.*
4. **Preview pane height** — full-height or scrollable preview pane in EditorPage + PagesTab iframes. Kills S2/S4. *Medium.*
5. **Replace `window.location.assign` with `navigate()`** in PagesTab edit buttons. Kills E2. *Low.*
6. **Theme-card + tokens-form polish** — one-line clamped descriptions, dedupe card names, hex preview chips in tokens rows. Kills V3/T3/F1. *Low.*

---

## Verification Evidence

- Screenshots: `.audit-ux/01-admin-dashboard.png` … `11-theme-editorial.png` (live deployment, 2026-10-04)
- Functional verification (this session): 21/21 surfaces navigate/render with shell; saves toast on delivery/payments/identity/settings/policies/health/tokens/pages; draft→preview no-reload pipeline verified; curated-products override verified; theme engine verified (3 themes live-screenshotted).
- Fixes shipped during the audit window: `ab2775c`, `f44b7b8`, `5d51977`, `99ffd34`, `6c45c89`.

**Overall: 14/24 — the public storefront is shippable; the admin panel works but needs the six ranked fixes to feel like a product.**
