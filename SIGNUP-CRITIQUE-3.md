# SIGNUP-CRITIQUE-3 — Adversarial Review, Round 3

Reviewer: fresh-context agent (single-model; cross-model declined by user earlier this process — decision stands).
Reviewed artifact: `SIGNUP-PLAN.md` v3. Prior rounds' findings not re-reported unless v3's fix was wrong.
Verification: reviewer read 20260911000130, 20260412161413, 20260904000100, 20260407071618, 20260415000837/001620, 20260420112330, 20260516201928, 20260911000500, 20260824000000, team-manage/index.ts, and 28 direct PostgREST write sites in src/.

All 15 findings validated against the plan text. Classification: **15 × Valid + actionable**. Cumulative: 45 findings processed, 45 actionable.

## Dispositions

### BLOCKERS

1. **Owner bundle grants zero power** — RLS writes on operational tables check global `has_role('admin'|'staff')` (20260415001620); `has_permission()` exists (20260420112330:169) but no policy calls it; `stores` SELECT is admin-only; clients write 28 tables directly.
   → ACTIONABLE: new **Task 1.6: member-scoped RLS migration** (pattern proven on app_settings 20260911000400); Phase 0 gated on it. DoD updated.
2. **Select-USING(true) = instant cross-tenant PII leak the moment signups open** — `orders`/`products`/`customers` SELECT for `authenticated`unrestricted.
   → ACTIONABLE: read-side scoping folded into Task 1.6 (launch blocker, removed from "separate hardening" non-goal).
3. **RPC auth mechanism unworkable** — service-role call → `auth.uid()` NULL; user-JWT call → blocked by own EXECUTE revoke; `create_business_with_owner` (read at 20260911000130:17) is caller-JWT with `v_user := auth.uid()`.
   → ACTIONABLE: spec fixed — edge fn verifies user JWT (verify_jwt) then calls `provision_owner_business(p_user_id uuid)` with service key; RPC self-verifies against `auth.users`; `REVOKE ALL FROM PUBLIC/anon/authenticated; GRANT EXECUTE TO service_role`.
4. **`signup_intent` gate forgeable via `auth.updateUser({data})`** — any existing unprovisioned account could self-mint a business while switch is open; consent/business_name sourcing from mutable metadata also broken.
   → ACTIONABLE: gate redesigned to a **server-anchored record**: `signup_started` event carrying client-generated nonce, written pre-signUp, same nonce echoed in signup metadata; provision requires marker + `users.created_at` within 24 h + matching row (same email+nonce, written within creation window). business_name/consent read from that row, never live metadata. Metadata documented as untrusted.

### MAJORS

5. **"This wasn't me" delete had no auth model** (sits on no-session screen) → ACTIONABLE: session-authorized `delete_unprovisioned_self()` RPC (self-only, only when zero tenant rows + zero roles); no-session screen routes through "Sign in to finish setup"; rate-limited + audited.
6. **Task 2.4 under-specced** — `inviteUserByEmail` rejects registered emails; attach leaves `accepted_at` NULL; stale-delete discriminator unsafe (would eat mid-flight signups); staff role is global (undisclosed).
   → ACTIONABLE: full branch spec (existing-UBA user ⇒ direct `user_roles` attach + `accepted_at=now()` + no email step; stale-delete only when no UBA + no owner marker + unconfirmed >48 h); plan now discloses staff role's global scope in §13 accepted residuals.
7. **Consent double-sourced / order-ambiguous / no uniqueness** → ACTIONABLE: single writer = provision RPC; inputs from anchored signup record; `UNIQUE(user_id, doc)` + `ON CONFLICT DO NOTHING`; "first session-possessing action" wording deleted.
8. **UI kill switch was build-time Vite env** (contradicts <1 min DoD) → ACTIONABLE: `/signup`, create-account link, resend read `app_config.signup_open` at runtime; Vite flag = deploy-time gate only.
9. **Funnel referenced unwritten events** (`email_confirmed`, `first_login`) → ACTIONABLE: funnel = `signup_started → email_confirmed → provisioned`; `email_confirmed` whitelisted in `signup-event` but only with a valid session-binding; `first_login` derived from `auth.users.last_sign_in_at` in the dashboard query, not an event.
10. **`status='active'` violates CHECK ('connected','disconnected','syncing','error'); placeholder store's downstream blast radius unanalyzed** (woo-sync-all cron, `storefront_place_order`, parity rows `connectors`/`selling_points`/`product_sources` seeded for old businesses only) → ACTIONABLE: commit `'disconnected'`; Task 0.1 extended to enumerate all `stores` consumers; provision transaction now seeds parity rows (`connectors`, `selling_points` showroom_pos + dokanos_storefront) per backfill convention.

### MINORS

11. **Location row unspecified** → ACTIONABLE: `locations(name='Main', type='store', is_default=true, business_id, brand_id)` in-transaction + selling-point seed decision made explicit.
12. **`signup_open` seeded true contradicts dark-ship** → ACTIONABLE: seed `false`; Phase 1 flip is the documented step.
13. **Resend throttle per-email only** → ACTIONABLE: added ≤20/h/IP; hammer test updated.
14. **Test title contradicted verified fail-open store-access semantics** → ACTIONABLE: retitled to assert the post-insert assertion; fail-open direct-DB behavior recorded (real protection = Task 1.6 RLS).
15. **Only 1 of 3 UNIQUE slug columns covered; model-RPC validations (name ≤100, currency, timezone allow-lists) un-inherited** → ACTIONABLE: businesses/brands/storefronts slugs derive from one candidate set with retry across all unique violations; explicit defaults `currency='BDT'`, `timezone='Asia/Dhaka'`, name ≤100.

Round-3 verdict: plan NOT acceptable as v3 → all 15 fixes applied in v4. Round 4 reviews v4 + all three critique files.
