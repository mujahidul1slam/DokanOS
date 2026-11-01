# Cutover runbook — Enveil Vincent mapping migration (Task 17)

> ## ⛔ USER-GATED — READ FIRST
>
> **This runbook performs NO action by itself and NO production write may happen without the
> user's explicit go-ahead.** Three separate user gates exist below (Gates 1–3) and each must be
> answered explicitly before its step runs:
>
> - **Gate 1** — explicit user go-ahead before the production migration chain (catch-up batch +
>   schema wave) is applied.
> - **Gate 2** — explicit user go-ahead immediately before `scripts/migrate-enveil-vincent.sql`
>   touches production data (the only step that writes/mutates tenant rows).
> - **Gate 3** — the user personally reviews and **signs off the live post-migration audit
>   report** before the new UI is enabled/announced.
>
> If any gate is unanswered: **stop**. Everything up to Gate 2 is read-only or scratch-local;
> nothing proceeds on assumption.

Status: **DOCUMENTATION ONLY (Task 17 deliverable). Nothing in this runbook has been executed
against production.** Production execution is a separate, human-approved action following this
document verbatim.

Real tenant (the only keep): business `de31fd60-a520-4d42-aef2-c72ededc4c09` **Enveil Vincent**
(brands Vincent `ca061912-27a6-4eb5-a859-b77e9a347a30`, Enveil `3eb99fc9-7826-4890-ace0-78af0dfdf972`)
— per `DOMAIN-REVAMP-SPEC.md` §7.

Sources for every step are cited inline; the executable truth lives in
`scripts/migrate-enveil-vincent.sql` and `scripts/task8-audit.mjs` — **run those files, do not
retype their statements from this document.** Expected counts come from
`tasks/audit/task8-dry-run-report.md` (dry-run against `task8_scratch`, refreshed extract of 2026-11-01).

## ⚠ Name traps — everything by UUID, never by name

(`DOMAIN-REVAMP-SPEC.md` §7; `scripts/migrate-enveil-vincent.sql:11-16`)

- **Two businesses are named "Enveil Vincent"** — the real one `de31fd60-…` and a 2-minute
  onboarding skeleton `13e888dc-…` (zero data, wiped).
- Selling point `9d2cc780-…` "Enveil Woocommerce" (**junk, delete**) vs `9a3fb6c0-…`
  "Enveil WooCommerce" (**real, keep**) differ by one word.
- The test storefront "AGS" `a8ff5e33-…` points at the **real Enveil store** `4f3e88d1-…` —
  that link is severed **first**, before any delete.
- Two order sources share the display name "Main Showroom" and two share
  "Facebook / Instagram" (one pair per brand) — identify rows by UUID, never by name.

## 0. What runs where (cross-checked against the tooling)

| Concern | Tool | Runs against |
|---|---|---|
| Read-only production inventory | `scripts/task8-extract-prod.mjs` | production, **SELECT-only** via the Supabase Management API (refuses non-SELECT, `scripts/task8-extract-prod.mjs:56-60`) |
| Scratch DB build | `scripts/task8-build-scratch.mjs` | local `task8_scratch` only (refuses non-local hosts, `scripts/task8-build-scratch.mjs:26-29`) |
| Rehearsal = apply + audit + idempotency + report | `scripts/task8-audit.mjs` | local scratch only — **it refuses any non-local database and never touches production** (`scripts/task8-audit.mjs:12`, `:132-139`) |
| Production apply (Gate 2) | `scripts/migrate-enveil-vincent.sql` | production, **one transaction** — via `psql`/SQL editor (see Phase 2) |
| Live audit (Gate 3 input) | the same queries `scripts/task8-audit.mjs` runs (`collectAudit` `:52-108`, `ordersPerSource` `:110-118`) | production, **read-only** |

> Note: the Task 17 card phrases production execution as "run `scripts/migrate-enveil-vincent.sql`
> via `scripts/task8-audit.mjs`". That orchestration script is deliberately local-only (it derives
> its connection from `supabase status`, refuses non-local hostnames, and always writes the
> scratch report `tasks/audit/task8-dry-run-report.md`), so against production the **same SQL
> file** is applied directly and the **same audit queries** are reused read-only. The rehearsal
> (Phase 1) is exactly the card's task8-audit.mjs flow.

## 1. Preconditions — in this order

The migration script itself lists these preconditions (`scripts/migrate-enveil-vincent.sql:18-25`)
and refuses to run outside them (guard `:33-45`).

1. **Checkpoints A–E complete** (Task 17 dependency, `tasks/todo.md` Task 17): Tasks 1–15 done,
   tests/typecheck/build green, dry-run report reviewed with the human (Checkpoint C).
2. **Production migration chain applied first** — reconciled with
   `tasks/audit/production-migration-plan.md`: **28 files, in filename order**
   (re-verified read-only 2026-11-01, `tasks/audit/task17-readiness-report.md` §2).
   **Gate 1 approved 2026-11-01 (user): rollback basis = proven logical dump; scope = all 28.**
   ✅ **APPLIED 2026-11-01 19:54** — `supabase db push --linked --yes`, exit 0, all 28 in filename
   order. Post-state: ledger **190**, head **`20261103090000`**, `is_signup_open()` live,
   `legacy_order_channels` keeps its 3 rows, new tables + `joined_via` present, business/customer/
   order/product counts unchanged (8 / 3,246 / 4,092 / 225). Verification table:
   `tasks/audit/task17-readiness-report.md` §7. Two follow-ups it surfaced: the Vercel build for the
   pushed branch had **not** landed at the time of writing (the live bundle still queries the legacy
   `order_sources` shape), and nine public tables are RLS-disabled (§8 of the report).
   - The **19-file catch-up batch** (16 pending migrations + repair
     `20261030090000_repair_audit_drift` + Phase-1 `20261030180000_profiles_default_business`,
     `20261030200000_profile_setup`). **Signup on production is fail-closed until #10
     `20261022120000_signup_config_accessor` lands** (`is_signup_open()` missing there — verified
     `PGRST202`, `tasks/audit/production-migration-plan.md` §"Where production stands").
   - Then the **domain-revamp schema wave** (5 files, in filename order):
     `20261031090000_unified_order_sources`, `20261031113000_warehouses_stock`,
     `20261031140000_courier_services`, `20261031180000_payment_accounts`,
     `20261101090000_role_ladder_rename` (Tasks 4/5/9/10/12). The data script needs at least
     the first three: it writes `order_sources` (incl. `legacy_*` columns),
     `warehouses`/`product_locations` stock holders, and `courier_services`
     (`scripts/migrate-enveil-vincent.sql:184-205`) — note the script header says "Tasks 4–5
     schema" but step 2b also requires `courier_services` from `20261031140000`.
   - Then the **4 integration migrations**: `20261102090000_business_onboarding` (Task 13),
     `20261102120000_legacy_pool_rls` + `20261102150000_storefront_brand_scoped_rls` (Task 15),
     `20261103090000_operational_store_provisioning` (option B).
   - ⚠ **#20 `20261031090000_unified_order_sources` renames the legacy `order_sources` table** to
     `legacy_order_channels` and recreates `order_sources` with a different column set. The
     currently deployed frontend (build of 2026-10-30) still queries the legacy shape
     (`is_default`/`sort_order`), so those pages error from #20 onward until the new frontend
     ships — no data loss, but the deploy must be part of this window (§1 precondition 3).
   - ✅ **Resolved (2026-11-01):** the earlier worktree blocker — batch files #10/#11 apparently
     deleted by a foreign actor — is **dissolved**. Both files are present, clean, and committed
     (`20261022120000_signup_config_accessor.sql` blob `f3e80e8c79c7a823ee3569f962c43bea37d5da4f`,
     `20261023100000_signup_service_role_grants.sql` blob `c07b6a333e9f042ffdf7ceeee3ff79b9a1924b34`;
     `git status --short -- supabase/migrations` empty). No restore action is needed.
3. **Frontend deployed together with the batch** (apply-order warning,
   `tasks/audit/production-migration-plan.md` §"Apply-order warning"). Measured against the actual
   deployed bundle (all 89 chunks crawled read-only, 2026-11-01): the live build references
   **no `app_config`** at all, so the older "app_config 401" concern does not apply. The real
   constraint is legacy row shapes: the deployed UI still reads `order_sources.select("id, name,
   is_default")` / `order("sort_order")` and inserts `{name, sort_order}`, which **break at #20**.
   Sequence the window as **chain → frontend deploy → smoke → lift freeze**. Note the repo has no
   `.vercel/` link and the branch is 51 commits ahead of `origin`; the new build reaches production
   only after those commits are pushed (outbound action — user-visible, not yet done).
4. **Fresh rehearsal green** (Phase 1 below) on an extract taken ≤24 h before the window.

## 2. Phase 1 — Rehearsal on a scratch DB (no production writes)

Exactly the Task 8 tooling flow (`tasks/audit/task8-dry-run-report.md` header links):

```bash
# 1. READ-ONLY extract of production (SELECT-only; writes PII to .tmp-task8/extract/ —
#    NEVER commit that directory). Credentials: SUPABASE_ACCESS_TOKEN or
#    ~/.supabase/access-token-extracted; project from SUPABASE_PROJECT_ID or .env
#    VITE_SUPABASE_PROJECT_ID. (scripts/task8-extract-prod.mjs)
node scripts/task8-extract-prod.mjs

# 2. Build local task8_scratch: full repo schema (must include the schema wave above)
#    + the extract, FK-safe load order. Local stack must be up:
#    supabase start && supabase db reset --local. (scripts/task8-build-scratch.mjs)
node scripts/task8-build-scratch.mjs

# 3. Rehearse: audit-before → apply scripts/migrate-enveil-vincent.sql (one transaction)
#    → audit-after + 12 acceptance checks → idempotency re-run (guard must refuse)
#    → writes tasks/audit/task8-dry-run-report.md. (scripts/task8-audit.mjs)
node scripts/task8-audit.mjs
```

Pass criteria (from the refreshed 2026-11-01 run, `tasks/audit/task8-dry-run-report.md` §"Acceptance
checks"): **all 12 checks ✅** — idempotent apply (second run refused by the guard, audits
identical), 4 sources + warehouses per brand, 225 products preserved & attributed, customers
preserved + 2 merged, pool customers with connected-order product evidence attributed, bound orders
preserved + 809 inferred, residual legacy pool recorded, all resolvable orders attributed, junk + test
data wiped (incl. AGS link severed first), stock repointed (205 rows, none moved), no name-based
lookups (static scan `scripts/task8-audit.mjs:137-141`), and 2 courier services mapped.

**Preserve the refreshed report** (copy it to a dated file before the run overwrites
`tasks/audit/task8-dry-run-report.md`) — its "After" values are the **live-audit expected counts**
for Phase 4 (the reference is a rehearsal snapshot; production keeps trading, so customer/order
totals drift upward — take a fresh extract in the same window before applying exact-count checks).

## 3. Phase 2 — Backup + maintenance window (Gate 1, then Gate 2)

Per `DOMAIN-REVAMP-SPEC.md` §7: one-shot in a short maintenance window (brief read-only freeze),
rollback = the pre-migration backup.

1. **Gate 1 — user go-ahead.** ✅ **GIVEN 2026-11-01** (user, via readiness review):
   rollback basis = the proven logical dump (no native backup/PITR exists); scope = **all 28
   migrations**. Record who/when for any *further* go-ahead before anything below. (The 28-file
   chain is separately gated from the data script — Gate 2 — and follows the plan's pre/post-checks.
   Apply order: chain (28) → frontend deploy → this runbook.)
2. **Backup** (the rollback — there are NO DOWN scripts,
   `tasks/audit/production-migration-plan.md` §"Pre-checks" 1): production has no native backup and
   no PITR, so the rollback is the **logical dump** taken and restore-verified on 2026-11-01
   (`prod-schema-public.sql` + `prod-data-public.sql`; checksums and durable copy location in
   `tasks/audit/task17-readiness-report.md` §1). **Re-take it after the 28-file chain lands,
   immediately before the data script**, and record the dump time + checksums here as the recovery
   timestamp. Confirm the durable copy is readable before proceeding.
3. **Maintenance window + brief read-only freeze** (spec §7): pause order entry/POS/trading for
   the window (minutes, not hours). Note: both Woo stores currently report `status=error`
   (`tasks/plan.md` risks table) — flag to the user separately; the migration does not depend on
   sync health.
4. **Pre-flight read-only checks** (`tasks/audit/production-migration-plan.md` §"Pre-checks"
   2–5, plus the script guard's own preconditions):

   ```sql
   -- signup restored? (batch #10 landed)
   SELECT to_regprocedure('public.is_signup_open()');                     -- NOT NULL
   -- script guard clean? (scripts/migrate-enveil-vincent.sql:33-39)
   SELECT count(*) FROM public.order_sources WHERE legacy_store_id IS NOT NULL;  -- 0
   -- real tenant present? (scripts/migrate-enveil-vincent.sql:40-44)
   SELECT count(*) FROM public.businesses
    WHERE id = 'de31fd60-a520-4d42-aef2-c72ededc4c09';                    -- 1
   -- drift repair still converged? (plan pre-check 2)
   SELECT count(*) FROM public.webhook_events
    WHERE created_at IS NULL OR status_code IS NULL OR topic IS NULL;     -- 0
   -- row-count snapshot for after-comparison (plan pre-check 4)
   SELECT 'orders' t, count(*) FROM public.orders
   UNION ALL SELECT 'customers', count(*) FROM public.customers
   UNION ALL SELECT 'products', count(*) FROM public.products;
   -- grants snapshot saved to a file (plan pre-check 5; rollback aid)
   SELECT grantee, table_name, privilege_type
     FROM information_schema.role_table_grants WHERE table_schema = 'public';
   ```

5. **Gate 2 — user go-ahead for the data migration.** Explicit, immediate, recorded. If not
   given: lift the freeze and stop. Nothing has been written yet.

## 4. Phase 2 (cont.) — Execute the migration

Run the **file**, unedited, as one script:

```bash
psql "$PRODUCTION_DB_URL" -v ON_ERROR_STOP=1 -f scripts/migrate-enveil-vincent.sql
```

(The Supabase dashboard SQL editor with the whole file pasted as one script is acceptable.) The
file self-wraps in `BEGIN`/`COMMIT` (`scripts/migrate-enveil-vincent.sql:28`, `:442`) — **the
apply is all-or-nothing**; a mid-script error rolls everything back and mutates nothing.

What the script does, step by step (exact behavior — the runbook matches the file):

| Step | What happens | Where |
|---|---|---|
| 0 | **Guard**: refuses "task8: mapping already applied" if any `order_sources.legacy_*` is set; refuses if the real tenant business is missing | `scripts/migrate-enveil-vincent.sql:33-45` |
| 1 | **Sever the AGS → real-Enveil-store link FIRST** (Q24/Q27, spec §7 warning): delete `storefront_pages` then the storefront row `a8ff5e33-…` (the test "AGS" storefront that points at the real Enveil store `4f3e88d1-…`) — before any other delete | `:47-53` |
| 2 | **Create the 8 mapped order sources** (4/brand): WooCommerce / Storefront / Showroom / Facebook-Instagram per brand, config (Woo URL + API keys, storefront slug) **copied from the legacy rows at runtime** (credentials never in the file), `legacy_*` mapping columns filled with the source legacy ids, showroom = stock-holding ON + ship-from-store ON, digital sources get a warehouse-first-then-showroom `fulfillment_preference` | `:62-176` |
| 2b | **Courier services (Task 9)**: 2 Pathao `pathao_integrations` → 2 business-level `courier_services`, credentials copied at runtime, paired to their courier `connectors` via `config.integration_id` (no name lookups) | `:184-205` |
| 3 | **Warehouse**: location `42cceea7-…` "Warehouse" (Vincent) → 1 `warehouses` row (Enveil has none — spec §7 "no warehouse yet — fine") | `:211-215` |
| 4 | **Stock repoint** (rows never move): the 205 `product_locations` rows repoint `location_id` → `stock_holder_order_source_id` (both showrooms) or `warehouse_id` (warehouse), `location_id` cleared | `:222-232` |
| 5 | **Products provenance**: all products (Woo-synced) get `origin_order_source_id` = their brand's WooCommerce source, `origin_kind='woo_sync'` | `:237-243` |
| 6 | **Customer merges (BEFORE attribution)**: the 2 audited phone/alias duplicates (`c4444444-…`, `c7777777-…`) merge into brand customer `c1111111-…` — orders repointed, aliases merged **with de-duplication** against `uq_customer_alias_value`, dup rows deleted. The one further strict email-alias duplicate (`1a689ee5-…` → `4d0d1b7d-…`) is **deliberately left in the pool** (Checkpoint C review item) | `:252-272` |
| 7 | **Store-bound customers → provenance**: `origin_order_source_id` + `origin_kind` per channel (online/woo-id → woo_sync, pos → pos, fb/ig → manual, else manual/no source) | `:278-299` |
| 8 | **Store-bound orders → mapped source**: online/woocommerce/woo-id → WooCommerce; fb/ig → Facebook/Instagram; everything else on the counter (exchange/split/…) → Showroom | `:306-322` |
| 8b | **Pool customers with connected-order evidence → brand**: for each still-unattributed customer, use the connected order's store/source or its ordered products to infer a brand; mixed-brand evidence chooses the earliest connected order's brand, then the customer's still-unattributed orders follow in step 9 | `:325-399` |
| 9 | **Inference for remaining unattributed orders**: brand resolved via customer id match (wins) or exactly-one store-bound customer on the order's phone, then attributed by channel text (pos/exchange → showroom, fb/ig → Facebook). The refreshed rehearsal resolved 809 orders (97 at the original spec scope); `orders.inferable` must reach 0 | `:402-435` |
| 10 | **Legacy pool**: remaining unattributed orders/customers tagged `source='legacy migration'` (customers also `origin_kind='legacy'`), business-level pool, reassignable later (Task 15). After step 8b this is the residual no-evidence pool; its free-text channel is overwritten and the tag remains a Task 16 migration concern | `:438-452` |
| 11 | **Junk rows inside the real business** (spec §7): brand `d56f8d28-…` "safsdfsafsd" + its storefront `94cd65c5-…` (+2 pages); selling points `7df6baea-…` "Badda Showroom" and `9d2cc780-…` "Enveil Woocommerce" (**the junk one** — not `9a3fb6c0-…`) | `:379-385` |
| 12 | **Test-data wipe** (Q24/Q27, spec §7), children first: storefront pages→storefronts (6, +the AGS link already gone in step 1 = 7), selling points (14), connector `9f777dc7-…` (**the 2 Pathao courier connectors `43c2b501-…`/`2a01ee63-…` STAY**), product_sources `11b92544-…`, customer_sources `b6896fa5-…`, locations (4), brands (6), stores (6), user_business_access (7), businesses (7 — incl. the duplicate "Enveil Vincent" `13e888dc-…`) | `:393-440` |
| — | `COMMIT` | `:442` |

### Q24/Q27 test-data wipe — rules (as the script performs them)

- **Sever the AGS → Enveil-store link FIRST** (step 1, before any other delete). The test
  storefront "AGS" points at the real Enveil store; deleting the link first guarantees no
  test-data delete can reach the real store (`scripts/migrate-enveil-vincent.sql:47-53`).
- **Everything by UUID literal, never by name** (spec §7 name traps above). The script contains
  no name-based lookup anywhere (audit's static scan proves it).
- **Children before parents** (pages → storefronts → selling points → connectors → sources →
  locations → brands → stores → access rows → businesses).
- Totals per spec §7: 7 test businesses (incl. `13e888dc-…`), 6 test brands/stores, 7 storefronts
  (incl. AGS), 4 locations, 14 selling points, 1 connector, 7 access rows + the 4 junk rows /
  2 pages inside the real business.
- **Keep**: the 2 Pathao courier connectors and `pathao_integrations` rows (mapped in step 2b; the
  legacy rows themselves are dropped only at Task 16).
- If the script aborts at any point, nothing is wiped (one transaction) — that is the safe state.

## 5. Phase 3 — Post-migration audit (Gate 3 input)

Produce `tasks/audit/task17-live-audit-report.md` from **read-only** queries against production —
the exact queries `scripts/task8-audit.mjs` runs (`collectAudit` `:52-123`, `ordersPerSource`
`:127-135`). Copy-paste form (expected = the **fresh Phase 1 rehearsal** report; the current
2026-11-01 reference is in Phase 4):

```sql
-- table totals (collectAudit:54-61)
SELECT 'businesses' t, count(*) n FROM public.businesses
UNION ALL SELECT 'brands', count(*) FROM public.brands
UNION ALL SELECT 'stores', count(*) FROM public.stores
UNION ALL SELECT 'locations', count(*) FROM public.locations
UNION ALL SELECT 'selling_points', count(*) FROM public.selling_points
UNION ALL SELECT 'storefronts', count(*) FROM public.storefronts
UNION ALL SELECT 'connectors', count(*) FROM public.connectors
UNION ALL SELECT 'products', count(*) FROM public.products
UNION ALL SELECT 'product_variations', count(*) FROM public.product_variations
UNION ALL SELECT 'product_locations', count(*) FROM public.product_locations
UNION ALL SELECT 'customers', count(*) FROM public.customers
UNION ALL SELECT 'orders', count(*) FROM public.orders
UNION ALL SELECT 'order_sources', count(*) FROM public.order_sources
UNION ALL SELECT 'warehouses', count(*) FROM public.warehouses
UNION ALL SELECT 'courier_services', count(*) FROM public.courier_services
UNION ALL SELECT 'user_business_access', count(*) FROM public.user_business_access;

-- derived metrics (collectAudit:62-119) — see Phase 4 for expected values
SELECT count(*) FROM public.order_sources
 WHERE legacy_store_id IS NOT NULL OR legacy_selling_point_id IS NOT NULL
    OR legacy_storefront_id IS NOT NULL OR legacy_location_id IS NOT NULL;      -- legacy_mapped = 8
SELECT count(*) FROM public.order_sources WHERE brand_id = 'ca061912-27a6-4eb5-a859-b77e9a347a30'; -- 4
SELECT count(*) FROM public.order_sources WHERE brand_id = '3eb99fc9-7826-4890-ace0-78af0dfdf972'; -- 4
SELECT count(*) FROM public.courier_services WHERE legacy_pathao_integration_id IS NOT NULL;       -- 2
SELECT count(*) FROM public.products WHERE origin_order_source_id IS NOT NULL;                     -- 225
SELECT count(*) FROM public.customers WHERE store_id IS NOT NULL;                                  -- bound
SELECT count(*) FROM public.customers WHERE source = 'legacy migration';                           -- pool
SELECT count(*) FROM public.customers
 WHERE origin_kind IS NOT NULL AND origin_kind <> 'legacy';                                         -- attributed
SELECT count(*) FROM public.orders WHERE store_id IS NOT NULL;                                      -- bound
SELECT count(*) FROM public.orders WHERE order_source_id IS NOT NULL;                               -- attributed
SELECT count(*) FROM public.orders WHERE source = 'legacy migration';                               -- pool
SELECT count(*) FROM public.orders                                                                -- unattributed_left
 WHERE store_id IS NULL AND selling_point_id IS NULL AND storefront_id IS NULL
   AND order_source_id IS NULL AND source <> 'legacy migration';                                    -- 0
SELECT count(*) FROM public.product_locations
 WHERE warehouse_id IS NOT NULL OR stock_holder_order_source_id IS NOT NULL;                       -- 205
SELECT count(*) FROM public.product_locations WHERE location_id IS NOT NULL;                       -- 0
-- wiped test/junk rows still present? (the 7 tracked ids of task8-audit.mjs:40-45)
SELECT ((SELECT count(*) FROM public.storefronts WHERE id IN ('a8ff5e33-986a-413e-a774-03ee49727fe9','94cd65c5-fbb0-4ff5-a60a-c5e33e325728','13e888dc-db75-47cf-94c4-012bc1d5f669','e36ec825-2bb7-42e4-8b96-53a969054064','7df6baea-b2b1-4db0-90f0-b2ee853e86b6','9d2cc780-0e2a-44c8-a4dc-afef2eec4267','d56f8d28-0a28-4f57-894d-8f85c27e8dfa'))
     + (SELECT count(*) FROM public.brands    WHERE id IN ('a8ff5e33-986a-413e-a774-03ee49727fe9','94cd65c5-fbb0-4ff5-a60a-c5e33e325728','13e888dc-db75-47cf-94c4-012bc1d5f669','e36ec825-2bb7-42e4-8b96-53a969054064','7df6baea-b2b1-4db0-90f0-b2ee853e86b6','9d2cc780-0e2a-44c8-a4dc-afef2eec4267','d56f8d28-0a28-4f57-894d-8f85c27e8dfa'))
     + (SELECT count(*) FROM public.businesses WHERE id IN ('a8ff5e33-986a-413e-a774-03ee49727fe9','94cd65c5-fbb0-4ff5-a60a-c5e33e325728','13e888dc-db75-47cf-94c4-012bc1d5f669','e36ec825-2bb7-42e4-8b96-53a969054064','7df6baea-b2b1-4db0-90f0-b2ee853e86b6','9d2cc780-0e2a-44c8-a4dc-afef2eec4267','d56f8d28-0a28-4f57-894d-8f85c27e8dfa'))) AS wiped_rows_still_present;  -- 0

-- orders per new source (ordersPerSource:127-135)
SELECT s.name, s.type, count(o.id) AS orders
  FROM public.order_sources s LEFT JOIN public.orders o ON o.order_source_id = s.id
 GROUP BY s.id, s.name, s.type, s.brand_id ORDER BY s.brand_id, s.name;
```

## 6. Phase 4 — Verification: expected counts (refreshed 2026-11-01 rehearsal)

From `tasks/audit/task8-dry-run-report.md` (After column). The values below are the current
Phase 1 rehearsal reference; production is still expected to drift, so compare the live audit
against a fresh extract from the same window. Structural invariants must hold exactly unless a
fresh rehearsal explains a deliberate data-shape change:

- `order_sources` = 8 (4 per brand), **all 8** carry `legacy_*` mapping ids; `warehouses` = 1;
  `courier_services` = 2 (both legacy-mapped).
- `products` preserved and fully attributed (225); `product_variations` preserved (1,204);
  `product_locations` preserved (205) — 205 holder rows, **0** rows still on legacy `location_id`.
- `customers.total` = before − 2 (the 2 merges); `customers.attributed + customers.pool =
  customers.total`; the connected-order evidence cohort is 0 after step 8b.
- `orders.unattributed_left` = 0; `orders.attributed` = before-bound + inferred (809 in the refreshed
  rehearsal); `orders.inferable` = 0; `orders.pool` = `orders.total` − `orders.attributed`.
- `wiped_rows_still_present` = 0.

| Metric | Expected after (2026-11-01 rehearsal) | Drift rule |
|---|---:|---|
| businesses.total | 1 | exact |
| brands.total | 2 | exact |
| stores.total | 2 | exact (legacy tables untouched until Task 16) |
| locations.total | 3 | exact |
| selling_points.total | 8 | exact |
| storefronts.total | 2 | exact |
| connectors.total | 4 | exact (2 woo channel + 2 Pathao courier kept) |
| products.total | 225 | exact |
| product_variations.total | 1,204 | exact |
| product_locations.total | 205 | exact |
| customers.total | 3,244 | = before − 2 |
| orders.total | 4,092 | fresh-extract reference; compare same-window audit |
| order_sources.total | 8 | exact |
| warehouses.total | 1 | exact |
| courier_services.total | 2 | exact |
| user_business_access.total | 2 | exact |
| order_sources.legacy_mapped | 8 | exact |
| order_sources.vincent / enveil | 4 / 4 | exact |
| courier_services.legacy_mapped | 2 | exact |
| products.attributed | 225 | = products.total |
| customers.bound | 3,193 | fresh-extract reference |
| customers.pool | 51 | = total − attributed |
| customers.attributed | 3,193 | = total − pool |
| customers.unattributed_with_order_evidence | 0 | exact after step 8b |
| orders.bound | 3,235 | = before-bound (bound rows are never re-attributed) |
| orders.attributed | 4,044 | = before-bound + 809 (refreshed inferred) |
| orders.pool | 48 | = total − attributed |
| orders.unattributed_left | 0 | exact |
| orders.inferable (post-migration) | 0 | exact |
| stock.holder_rows | 205 | exact |
| stock.legacy_location_rows | 0 | exact |
| wiped_rows_still_present | 0 | exact |

Orders per new source after (2026-11-01 rehearsal; identify sources by UUID — names repeat across brands):

| Brand | Source | Type | Orders |
|---|---|---|---:|
| Enveil | Enveil WooCommerce `ea160683-…` | woocommerce | 660 |
| Enveil | Facebook / Instagram `60741e62-…` | facebook | 243 |
| Enveil | Main Showroom `748bb49a-…` | showroom | 179 |
| Enveil | Enveil Storefront `81cb426c-…` | storefront | 0 |
| Vincent | Vincent WooCommerce `2590e589-…` | woocommerce | 1,769 |
| Vincent | Facebook / Instagram `b259adc8-…` | facebook | 555 |
| Vincent | Main Showroom `7e2687c4-…` | showroom | 638 |
| Vincent | Vincent Storefront `c5376c7f-…` | storefront | 0 |
| | **Total attributed** | | **4,044** |

### Count reconciliation (spec snapshot → refreshed dry-run → Task 8 card)

- Spec snapshot 2026-10-29 (`DOMAIN-REVAMP-SPEC.md` §7 "Data mapping"): 225 products;
  customers 2,020 bound + 1,202 unattributed (2 merged → 1,200 pool); orders 3,201 attributed +
  849 unattributed (96 inferred / 753 pool).
- Refreshed dry-run report 2026-11-01 (current rehearsal): 225 products; customers 3,246 → 3,244
  (2 dup rows merged away), bound 3,235 → 3,193 attributed, residual pool 51; orders 4,092,
  bound 3,235, inferred 809, attributed **4,044**, pool 48. The larger inference count includes
  orders of customers resolved by step 8b; `orders.inferable` reaches 0 and the evidence cohort is
  fully drained.
- The spec snapshot and 2026-10-31 values above remain historical comparison points only. The
  generated report is authoritative for the current rehearsal; production execution must take a
  fresh extract in the same window rather than copy these drifting totals blindly.

## 7. Phase 5 — Enable the new UI (Gate 3 first!)

1. **Gate 3 — user signs off the live audit report** (`tasks/audit/task17-live-audit-report.md`
   vs the fresh rehearsal report): explicit, recorded, **before** the new UI is enabled or
   announced. Any mismatch on an exact-shape metric → rollback (§8), do not enable.
2. Deploy the frontend built from this branch (per `tasks/audit/production-migration-plan.md`
   §"Apply-order warning"). There are **no feature flags** (`tasks/plan.md` architecture
   decisions) — "enable the new UI" = ship this branch's UI; the old surfaces were already
   replaced per slice (Task 11 retired `/integrations` + StoresHub).
3. **Auth redirect allow-list (cutover-critical — found live 2026-11-01 on the local stack):**
   Supabase Auth → URL Configuration must list the production app origin in `Site URL` /
   `Additional redirect URLs`. GoTrue **silently** replaces an unlisted `emailRedirectTo`
   with its default SITE_URL, so every verification/recovery email dead-ends at a wrong
   origin (locally: `http://127.0.0.1:3000`) while the token still verifies server-side —
   users end up confirmed but never reach `/auth/confirm` → `/profile/setup`. Verify with a
   test signup: the mail's link must carry `redirect_to=<app-origin>/auth/confirm`.
4. Smoke-verify (deployed frontend + production): login; `/order-sources` shows 4 sources per
   brand with per-source order counts matching the Phase 4 table; Settings → Warehouses shows
   the 1 warehouse with on-hand stock; Settings → Courier services shows the 2 Pathao services
   (Configured); storefront checkout inserts an order (`payment_meta` path); `/signup` renders
   the form (not the error gate). Optionally `node scripts/verify-live-deployment.mjs` — but
   note its hard-coded deployment URL currently returns **410 Gone**
   (`tasks/audit/production-migration-plan.md` §"Apply-order warning"); confirm which deployment
   is current first.
5. Lift the freeze; announce. Flag the `status=error` Woo stores to the user (pre-existing).

## 8. Rollback plan

- **Before COMMIT:** nothing to do — the script is one transaction
  (`scripts/migrate-enveil-vincent.sql:28`, `:442`); any error aborts the whole apply.
- **After COMMIT (verification failure or user decision):** restore the pre-migration **logical
  dump** taken immediately before the data script (production has no native backup/PITR — Gate 1
  decision 2026-11-01; dump time + checksums recorded in Phase 3 step 2). **There are no DOWN
  scripts — the dump is the rollback**
  (`tasks/audit/production-migration-plan.md` §"Pre-checks" 1,
  `tasks/audit/task17-readiness-report.md` §1).
- Roll back only the data script (restore the pre-Gate-2 dump) if the schema chain itself is
  fine — the batch + schema wave are additive DDL and may stay. If the batch's #15/#16 grants
  misfire, re-apply the saved grants snapshot instead of restoring
  (`tasks/audit/production-migration-plan.md` §"Rollback").
- Rollback triggers: any exact-shape metric mismatch in Phase 4; missing products/customers/
  orders; `wiped_rows_still_present` > 0 (test data not fully gone — or worse, a keep-row gone:
  compare against the backup immediately); broken smoke after deploy; anything the user says.
- After rollback: re-run the §3 pre-flight read-only queries (Phase 2 step 4; guard must read clean), re-do
  Phase 1 rehearsal, schedule a new window. Never "fix forward" by editing the script ad hoc.

## 9. ✅ Sign-off checklist (copy into the live run)

**No production write happens without the user's explicit go-ahead. No new UI without the user's
sign-off on the live audit report.**

| # | Gate / step | Done when | Who | When |
|---|---|---|---|---|
| ☐ | Checkpoints A–E complete; dry-run report reviewed (Checkpoint C) | `tasks/audit/task8-dry-run-report.md` reviewed incl. the 3 review items | user | 2026-11-01 |
| ☐ | **28-file chain applied** (19-file catch-up batch + 5-file schema wave + 4 integration migrations) | ledger head **`20261103090000`**, count **190**; `is_signup_open()` NOT NULL | operator | 2026-11-01 ✅ (162→190) |
| ☐ | Fresh scratch rehearsal: all 12 checks ✅ | refreshed report saved (dated copy), including the connected-order evidence cohort | operator | |
| ☐ | Backup taken, recovery timestamp recorded — logical dump (no native backup/PITR) | recorded here: ____ | operator | |
| ☐ | Maintenance window announced; read-only freeze on | | operator | |
| ☐ | Pre-flight read-only queries all green | §3 (Phase 2 step 4) | operator | |
| ☐ | **GATE 1 — user go-ahead for the production chain** | explicit yes from the user | **user** | 2026-11-01 ✅ |
| ☐ | **GATE 2 — user go-ahead for the data migration** | explicit yes, immediately before | **user** | |
| ☐ | `scripts/migrate-enveil-vincent.sql` applied (one transaction, no edits) | COMMIT succeeded | operator | |
| ☐ | Live audit report produced (`tasks/audit/task17-live-audit-report.md`) | Phase 3 queries run read-only | operator | |
| ☐ | **GATE 3 — user signs off the live audit report** | explicit sign-off, recorded here: ____ | **user** | |
| ☐ | New UI deployed + smoke verified | Phase 5 checks green | operator | |
| ☐ | Freeze lifted; Woo `status=error` flagged to user | | operator | |
| ☐ | **Task 16 (drop legacy tables) NOT run** — separate user decision after the audit passes | deferred | **user** | |

## 10. After cutover (out of this runbook's scope, but ordered here)

- **Task 16** (drop legacy tables/columns, delete orphaned code) runs only **after** the cutover
  audit passes and the user decides (`tasks/todo.md` Task 16 dependency; spec §7 keeps
  `legacy_*` mapping columns on the new rows). Until then legacy tables keep working
  (stores 2 / locations 3 / selling_points 8 / storefronts 2 / connectors 4 remain by design).
- Checkpoint C review items are resolved in the generated report: (1) the strict email-alias duplicate
  (`1a689ee5-…` → `4d0d1b7d-…`) stays in the pool; (2) pool customers with connected-order product
  evidence are attributed by the signed-off earliest-order rule, while the residual tag is a Task 16
  migration item; (3) fulfillment defaults are accepted and remain editable in the Task 7 UI
  (`tasks/audit/task8-dry-run-report.md` §"Review items").
- Legacy `orders.source`/`customers.source` free-text is consumed read-only until Task 16.

## Appendix — cross-check notes (runbook ↔ scripts ↔ audit docs)

Recorded while verifying this runbook against the actual scripts (Task 17 verification):

1. `scripts/task8-audit.mjs` is **local-only by design** (`:12`, `:132-139`) and overwrites
   `tasks/audit/task8-dry-run-report.md` — production apply is the raw SQL file (Phase 4 step),
   production audit is its queries reused read-only. Rehearsal is the script's flow verbatim.
2. `scripts/migrate-enveil-vincent.sql:20` preconditions say "Tasks 4–5 schema", but step 2b
   (`:184-205`) writes `courier_services`, created by `20261031140000_courier_services.sql`
   (Task 9) — the schema wave must include it (and does, in §1).
3. `tasks/audit/production-migration-plan.md` post-check "Ledger head = `20261030090000`,
   count = 179" was **stale** (written for the 17-file version of the batch); it has been updated to
   the reconciled **28-file** scope → head `20261103090000`, count 190. The plan's own 19-file batch
   alone would end at head `20261030200000`. Re-count at execution time — more migrations may land
   meanwhile.
4. ✅ **Resolved (2026-11-01):** the foreign worktree deletions of batch files #10/#11
   (`20261022120000_signup_config_accessor.sql`, `20261023100000_signup_service_role_grants.sql`)
   no longer exist — both files are present, clean, and committed, and
   `git status --short -- supabase/migrations` is empty. No blocker remains.
5. The audit's wipe check samples **7 tracked ids** across storefronts/brands/businesses
   (`scripts/task8-audit.mjs:40-45`) — it proves the headline rows are gone, not every deleted
   row; full wipe completeness rests on the script's own UUID lists (steps 11–12).
6. The refreshed Task 8 report carries **12** checks: the connected-order evidence cohort and the
   zero-resolvable-orders invariant are explicit, alongside the mapping, preservation, pool, wipe,
   stock, UUID-only, and courier checks. All 12 pass in the 2026-11-01 rehearsal.
7. The dry-run report's per-source table lists sources ordered by `brand_id`, so Enveil rows come
   first despite "Vincent" names sorting later; two source names repeat across brands — the Phase
   4 table adds brand + UUID to remove the ambiguity.
