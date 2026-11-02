# SIGNUP-BUSINESS-AUDIT — Post-Execution Audit of Sign-Up & Business Account System

> Triggered by user report after executing `ffb6648` ("feat(signup): self-serve signup, member-scoped RLS, and multi-tenant business provisioning").
> Method: direct evidence — migration reads, source reads, policy tracing. Every finding cites file:line.

## 0. What was executed (state map)

| Piece | Status |
|---|---|
| Migrations 1.1/1.2 (support tables, provisioning RPCs) | ✅ applied (incl. parity-row creation, see F2) |
| `20260929120000_member_scoped_rls.sql` (328 lines) | ✅ **writes only** — read-side untouched (F1) |
| `20260925130000_storefront_brand_link`, `…140000_publish_and_delete_rpcs` | ✅ (`publish_my_storefront`, `delete_unprovisioned_self`, purge + retention fns) |
| Edge fns: `signup-provision`, `signup-event`, `auth-resend`, `create-business`, `purge-unconfirmed` | ✅ present |
| Frontend: `/signup`, `/check-email`, `/auth/confirm`, `/welcome`, `/welcome/setup-failed`, `CreateBusinessDialog` | ✅ present |
| Business switcher (`AppSidebar` + `useBusinessContext`) | ✅ pre-existing, live |

## 1. User-reported problem 1 — "Switching business doesn't actually switch the account"

**Verdict: confirmed at TWO layers. The switcher changes a label; data is not isolated anywhere except two pages.**

### F1.1 — Frontend scoping map (evidence: per-page query reads)

| Surface | Uses business context | Filters data by active business |
|---|---|---|
| Orders | ❌ | ⚠️ filters by *selected store* only, not the business's stores |
| Customers | ❌ | ⚠️ same |
| POS | ❌ | ⚠️ same |
| PosReports | ❌ | ⚠️ same |
| Integrations | ❌ | ⚠️ same |
| **Products** | ❌ | ❌ **no filter at all — every product, every business** |
| **Dashboard** | ❌ | ❌ no filter |
| **Analytics** | ❌ | ❌ no filter |
| StorefrontsPage | ✅ | ✅ `.eq("business_id")` |
| StoresHub | ✅ | ✅ (per-brand panels) |

`.eq("business_id")` exists in exactly **two** places in the whole frontend (`useBusinessContext` itself + `StorefrontsPage`). Everything else renders the union of all businesses the user can access → switching the business changes nothing visible on those pages.

### F1.2 — DB read-side still open
`20260929120000_member_scoped_rls.sql` replaces only INSERT/UPDATE/DELETE policies for orders/products/customers/order_items (+ SELECT on stores/storefronts). The original **SELECT policies `USING (true)` on `orders`, `products`, `customers` (20260415001620) still stand** — every authenticated user can read every tenant's data.

### F1.3 — Even with perfect RLS, admin sees everything
`user_can_access_store()` short-circuits on `has_role('admin'|'staff')` (member_scoped_rls.sql:21–22) — correct for safety, but it means **the user-visible isolation for a platform-admin account depends entirely on frontend filters** (F1.1), which don't exist. This is why switching felt fake: as admin, you see the same global dataset on 8 of 10 surfaces.

**Fix direction (R2):** a canonical `useBusinessStores()` hook (active business → brand set → `woo_store_id`s + stores) applied to every data query; plus completing read-side RLS for member accounts. Admin UI becomes business-scoped; admin SQL/service-role access unchanged.

## 2. User-reported problem 2 — "New business shows WooCommerce/Facebook/Showroom as connected"

**Verdict: confirmed. Root cause = provisioning auto-creates a full template of placeholder rows.**

### F2.1 — `signup_create_business_core` (20260925120100, lines 99–142) still creates, per new business:
`stores` (placeholder URL, status 'disconnected'), `brands`, `locations` ('Main' showroom), `storefronts` (inactive), **4 selling_points** (Showroom POS / WooCommerce / Facebook / dokanos_storefront), **connector** (channel/woocommerce, 'disconnected'), **product_sources + customer_sources**. This was "parity with the July backfill" — correct per the old plan, wrong per the actual product: **a new business should start blank.**

### F2.2 — StoresHub renders all of them
`StoresHub.tsx:136–139` lists selling_points/connectors/product_sources/customer_sources per brand (badges at :581/:648 render `status === "connected"` vs secondary). Placeholder rows with 'disconnected' status still appear as channel cards → reads as "WooCommerce connected, Facebook connected…". Additionally `:137–139` include `brand_id.is.null` rows — **global/shared rows leak into every brand's list**.

### F2.3 — `Welcome.tsx` assumes the auto-provisioned storefront
It checks `storefronts.is_active` for the just-created business and offers publish. With blank-slate provisioning this becomes the **brand/store creation wizard** instead.

**Fix direction (R1 + R3 + R4):** strip provisioning to business + owner membership + permission bundle (no store/brand/rows); StoresHub shows only the brand's real rows, no NULL-brand leakage, "connected" only when actually connected; a guided post-creation flow: create store/brand → add locations/warehouse → connect selling points as explicit actions.

## 3. Other audit findings (unreported but blocking the same goals)

- **F3.1** `user_store_access` is created at provision time bound to the auto-store (core:199). Under blank-slate provisioning it must be created when the user creates their first store in onboarding.
- **F3.2** `publish_my_storefront` asserts ownership via the storefront→store→brand→business chain — fine today, but after R1 there is no storefront to publish until the onboarding creates it; the publish step moves into onboarding.
- **F3.3** Read-side RLS completion (F1.2) is required before opening signups to the public (plan's launch blocker) — currently reads remain open for every authenticated user, member or not.
- **F3.4** July-backfilled businesses keep their seeded rows (including real pathao connectors). We do NOT touch those; only stop creating new template rows (existing data preserved).

## 4. Remediation plan (v3 — post-critique rounds 1–2; see `SIGNUP-BUSINESS-AUDIT-CRITIQUE-1/2.md`)

**Release shape: R1+R3+R4a+R4 ship as ONE atomic release** (no window exists where provisioning is blank but onboarding doesn't exist — every interim signup would hit a broken Welcome). R2a→R2b→R2c→R2d ship as a second release. **Public signup launch stays gated on Release 2** — `signup_open` remains `false` until R2c/R2d land (real tenant data must never sit under the still-open `USING(true)` reads; §3 F3.3).

| # | Work | Size | Depends on |
|---|---|---|---|
| **R1** | Blank-slate provisioning: rewrite `signup_create_business_core` → business + UBA('owner') + **33-key bundle (32 + add `storefronts.view`; fix the "31" comment at 20260925120100:160)** only. Drop ALL row creation (store/brand/location/storefront/selling_points/connectors/sources/store-access). Keep: slug for businesses only, idempotency, all gates (anchor/nonce/expiry/provider/domain), consent, audit. **Remove** the store-access post-insert assertion (:208–212) coherently. **Move** the 3-table slug retry loop + `storefront_domain` check (20260925120100:81–153) into R4a's RPC. Add idempotency guard to `create_additional_business`: key = **(p_user_id, canonical slug-base)** matched against **that user's own** businesses created within the last 24 h — never a global key (user B invoking "My Shop" after user A took `my-shop` gets a fresh suffixed slug, never A's business); different names always create new. | 0.5 d | — |
| **R3** | Connection-truth UI: StoresHub drops `brand_id.is.null` leakage (:137–139); empty-state = "Connect" CTAs; badges only for real connections; scope by active business. **`useStoresList` fails CLOSED** (zero brand-stores → empty list + wizard CTA, never "all stores"). | 0.5 d | R1 |
| **R4a** | **NEW — member store-creation RPC** (the missing DB path; no member INSERT policy exists on `stores`/`user_store_access`): `create_my_brand_store(p_business_id, p_name)` SECURITY DEFINER — asserts caller UBA role IN ('owner','admin'); ONE transaction: store + brand(woo_store_id=store.id) + user_store_access(user, store) + **inactive placeholder `storefronts` row carrying the reserved slug** (restores the original 3-table atomic slug reservation; wizard step 4 publishes THIS storefront — no new storefront INSERT at step 4, no collision window); **carries the slug collision retry + `storefront_domain` check** moved from R1; idempotent per business (re-invoke → existing store/brand; **declared cap: one self-serve store/brand per business in this remediation** — the wizard creates the first store; additional stores are a future flow via the same RPC); own migration + verify fn; GRANT TO authenticated. | 1 d | R1 |
| **R4** | Onboarding wizard (atomic with R1): step 1 create store/brand (**via R4a RPC**); step 2 locations/warehouse (existing member INSERT via `is_business_member`, 20260904000100:338–348); step 3 connect selling points (existing member INSERT); step 4 optional storefront: attach `dokanos_storefront` selling_point (storefront_id+woo_store_id) to the **R4a-reserved placeholder storefront** → `publish_my_storefront` (its 4-assertion chain, 20260925140000:61–109, satisfied by construction). **Resume guard**: route-level check — active business with zero brands/stores → wizard (covers login, refresh, switch-back, cross-device). **AuthConfirm navigation** (BOTH call sites, :100 and :174) → wizard; Welcome.tsx replaced; CreateBusinessDialog hands off to wizard + copy rewrites (its storefront-URL preview :104 is false until step 4). **Wizard resumability**: business with store but zero selling points resumes at step 3. | 2.5 d | R4a |
| **R2a** | `useBusinessStores()` hook — active business → its brands → `woo_store_id` set; fail-closed. **The ONLY scoping source** — `usePermissions.storeIds`/`hasStoreAccess` must NOT be used for business scoping (fail-open, membership-union across ALL businesses, usePermissions.tsx:56–61). Apply to Products, Dashboard, Analytics (currently zero filters). | 1 d | — |
| **R2b** | Same hook for Orders, Customers, POS, PosReports, Integrations (replace selected-store-only filters) **+ the full picker/write-target checklist**: Orders.tsx:255, Customers.tsx:134/143, POS.tsx:244, PosReports.tsx:176, Integrations.tsx:61, AddOrderDialog.tsx:291, ProductList.tsx:134/231, ProductDetailSheet.tsx:185/392, CategoriesTab.tsx:48, MeasurementsTab.tsx:54, PreOrderCategoriesDialog.tsx:82, PreOrdersSettingsTab.tsx:31, UserAccessDialog.tsx:54, PathaoStoreLinks.tsx:31, storefront-admin/shared.tsx:61, GlobalSyncIndicator.tsx:56, StoreHealthGrid.tsx:35 — every store picker lists only the active business's stores; write targets (AddOrderDialog) can only write into the active business's stores. | 2 d | R2a |
| **R2c** | Complete read-side RLS — **full table list (all verified `USING(true)` TO authenticated in 20260415001620)**: orders (:26), products (:46), customers (:66), order_items (:87), order_payments (:107), order_timeline (:127), held_carts (:147), pos_returns (:167), **product_categories (:207), product_variations (:227), categories (:247 — decision: business-scoped dictionary)**. **DROP** those authenticated read policies (not merely "replace") and add `user_can_access_store`-scoped SELECTs (leaf tables via parent join: order_\*→orders.store_id; product_variations/product_categories→products.store_id; categories→store-scoped where used). `pos_shifts` is ALREADY user-scoped (`auth.uid() = user_id OR admin`, :186–188) — no change. **Explicitly RETAIN anon policies** ("Public can read active products" 20260620172022:6 — anon-only after :3 re-drop; product variations 20260914140000:18 — `TO anon, authenticated`, its authenticated branch is nullified by USING(true) until dropped, catalog survives via the retained anon branch; active storefronts member_scoped_rls:95–98; storefront_products 20260516201928:64) — public storefront reads must not break; the variations hole (cross-tenant prices of inactive/draft products, 20260914140000:14–16 comment) closes. Platform admin/staff stay global by design; UI isolation for admins comes from R2a/b. | 1 d | — |
| **R2d** | **NEW — member POS writes** (currently dead for every self-serve business: held_carts INSERT :149–151, pos_returns INSERT :169–171, pos_shifts INSERT :190–192 + UPDATE :194–196 are admin/staff-gated, while the 33-key bundle grants `pos.*` and the wizard provisions a Showroom POS selling point): add `user_can_access_store`-scoped INSERT/UPDATE policies for the three tables (pos_shifts via `selling_point_id`→`selling_points.business_id`), mirroring the member_scoped_rls pattern. | 0.5 d | R2c |

Total ≈ **9 person-days**. Release 1: R1+R3+R4a+R4 (atomic). Release 2: R2a → R2b → R2c → R2d.

### Acceptance criteria (per item) + gate-regression checklist

**R1**: provisioned business = exactly 1 `businesses` row + 1 UBA('owner') + 33 `user_permissions` rows; ZERO rows in stores/brands/locations/storefronts/selling_points/connectors/product_sources/customer_sources/user_store_access. All §10.3 gate tests (anchor/nonce/expiry/provider/domain/idempotency) re-run green unchanged.

**R4a/R4**: owner creates store/brand/location/selling-point via client under member JWT (no service key); owner/admin of business A cannot create in business B; **`member`/`viewer` UBA holders cannot invoke `create_my_brand_store`**; wizard resume at step 3 for store-without-selling-points state; publish works post-wizard on the **R4a-reserved storefront**; `storefronts.view` opens /storefronts for a fresh owner; **second invoke of `create_my_brand_store` for the same business returns the same store (single-store cap — declared, not accidental)**; **`create_additional_business` idempotency**: double-invoke same name in-window → same business_id; different name → new business; user B using user A's taken name → fresh suffixed slug, never A's business.

**R2**: switching between two businesses shows zero cross-data on ALL 10 surfaces (Orders, Products, Customers, POS, PosReports, Integrations, Dashboard, Analytics, Storefronts, StoresHub); every picker lists only active-business stores; useStoresList empty for blank business.

**R2c**: member-JWT read of another business's orders/order_items/customers/**product_variations/product_categories** returns zero rows; anon storefront catalog reads unchanged (cross-tenant inactive/draft product prices via variations — closed); existing backfilled businesses show their REAL connections in StoresHub, data untouched. **R2d**: owner opens/closes a POS shift, holds a cart, and processes a return under member JWT.

**Gate-regression (unchanged behavior asserted)**: kill switch (signup-provision/index.ts:48–57); purge + retention fns (20260925140000:202–276); `delete_unprovisioned_self` invariants (:170–180) under blank-slate (a provisioned owner HAS a UBA row → self-delete correctly does not apply to them); no `user_roles` rows from self-serve (SQL-asserted).

**Explicit product decision embedded (confirm):** after R2, your platform-admin login will see business-scoped data in the UI too (that's what makes switching real); full-platform views remain available via SQL/service role, and platform staff keep global authority by design.
