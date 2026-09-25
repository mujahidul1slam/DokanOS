# SIGNUP-CRITIQUE-2 — Adversarial Review, Round 2

Reviewer: fresh-context agent (single-model; cross-model previously declined by user — decision stands for remaining rounds).
Reviewed artifact: `SIGNUP-PLAN.md` v2.
Prior findings in `SIGNUP-CRITIQUE-1.md` were not re-reported; round 2 focused on new problems introduced by v2's fixes and deeper repo verification.

All 15 findings validated against the plan text by the orchestrator. Classification: **15 × Valid + actionable** (0 contract-misread, 0 trade-off, 0 noise). Cumulative: 30 findings, 30 actionable — no doubt theater, real adversarial yield.

## Dispositions

### BLOCKERS

1. **Stale ground truth again: the multi-business layer exists** — Verified: `20260904000100` creates `businesses`, `user_business_access` ("true multi-tenancy membership"), `brands`, `locations`; `20260911000130` has an existing atomic org+owner RPC `create_business_with_owner` (admin-gated); `20260911000120` restricts `businesses` INSERT to platform admins. v2 would create owners missing from `user_business_access` — invisible to all member-scoped surfaces.
   → ACTIONABLE: §1 rewritten with the business layer; provisioning redesigned to build on `create_business_with_owner` (self-serve variant) creating **business + brand + store(url,status) + storefront(slug) + `user_business_access('owner')` + permission bundle + store-access row** in one transaction.
2. **`team-manage` deletes null-role users on invite — would erase every self-registered owner** — Verified in `team-manage/index.ts`: "Stale auth user — delete to allow fresh invite" path, and no accept-path for inviting existing users.
   → ACTIONABLE: plan scope explicitly includes a minimal `team-manage` fix (null-role provisioned users are invitable: attach role to the existing user, no delete/recreate) + integration test "invited owner keeps their store" + note on orphan `user_store_access` sweep.

### MAJORS

3. **Trigger guard missed the "first user gets admin" ELSE branch** → ACTIONABLE: guard bypasses **both** role-granting branches for `signup_intent='owner'`; SQL test with wiped `auth.users` asserting no `user_roles` row.
4. **Idempotency had no enforcing mechanism** (concurrent provisions → two stores) → ACTIONABLE: `pg_advisory_xact_lock(hashtext(user_id::text))` at RPC start + concurrent-double-invoke SQL test.
5. **Purge job would delete pending invitees; wrong pattern** → ACTIONABLE: exclude users with invite metadata; implement via cron→edge-fn (`admin.deleteUser` batches, existing `net.http_post` + cron-secret pattern, 300 s budget); regression test "invited user survives 8 days unactioned".
6. **`signup-event` = anonymous funnel poisoner** (pre-auth, no whitelist, forgeable terminal events) → ACTIONABLE: `verify_jwt=false`, per-IP rate limit, server-side whitelist {`signup_started`, `resend`} only, `meta` schema+size validation, no client `user_id`, terminal events server-written only.
7. **Kill switch closed provisioning, not sign-ups** (GoTrue keeps creating users + burning email quota) → ACTIONABLE: runbook adds dashboard step (disable email signups) AND Goal-5/DoD wording corrected to "closes new provisioning + UI in <1 min server-side; full account-creation closure = dashboard toggle, one documented step".
8. **Slug generator: Bengali/emoji names → empty slug; ignored existing slug contract** — Verified `storefronts.slug text NOT NULL UNIQUE` (20260516201928), no format CHECK; canonical path enforces `^[a-z0-9]+(-[a-z0-9]+)*$`, 2–60.
   → ACTIONABLE: adopt that regex/length in provision RPC; empty/short fallback = `store-<4 random>`; tests on Bengali names.
9. **Empty `user_store_access` = access to ALL stores; permission grants are global** — Verified `user_permissions` has no `store_id`; zero access rows ⇒ unrestricted (`20260420112330`).
   → ACTIONABLE: provision inserts permission bundle **+ exactly 1 store-access row in the same transaction with a post-insert assertion**; test "owner with empty store-access sees nothing"; residual platform-level semantics documented.

### MINORS

10. **`stores.url` NOT NULL + `status='disconnected'` default unaddressed** → ACTIONABLE: Task 0.1 gains NOT-NULL inventory duty; plan specs placeholder `url` (`https://<slug>.<storefront-domain>`) and desired `status`.
11. **Purge races a day-6.9 resend** → ACTIONABLE: purge predicate = unconfirmed AND created>7d AND no resend/confirm event in last 48 h.
12. **Consent attributed to confirmer's IP, not acceptor** → ACTIONABLE: consent event (doc, version, ts) recorded at first session-possessing action; provision IP/UA labeled as provisioning actor.
13. **Response-mapper "ALL auth calls" contradicts zero-regression on login/MFA** → ACTIONABLE: per-call mapping table (login/MFA raw except user-not-found class; reset/signup/resend generic) + unit tests.
14. **"Verified in Task 0.1" claims — task hasn't run** → ACTIONABLE: all 0.1-dependent facts marked ASSUMED; the two reviewer-verified facts (slug column; `get_user_permissions(_user_id uuid)→app_permission[]`, `get_user_store_ids(_user_id uuid)→uuid[]`, both default PUBLIC EXECUTE, read-only, no grant RPC — provision inserts directly) folded into §1 with migration cites; pre-existing `_user_id` enumeration weakness noted as out-of-scope observation.
15. **`purged_unconfirmed` rows keep email 400 days; no "this wasn't me" path** → ACTIONABLE: email NULLed immediately on purge rows; "This wasn't me — delete this account" for unprovisioned accounts on `/auth/confirm`.

Round-2 verdict: plan NOT acceptable as v2 → all fixes applied in v3. Round 3 reviews v3 + both critique files.
