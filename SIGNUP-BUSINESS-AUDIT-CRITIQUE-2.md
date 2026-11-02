# SIGNUP-BUSINESS-AUDIT-CRITIQUE-2 — Remediation Plan Critique, Round 2

Reviewer: fresh-context adversarial agent (single-model; cross-model declined — standing). Artifact: `SIGNUP-BUSINESS-AUDIT.md` §4 **v2**. Round-1 fixes verified present; reviewer also stress-checked and CLEARED: R4a escalation design (UBA CHECK values owner/admin/member/viewer; `role IN ('owner','admin')` matches house idiom; the user_store_access grant adds nothing beyond brand-link branch 3), products premise (authenticated SELECT really is USING(true); is_active=true policy is anon-only), R2c table shapes, R4 step 2/3 member-INSERT policies, gate-regression claims, 33-key bundle consistency.

All 6 findings validated → **6 × Valid + actionable** (2 MAJOR, 4 MINOR). Cumulative: 18 findings, 18 actionable.

## Dispositions

1. **[MAJOR] R2c list STILL incomplete** — product_variations (:227), product_categories (:207), categories (:247) keep `USING(true)`; the "product variations 20260914140000:18" policy is `TO anon, authenticated` (its authenticated branch nullified by USING(true)); the repo's own comment (:14–16) flags cross-tenant inactive/draft product prices via variations; pos_shifts mislabeled (already user-scoped :186–188).
   → v3: three tables added with parent-join scoping; categories decision recorded (business-scoped dictionary); DROP (not "replace") instruction; pos_shifts corrected; variations-hole closure added to acceptance criteria.
2. **[MAJOR] POS dead-on-arrival for self-serve** — held_carts (:149–151), pos_returns (:169–171), pos_shifts INSERT/UPDATE (:190–196) remain admin/staff-gated while the bundle grants `pos.*` and the wizard provisions a Showroom POS.
   → v3: **new R2d** — member POS write policies via user_can_access_store (pos_shifts via selling_point_id→selling_points.business_id) + acceptance test (shift open/close, hold cart, return under member JWT). Chose extending writes over descoping POS (bundle + wizard already promise it).
3. **[MINOR] create_additional_business idempotency underspecified** — a global-keyed implementation could hand back ANOTHER USER's business.
   → v3: guard = (p_user_id, canonical slug-base) against that user's OWN businesses ≤24 h; different names always create new; three acceptance tests added (double-invoke, different-name, user-B-vs-user-A).
4. **[MINOR] Storefront slug reservation lost between steps 1 and 4** — step-4 member INSERT could hit a raw unique_violation.
   → v3: R4a now inserts an **inactive placeholder storefront row carrying the reserved slug** (restores the original 3-table atomicity); step 4 attaches the selling point and publishes THAT storefront — no step-4 INSERT at all.
5. **[MINOR] Release-2 window not restated in the operative plan section** — Release 1 creates real tenant data under still-open reads.
   → v3: release-shape paragraph now states **public signup launch stays gated on Release 2; `signup_open` remains false until R2c/R2d land**.
6. **[MINOR] R4a "idempotent per business" silently capped every business at one store** — unacknowledged product limit.
   → v3: **declared cap** (one self-serve store/brand per business in this remediation; additional stores = future flow via the same RPC); acceptance test asserts second invoke returns the same store; also added the member/viewer-deny test from the reviewer's clean-checks note.

Round-2 verdict: plan NOT acceptable as v2 → all 6 applied in §4 v3 (total ≈ 9 person-days). Round 3 verifies convergence.
