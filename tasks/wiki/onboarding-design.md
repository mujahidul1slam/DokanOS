# Onboarding design (Tasks 13–14)

Landed as commits `24246c6` (Task 13, 2026-10-31) and `1a7d2d9` (Task 14, 2026-11-01). Spec: `DOMAIN-REVAMP-SPEC.md` §6a/§6b.

## Provenance gate (`joined_via`)
- Migration `20261102090000_business_onboarding.sql` added `user_business_access.joined_via ∈ ('created','invited','granted')`, DEFAULT `'granted'` = **fail-closed**. `create_business_with_owner` + `signup_create_business_core` stamp *created*; `accept_business_invitation` stamps *invited*; direct grants stay *granted*. One-time backfill for legacy rows.
- **Decision (2026-10-31, agent-made, flagged to user):** the wizard and its settings entry point show ONLY to `joined_via === 'created'` ([eligibility.ts](../../src/features/onboarding/eligibility.ts) `shouldOfferBusinessOnboarding`). Spec says "invited members never see it" + "created from scratch"; directly-granted members are therefore excluded too. Widening to `!== 'invited'` is a one-predicate change if the user prefers.

## Checklist persistence
- `business_onboarding_steps`: PK (business_id, step_key), `status ∈ ('completed','skipped')`; **no row = step open**. `step_key` is open text by design so later tasks append steps without a constraint migration (Task 14 did exactly that: `warehouses`, `product_import`, `storefront`). Vocabulary lives in `src/features/onboarding/steps.ts`; unknown keys ignored client-side.
- Skip semantics: per-step "Skip for now" (persists `skipped`, advances) + "Exit setup" (bails anytime, marks already persisted). Resume = first unmarked step. Completing all stamps `businesses.onboarding_completed_at`.

## Storefront sub-onboarding (Task 14)
- ONE shared flow in `src/components/storefront/` (`storefrontSetup.ts` pure validation/settings, `storefrontCreate.ts` pipeline, `StorefrontSubOnboarding.tsx` form): used by the wizard's storefront step AND StorefrontsPage's "New Storefront" (the page's old 195-line dialog was deleted). "Publish now" publishes the scaffolded Home page — the anon runtime only renders published snapshots.
- Known quirk (pre-existing, preserved for Task 16): a storefront created when the business has **no stores** gets `store_id=null` and is hidden from the store-scoped admin list, though `/storefront/<slug>` renders. The wizard success panel links the public URL as a workaround.

## Product import step (Task 14)
- CSV is an **action**, not an entity (spec §6a): `src/lib/productImport.ts` — RFC-4180-subset parser, per-line errors with skip-and-report, batch insert with row-by-row fallback, provenance `origin_kind='csv'`. Woo import kicks the sync worker only for connection-complete sources; manual add deep-links `/products?new=1`.
- One deliberate lint suppression landed with Task 14: `eslint-disable-next-line react-hooks/exhaustive-deps` on a manual `reload()` effect (`[targetBrandId]`). Accepted as pragmatic; noted in the verification record.

## related
- [legacy-pool-semantics.md](legacy-pool-semantics.md) (provenance columns) · [task-conventions.md](task-conventions.md) · [environment-quirks.md](environment-quirks.md) (build flake during both verifications)
