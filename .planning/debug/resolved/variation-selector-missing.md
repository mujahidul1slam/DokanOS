---
slug: variation-selector-missing
status: resolved
trigger: "When clicking a variable product in the add order picker, some products show no variation selector and are added without size variation; other products show only some size variations even though all are in stock."
created: 2026-10-07
updated: 2026-10-07
resolved_at: 2026-10-07
symptoms:
  expected_behavior: "In the add order screen, clicking a variable product with size variations should show a variation selector (dropdown) listing all available size variations to pick from before adding the item to the order."
  actual_behavior: "Both issues occur: (1) some products (Sarmad Beige Punjabi, Shahzrey, and more) show no variation selector at all and get added without any size variation despite being variable products with size variations; (2) some products (All Over Embroidery Punjabi - Navy Blue, Black Bootcut Gurkha Pants, and many more) show only some size variations in the selector even though all of them are in stock."
  error_messages: "No errors visible in browser console (F12) or WooCommerce logs."
  timeline: "Intermittent — happens only on some variable products, not all."
  reproduction: "Click a variable product in the add order screen picker → no variation selector / incomplete selector appears. Confirmed in add-order flow."
---

## Current Focus

| Field | Value |
|-------|-------|
| hypothesis | **CONFIRMED**: Supabase PostgREST server-side max-rows (1000) silently truncates AddOrderDialog's unpaginated `product_variations` fetch. Table has 1180 rows; the exact fetch the dialog sends returns 1000 (`Content-Range: 0-999/*`, HTTP 200, no error field). Products whose variations fall beyond row 1000 → zero rows → no variation selector, added without size (symptom 1); products straddling the boundary → partial fetch → only some sizes (symptom 2). No console errors because truncation is silent. |
| test | New `src/test/supabasePage.test.ts` (paged-fetch helper) + rerun storefrontVariations.test.ts + typecheck |
| expecting | All tests green, typecheck clean |
| next_action | apply fix (paged fetch helper + wire into AddOrderDialog + error catch), verify, commit, update Resolution |
| reasoning_checkpoint | *(n/a — root cause confirmed by live DB evidence)* |
| tdd_checkpoint | *(n/a — tdd_mode false)* |

## Evidence

- timestamp: 2026-10-07 (session-manager)
  - **Live DB check**: `product_variations` total = **1180 rows** (`Content-Range: 0-0/1180`). The exact unpaginated fetch AddOrderDialog sends (`select=id,product_id,name,sku,price,stock_quantity,attributes`, no limit) returns **exactly 1000 rows**, `Content-Range: 0-999/*`, HTTP 200 — **180 rows silently missing**.
  - **Reported products confirmed in the truncated page window**: `a9ff2413` (Sarmad Beige Punjabi) and `7c302eec` (Shahzrey) → **ZERO rows fetched** → no selector, added without size (symptom 1). `c39eaa6c` (All Over Embroidery - Black) → partial fetch → only some sizes (symptom 2). Boundary position depends on PostgREST scan order (no `.order()` clause) → explains intermittency across products/sessions.
  - All 10 queried products DO have 4–18 variations in the DB with matching lowercase uuid `product_id`s — data is intact; only the fetch truncates it.
  - `products` table total = 216 rows — under the cap, safe.
  - POS.tsx:178/208, MeasurementSlipPrint:167, pos/VariationModal:59 fetch product_variations with server-side `.eq()` filters → small subsets, safe from the cap. The unpaginated full-table fetch in AddOrderDialog is the single affected site.
  - The fetch chain `Promise.all([...]).then(...)` in AddOrderDialog has **no catch** — even a hard fetch failure would set variations=[] silently, the same visible outcome. Silent-failure prevention (error catch) is part of the fix.
  - **MISDIAGNOSIS CORRECTED**: the prior session's casing-drift fix (case-insensitive `getProductVariations`) is unsupported by data — DB has zero casing drift (1000/1000 sampled ids lowercase uuid). The helper is harmless (semantically exact for uuid: ids differing only in case ARE the same uuid) and stays, but it does not fix this bug.

## Eliminated

- hypothesis: Casing drift between `product_variations.product_id` and `products.id` — DISPROVEN by live DB check: all sampled product_ids are lowercase uuid, both columns are `uuid` type (Postgres normalizes output).
- hypothesis: RLS filtering variations at query level — anon-key query returns rows (RLS not blocking); all products' variations present in DB with matching ids; the fetch simply truncates at 1000.
- hypothesis: Client-side strict `===` comparison — works fine with normalized lowercase uuids from both tables; every add-order resolution path already goes through the shared helper in the working tree.

## Specialist Review

Reviewed against the code-review-and-quality five-axis checklist (mapped hint react/typescript; `typescript-expert` unavailable → closest skill used):

- **Correctness** ✓ — helper matches Postgres range/pagination semantics; edge cases tested (short page, exact page multiple, empty table, error throw, null data, custom page size); regression test covers both reported symptoms.
- **Readability** ✓ — documented helper, clear names; legacy `{key,value}` alias in AddOrderDialog documented.
- **Architecture** ✓ — canonical helper in `src/lib/`, reused pattern; no feature logic in shared modules.
- **Security** N/A — no user-input or auth changes.
- **Performance** ✓ — paged fetch is 2 requests for 1180 rows; same O(P×V) memoized lookup as before.
- **Verdict: LOOKS_GOOD** — with two Consider items (not blockers, out of reported scope):
  - *Consider:* paginate the `products` fetch too (216 rows today — safe, but will cross 1000 with growth).
  - *Consider:* variation modal `addItem` passes `productId: v.product_id` (AddOrderDialog ~1296) while every other call site passes the product's own `p.id` — harmless now (uuid normalized), inconsistent stylistically.

## Resolution

| Field | Value |
|-------|-------|
| root_cause | Supabase PostgREST server-side max-rows (1000) silently truncated AddOrderDialog's unpaginated `product_variations` fetch (table: 1180 rows; fetch returned 1000, `Content-Range: 0-999/*`, HTTP 200, no error) — products whose variations fell beyond the 1000-row window had zero rows fetched (no variation selector, added without size) or a partial fetch (only some sizes). Boundary position follows PostgREST scan order (no `.order()` clause), explaining the per-product intermittency. A prior session's casing-drift hypothesis was disproven (DB has zero casing drift) but its harmless case-insensitive helper remains. |
| fix | Added `fetchAllRows` paged-fetch helper (`src/lib/supabasePage.ts`) that walks range windows until a short page and throws on error; wired it into AddOrderDialog's `product_variations` fetch (`.range(from, to)` per page) and added a `.catch` on the catalog fetch chain so a failed fetch is never silently swallowed. |
| verification | 22/22 tests pass (8 new `src/test/supabasePage.test.ts` incl. the 1180-row regression + 14 existing storefrontVariations); `tsc --noEmit` exit 0; live-DB simulation of the exact paged fetch returned all 1180 rows with all four reported products fully covered (Sarmad Beige 4/4, Shahzrey 4/4, All Over Embroidery - Black 4/4, Gurkha Pant 18/18). |
| files_changed | src/lib/supabasePage.ts (new), src/test/supabasePage.test.ts (new), src/components/orders/AddOrderDialog.tsx, src/lib/variations.ts, src/test/storefrontVariations.test.ts |
