# Legacy / unattributed pool semantics (Task 15)

Work landed 2026-11-01 (commit hash recorded in [cutover-status.md](cutover-status.md) once phase 2 commits). Spec §7; pool rows are produced by `scripts/migrate-enveil-vincent.sql` step 10 (:361–374).

## Pool predicates (as the migration script actually writes them)
- Orders: `source='legacy migration'` AND `store_id IS NULL` AND `storefront_id IS NULL` AND `order_source_id IS NULL` (Task 16 dropped `selling_point_id`; the predicate is now three binding columns).
- Customers: `source='legacy migration'` AND `origin_kind='legacy'` AND `store_id IS NULL` AND `origin_order_source_id IS NULL`.
- The TAG identifies a pool row; the NULL-binding half is what makes reassignment drain it. **Task 16 kept `orders.source`/`customers.source`** (Safe-contract scope: the key-model migration that would retire the tag is a separate documented follow-up), so the tag survives in place.

## Reassign semantics (dual-write, same as the script's steps 7–9)
- Bind the chosen brand's order source (`orders.order_source_id` / `customers.origin_order_source_id`), keep `customers.origin_kind='legacy'`, and — when the brand has a legacy store — the transitional `store_id = brands.woo_store_id` (the app's operational queries + RLS still scope through it; same pattern as `POS.tsx`/`AddOrderDialog` at the time). Store-less brands take the source-only path.

## RLS gap discovered (2026-11-01)
- Every existing orders/customers policy required `store_id IS NOT NULL AND user_can_access_store(store_id)` — pool rows passed **no** policy: invisible and unmodifiable via PostgREST before this task.
- Migration `20261102120000_legacy_pool_rls.sql` (policies only, no schema change): pool read for active-business members, pool reassign UPDATE for owner/admin/manager (staff read-only) with a WITH CHECK that only allows moving a row into a binding the operator can access; plus source-attribution read/update legs so source-bound rows (including the refreshed rehearsal's 809 inferred orders) are visible to the source's business, with a store-consistency guard.
- **Documented trade-off:** pool rows are unowned by construction (no business/brand binding), so their tenancy gate is membership in the server-side ACTIVE business context — right for the single real tenant post-migration; in a multi-business world unowned rows are shared by whichever business a member has active (outsiders fail closed). Pinned in `supabase/tests/rls/legacy_pool_test.sql`.
- **Recommendation for Task 16's contract:** stamp `business_id` onto pool rows (one UPDATE in the migration script) so the pool becomes truly per-business. Not done in Task 15 — it would change the line-cited script content. → **IMPLEMENTED in Task 16** (below).

## Task 16 addendum (2026-11-02): account stamping + the account leg
- `orders`/`customers` gained `business_id uuid REFERENCES businesses(id) ON DELETE SET NULL` (`20261103120000` §1). The migration's §2 stamps pool rows with the legacy account when the `order_sources` legacy mapping (`legacy_store_id`/`legacy_selling_point_id` → brands) resolves to exactly one business — production's 99 pool rows (48 orders / 51 customers) stamp to Enveil Vincent `de31fd60-a520-4d42-aef2-c72ededc4c09`; ambiguous or empty mappings leave rows unstamped with a NOTICE.
- Pool RLS recreated (§4) with the account leg: `(business_id IS NULL OR business_id = current_business_context())` on read and reassign — stamped rows are visible only to their own business; unstamped rows keep the shared-active-context trade-off above. The reassign WITH CHECK now also accepts a stamped-row handoff to a store/source the operator can access (drains the pool into tenancy).
- The Task 15 test file was updated in place (`supabase/tests/rls/legacy_pool_test.sql`): predicates drop the `selling_point_id` leg; behavioral coverage unchanged (manager reassigns, staff read-only, cross-business denial, outsider fail-closed).

## related
- [onboarding-design.md](onboarding-design.md) (provenance columns from Tasks 4/13) · [cutover-status.md](cutover-status.md) (refreshed dry-run numbers: pool 48 orders / 51 customers; 809 orders inferred; 1,162 customers resolved via connected-order evidence)
