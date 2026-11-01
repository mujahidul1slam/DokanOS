# Wiki — Domain Revamp goal (accounts / order sources / onboarding)

Created 2026-11-01 by the chief-of-staff session pursuing the remaining tasks of [../todo.md](../todo.md). Pages record decisions and findings as dated history with commit citations — they never claim to describe the code "now".

## Status & strategy
- [cutover-status.md](cutover-status.md) — where the user-gated cutover (Task 17) and the contract drop (Task 16) stand; known blockers and discrepancies.
- [task-conventions.md](task-conventions.md) — how tasks in this repo are implemented, verified, and committed (the pattern every task session follows).

## Decisions
- [signup-flow.md](signup-flow.md) — signup gate, email-verification chain (local auto-confirm!), duplicate-email handling and its anti-enumeration fix.
- [onboarding-design.md](onboarding-design.md) — Task 13/14 wizard design: `joined_via` provenance, creator-only gate, step vocabulary, storefront sub-onboarding.
- [legacy-pool-semantics.md](legacy-pool-semantics.md) — Task 15 pool predicates, reassign semantics, the RLS gap and its policy migration.
- [transitional-store-model.md](transitional-store-model.md) — the three store id spaces mid-migration and the RLS landmines they produce (storefronts, pages scaffold, CSV import).

## Environment
- [environment-quirks.md](environment-quirks.md) — build/test/runtime quirks of this Windows workspace (esbuild TMP flake, Docker, ports, Playwright).
- [foreign-worktree-state.md](foreign-worktree-state.md) — uncommitted changes made by other actors in this shared checkout, and the user's decisions about them.
