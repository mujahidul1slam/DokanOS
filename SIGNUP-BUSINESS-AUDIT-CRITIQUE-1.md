# SIGNUP-BUSINESS-AUDIT-CRITIQUE-1 — Remediation Plan Critique, Round 1

Reviewer: fresh-context adversarial agent (single-model; cross-model declined earlier — standing decision).
Artifact: `SIGNUP-BUSINESS-AUDIT.md` §4 remediation plan (R1, R3, R4, R2a/b/c).
All 12 findings validated against the plan text and verified against the repo (policies, RPC bodies, component queries). Classification: **12 × Valid + actionable** (0 noise, 0 contract-misread).

## Dispositions

### BLOCKER

1. **No member-usable path exists to create the first `stores` row or `user_store_access` row — R4's wizard was unimplementable as written.**
   Verified: `stores` has NO member INSERT policy anywhere (member_scoped_rls:68–83 = admin FOR ALL + member SELECT/UPDATE only; the pre-20260415001620 one was admin-only). `user_store_access` INSERT = admin-only (20260420112330:135–138). Only service_role provisioning fns create stores. Chicken-and-egg: brand link needs a store; stores can't be member-inserted.
   → **Plan v2: new work item R4a — member-callable `SECURITY DEFINER` RPC `create_my_brand_store(p_business_id, p_name)` asserting caller's UBA role IN ('owner','admin'), transactionally inserting store + brand(woo_store_id) + user_store_access; GRANT TO authenticated; own migration + verify fn.**

### MAJORS

2. **`publish_my_storefront`'s four-assertion chain never specced in R4** (store→brand→storefront→selling_points with storefront_id+woo_store_id, 20260925140000:61–109).
   → Plan v2: R4 specs the exact creation sequence; storefront insert rides the existing member INSERT policy (member_scoped_rls:100–103).
3. **R2b omitted ~15 unscoped stores pickers/write-targets** (Orders.tsx:255, Customers.tsx:134/143, POS.tsx:244, PosReports.tsx:176, Integrations.tsx:61, AddOrderDialog.tsx:291, ProductList.tsx:134/231, ProductDetailSheet.tsx:185/392, CategoriesTab.tsx:48, MeasurementsTab.tsx:54, PreOrderCategoriesDialog.tsx:82, PreOrdersSettingsTab.tsx:31, UserAccessDialog.tsx:54, PathaoStoreLinks.tsx:31, storefront-admin/shared.tsx:61, GlobalSyncIndicator.tsx:56, StoreHealthGrid.tsx:35) and `useStoresList` fails open when brand-stores are empty.
   → Plan v2: full component checklist folded into R2b; `useStoresList` fails CLOSED (zero brand-stores → empty list + wizard CTA).
4. **R2c's table list incomplete** — `order_items`, `order_payments`, `order_timeline`, `held_carts`, `pos_returns` keep `USING(true)` (20260415001620:86–167); a careless rewrite would also break public storefront reads (anon policies on products/storefronts/storefront_products).
   → Plan v2: R2c enumerates ALL tables (orders, order_items, order_payments, order_timeline, held_carts, pos_returns, pos_shifts, products, customers), explicitly RETAINS anon policies.
5. **No resume-onboarding route** — blank-slate owner logging in later lands on an empty Dashboard forever (Login → "/", PermissionGuard passes on bundle).
   → Plan v2: R4 adds a route-level guard: active business with zero brands/stores → wizard (covers login, refresh, switch-back, cross-device).
6. **R1 shipped before R4 — broken window** (every interim signup hits Welcome showing another tenant's storefront via an unscoped query; publish throws).
   → Plan v2: **R1+R3+R4 = one atomic release**; AuthConfirm nav (both call sites, :100/:174) + Welcome replacement + CreateBusinessDialog copy rewrites inside R4.
7. **Bundle is 32 keys (comment says 31) and lacks `storefronts.view`** — owner finishes the wizard, publishes, then gets "Access denied" on /storefronts.
   → Plan v2: add `storefronts.view` → 33 keys; corrected count in R1.
8. **Zero acceptance criteria; "keep gates" asserted, not verified.**
   → Plan v2: per-item acceptance criteria + gate-regression checklist (anchor/nonce/expiry/provider/domain; kill switch signup-provision/index.ts:48–57; purge fns 20260925140000:202–276; delete invariants :170–180 under blank-slate).
9. **Estimates too low** — R4 at 1.5d couldn't contain the wizard + RPC + guards + copy rewrites.
   → Plan v2: R4 → 3.5d (incl. R4a RPC), R2b → 2d (incl. picker sweep); total ≈ 8.5 pd.

### MINORS

10. **`usePermissions.storeIds`/`hasStoreAccess` is fail-open + membership-union** (usePermissions.tsx:56–61; get_user_store_ids unions across ALL businesses) — a trap for the R2 implementer.
    → Plan v2: R2a states `useBusinessStores()` is the ONLY scoping source; `storeIds` must not be used for business scoping.
11. **R1 drops the atomic 3-table slug retry and strands the `storefront_domain` check** (20260925120100:81–86, :91–153).
    → Plan v2: slug collision retry + storefront_domain check move into `create_my_brand_store` (R4a).
12. **Wizard idempotency/resumability undefined** (create_additional_business has no idempotency; mid-wizard refresh = half-built business).
    → Plan v2: wizard resume semantics = acceptance criterion ("store but zero selling points → resume at step 3"); `create_my_brand_store` idempotent per business.

Round-1 verdict: plan NOT acceptable as v1 → all 12 applied in §4 v2. Round 2 verifies.
