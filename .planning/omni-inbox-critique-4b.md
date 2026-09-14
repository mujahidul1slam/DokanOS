# Adversarial Critique Cycle 4 — Critic B (Architecture / UX / Phasing) — FINAL

**Critique date:** 2026-09-14
**Plan under review:** `.planning/omni-inbox-plan-v4.md` (3094 lines)
**Scope:** verification of all cycle-3b architecture/UX/phasing fixes (HI-B1, HI-B3–B5, ME-B1–B3, ME-B6, LO-B1, LO-B3–B5, LO-B8) + regression scan of the same areas. SQL DDL internals remain Critic A's.

---

## 1. NEW architecture/UX issues

No new CRITICAL or HIGH issues. Four new LOW defects and one MEDIUM structural defect were introduced or left behind by the fix edits:

### NEW-1 (MEDIUM). Unclosed SQL fence: the M3-4 `has_ordered` backfill block (line 1199) has no closing fence — markdown parity breaks from §2.5.4 to EOF.

**Evidence:** The §2.5.4 resolve_order_business SQL block closes correctly at line 1187, but the inserted M3-4 backfill block opens ```sql at line 1199 and is never closed — line 1211 is blank, line 1212 is the `#### 2.5.5` heading, line 1214 is the *next* block's opening ```sql. A fence-parity scan of the full file confirms an odd fence count cascading downward: the §2.5.5 header is swallowed into the 1199 block, subsequent blocks open/close inverted, and the scan terminates with an unclosed fence at line 2957 (the §17.5 presence-cron block's intended closer) running to EOF. Rendered markdown from line 1199 onward alternately displays SQL as prose and hides headings. The block was inserted by the v4 HI-B3/M3-4 edit — the closing fence was lost in the insertion.
**Fix:** add a closing ``` after line 1210 (one character).

### NEW-2 (LOW). Stale `catalogScope {productIds, storeIds}` prop shape in three references — the §6.1 prop definition now carries only `storeIds`.

**Evidence:** §6.1's prop definition (lines 2071–2073) correctly drops `productIds` (products are store-keyed per ME-B1), but three spots still name the old two-field shape: §6.1 Flow step 2 (line 2114, "catalogScope = <business's productIds/storeIds>"), the Phase 4 checklist (line 2718, "catalogScope {productIds, storeIds}"), and the §15.1 AddOrderDialog row (line 2783). Passing productIds is harmless dead data, but the fix updated the prop definition without its references — an implementer reconciling the prop against the call sites sees two shapes.
**Fix:** change all three to `catalogScope {storeIds}`.

### NEW-3 (LOW). §5.6 line 2027 still contains the "one-shot token" language LO-B4 declared fixed.

**Evidence:** The §4.1 fix (line 1655) now correctly states "both the pg_net cron and the webhook's non-blocking sweep call pass it as `x-cron-secret` — the same vault secret, no 'one-shot minting' exists," and §20's LO-B4 entry claims the language was fixed. But §5.6's sweep-verification step (line 2027) still reads "`meta-outbox-sweep` verifies the `x-cron-secret` header **(or the non-blocking call's one-shot token from `meta-webhook`)**" — the exact parenthetical the fix was supposed to delete, now directly contradicting §4.1.
**Fix:** delete the parenthetical at line 2027 (the webhook's non-blocking sweep call passes the same `x-cron-secret`).

### NEW-4 (LOW). Conversation-tag writers are named in prose as "Phase 5 UI" but no Phase 5 checklist item creates them.

**Evidence:** The ME-B2 fix scopes `conversations.tags` to ops tags (§2.2.2 comment, lines 345–347) and names the writers — "conversation-level TagManager action in BulkActionBar and per-conversation header (Phase 5 UI: 'Add conversation tag')" (§3.3 comment, lines 1497–1499). The Phase 5 checklist (lines 2726–2733) contains TagManager + customer_tags CRUD, notes, customer-tag filter, merge UI, QuickReplyPicker, ConversationSearch — **no conversation-tag writer task**. §20's ME-B2 entry claims "both writers named (Phase 5)." Named in prose, not scheduled: the original ME-B2 failure mode (a `tags` column nothing ever writes) recurs by default — the GIN index and column stay dead unless an implementer invents the UI mid-phase, exactly what the fix was meant to prevent. The filter itself is safe (reads `customer_tags`).
**Fix:** add a Phase 5 checklist item: "Conversation-tag writer UI (BulkActionBar action + per-conversation header — §3.3/§2.2.2)".

### NEW-5 (LOW, minor). Rate-limit seed values (200/200/200) disagree with the §2.2.13 DDL defaults (250).

**Evidence:** §2.2.13 DDL defaults capacity/refill/tokens to 250 (lines 677–679, both marked [VERIFY spike]); the §5.3 self-seed INSERT and the `seed_rate_limit_bucket` trigger both pass explicit 200/200/200 (lines 1904, 1930). Functionally harmless (the trigger/RPC always pass explicit values, so the DDL defaults never take effect), but an implementer applying the Phase 0 spike result to the DDL defaults won't reach the seeded values.
**Fix:** align both to one number (or note that §5.3's 200 is the operative seed).

---

## 2. VERIFICATION TABLE (cycle-3b items, Critic B scope)

| Item | Verdict | Evidence (plan-v4 line refs) |
|---|---|---|
| HI-B1 — rate-limit smoke test in Phase 2 | **FIXED** | §5.3 RPC self-seeds (INSERT … ON CONFLICT DO NOTHING, 1901–1905) + belt AFTER INSERT trigger `trg_seed_rate_limit_bucket` (1923–1936); Phase 2 smoke test present (2695) and inline (1939). Fresh account can always consume. |
| HI-B3 — business_id resolution corrected | **FIXED** | §2.5.4: false "sets business_id directly from the conversation at insert time" sentence deleted (1191–1195); canonical path = OrderLinker UPDATEs `orders.business_id` post-`onCreated` (1192–1193) + trigger (b) defensive backfill (1194). §2.5.3 trigger (b) actually contains the UPDATE (1114–1122). §6.1 Flow step 3 rewritten consistently (2115: "dialog's orders insert does NOT set business_id… Resolution at the link step"). §7.4/§10.1 scope statement consistent (1189). |
| HI-B4 — watermark read semantics | **FIXED** | §4.4 step 4 (1745): `message_reads` carries `{"read": {"watermark": …}}` and no mids; "do NOT match by mid"; bulk-mark all outbound with `created_at <= to_timestamp(watermark/1000)`; Phase 0 spike records payload shape. Delivery step 3 correctly retains mids. |
| HI-B5 — InvoiceQuickSend mechanism | **FIXED** | §3.2 (1451): html-to-image `toPng` → Storage PNG → image attachment, no PDF lib (verified absent, stated honestly); Phase 4 install task present (2723: "install `html-to-image` → invoiceHtml → hidden-node render → toPng → Storage upload → image attachment send"). |
| ME-B1 — catalogScope store-keyed | **FIXED** | §6.1 (2086–2099, 2109): products `.in('store_id', storeIds)`, variations `.in('product_id', <scoped product ids>)` (fetched after products, so ids in hand), stores `.in('id', storeIds)`, orders_sources NOT scoped; URL-length hazard documented (2097–2099); no `.in('id', productIds)` anywhere. Prop definition carries only `storeIds` (2071–2073). Residual stale references → NEW-2. |
| ME-B2 — tag filter reads customer_tags | **FIXED** | §3.3 (1497–1504): customer-tag filter joins through `customer_tags` then `.in('id', ids)`; `conversations.tags` scoped to ops tags in the §2.2.2 schema comment (345–347). One taxonomy in the UI. Residual scheduling gap → NEW-4. |
| ME-B3 — opt-in template-send row 3a′ | **FIXED** | §5.2 row 3a′ (1879): rows with `saved_message_id` → saved message of category `optin_prompt`/`optin_one_time` built as template sends from `optin_config` per §10.2; row `content` is agent-visible only, never sent; window-checked. Row 3a correctly excludes opt-in prompt rows. |
| ME-B6 — accessibility contract | **FIXED** | §3.6.1 (1578–1587): live region (`role="log"`, `aria-live`), focus management for §3.1.1 push navigation, composer labeling, keyboard + visible focus, non-color signaling, reduced motion — all six requested items present. |
| LO-B1 — §15.3 file locations | **FIXED** | §15.3 (2805): `AutomationRuleEditor` (lives inside `InboxSettings.tsx`), `AnalyticsDashboard` (lives in the analytics page file). |
| LO-B3 — thread pagination tuple | **FIXED** | §3.7 (1591): `(created_at, id)` tuple keyset with the full `WHERE (created_at, id) < (:oldest_created_at, :oldest_id) ORDER BY created_at DESC, id DESC LIMIT 50` — same-timestamp skip class closed for the thread. |
| LO-B4 — META_CRON_TOKEN cross-ref | **FIXED** | §4.1 step 6 (1655): token marked §5.6 with the fix note; both callers pass `x-cron-secret` (same vault secret, no one-shot minting). §5.6 (1967–1989) specifies vault secret + `x-cron-secret` header. Residual stale parenthetical → NEW-3. |
| LO-B5 — sweep cron phasing | **FIXED** | Phase 1 (2677): "the 30s outbox-sweep cron schedule is NOT created here"; Phase 2 (2693): function deployed first, then the 30s pg_net cron. No more 404 pg_net week. |
| LO-B8 — signed HttpOnly cookie | **FIXED** | §4.7 (1777): state is an HMAC-signed HttpOnly cookie with a vault-held cookie key, carries business_id + expiry + random value, verified at step 3; `connect_sessions` table explicitly dropped ("needs no schema"). Remaining mentions (1777, 3093) are both references to the dropped option — no orphaned table. |

**Cross-checks that passed (no regressions):** §20 changelog entries match the plan body for all 13 items; §18 Migration 03a ordering (orders.business_id first, C3-1) consistent with Phase 1 Migration C (2675) and §2.3 RLS note (2967); §5.2 check 4 fail outcome consistent with §5.3 (1942); Phase 2/4/5 checklist ordering internally consistent; §15.3/§18 component lists now agree on AutomationRuleEditor/AnalyticsDashboard placement.

---

## 3. VERDICT

**CONVERGED.** All 13 cycle-3b items in Critic B's scope are genuinely fixed (no PARTIALLY, no NOT FIXED). No new CRITICAL or HIGH issues. The five new/ residual defects above (one MEDIUM, four LOW) are all single-line or single-checklist-item fixes and none blocks convergence.

**Recommended one-line fixes before implementation starts (all trivial):**
1. Close the SQL fence after line 1210 (NEW-1, MEDIUM — one character, restores document rendering).
2. `catalogScope {storeIds}` in lines 2114, 2718, 2783 (NEW-2).
3. Delete the "one-shot token" parenthetical at line 2027 (NEW-3).
4. Add the Phase 5 conversation-tag-writer checklist item (NEW-4).
5. Align rate-limit seed 200 vs DDL default 250 (NEW-5, optional).
