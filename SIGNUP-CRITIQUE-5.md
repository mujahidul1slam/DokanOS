# SIGNUP-CRITIQUE-5 — Adversarial Review, Round 5

Reviewer: fresh-context agent (single-model). Reviewed artifact: `SIGNUP-PLAN.md` v5 + all prior critiques.
Verified against vendored `@supabase/auth-js ^2.101.1` types + `GoTrueAdminApi.js`/`GoTrueClient.js`, and `storefronts` UPDATE policies (20260516201928).

All 12 findings validated against plan text. Classification: **12 × Valid + actionable**. Cumulative: 68 findings, 68 actionable.

## Dispositions

### BLOCKERS

1. **`auth-resend` built on the wrong primitive** — `admin.generateLink({type:'signup'})` requires `password` (won't typecheck) and is a user-CREATION API that errors on registered emails (100% of this fn's traffic); it's for custom-provider link generation, not confirmation re-sends.
   → ACTIONABLE: replaced with server-side GoTrue `/resend` from an anon-key client inside the edge fn (`auth.resend({type:'signup', email, captchaToken})` — captcha supported, verified in GoTrueClient.js), after the fn's own Turnstile + throttles; `resend` event written **only on 2xx**; generic response regardless.
2. **Anchor freshness window contradicts the resend flow** — `[users.created_at −2m, +10m]` fails every re-anchored resend (created_at never changes on repeat signUp; links expire) and any form left open >12 min.
   → ACTIONABLE: window re-anchored to **provision time** — gate = unconsumed anchor, same email+nonce, written ≥ `users.created_at −2m` AND within 24 h **before the provision call** (24 h user-freshness gate unchanged); §10.3 tests: resend at +2 h/+23 h → confirm+provision succeeds; anchor-only retry at +30 m succeeds.

### MAJORS

3. **Purge grace vs 24 h provision gate = curated zombie accounts** (unprovisionable users kept alive forever by resends) → ACTIONABLE: lifetimes made coherent — purge at `created_at > 26 h` regardless of resend grace; grace only meaningful inside the 24 h eligibility window; §10.7 test "resent-daily unconfirmed user still purged at ~26 h".
4. **Storefront publish flip has no write path** (only UPDATE policy is global-staff-gated; owners get zero roles; `storefronts` outside Task 1.6 scope) → ACTIONABLE: new SECURITY DEFINER `publish_my_storefront()` RPC (owner-membership asserted, sets ONLY `is_active=true`, audits, server-writes `site_opened`); direct client UPDATE of storefronts stays denied for owners; §10.3 tests.
5. **Task 1.6 matrix misses the two things that blow up member RLS** — recursion-safe helpers + fail-open semantics — plus a real perf gate → ACTIONABLE: matrix extended with: STABLE SECURITY DEFINER helper names (recursion-safe), explicit fail-open/fail-closed rule per table (`user_store_access` zero-rows behavior decided per table), numeric p95 budget + `EXPLAIN ANALYZE` gate + parent-FK index verification; §10.2 acceptance rows per matrix entry.
6. **`delete_unprovisioned_self()` load-bearing but untasked/unspecced** → ACTIONABLE: Task 1.7 (0.5 d): caller-JWT SECURITY DEFINER, grant model spec'd, invariants in §10.3 (rejected when tenant rows exist / roles exist / called for other id), E2E stays in §10.8.

### MINORS

7. **`site_opened` dead enum value** → ACTIONABLE: assigned to `publish_my_storefront()` (#4) as its writer.
8. **§9 "every event has an authenticated producer" was false** (`signup_started` is anonymous by design) → ACTIONABLE: reworded to precise security statement ("anonymous but only usable when cryptographically anchored…").
9. **§8.2 redirect allow-list missing the recovery/set-password landing** → ACTIONABLE: added (plus `/welcome/setup-failed` wherever email-linked).
10. **Task 2.4 attach had no audit; `accepted_at=now()` misrepresents history** → ACTIONABLE: kept timestamp for repo-consistency + new audit event `staff_role_attached` (inviter + ts); reset-password email copy mandated to say "you were granted staff access".
11. **No negative tests for the resend path** → ACTIONABLE: §10.10 added — confirmed-email resend → no email, generic response, NO `resend` row; GoTrue error → NO row, generic response.
12. **`signup-event` lacked per-email cap** (anonymous email-stuffing into PII table) → ACTIONABLE: ≤3/day/email (alias-normalized) added alongside the IP cap, privacy rationale noted.

Round-5 verdict: plan NOT acceptable as v5 → all fixes applied in v6. Round 6 reviews v6 + all critique files.