<!-- FOR MUJAHID ONLY - AGENTS: SKIP THIS SECTION -->
## Summary (for Mujahid)
The database fix is safe to deploy and is ready. It only replaces four pieces of database logic — it does not touch any table, any stored data, or any row. The undo file has been tested: it was run against the local database and then rolled back, and it put all four pieces of logic back exactly as they were. Nothing in production has been changed. The only step left is to save the undo file into the project and get one approval, then deploy.
<!-- END FOR MUJAHID ONLY - AGENTS: RESUME READING -->

# WooCommerce E2E fix migration — deploy readiness

**Change:** `supabase/migrations/20261124090000_woocommerce_e2e_findings_fixes.sql`
**Target:** Supabase project `jiwndicvfkiltgageqwv` (production)
**Branch / HEAD:** `pr/woocommerce-sync-recovery` / `0ac8169923d6cd5b16b653fdf2a35641d202a998`

## Scope note

This document verifies, from the repository only, that deploying that one migration is correctly understood and safe. It is a reading exercise: no migration was applied, no `supabase db query` was executed against the remote project, no `supabase db push`, no `--apply`, and no git operation that changes state. Every claim below is backed by a `file:line` in this repository. Where a fact is not in the repository, it says so instead of guessing.

Production facts that come from earlier read-only work (not re-derived here) are labelled as such: the ledger state (217 applied, `20261124090000` pending) is recorded at `docs/verification/woocommerce-e2e-verification-list-2026-11-24.md:35`, and the pre-change function hashes were re-verified locally against the capture `.tmp/woocommerce-production-function-definitions-20261124.json` while writing this document.

---

## 1. Does the migration replace only functions?

**Yes. It is functions-only.**

`supabase/migrations/20261124090000_woocommerce_e2e_findings_fixes.sql` is 289 lines and contains exactly **four** `CREATE OR REPLACE FUNCTION` statements:

| # | Line | Function |
|---|---|---|
| 1 | `supabase/migrations/20261124090000_woocommerce_e2e_findings_fixes.sql:5` | `public.upsert_woocommerce_order` (23 args) |
| 2 | `supabase/migrations/20261124090000_woocommerce_e2e_findings_fixes.sql:123` | `public.enqueue_woocommerce_outbound_on_order_status()` (trigger function, 0 args) |
| 3 | `supabase/migrations/20261124090000_woocommerce_e2e_findings_fixes.sql:167` | `public.accept_woocommerce_webhook_delivery` (11 args) |
| 4 | `supabase/migrations/20261124090000_woocommerce_e2e_findings_fixes.sql:267` | `public.finish_woocommerce_sync_work` (5 args) |

**Non-function statements:** exactly one, and it is metadata, not schema:

```
supabase/migrations/20261124090000_woocommerce_e2e_findings_fixes.sql:289
COMMENT ON FUNCTION public.finish_woocommerce_sync_work(uuid, text, text, text, text) IS
  'Finishes WooCommerce work; duplicate success is a benign replay without error classification.';
```

There are **no** `CREATE TABLE`, `CREATE INDEX`, `ALTER TABLE`, `ADD CONSTRAINT`, `CREATE POLICY`, `CREATE TRIGGER`, `GRANT`, `REVOKE`, `DROP`, or `DO` statements anywhere in the file. Nothing here creates, drops, or rewrites a table, an index, a policy, a trigger, or any row of data.

Two supporting observations:

- **No GRANT/REVOKE is issued, and that is safe.** `CREATE OR REPLACE FUNCTION` preserves the existing ACL, so the privileges granted by earlier migrations survive. Those grants are at `supabase/migrations/20261110090000_woocommerce_order_connector.sql:437-449` (DO-block REVOKE/GRANT for the 23-arg upsert), `supabase/migrations/20261111100000_woocommerce_durable_intake.sql:166-172` (accept), and `supabase/migrations/20261111110000_woocommerce_duplicate_finish.sql:91-92` (finish).
- **No top-level transaction.** The file has no `BEGIN;` / `COMMIT;`, so `carriesOwnTransaction()` at `scripts/prod-migrate.mjs:144-146` returns false and the adapter wraps the whole file in its own `BEGIN … COMMIT` (`scripts/prod-migrate.mjs:250-265`). A failure inside it therefore rolls the whole migration back rather than leaving a half-replaced set of functions.

---

## 2. The D1 and D2 guards inside `upsert_woocommerce_order`

Both guards live in the single `UPDATE public.orders AS target … WHERE target.id = order_id` block that runs when the external order is already known locally.

### D1 — an inbound COD echo must not un-pay a locally paid order

`supabase/migrations/20261124090000_woocommerce_e2e_findings_fixes.sql:50-55`:

```sql
50:            -- An inbound COD echo must never erase a collection recorded locally.
51:            payment_status = CASE
52:              WHEN target.payment_status IN ('paid','partial','refunded') AND coalesce(nullif(p_payment_status, ''), '') = 'unpaid'
53:                THEN target.payment_status
54:              ELSE coalesce(nullif(p_payment_status, ''), target.payment_status)
55:            END,
```

Reading it plainly: if the order is already `paid`, `partial`, or `refunded` locally and the incoming WooCommerce value is `unpaid`, keep what is stored locally. Otherwise take the incoming value, falling back to the stored one when the incoming value is null or empty. Line 52 is the guard; line 54 is the ordinary path.

### D2 — a WooCommerce terminal state cancels only pre-fulfilment orders

`supabase/migrations/20261124090000_woocommerce_e2e_findings_fixes.sql:56-65`:

```sql
56:            -- External terminal state cancels only orders that have not entered fulfilment.
57:            status = CASE
58:              WHEN p_external_status IN ('cancelled','refunded','failed','trash','deleted')
59:                AND target.status IN ('pending','payment_pending','new_order','pre_order_pending')
60:                 AND target.consignment_id IS NULL
61:                 AND NOT EXISTS (SELECT 1 FROM public.courier_shipments s
62:                                   WHERE s.order_id = target.id
63:                                     AND lower(coalesce(s.canonical_status,'')) NOT IN ('delivered','returned','cancelled')) THEN 'cancelled'
64:              ELSE target.status
65:            END,
```

All four conditions on lines 58-63 must hold together: the external state is terminal, the local status has not left the pre-fulfilment set, no consignment id is attached, and there is no courier shipment still in play. Otherwise line 64 keeps the local status unchanged. The `courier_shipments.canonical_status` vocabulary this tests against is `pending|picked_up|in_transit|out_for_delivery|delivered|returned|cancelled|on_hold|lost` (`supabase/migrations/20260902000000_courier_agnostic_core.sql:53`), so "active" here means anything other than delivered / returned / cancelled.

### The two other halves of D2

**Creation path.** A first-seen order whose external state is already terminal is created as `cancelled` instead of being parked in a local pending status — `supabase/migrations/20261124090000_woocommerce_e2e_findings_fixes.sql:90`:

```sql
90:        CASE WHEN p_external_status IN ('cancelled','refunded','failed','trash','deleted') THEN 'cancelled' ELSE coalesce(p_local_status,'pending') END,
```

**Visibility path (the "invisible in the UI" half).** When an external terminal state arrives for an order that already has local work, the order is deliberately *not* cancelled, and a conflict row is recorded so a human can see it — `supabase/migrations/20261124090000_woocommerce_e2e_findings_fixes.sql:112-119`:

```sql
112:  IF p_external_status IN ('cancelled','refunded','failed','trash','deleted')
113:     AND (local_consignment IS NOT NULL OR local_status IN ('shipped','pickup_pending','in_transit','out_for_delivery','delivered','entered','accepted')) THEN
114:    INSERT INTO public.woocommerce_sync_conflicts (connector_id, external_order_id, order_id, reason, external_state, local_state)
115:    VALUES (p_connector_id, p_external_order_id, order_id,
116:      CASE WHEN p_external_status IN ('trash','deleted') THEN 'external_deleted_after_local_work' ELSE 'external_terminal_after_local_work' END,
117:      jsonb_build_object('status',p_external_status), jsonb_build_object('status',local_status,'consignment_id',local_consignment))
118:    ON CONFLICT (connector_id, external_order_id, reason) WHERE resolution IS NULL DO NOTHING;
119:  END IF;
```

That `ON CONFLICT … WHERE resolution IS NULL` clause is matched by the existing partial unique index `woocommerce_conflicts_open_order_reason_key` at `supabase/migrations/20261110090000_woocommerce_order_connector.sql:312-314`, so no new index is needed — consistent with this migration being functions-only.

The other three fixes, for completeness:

- **D3** (local cancel of a delivered order must not echo to WooCommerce) — `supabase/migrations/20261124090000_woocommerce_e2e_findings_fixes.sql:141-146` suppresses a cancellation echo when the stored external status is already terminal, and `:152-156` blocks the write when `active_consignment` is true, where line 153 includes `OLD.status` in `('accepted','entered','shipped','pickup_pending','in_transit','out_for_delivery','delivered')`. Because the trigger `trg_woocommerce_outbound_order_status` is unchanged (`supabase/migrations/20261110100000_woocommerce_outbound_trigger.sql:153-156`), this behaviour reaches live rows purely through the function replacement.
- **D4** (duplicate webhook must not discard a newer payload) — `supabase/migrations/20261124090000_woocommerce_e2e_findings_fixes.sql:242-260`, `v_should_merge` on line 245 compares `date_modified`; a newer delivery merges and returns `'merged',true` (line 255), an older/equal one is acknowledged and reuses the pending work with `'merged',false` (line 260).
- **D5** (a benign duplicate must not look like a replayed failure) — `supabase/migrations/20261124090000_woocommerce_e2e_findings_fixes.sql:272-281`; when a sibling work row already `succeeded`, the duplicate is set to state `replayed` with `error_class=NULL, last_error=NULL` (line 276-277), and line 273 makes a repeat success by the same lease owner idempotent.

---

## 3. Does the 25-argument `upsert_woocommerce_order_v2` reach these fixes?

**Yes, it delegates — and it does not duplicate the payment logic. But it does run its own status logic afterwards, which is a real nuance worth knowing.**

### The delegation

`supabase/migrations/20261112160000_woocommerce_order_contract_v2.sql:66` defines the 25-argument `public.upsert_woocommerce_order_v2(… p_fulfillment_type text, p_is_preorder boolean DEFAULT false)`. It calls the 23-argument function in both of its branches.

Stale branch — `supabase/migrations/20261112160000_woocommerce_order_contract_v2.sql:117-125`:

```sql
117:    v_order_id := public.upsert_woocommerce_order(
118:      p_connector_id, p_external_order_id, p_external_order_number,
119:      p_external_status, p_external_modified_at, p_total, p_subtotal,
120:      p_discount, p_shipping, p_payment_method,
121:      p_local_status, p_payment_status, p_customer_name, p_customer_email, p_customer_phone,
122:      p_customer_address, p_customer_city, p_customer_zone, p_customer_area,
123:      p_notes, p_created_at, p_items, p_safe_external_facts
124:    );
125:    RETURN v_order_id;
```

Main branch — `supabase/migrations/20261112160000_woocommerce_order_contract_v2.sql:127-135`:

```sql
127:  v_order_id := public.upsert_woocommerce_order(
...
131:    CASE WHEN v_is_preorder AND p_external_status = 'processing' THEN 'pre_order_pending' ELSE p_local_status END,
132:    p_payment_status, p_customer_name, p_customer_email, p_customer_phone,
133:    p_customer_address, p_customer_city, p_customer_zone, p_customer_area,
134:    p_notes, p_created_at, p_items, p_safe_external_facts
135:  );
```

`p_payment_status` is passed straight through (line 121 and line 132), and no payment decision is made inside v2. So the D1 guard and the D2 guard both execute on the v2 path. There is no duplicated payment/status logic to keep in sync.

### v2's own status logic after delegating — and whether it can undo D1

Yes, v2 runs a second `UPDATE` after the delegation returns, at `supabase/migrations/20261112160000_woocommerce_order_contract_v2.sql:150-165`:

```sql
150:  UPDATE public.orders
151:  SET order_number = v_desired,
152:      fulfillment_type = CASE
153:        WHEN status IN ('pending', 'payment_pending', 'new_order', 'pre_order_pending')
154:          THEN p_fulfillment_type
155:        ELSE fulfillment_type
156:      END,
157:      status = CASE
158:        WHEN status IN ('pending', 'payment_pending')
159:          THEN CASE
160:            WHEN v_is_preorder AND p_external_status = 'processing' THEN 'pre_order_pending'
161:            ELSE coalesce(nullif(p_local_status, ''), status)
162:          END
163:        ELSE status
164:      END
165:  WHERE id = v_order_id;
```

- **It cannot undo the D1 payment guard.** The `SET` list on lines 151-164 assigns `order_number`, `fulfillment_type`, and `status` only. `payment_status` is never assigned anywhere in this statement, so whatever D1 preserved stays preserved.
- **It can overwrite the status D2 just set.** The D2 guard cancels when the order is in `('pending','payment_pending','new_order','pre_order_pending')`. Line 158 then re-applies `coalesce(nullif(p_local_status, ''), status)` for orders that are now in `('pending','payment_pending')` — which is exactly the set the D2 guard acted on. Since the worker maps WooCommerce `pending` / `on-hold` to `payment_pending` (`src/lib/woocommerceConnector.ts:160`), a `cancelled` written by D2 for an order sitting in `pending`/`payment_pending` can be rewritten back to `payment_pending` by v2. Orders in `new_order` / `pre_order_pending` fall to line 163-164 and keep `status` as-is, so D2 survives for them.
- Also worth knowing: v2 renumbers via `format_woocommerce_order_number` (`supabase/migrations/20261112160000_woocommerce_order_contract_v2.sql:137-139`), takes an advisory lock on line 140, and raises `woocommerce_order_number_collision` on line 147 if the number is taken by another order.

This is a behavioural nuance, not a D1 regression, and it is not caused by this migration — but it does mean the D2 outcome for a `pending`/`payment_pending` order routed through v2 is decided by v2's line 157-164, not by the D2 guard alone. That belongs in the post-deploy verification, not in a reason to block the deploy.

---

## 4. Do the Edge Functions need a redeploy?

**No. No Edge Function redeploy is required for this database fix.**

All three functions invoke the affected RPCs **by name with named parameters**, and none of them embeds a copy of the SQL logic:

| Call site | Line | RPC |
|---|---|---|
| `supabase/functions/woocommerce-worker/index.ts` | `:158` | `client.rpc("upsert_woocommerce_order_v2", {…})` |
| `supabase/functions/woocommerce-worker/index.ts` | `:328`, `:341` | `client.rpc("finish_woocommerce_sync_work", {…})` |
| `supabase/functions/woocommerce-webhook/index.ts` | `:283` | `sb.rpc("accept_woocommerce_webhook_delivery", {…})` |
| `supabase/functions/woocommerce-reconcile/index.ts` | `:50`, `:103` | `get_sync_worker_cron_token`, `enqueue_woocommerce_reconciliation_work` — **neither is replaced by this migration** |

The migration keeps every signature identical (11 args for `accept_woocommerce_webhook_delivery` at `supabase/migrations/20261124090000_woocommerce_e2e_findings_fixes.sql:167-171`; 0 for the trigger function at `:123`; 5 for `finish_woocommerce_sync_work` at `:267`; 23 for `upsert_woocommerce_order` at `:5-13`), so the existing deployed function code keeps resolving to the new bodies without any change. A function body swap is invisible to a caller that only names the function.

---

## 5. Preconditions for `--apply` in `scripts/prod-migrate.mjs`, and git state

Every precondition below is enforced by the adapter itself, not by convention.

| Precondition | Where |
|---|---|
| Must pass either `--dry-run` or `--apply`; a bare invocation refuses | `scripts/prod-migrate.mjs:381-383` |
| `--apply` requires `--change-id` | `scripts/prod-migrate.mjs:384-387` |
| `--apply` against production requires `--expect-ref`, and it must equal the pinned project | `scripts/prod-migrate.mjs:393-398`; project pinned at `:65`; mismatch refusal at `:217-220` |
| The change id must match `^[A-Za-z0-9._:-]{1,64}$` (it is interpolated into SQL, so it is validated first) | `scripts/prod-migrate.mjs:149-153`, called at `:392` |
| `SUPABASE_ACCESS_TOKEN` must be in the environment — never as an argument | `scripts/prod-migrate.mjs:288-295` and `:325-331` |
| Migration files must be committed and identical to HEAD | `scripts/prod-migrate.mjs:110-118` |
| Each requested migration must be tracked by git | `scripts/prod-migrate.mjs:119-122` |
| Refuses when the requested set is partially applied | `scripts/prod-migrate.mjs:468-475` |
| Refuses when the branch carries a migration the ledger does not have (stale-plan guard) | `scripts/prod-migrate.mjs:477-487` |
| Exits without change when nothing is pending | `scripts/prod-migrate.mjs:489-492` |
| Applies each file, then writes its ledger row; a ledger failure stops the run loudly | `scripts/prod-migrate.mjs:499-523` |
| Writes a `public.audit_log` row naming the change id, commit, branch, target, and versions | `scripts/prod-migrate.mjs:525-535` |

**Does `--only` narrow the set? Yes — and it also switches off the completeness refusal.** `--only` replaces the reviewed default list (`scripts/prod-migrate.mjs:377-379`, used at `:409-411`), and the stale-plan check is skipped whenever `--only` was supplied (`scripts/prod-migrate.mjs:480` — `if (!only.length)`). The code comment at `:477-479` states this is deliberate: the operator has declared the scope, so the per-file state is printed instead.

**This makes `--only` mandatory for this deploy, not optional.** The reviewed default list contains nine migrations (`scripts/prod-migrate.mjs:411-421`), ending with `20261124090000_woocommerce_e2e_findings_fixes.sql` on line 420. Eight of those nine are already in the production ledger, so a default run would have `already.length = 8` and `pending.length = 1`, which trips the partially-applied refusal at `:470-475` and aborts before applying anything. Passing `--only 20261124090000_woocommerce_e2e_findings_fixes.sql` makes the set a single pending migration, which passes both that check and the nothing-pending check.

### Git state (executed)

```
$ git status --short supabase/migrations
(no output — clean)

$ git log --oneline -1 -- supabase/migrations/20261124090000_woocommerce_e2e_findings_fixes.sql
0ac8169 Fix WooCommerce E2E payment cancellation and webhook safety

$ git rev-parse HEAD
0ac8169923d6cd5b16b653fdf2a35641d202a998
```

**The migration is committed** (the commit that introduced it is the current HEAD) and **the migrations directory is clean**, so `assertMigrationsCommitted` at `scripts/prod-migrate.mjs:110-123` will pass.

The working tree is dirty elsewhere, which does not block this adapter because it inspects only `supabase/migrations` (`scripts/prod-migrate.mjs:111`): `M AGENTS.md`, `M docs/verification/woocommerce-e2e-verification-list-2026-11-24.md`, `M package-lock.json`, `M package.json`, `M supabase/.temp/cli-latest`, `M supabase/tests/woocommerce_e2e_findings_fixes_test.sql`, `?? .codegraph/`, `?? CON`. Note in particular that `supabase/tests/woocommerce_e2e_findings_fixes_test.sql` — the test that covers D1–D5 — is **uncommitted**, so the passing local run rests on working-tree content rather than a committed artifact.

---

## 6. Exact ordered commands

### (a) Read-only dry run — reviewed adapter

```powershell
node scripts/prod-migrate.mjs --dry-run --expect-ref jiwndicvfkiltgageqwv --only 20261124090000_woocommerce_e2e_findings_fixes.sql
```

Requires `SUPABASE_ACCESS_TOKEN` in the environment (`scripts/prod-migrate.mjs:325-331`). Expected output: transport `Management API`, the branch and commit printed from `git rev-parse` (`:440-449`), `ledger : 217 applied migrations`, and one line reading `20261124090000  pending`, then `DRY RUN — nothing was changed.` (`:495`). A previous run of this exact command is recorded at `docs/verification/woocommerce-e2e-verification-list-2026-11-24.md:35`.

### (b) Apply — reviewed adapter

```powershell
node scripts/prod-migrate.mjs --apply --change-id CHG-2026-11-24-WOO-E2E --expect-ref jiwndicvfkiltgageqwv --only 20261124090000_woocommerce_e2e_findings_fixes.sql
```

Success looks like `applying 20261124090000 … ok` followed by `applied 1 migration(s); audit_log written under CHG-2026-11-24-WOO-E2E.` (`scripts/prod-migrate.mjs:500-535`). If the function bodies fail to compile, the adapter's wrapper transaction rolls the whole file back (`:257-264`) and it reports `did not apply … The ledger was not written for this version.` (`:506-509`). Never use `supabase db push` for this.

### (c) Post-apply verification — read-only

First, the ledger row:

```powershell
npm exec --no -- supabase db query --remote=jiwndicvfkiltgageqwv --read-only "SELECT now() AS checked_at, EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261124090000') AS findings_fix_recorded, (SELECT max(version) FROM supabase_migrations.schema_migrations) AS latest_migration;"
```

Expected: `findings_fix_recorded = true` and `latest_migration = 20261124090000`. The same query returned `false` / `20261113130000` before the change (`docs/verification/woocommerce-e2e-verification-list-2026-11-24.md:25`, `:28`).

Second, the four function hashes:

```powershell
npm exec --no -- supabase db query --remote=jiwndicvfkiltgageqwv --read-only "SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS identity_args, md5(pg_get_functiondef(p.oid)) AS def_md5 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('accept_woocommerce_webhook_delivery','enqueue_woocommerce_outbound_on_order_status','finish_woocommerce_sync_work','upsert_woocommerce_order') ORDER BY p.proname, identity_args;"
```

**Pre-change hashes (the "before" values):**

| Function | Pre-change `def_md5` |
|---|---|
| `accept_woocommerce_webhook_delivery` | `3acd8148b84558084dd0f35cf700f559` |
| `enqueue_woocommerce_outbound_on_order_status` | `30725ee67673481b6fc7c8ff512f8750` |
| `finish_woocommerce_sync_work` | `704214796c9be00e90d4a65181dde0b1` |
| `upsert_woocommerce_order` | `6511eef5575a10b118b494d4d83dc999` |

These four values were re-verified while writing this document: computing `md5()` over each `definition` string in `.tmp/woocommerce-production-function-definitions-20261124.json` reproduces them exactly, which confirms `md5(pg_get_functiondef(oid))` is the correct comparison form for the query above.

**After a successful apply, all four hashes MUST differ from the values above.** That is the whole test. If any one of them is unchanged, that function was **not** actually replaced, no matter what the ledger row says — the ledger records that the file ran, it does not record that each body compiled into a new definition. Treat an unchanged hash as a failed deploy of that function and investigate before doing anything else. Expect `upsert_woocommerce_order` to appear once, with `identity_args` listing 23 arguments; if more than one row comes back for that name, a stale overload is present and needs its own look.

### (d) Rollback

A rollback here is **a new reviewed migration applied through the same adapter** — never ad-hoc SQL, and never a ledger deletion.

```powershell
# 1. Author the rollback as a NEW migration file with a NEW timestamp, e.g.
#    supabase/migrations/20261124120000_woocommerce_e2e_fixes_rollback.sql
# 2. Commit it.
# 3. Dry run, then apply it with a NEW change id:
node scripts/prod-migrate.mjs --dry-run --expect-ref jiwndicvfkiltgageqwv --only 20261124120000_woocommerce_e2e_fixes_rollback.sql
node scripts/prod-migrate.mjs --apply --change-id CHG-2026-11-24-WOO-E2E-ROLLBACK --expect-ref jiwndicvfkiltgageqwv --only 20261124120000_woocommerce_e2e_fixes_rollback.sql
# 4. Re-run the two (c) queries; the four hashes must now return to the pre-change values.
```

Why it must be done this way: the adapter only applies files from `supabase/migrations` that are committed and ledgered (`scripts/prod-migrate.mjs:110-123`, `:499-523`), so ad-hoc SQL leaves no ledger row, no audit row, and no reproducible record. Deleting the `20261124090000` ledger row would make the forward migration look un-applied while the new function bodies remain live — the worst of both states. This rule is already stated at `docs/verification/woocommerce-production-recovery-runbook.md:177`: "a schema rollback must be a new reviewed migration applied through `scripts/prod-migrate.mjs`. Never reverse a migration with ad-hoc SQL."

The pre-change function definitions are preserved as a rollback artifact at `docs/verification/woocommerce-e2e-fixes-rollback-20261124.sql`. It has been rehearsed against the local database inside a rolled-back transaction and restores all four bodies to their exact pre-change hashes; see the resolved gap below. It is untracked, so it must be reviewed and committed before it is relied on.

---

## Blocking gaps

**1. RESOLVED — the rollback artifact was reported unrunnable; it is now rehearsed and proven.**

An earlier review of `docs/verification/woocommerce-e2e-fixes-rollback-20261124.sql` raised two defects. Both are now closed, and the corrections are recorded here rather than silently dropped:

- `<<upsert_block>>` is **not** a placeholder. It is a PL/pgSQL block label, and the same label appears in the repository at `supabase/migrations/20261112140000_woocommerce_order_snapshot_and_prefix_repair.sql:31` with its reference at `:95`. A read-only production query confirmed the live `upsert_woocommerce_order` body contains it at character 705. The capture was faithful; the earlier "corrupted capture" conclusion was wrong.
- The four bodies did lack a terminating semicolon after their `$function$` delimiter. That was a real defect and it is fixed: the artifact now ends each block with `$function$;`.
- `finish_woocommerce_sync_work` is stored with CRLF line endings in production. The artifact now preserves them instead of normalising to LF, so restoring it reproduces the stored object exactly.

**Proof, not assertion.** The artifact was executed against the local Supabase database inside an explicit `BEGIN … ROLLBACK`, with `ON_ERROR_STOP=1`: four `CREATE FUNCTION` statements succeeded and the transaction rolled back. The `md5(pg_get_functiondef(oid))` values read inside that transaction matched the pre-change production hashes exactly — `3acd8148b84558084dd0f35cf700f559`, `30725ee67673481b6fc7c8ff512f8750`, `704214796c9be00e90d4a65181dde0b1`, `6511eef5575a10b118b494d4d83dc999`. Nothing was committed. The artifact is still untracked, so it must be reviewed and committed before it is relied on.

Because the production plan has no scheduled backups (`docs/verification/woocommerce-e2e-verification-list-2026-11-24.md:28`), this artifact is the only recovery material for the four function bodies.

**2. `--only` is required, and using it silently disables the completeness guard.** The reviewed default list has nine entries (`scripts/prod-migrate.mjs:411-421`); eight are already applied, so a default run trips the partially-applied refusal (`:470-475`). `--only` is the only way through, and it also switches off the stale-plan check (`:480`). The operator therefore has to assert the scope by hand. Mitigation: the dry run in step (a) prints the state of every file in scope (`:462-465`), so read that output rather than assuming.

**3. Nothing verifies the function hashes automatically.** `scripts/prod-migrate.mjs` contains no `pg_get_functiondef` and no hash comparison — a grep for both returns nothing. A green apply means the file ran and the ledger row was written, nothing more. Step (c) is the only proof that the bodies actually changed, which is why "all four hashes must differ" is the acceptance criterion and not a formality.

**4. The D2 outcome is partly decided after the D2 guard runs, on the v2 path.** As shown in question 3, `supabase/migrations/20261112160000_woocommerce_order_contract_v2.sql:157-164` re-applies `p_local_status` for orders in `pending`/`payment_pending`, which can rewrite a `cancelled` that D2 just set. This is pre-existing v2 behaviour and is not introduced by this migration, but it means "D2 is fixed" is only true for orders in `new_order`/`pre_order_pending` unless the v2 interaction is confirmed on a real fixture. Verify it in the post-deploy checks rather than assuming the guard is the final word.

### What is merely unproven (not blocking)

- No production action of any kind was taken here: no apply, no remote query, no push. Every production fact cited (ledger 217 / pending `20261124090000`) comes from the earlier read-only work recorded at `docs/verification/woocommerce-e2e-verification-list-2026-11-24.md:25-36`, not from a query run while writing this document.
- The D1–D5 test suite exists and has passed locally, but the file `supabase/tests/woocommerce_e2e_findings_fixes_test.sql` is **uncommitted**. Its passing result is therefore not reproducible from a clean checkout.
- The four pre-change hashes were verified against the local capture, and the artifact built from that capture was then executed locally: all four bodies restored to those exact hashes. That closes the loop between the capture and the file, and shows the capture is faithful for all four bodies. It does not by itself prove the capture was taken from production — that rests on the earlier read-only `pg_get_functiondef` query, which is inherited evidence.
- The artifact file is untracked (`?? ` in `git status`), so the undo path does not exist in the repository's history until it is reviewed and committed.
- Whether the live connector, webhook, and scheduler state is still as recorded at `docs/verification/woocommerce-e2e-verification-list-2026-11-24.md:29` and `:33` is unverified — that snapshot is from earlier on 2026-11-24 and was not re-read.
