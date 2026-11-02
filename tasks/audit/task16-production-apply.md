# Task 16 production apply — pre-flight record + gated run card

**Status: APPLIED 2026-11-02 (user-approved), post-verified 24/24, UI smoke green after a frontend
redeploy.** The migration is `supabase/migrations/20261103120000_task16_contract_drop.sql` (committed
`231f773`, battery-green locally: RLS 28/28, vitest 496 passed | 3 skipped, typecheck + build clean).

## 1. Pre-state probe — 22/22 PASS (2026-11-02, read-only Management-API probe)

| Check | Expected | Actual |
| --- | --- | --- |
| Ledger | count 191, head `20261103100000`, Task 16 pending | ✅ 191 / `20261103100000` / 0 |
| 7 legacy tables present | all | ✅ legacy_order_channels 3, connectors 4, product_sources 2, customer_sources 2, brand_stores 0, selling_points 8, locations 3 |
| 5 dead columns present | all | ✅ orders.selling_point_id, orders.location_id, product_locations.location_id, purchase_orders.location_id, pos_shifts.selling_point_id |
| `business_id` on orders/customers | absent | ✅ absent on both |
| Pool rows | 48 orders / 51 customers | ✅ 48 / 51 |
| Legacy mapping ambiguity | exactly 1 business | ✅ 1 business (8 mapped sources) = Enveil Vincent `de31fd60-a520-4d42-aef2-c72ededc4c09` → §2 stamps all 99 pool rows |
| `publish_my_storefront` pre-state | references selling_points | ✅ |
| Dead RPCs present | both | ✅ create_brand_store, brand_store_legacy_links_valid |
| `product_locations_one_holder` | references location_id | ✅ |
| Row snapshot | — | orders 4,095 / customers 3,247 / products 225 (live traffic since the 06:02 data migration: +2 orders, +1 customer) |

## 2. Rollback basis — fresh pre-drop dumps

Taken immediately before the apply (supersedes the 04:59 pre-data dumps for THIS step; the older
pair remains the data-migration rollback):

- `C:\Users\mujah\dokan-prod-backups\20261102-pre-task16-drop\prod-schema-public.sql` — 355,666 B, sha256 `8F7C57C2E2507A0EF9D2D07B52830E0EBD715F8FDF84D9A5C3B6C0C838BEA489`
- `C:\Users\mujah\dokan-prod-backups\20261102-pre-task16-drop\prod-data-public.sql` — 21,852,087 B, sha256 `3D845D39D7EDCEEC26C0B88A690C61A550B06BC179E6A7FBDFBA0D17E6642F1F`

Restore-verified into a throwaway local database before the apply (same proven procedure as
2026-11-01: create scratch → restore schema → restore data → row-count spot check → drop scratch).
Result: **PASS** — schema restored clean (after stubbing `auth.users`/`auth.uid()`/`auth.jwt()` +
`pg_trgm`, which live outside the public-schema dump); data restored under
`session_replication_role=replica` (the known circular FK on `categories`); spot counts match the
live probe exactly — orders 4,095 / customers 3,247 / products 225 / order_items 5,329 / pool 48+51 /
selling_points 8 / locations 3. Scratch DB dropped after verification.

**Rollback procedure if the apply fails mid-way:** the migration is a single transaction — a failed
apply leaves production untouched; re-run after fixing the cause. If the apply SUCCEEDS and a defect
is found later, rollback = restore the two dumps above into the project (destructive, last resort —
loses any data written after the dump; coordinate a freeze first).

## 3. Apply (USER-GATED — **approved 2026-11-02**)

```powershell
npx supabase db push --linked --yes     # pushes exactly the one pending migration
```

Expected output: `20261103120000_task16_contract_drop.sql` applied; NOTICE lines
`task16: stamped 51 pool customers with legacy business de31fd60-…` and
`task16: stamped 48 pool orders with legacy business de31fd60-…`; ledger 191 → **192**.

**Attempt log:**
1. **First push FAILED cleanly** (2026-11-02, pre-fix file): `ERROR: column "business_id" of relation
   "customers" does not exist (SQLSTATE 42703)` — the stamping § ran before the column-add §; the
   hosted apply executes the batch in file order and production's unambiguous mapping exercises the
   branch the local battery never reaches. Single transaction → rolled back; ledger verified still
   191 / `20261103100000`; zero production changes.
2. **Fix**: the two `ALTER TABLE … ADD COLUMN business_id` statements moved above the stamping block
   (now §1 columns → §2 stamping); lesson recorded in [../wiki/environment-quirks.md](../wiki/environment-quirks.md);
   full `db reset` battery re-run proves the fixed file applies on a clean database.
3. **Second push SUCCEEDED** (2026-11-02 ~09:25 +06, log `.tmp/task16-push2.log`): applied
   `20261103120000_task16_contract_drop.sql` with the expected NOTICEs —
   `task16: stamped 51 pool customers with legacy business de31fd60-a520-4d42-aef2-c72ededc4c09`,
   `task16: stamped 48 pool orders with legacy business de31fd60-…`,
   `pool customers 51 (51 stamped), pool orders 48 (48 stamped)`.

## 4. Post-verify — 24/24 PASS (2026-11-02, read-only Management-API probe)

All §4 checks green: ledger **192 / `20261103120000`**; 7 tables dropped (regclass NULL); 5 dead
columns gone; `business_id` present on orders + customers; pool stamped **48/48 orders + 51/51
customers, 0 unstamped**; `publish_my_storefront` rewritten (selling_points refs = false, brand leg
= true); dead RPCs gone; one-holder CHECK two-way
`CHECK (((warehouse_id IS NOT NULL)::integer + (stock_holder_order_source_id IS NOT NULL)::integer) = 1)`;
4 pool policies, none referencing `selling_point_id`; 3/3 `order_sources.legacy_*` mapping columns
survive; `is_signup_open()` still true. Row snapshot **identical to the pre-apply probe** — orders
4,095 / customers 3,247 / products 225 / order_items 5,329 (zero data loss).

**UI smoke + one incident**: the first smoke on `dokanos.vercel.app` found Order Sources failing
("Failed to load order sources") — the deployed bundle `index-CR_kWxJC.js` predated the Task 16
client surgery and still queried the dropped tables (no compat views exist by design). **Remedy:
redeployed the frontend** — build clean (29.06s, new bundle `index-CuPRDVZ_.js`), `vercel --prod`
aliased to `dokanos.vercel.app` (Ready in 44s). Re-smoke **all green**: Dashboard renders (Dispatch
gone from the sidebar); Order Sources loads 8 sources with the legacy section showing only the two
Woo-store sync rows (Enveil + Vincent, mapping columns intact); Brands shows no store UI (subtitle
"Legacy Woo store linked" kept); Settings → Courier services shows the 2 Pathao services with the
legacy-mapped badge and no legacy section; an order detail sheet renders with the source binding
("Vincent WooCommerce") and no "Fulfill From" picker; Legacy Pool shows 48 orders + 51 customers
with Reassign actions under the Enveil Vincent context (the account leg live).

## 4a. Post-verify checks (the SQL that was run)

```sql
SELECT count(*)::int AS n, max(version) AS head FROM supabase_migrations.schema_migrations;  -- 192 / 20261103120000
SELECT to_regclass('public.selling_points'), to_regclass('public.locations'),
       to_regclass('public.brand_stores'), to_regclass('public.connectors'),
       to_regclass('public.product_sources'), to_regclass('public.customer_sources'),
       to_regclass('public.legacy_order_channels');                                          -- all NULL
SELECT count(*) FROM information_schema.columns WHERE table_schema='public'
  AND ((table_name='orders' AND column_name IN ('selling_point_id','location_id'))
    OR (table_name='product_locations' AND column_name='location_id')
    OR (table_name='purchase_orders' AND column_name='location_id')
    OR (table_name='pos_shifts' AND column_name='selling_point_id'));                        -- 0
SELECT count(*) FROM public.orders  WHERE business_id = 'de31fd60-a520-4d42-aef2-c72ededc4c09'
  AND source='legacy migration' AND store_id IS NULL AND storefront_id IS NULL
  AND order_source_id IS NULL;                                                               -- 48
SELECT count(*) FROM public.customers WHERE business_id = 'de31fd60-a520-4d42-aef2-c72ededc4c09'
  AND source='legacy migration' AND origin_kind='legacy' AND store_id IS NULL
  AND origin_order_source_id IS NULL;                                                        -- 51
SELECT position('selling_points' in pg_get_functiondef('public.publish_my_storefront(uuid)'::regprocedure)) > 0;  -- false
SELECT to_regprocedure('public.create_brand_store(uuid,text,text)'),
       to_regprocedure('public.brand_store_legacy_links_valid(uuid,uuid,uuid,uuid)');        -- both NULL
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='product_locations_one_holder';
                                                                                             -- two-way CHECK, no location_id
SELECT count(*) FROM pg_policies WHERE tablename IN ('orders','customers')
  AND schemaname='public' AND policyname LIKE '%pool%';                                      -- 4 pool policies, none referencing selling_point_id
SELECT public.is_signup_open();                                                              -- true (signup still open)
```

## 5. Follow-ups recorded (not blockers)

- Key-model migration (`orders.source`/`customers.source` → structured attribution): **EXECUTED
  2026-11-02** as `20261103140000_key_model_attribution.sql` — `business_id` backfilled for every
  order/customer, derivation triggers added, RLS rewritten to plain `business_id` tenancy, pool
  membership made structural. The tag survives as data only. Production apply is user-gated.
- `tasks/wiki/transitional-store-model.md` records that all `legacy_*` mapping columns survive as
  the historical sync record.
