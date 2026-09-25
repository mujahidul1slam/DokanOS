# SIGNUP-CRITIQUE-6 — Adversarial Review, Round 6

Reviewer: fresh-context agent (single-model). Reviewed artifact: `SIGNUP-PLAN.md` v6 + all prior critiques.
Verified: GoTrue `/resend` returns 200 with EMPTY body for already-confirmed emails (`resend.go`), `/resend` sits behind `verifyCaptcha` + own rate limiter; `storefronts.name` NOT NULL; `storefronts.store_id` link; `brands.woo_store_id` = the store→business link used by parity backfill (20260904000100:527–529).

All 11 findings validated against plan text. Classification: **11 × Valid + actionable**. Cumulative: 79 findings, 79 actionable.

## Dispositions

### BLOCKERS

1. **Turnstile single-use contradiction reborn** — "own Turnstile" on `auth-resend`/`signup-event` + GoTrue-side verification = every token consumed twice → `timeout-or-duplicate`.
   → ACTIONABLE: token discipline table (§6.1): `signUp`/`resend` tokens are **forwarded** to GoTrue (captchaToken param), edge fns do NOT siteverify those; `signup-event` gets its OWN distinct token (form mints two tokens). No fn verifies a token GoTrue will also verify.
2. **§10.10 resend test contradicts verified GoTrue semantics** — confirmed-email resend returns 200/empty → "write event only on 2xx" would audit a send that never happened; DoD claim unachievable.
   → ACTIONABLE: `auth-resend` pre-checks `email_confirmed_at` via service key; writes `resend` event only when (user exists AND unconfirmed AND GoTrue 2xx); §10.10 rewritten accordingly; DoD reworded to "resend events = confirmed actual dispatch attempts".

### MAJORS

3. **Provision transaction omitted linkable/NOT-NULL columns** → ACTIONABLE: insert list expanded — `storefronts(name=<business name>, store_id=<new store>, slug, is_active=false)`, `brands(woo_store_id := stores.id, slug)` (the ONLY member-scope join path), `selling_points` parity incl. `storefront_id` per backfill convention. This also unblocks `publish_my_storefront`'s membership assertion and all Task-1.6 policies.
4. **Confirmed-but-unprovisionable zombies unhandled** (purge covers only unconfirmed; stale-delete branch became dead code) → ACTIONABLE: DoD/Goal-3 reworded honestly ("no unconfirmed zombies; confirmed-incomplete accounts exit via self-delete/support and squat the email — accepted residual, disclosed"); dead stale-delete branch note removed from §7 (only the no-UBA/unconfirmed predicate remains reachable).
5. **"Forge-proof anchor" impossible by construction** — both sides attacker-controlled for one's own account → ACTIONABLE: rebranded to **consent/attribution + cross-account binding**; trust boundary stated precisely ("equivalent to signup itself"); §10.9 tamper test replaced with the implementable one — cross-account mismatch (anchor email ≠ user email under canonical normalizer) rejects.
6. **Task 1.6 at 3 days not credible; whole program ≈14 days undercounted** → ACTIONABLE: 1.6 split into 1.6a (policy-matrix deliverable, **reviewed before any migration**, 2 d) + 1.6b (per-domain cutover, 8 d); program re-baselined to ~3 weeks total.

### MINORS

7. **`publish_my_storefront` hygiene + idempotency unspecified** → ACTIONABLE: §6.7 hygiene list + grants extended to both 1.7 RPCs; `site_opened` written only on an actual false→true flip.
8. **Per-email cap would eat `email_confirmed` under retries** → ACTIONABLE: ≤3/day/email cap scoped to `signup_started` only; test: 3 anchors then confirm → `email_confirmed` still recorded.
9. **Dead-config controls**: empty `disposable_email_domains` (vacuous test) + edge-fn secrets missing from §8 → ACTIONABLE: seeding (source list + update cadence) added to Task 1.1; Turnstile secret, service key, cron secret added to §8 checklist.
10. **Anchor email equality vs alias normalization never reconciled** → ACTIONABLE: one canonical normalizer (lowercase/trim/strip `+tag`/gmail dots) defined once, applied at ingest AND gate comparison; unit test for case/alias gate equality.
11. **Two details silently dropped from earlier rounds**: placeholder-URL format `https://<slug>.<storefront-domain>` restored; purge discriminator unified with the provision gate (`invited_at IS NULL`) — fixes the round-2 invitee-eating regression hiding in the "invite meta" wording.

Round-6 verdict: plan NOT acceptable as v6 → all fixes applied in v7. Round 7 reviews v7 + all critique files.