# SIGNUP-CRITIQUE-10 — Adversarial Review, Round 10 (near-converged)

Reviewer: fresh-context agent (single-model). Reviewed artifact: `SIGNUP-PLAN.md` v10 + all prior critiques.
Round-9 fix integrity: all 10 verified present/correct. Repo spot-checks all hold (auth-js 2.104.0; CHECK domains accept specced values incl. `disconnected`, `locations.type='store'`, UBA `'owner'`; storefronts anon SELECT filter; team-manage lines; invitations schema).

All 6 findings validated against plan text. Classification: **6 × Valid + actionable**. Cumulative: 118 findings, 118 actionable. **Severity profile: 0 BLOCKERS, 2 MAJOR, 4 MINOR — first round without blockers.**

## Dispositions

### MAJORS

1. **§7's "exhaustive" branches weren't** — owner-marker users WITHOUT a UBA row (confirmed-unprovisioned zombie; mid-flight with live anchor) fell through all three branches into undefined behavior in the regression-critical function.
   → ACTIONABLE: branch (d) added — no UBA + owner marker ⇒ no delete, no attach, typed error "account has a pending self-serve setup" (admin waits for 26 h purge or support); §10.6 asserts both sub-states + copy.
2. **Parity row bindings underdetermined** — backfill sets `showroom_pos.location_id` (:502–503), `dokanos_storefront.woo_store_id` (:527–529), `woocommerce.woo_store_id` (:510–512); §3 listed none; plus §3's `locations.type='store'` vs backfill's `'showroom'` (:490–491) disagreement under "exact parity" phrasing.
   → ACTIONABLE: §3 row list extended with all three bindings; location type aligned to the backfill convention (`'showroom'`, Task-0.1-verified); §10.3 asserts the bindings.

### MINORS

3. **§12 title stale ("~26.5") vs table/header (29.5)** → ACTIONABLE: §12 title corrected.
4. **Resend gate ignored `invited_at`** — invitees could pull wrong-template signup confirmations → ACTIONABLE: gate adds `invited_at IS NULL`; §10.10 invitee-negative row.
5. **Client-side disposable-domain pre-check had no data source** → ACTIONABLE: specced as a build-time bundled snapshot (staleness documented; authoritative check stays server-side).
6. **Captcha-error mapping was scoped to login only** though the §11.2 stale-bundle window hits reset/signup/resend too → ACTIONABLE: captcha-error class applies to all four calls; per-call mapper unit rows added to §10.1.

Round-10 verdict: 2 MAJOR + 4 MINOR fixed in v11. Round 11 = final convergence verification.
