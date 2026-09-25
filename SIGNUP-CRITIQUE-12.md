# SIGNUP-CRITIQUE-12 — Adversarial Review, Round 12

Reviewer: fresh-context agent (single-model). Reviewed artifact: `SIGNUP-PLAN.md` v12 + all prior critiques.
Round-11 fixes verified present except one missed label; new repo verifications this round: GoTrue `/invite` rejects only **confirmed** emails and natively re-sends for unconfirmed ones **re-stamping `invited_at`** (invite.go/mail.go — version-dependent behavior); team-manage `findUserByEmail` caps at 20×200 = 4,000 users (index.ts:38–49); `invitations` has no UNIQUE(email) (duplicate synthetic rows safe).

All 6 findings validated. Classification: **6 × Valid + actionable**. Cumulative: 130 findings, 130 actionable. Third consecutive blocker-free round (0 / 2 / 4).

## Dispositions

### MAJORS

1. **Cross-device/fresh-storage confirmation makes the body-nonce unrecoverable; Retry was futile** (re-reads the same absent localStorage) → ACTIONABLE: §5.2 names the trigger (confirm opened in a different browser/device/storage) and the rule — *missing persisted nonce OR nonce-gate rejection ⇒ run the full re-anchor path* (re-execute Turnstile, fresh nonce, re-post `signup_started`, re-call provision) never blind-resubmit; §10.8 E2E row added.
2. **team-manage dispatch breaks past 4,000 users; protected fall-through bricks accounts on current GoTrue** (`findUserByEmail` 20×200 cap; `/invite` re-sends unconfirmed users and re-stamps `invited_at`, then the `invited_at IS NULL` provision gate fails forever) → ACTIONABLE: Task 2.4 resolves targets via `get_auth_signup_state` (unpaginated); protected states are typed no-ops, never fall-through sends.

### MINORS

3. **Route (c) protection keyed on the user-writable marker** → ACTIONABLE: protection now keys on the **server-side unconsumed anchor** ("unconfirmed, no invite, unconsumed anchor ⇒ typed pending-setup error, no delete, no send"); marker demoted to secondary evidence.
4. **§1's "inviteUserByEmail rejects registered emails" overbroad** (current GoTrue rejects confirmed only; older self-hosted rejected all — which this codebase evidently observed) → ACTIONABLE: §1 scoped correctly; the `resend_invite` fallback re-explained; Task 0.1 verifies the deployed GoTrue version's invite semantics.
5. **Consent `accepted_at` unspecified; re-anchor could re-stamp unseen versions** → ACTIONABLE: `accepted_at := anchor.created_at`; resume-setup re-displays and re-affirms current-version consent before re-posting.
6. **§12 Task 2.4 still said "three-branch fix" and absorbed new scope unpriced** → ACTIONABLE: label corrected to "five-route fix per §7"; estimate 1 → 1.5 d; program total **~30 person-days**.

Round-12 verdict: 2 MAJOR + 4 MINOR fixed in v13. Round 13 = convergence re-check.