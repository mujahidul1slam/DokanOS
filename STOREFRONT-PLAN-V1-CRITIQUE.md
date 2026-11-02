# STOREFRONT-PLAN-V1 — Adversarial Critique (Cycle 1)

**Critic:** CRITIC agent, plan-convergence loop · **Date:** 2026-09-10
**Target:** STOREFRONT-PLAN-V1.md · **Ground truth:** STOREFRONT-AUDIT.md + supabase/migrations + src spot-checks

---

## Verdict

**REVISE — 13 actionable findings (4 HIGH, 6 MEDIUM, 3 LOW).**

The plan is structurally strong: correct phase decomposition, expand-only discipline, honest effort ranges, and real verification criteria. But it contains one false grounding fact that deletes a P0 security fix (H1), one self-contradiction that dead-wires the cancel-restores-stock feature (H3), one unpatched race that leaks stock on the idempotency path it was built to close (H2), and an RLS design that leaks draft content (H4).

---

## HIGH findings

### H1 — Anon `orders` policy is NOT gone; Phase 6 ships Track without closing the PII hole
- **Plan section:** §2 fact 6, §9.4, §9.6 ("Anon REST on orders still rejected")
- **What's wrong:** Plan asserts the anon policy was dropped in `20260412170009` and that Track is "broken, not leaking", so Phase 6 "only" rebuilds Track behind an edge function. Live DB ground truth (orchestrator-verified): the **"Allow anonymous access to orders" FOR ALL TO anon policy is still active**. As written, the plan deploys the new `storefront-track-order` fn, rewrites Track.tsx, and leaves every order (customer name, phone, address, totals) enumerable by anon REST by order number. The plan's verification line "anon key REST select on `orders` still rejected" will FAIL on day one, and the actual audit §2.9.1 critical finding stays open after the entire P0 program completes.
- **Evidence:** migration `20260407074308_42cf72b6…` (creates `FOR ALL TO anon USING (true)` on orders + order_items + order_payments + order_timeline + products + variations + customers); drop attempt `20260412170009`; live state per orchestrator pre-verification; plan §2 fact 6 and §9.4.
- **Required resolution:** Phase 6 must include a migration that drops the anon FOR ALL policies on `orders` — and re-checks/likewise drops the sibling anon policies on `order_items`, `order_payments`, `order_timeline`, `customers`, `product_variations` in the live DB (the 20260412 drop targeted all of them; if orders survived, assume the siblings did too). Correct fact 6. This is contract-tightening (not expand-only) — call it out as the plan's one deliberate exception, with the Track fn as the replacement access path. Keep the §9.6 anon-rejection verification (it becomes meaningful only after the drop).

### H2 — Same-key concurrent checkout double-decrements stock; the 23505 branch never compensates
- **Plan section:** §9.2 (third rewrite), §13 risk 2
- **What's wrong:** Flow is: SELECT by key → reserve RPC → insert order → catch 23505 → return deduped 200. Two parallel requests with the SAME key both pass the SELECT (neither order exists yet), BOTH succeed at the reserve RPC (stock permitting), first insert wins, second hits 23505 and returns "deduped: true" — but its reserve is never rolled back. Net: one order, stock decremented twice. Worse: with stock=1 and qty=1, request B's reserve RAISES out-of-stock → B returns 400 for what is semantically a duplicate of a successful order (client shows failure, user re-orders, merchant sees phantom stock loss or false failure). The compensation clause in §9.2 only covers "insert failure", not the 23505-deduped path, and §13 risk 2 mischaracterizes the window as "tiny" — it is the exact double-click window the phase exists to close.
- **Evidence:** plan §9.2 flow text; `orders.idempotency_key` design (§9.1); reserve RPC has no key awareness (§9.1 signature `p_items jsonb`).
- **Required resolution:** Make reserve + order-row insert atomic server-side: extend the RPC (or add a wrapper `storefront_place_order`) to take the idempotency_key + order payload, take `pg_advisory_xact_lock(hashtext(key))` (or SELECT the orders row FOR UPDATE by key after inserting a stub row first), and do insert+decrement in ONE transaction — the edge fn then has no cross-call window at all, which also deletes §13 risk 2 and the "accepted mitigation" comment. If the two-RPC shape is kept, the 23505 catch branch MUST invoke the restore-compensation for its in-memory items before returning deduped. Add a genuinely parallel same-key test to §9.6 (see L1).

### H3 — `orders.source` contradiction: §9.3 wiring keys on `'storefront'`, §9.2 says keep `'online'`, and a CHECK constraint likely forbids `'storefront'` anyway
- **Plan section:** §9.2, §9.3, §9.1
- **What's wrong:** Three defects stack: (a) §9.2 instructs "insert with `source='storefront'` (verify current source value in the fn; if it already writes a distinct source, keep it)" — the current fn writes `source: "online"` (`supabase/functions/storefront-checkout/index.ts`, orders insert), so a literal executor keeps `'online'`; (b) §9.3's cancel-restores-stock wiring triggers on `order.source === 'storefront'` — if (a) is followed, the condition NEVER matches and restore is dead code shipped as "working"; (c) `orders.source` was created with `CHECK (source IN ('online','pos'))` (`20260407071618`) — writing `'storefront'` violates the constraint (later migrations only juggled defaults), and the plan's expand-only §9.1 migration contains no constraint change. Any path through §9.2/§9.3 either breaks the insert or dead-wires the restore.
- **Evidence:** `20260407071618_75b9cdb2…` (source CHECK), `20260419…` (default churn), checkout fn insert (`source: "online"`), plan §9.2/§9.3.
- **Required resolution:** Pick one discriminator and propagate: either (1) widen the CHECK to include `'storefront'` via explicit constraint migration (ALTER … DROP CONSTRAINT + ADD — small, but must appear in §9.1 and the expand-only note), or (2) keep `'online'` and discriminate via a new nullable `orders.storefront_id`/`idempotency_key IS NOT NULL` marker, updating §9.3's condition to match. Delete the "if it already writes a distinct source, keep it" parenthetical — it is the bug.

### H4 — `storefront_page_sections` public SELECT policy leaks working-copy drafts of published pages
- **Plan section:** §4.1 RLS (second bullet), §10.1 table
- **What's wrong:** The sections table holds the working copy. The plan's public policy grants anon SELECT on sections whose parent page `status='published'` — but a published page being edited for v2 (sale banner, unpublished pricing) has `status='published'` the whole time its section rows contain the new draft content. Anon can read the draft props via REST. This directly contradicts the plan's own §4.1 claim "Drafts are unreadable to anon" and is unnecessary by the plan's own runtime design: `lib/pages.ts` reads sections from `published_snapshot` jsonb on the `storefront_pages` row — anon never needs the sections table at all. Draft preview runs on the staff session via the authenticated client.
- **Evidence:** plan §4.1 RLS bullets + §4.3 (`getPublishedPage` reads snapshot); `storefront_pages.published_snapshot` design (§4.1 DDL).
- **Required resolution:** Remove the public/anon SELECT policy on `storefront_page_sections` entirely (staff/admin only). Update the §10.1 RLS matrix and the §4.6 verify assertion ("policy count ≥ 3" becomes ≥ 2 on this table). Add a §4.6 manual check: anon REST GET on a section row of a published page returns empty.

---

## MEDIUM findings

### M1 — Phase 5's client-side shipping source (`invoice_settings`) is unreadable by the storefront anon client
- **Plan section:** §8.2 (Checkout.tsx bullet)
- **What's wrong:** `invoice_settings` has RLS enabled (`20260412172337`) and no policy grants anon anything (default-deny — confirmed by scanning all migrations). The storefront runtime uses the anon-key client (`src/storefront/lib/*` import `@/integrations/supabase/client`). The plan's "remove the hard-coded 80/150 mirror by … a tiny read of `invoice_settings` through the existing client" will silently return empty/error and break shipping display. Today's hard-coded 80/150 (`Checkout.tsx`) exists precisely because of this.
- **Evidence:** `20260412172337_f578ddd2…` (RLS on invoice_settings, zero policies found repo-wide); `src/storefront/pages/Checkout.tsx` (`useState(150)`, `city_id === cityId ? 80 : 150`).
- **Required resolution:** Either add a narrowly-scoped anon SELECT policy on `invoice_settings` (store-scoped rate columns only) to the Phase 5 migration, or drop the client mirror: have the checkout fn return the computed shipping in an error payload / add shipping-rate to its validation response, or a tiny public `storefront-shipping-quote` fn. Pick one and write it into §8.1/§8.2 with the migration it needs.

### M2 — Variation `stock_status` vocabulary mismatch breaks the disable/availability logic
- **Plan section:** §6.3 (Product.tsx), §7.2 (JSON-LD availability)
- **What's wrong:** Plan disables options on `stock_status='outofstock'` and maps JSON-LD availability from in/out-of-stock. But `product_variations.stock_status` DDL default is `'in_stock'` (underscore style, `20260408191701`), while `product_locations` uses Woo-style `'instock'/'outofstock'` (`20260904000100`) and the plan uses `'outofstock'`. Three vocabularies; the storefront check may never fire or always fire depending on which sync path wrote the row.
- **Evidence:** `20260408191701_ae729f9d…` (variation DDL `DEFAULT 'in_stock'`), `20260904000100_multi_business_foundation.sql` (CHECK `instock/outofstock/onbackorder`), plan §6.3.
- **Required resolution:** Verify the live value distribution first (add to §6.1's verify step), then either gate exclusively on `manage_stock && stock_quantity` (drop the stock_status term) or normalize the vocabulary in one place. JSON-LD availability should derive from the same normalized predicate.

### M3 — "Admin routes already sit behind PermissionGuard" is false for the storefronts route
- **Plan section:** §10.2
- **What's wrong:** `App.tsx` mounts `<Route path="/storefronts" element={<StorefrontsPage />} />` with **no PermissionGuard** (every neighbor route has one; storefronts is the bare exception). The plan's permission verification item ("verify the storefronts route's guard permission string") is vacuous — there is no guard — and the admin surface (soon including draft previews) relies on RLS alone.
- **Evidence:** `src/App.tsx` (storefronts route); contrast `analytics`, `settings`, `team` routes.
- **Required resolution:** Correct §10.2, and either add `<PermissionGuard permission="…">` around StorefrontsPage (smallest change; new tabs inherit it) or explicitly document the RLS-only posture. The preview route added in Phase 1 must live behind an actual auth guard (RequireAuth), not the assumed one.

### M4 — Sitemap delivery details: Host header, rewrite order, and robots.txt Sitemap URL
- **Plan section:** §7.3
- **What's wrong:** Three correctness defects: (a) Vercel external rewrites do NOT pass the original `Host` header to the destination (it is preserved in `x-forwarded-host`; `Host` becomes the supabase host) — the fn's Host-based storefront resolution won't fire as specified; (b) the `/sitemap.xml` rewrite must be listed BEFORE the existing catch-all `/(.*) → /index.html` in `vercel.json` (rewrites evaluate in order) or it never matches; (c) `Sitemap: /sitemap.xml` in robots.txt must be an **absolute URL** per the robots spec — relative values are ignored by Google/Bing.
- **Evidence:** `vercel.json` (single catch-all rewrite); plan §7.3.
- **Required resolution:** Fn reads `x-forwarded-host` (fallback `?slug=`); vercel.json change shown with explicit ordering; robots.txt emits an absolute URL per storefront host (or a per-host robots edge fn later — but v1 must not ship a spec-invalid directive).

### M5 — Sequencing self-contradiction: "5 before 6" rationale vs single-dev order ending "…6 → 4 → 5"
- **Plan section:** §3 (critical path), §11 (last bullet)
- **What's wrong:** §3 and §11 justify Phase 5 before 6 so `storefront-checkout` is rewritten once with settings already honored. §11's single-dev order `1 → 2 → 3 → 6 → 4 → 5` puts 5 AFTER 6 — guaranteeing the double rewrite the ordering argument exists to avoid (Phase 6 rewrite ignores settings; Phase 5 rewrite #4 re-touches the idempotency/stock code a second time, re-risking H2's race in the process).
- **Evidence:** plan §3 sentence "5 is small and independent but is sequenced before 6 so storefront-checkout is rewritten once" vs §11 "Single-dev order: 1 → 2 → 3 → 6 → 4 → 5".
- **Required resolution:** Pin single-dev order to `1 → 2 → 3 → 5 → 6 → 4` (or explicitly accept and schedule a 4th fn rewrite + H2 retest). One of the two statements must go.

### M6 — Unacknowledged P0 sub-scope drops: contact-form/newsletter sections, editable header/footer for system pages
- **Plan section:** §4.2 (9 types), §12 (out of scope)
- **What's wrong:** Audit P0 #1's section list includes contact-form and newsletter; the plan ships 9 types without them and §12 (out of scope) never mentions them — a silent narrowing of a P0 line item. Same for "system pages … as templates with editable header/footer": the plan covers nav but not header/footer editability, again without a §12 entry. Silent drops are how convergence loops lose scope.
- **Evidence:** STOREFRONT-AUDIT.md §4 P0 #1; plan §4.2 table, §12.
- **Required resolution:** Either restore the two section types (both are small against the registry the plan already builds) or add both items to §12 with one-line rationales (contact page exists as legacy template; newsletter has no capture backend until P1 analytics). No third option.

---

## LOW findings

### L1 — Concurrency verification is sequential, so it cannot exercise the races it claims to
- **Plan section:** §9.6 (concurrency script)
- **What's wrong:** "for i in 1..2: curl" run serially never overlaps the SELECT-key/reserve/insert window; it verifies dedup of a *retry*, not a *race*. H2's defect would pass this test.
- **Evidence:** plan §9.6.
- **Required resolution:** Fire the two curls concurrently (background jobs / `Promise.all`), and add the same-key-stock=1-qty=1 parallel case asserting BOTH responses are 200 with identical order_number.

### L2 — URL shapes in sitemap/canonical must be asserted against actual runtime routes
- **Plan section:** §7.2, §7.3
- **What's wrong:** Sitemap emits `/products/:slug` and the plan derives canonicals from stored slugs, but the actual `StorefrontApp` product route shape is not verified in the plan (existing routes may be `/product/:id…` style). A sitemap/canonical pointing at a 404/redirect is worse than none.
- **Evidence:** plan §7.2/§7.3; `src/storefront/StorefrontApp.tsx` (route definitions exist but shape unverified in plan).
- **Required resolution:** Add a §7.5 test asserting sitemap URLs and canonical hrefs match the router's actual path templates (single source of truth helper for both).

### L3 — Reserve RPC "coalesce(variation_id, zero-uuid)" implies a sentinel-uuid convention that doesn't exist; parent location rows are NULL-keyed
- **Plan section:** §9.1 (Case A)
- **What's wrong:** `product_locations.variation_id` is nullable with NULL for parent-product rows (`20260904000100` DDL). The zero-uuid coalesce phrasing will produce a query matching nothing (or requires rewriting rows to a sentinel that nothing populates). Also the aggregate trigger sums ALL location rows for a product_id (variation rows included) — the plan's Case A/Case B split must state which rows it decrements so the post-trigger aggregate lands where the plan's verify asserts.
- **Evidence:** `20260904000100_multi_business_foundation.sql` (product_locations DDL, nullable variation_id, `sync_product_stock_from_locations` sums by product_id only); plan §9.1.
- **Required resolution:** Write the parent-row predicate as `variation_id IS NULL` / `IS NOT DISTINCT FROM NULL`, and specify variation-row decrement behavior against the aggregate's product_id-only SUM (fixtures in §9.6 already cover this — make the predicate match them).

---

## Dropped-P0 / scope-creep scan (explicit)

- **Dropped:** contact-form + newsletter sections, editable header/footer for system templates — see M6 (unacknowledged). Everything else from audit P0 #1–#6 + §2.9.1/§2.9.3 is present. §2.9.2 (rate limiting) and §2.9.4 (AI fn role check) are audit-P2/verified items — correctly out of scope.
- **Scope creep:** none found. Phase 5's `settings` schema and Phase 1's snapshot/publish machinery are justified by their audit line items. The plan is notably creep-free.

## Quality assessment (context for the next cycle)

- **Phase dependencies:** sound, except M5's single-dev contradiction and the unflagged intra-phase deploy-order risk in Phase 3 (fn passing `variation_id` before the column exists — state migration-before-fn explicitly, as §9.5 does).
- **Effort realism:** total 7–9.5 wk is credible. Phase 6 at 4–6 d is now optimistic once H1 (policy drops + verify), H2 (atomic RPC), and H3 (CHECK migration) land inside it — re-estimate to 6–8 d.
- **Migration safety:** expand-only discipline is excellent and consistently argued; the two necessary exceptions (H1 drop, H3 CHECK widen) must be owned in §10.3, not smuggled.
- **Verification measurability:** verify_* SQL, table-driven vitest, and manual checklists are unusually good; fix L1 (sequential curls) and the two now-vacuous checks (§9.6 anon-rejection pre-H1; §10.2 guard check pre-M3).
- **Concurrency:** draft/publish section-editing is last-write-wins with no `updated_at` optimistic check — acceptable for v1, but say so in §13 and have the save compare `updated_at` to at least detect clobber.

---

## Appendix — Facts verified this cycle (do not redo)

1. **Pricing (20260831000300):** `products.price` REMAINS the effective price; `regular_price/sale_price/sale_price_from/sale_price_to/short_description/attributes/tags` were ADDED. Plan's `products.price` and `short_description` usage is valid. No rename happened.
2. **`product_variations` DDL (20260408191701):** `price numeric`, `manage_stock bool`, `stock_quantity int`, `stock_status text DEFAULT 'in_stock'`, `attributes jsonb`. Vocabulary mismatch is real (M2).
3. **Anon read on `products`** exists: `20260619164824` / `20260620` "Public can read active products" `FOR SELECT TO anon USING (is_active=true)` + GRANT. Plan fact 9 TRUE. No equivalent anon policy on `product_variations` found in migrations — plan's Phase 3 "verify + add" step is correct and necessary.
4. **Anon policies on orders family (20260407074308):** created FOR ALL on orders, order_items, order_payments, order_timeline, products, stores, customers, product_variations; `20260412170009` drops all of them. Live DB per orchestrator: orders anon access OPEN (H1). No re-creation found in migrations — the live-DB state wins.
5. **`orders.source`:** CHECK `IN ('online','pos')` at creation (20260407071618); later migrations changed defaults ('pos'/'woo' comments) but no widening to 'storefront' found. Checkout fn writes `source: "online"`. (H3.)
6. **`invoice_settings`:** RLS enabled (20260412172337), NO policies anywhere in migrations → default-deny for anon. (M1.)
7. **Junction `storefront_collection_products` (20260516201928):** `product_id uuid NOT NULL` — NO FK (plan's claim TRUE); public SELECT + staff/admin INSERT policies exist. `(collection_id, product_id)` UNIQUE.
8. **`product_locations` (20260904000100):** nullable `variation_id` (NULL = parent rows, no zero-uuid sentinel anywhere); `stock_quantity numeric(14,3)`; unique index `(product_id, variation_id, location_id)`; `sync_product_stock_from_locations` recomputes `products.stock_quantity` as SUM by product_id only (variation rows included). (L3.)
9. **Runtime files verified:** `src/storefront/lib/md.tsx` exists (plan's reference correct); `Home.tsx` has `getLayoutStyle` + 4 themes; `StorefrontLayout.tsx` hard-coded nav = Shop/About/Track/Contact (plan's default nav backfill matches exactly); `cart.ts` carries `variation_id?/variation_label?` and merges by `(product_id, variation_id)`; `Track.tsx` queries `orders` via the shared client selecting `customer_name` etc.; `Checkout.tsx` hard-codes 80/150; `AddOrderDialog.tsx` lines ~96/145/844 match the plan's citations (parse helper, `matchedVariation.price`, `"${name} - ${label}"`).
10. **StorefrontsPage:** 818 lines, 4 tabs (profile/content/domains/products) — plan fact 14 TRUE. Route in `App.tsx` has NO PermissionGuard (M3). `OrderDetailSheet.tsx` references `source` and has cancel paths (H3 wiring is feasible).
11. **`storefronts` DDL (20260516201928):** `hero_title/hero_subtitle/hero_image_url/about_md/policies/currency/is_active/social` all exist; `loadStorefront` selects `*` (new `nav`/`settings` columns flow without query changes; the `Storefront` TS interface needs the new fields).
12. **Build tooling:** `package.json` scripts = dev/build/lint/test(vitest)/test:watch — no `typecheck` (plan's "add one" is correct). `vercel.json` = single catch-all rewrite (M4b). `@playwright/test` present, no e-commerce e2e — plan's unit+manual posture is honest.
13. **`orders.idempotency_key` / `stock_restored_at`:** not present in any migration (only sync_queue has the pattern, 20260829000000) — plan's additions are genuinely new.
14. **Woo stock triggers:** `trg_auto_push_*` (20260831000500) enqueue `sync_queue` with `idempotency_key LIKE 'stock:%'` on products/variations stock writes; the aggregate trigger suppresses its own re-fire. Plan facts 1–2 TRUE; §9.6's "exactly one stock-push row" assertion is well-formed.
