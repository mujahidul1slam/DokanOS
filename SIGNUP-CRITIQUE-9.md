# SIGNUP-CRITIQUE-9 — Adversarial Review, Round 9

Reviewer: fresh-context agent (single-model). Reviewed artifact: `SIGNUP-PLAN.md` v9 + all prior critiques. Verified remaining round-8 dispositions hold (parity set matches 20260904000100 §§5–7; auth-js 2.104.0; storefronts UPDATE policy global-staff only; first-user-admin branch covered).

All 10 findings validated against plan text. Classification: **10 × Valid + actionable**. Cumulative: 112 findings, 112 actionable.

## Dispositions

### BLOCKER

1. **§7.c stale-delete predicate deletes pending invitees** — missing `invited_at IS NULL`; the `OR no unconsumed anchor` clause matched every invitee at any age (invitees never write anchors), contradicting §10.6/§5.2 — the same discriminator class fixed in round 6 for the other gates.
   → ACTIONABLE: `invited_at IS NULL` added to §7.c; §10.6 test re-targeted to exercise the team-manage predicate itself (re-invite a pending invitee → never deleted).

### MAJORS

2. **Captcha flip cuts a login-outage window for stale in-memory bundles** (long-lived tabs; this app has SW history) and the mapper had no captcha-error class → ACTIONABLE: §6.4 adds captcha-error → "refresh and try again" (oracle-free); §11 gains an existing-env rollout step (ship tokened forms as their own release → propagation window → monitor captcha-rejection rate → flip); transient honestly noted in §13.
3. **Consent `ip/ua` provenance silently dropped** — provision would stamp the confirmer's IP as the acceptor's (round-2 defect reintroduced) → ACTIONABLE: `consent_records.ip/ua := anchor (signup_started) ip/ua` (acceptance-time); provision-call IP lives only in `signup_events`; §10.3 assertion added.
4. **"~3.5 weeks two-stream" was a zero-slack floor** — 0.1's join inventory feeds 1.6a (day-0 dependency), 1.6a's review loop unbudgeted, 3.2 underpriced for 8+ captcha-env E2E flows → ACTIONABLE: 0.1's 1.6a-inventory output moved to a shared day-0 deliverable; 1.6a review loop budgeted +1 d; 3.2 → 2.5 d; header now reads "~4 weeks contingent (2 streams)".

### MINORS

5. **Table summed to 27.0 pd; header said 26.5** → ACTIONABLE: header + §12 title corrected to ~27 person-days (≈5.5 weeks single-stream).
6. **Post-captcha smoke omitted adjacent endpoints** (`/verify` confirm exchange, session refresh, invite set-password) → ACTIONABLE: §10.5 rows added — all three exercised in staging AFTER captcha ON.
7. **`get_auth_signup_state` used lower-only while canonical normalizer strips aliases** → ACTIONABLE: fn compares canonical-normalized forms both sides; alias-typed resend unit test added.
8. **`STOREFRONT_DOMAIN` was referenced but never provisioned** → ACTIONABLE: added as `app_config` seed in §4 (`storefront_domain`); §3 cites it as the source.
9. **`delete_unprovisioned_self()` "throttled" with no number** → ACTIONABLE: §6.3 gains ≤3/h/actor; §10 row added.
10. **Disposable-domain gate missing from §3's authoritative GATES list** → ACTIONABLE: added as an explicit gate line (rejects with `BLOCKED_DOMAIN` typed code), aligning §3/§6.5/§10.3.

Round-9 verdict: plan NOT acceptable as v9 → all fixes applied in v10.
