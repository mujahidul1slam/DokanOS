# SIGNUP-CRITIQUE-11 — Adversarial Review, Round 11

Reviewer: fresh-context agent (single-model). Reviewed artifact: `SIGNUP-PLAN.md` v11 + all prior critiques.
Round-10 fixes verified present; key repo claims re-verified (`locations.type` CHECK includes `'showroom'`; UBA CHECK includes `'owner'`; parity bindings cited correctly; auth-js 2.104.0 `resend` posts the email verbatim).

All 6 findings validated against plan text. Classification: **6 × Valid + actionable**. Cumulative: 124 findings, 124 actionable. Severity: 0 BLOCKERS / 3 MAJOR / 3 MINOR (second consecutive blocker-free round).

## Dispositions

### MAJORS

1. **§7 branches STILL not exhaustive** — pending-invitee re-invite (`invited_at` NOT NULL, unconfirmed, no UBA, no marker) matched nothing; (a)/(b) lacked an already-has-role guard (`UNIQUE(user_id,role)` → 500, regressing today's friendly error); "three branches" labels unupdated in §7/§10.6/§12.
   → ACTIONABLE: fifth route (e): pass through to `inviteUserByEmail` (native re-send); (a)/(b) guard "staff role already exists ⇒ typed no-op success"; labels fixed everywhere — now **five routes**.
2. **Canonical-alias resend mechanically broken** — gate normalized but GoTrue dispatches on the exact stored email; lookup fn returned no email field; canonical gmail-dot keys are many-to-one with no tie-break → wrong-user 4xx or false `resend` audit.
   → ACTIONABLE: `get_auth_signup_state` now returns the **stored email** too; >1 canonical match ⇒ generic reject + `blocked` audit; `auth.resend` is called with the **stored** email, never the typed one; §10.10 asserts dispatch target == stored email + multi-match reject case.
3. **Nonce gate rested on mutable metadata + unverified overwrite semantics** (could 100%-reject the most common retry flow; metadata writes could break first-confirm provisioning; nonce added no security — cross-account binding already comes from canonical email + freshness + single-consumption under a verified-JWT user id).
   → ACTIONABLE: nonce moved off the metadata channel — client persists it (localStorage) and submits it in the `signup-provision` request **body**; gate compares anchor nonce vs body nonce; metadata echo kept as diagnostic only; Task 0.1's metadata-overwrite item annotated "no longer gate-critical".

### MINORS

4. **"Never raw error text" overclaimed** — the mapper ships in the new bundle; stale pre-token tabs DO show GoTrue's (non-enumerative) captcha-rejection text during the toggle window.
   → ACTIONABLE: §11.2/§13 wording corrected; optional deploy-version forced-reload noted for the window.
5. **Missing-anchor accounts dead-ended in-window** (anchor post can fail after signup) → ACTIONABLE: resume-setup screen explicitly re-executes Turnstile + fresh nonce + re-posts `signup_started` on demand; §10.8 E2E case added.
6. **≤3/day/email anchor cap = targeted signup lockout vs a known address** → ACTIONABLE: disclosed in §13 with recovery (next bucket) + mitigations (per-IP cap, abuse alerting).

Round-11 verdict: 3 MAJOR + 3 MINOR fixed in v12. Round 12 = convergence re-check.
