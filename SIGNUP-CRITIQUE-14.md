# SIGNUP-CRITIQUE-14 — Adversarial Review, Multi-Business Delta (Round 14)

Reviewer: fresh-context agent (light variant). Target: the v2 multi-business delta only (§§1/2/3.2/4/6.3/7/10/12/13/14).
Verified: `get_my_managed_businesses()` body in 20260911000500; `user_permissions` UNIQUE(user_id, permission) in 20260420112330 (bundle re-grant idempotency claims hold); own-row SELECT on `user_business_access` intact after 20260911000100 (switcher self-read works).

Classification: **2 × Valid + actionable** (1 BLOCKER, 1 MAJOR). Everything else in the delta verified clean (rate caps consistent with tests, `business_added` enum extension properly scoped, gate split coherent with zero-regression). Cumulative across the loop: 139 findings, 139 actionable.

## Dispositions

1. **[BLOCKER] `get_my_managed_businesses()` filters to owner/admin (+dumps ALL businesses for platform admins)** — cannot power a switcher that must list member/viewer memberships (goal 6; §10.2's "member row in C" test would fail).
   → ACTIONABLE: new read RPC `get_my_businesses()` — caller's own UBA rows only, all roles, **no platform-admin disjunct**. §3.2 data line + §1 bullet + §10.2 assertion updated; SQL test asserts member/viewer rows appear and platform admins see only their own memberships.
2. **[MAJOR] The RPC returned no `role` column** — §3.2's role badges and owner-first fallback were unimplementable.
   → ACTIONABLE: `get_my_businesses()` returns `(id, name, slug, logo_url, role)`; role badge + fallback consume that column.

Round-14 verdict: both fixes applied in plan v2.1; added to Task 1.2. Follow-up confirmation round on the delta next.
