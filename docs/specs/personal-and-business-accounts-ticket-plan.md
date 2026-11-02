# Approved and published ticket breakdown

Parent specification: https://github.com/mujahidul1slam/DokanOS/issues/7

Status: approved by the user and published as GitHub sub-issues, with native blocking dependencies and the ready-for-agent label.

## Published tickets

| Slice | GitHub issue | Blocked by |
| --- | --- | --- |
| 1. Migration safeguards | [#8](https://github.com/mujahidul1slam/DokanOS/issues/8) | None |
| 2. Personal signup | [#9](https://github.com/mujahidul1slam/DokanOS/issues/9) | None |
| 3. Business accounts | [#10](https://github.com/mujahidul1slam/DokanOS/issues/10) | #8, #9 |
| 4. Independent brands | [#11](https://github.com/mujahidul1slam/DokanOS/issues/11) | #10 |
| 5. Physical/online stores | [#12](https://github.com/mujahidul1slam/DokanOS/issues/12) | #11 |
| 6. Invitations and membership | [#13](https://github.com/mujahidul1slam/DokanOS/issues/13) | #10 |
| 7. Ownership transfer | [#14](https://github.com/mujahidul1slam/DokanOS/issues/14) | #10 |
| 8. Integration and migration rehearsal | [#15](https://github.com/mujahidul1slam/DokanOS/issues/15) | #12, #13, #14 |

## 1. Audit legacy account data and establish migration safeguards

**Blocked by:** None.

**What it delivers:** A verifiable, non-destructive readiness check showing how existing accounts and resources can transition without guessing ownership, store type, or access. This is the up-front compatibility/prefactoring exception, not a schema-only feature ticket.

- Produce a read-only inventory of legacy memberships, ownership, global grants, brand/store relationships, locations, selling points, and relevant operational references.
- Distinguish unambiguous mappings from shared/unlinked resources, ambiguous store types, multiple-owner cases, and global-authority exceptions requiring review.
- Rehearse preservation checks using representative test fixtures; unresolved cases block affected changes rather than being automatically reassigned, deleted, or silently stripped of legitimate access.
- Define the additive compatibility and rollback boundaries for subsequent slices; do not prematurely remove old readers or mutate deployed data.
- Demonstrate the audit on test fixtures, including a safe case and a blocked ambiguous case.

## 2. Make personal signup and verification independent of business setup

**Blocked by:** None.

**What it delivers:** A person can register and verify their email without creating a business account or providing business details, then reach a useful no-membership screen.

- Signup collects person name, email, password, and required consent only.
- Confirmation and recovery work without business-provisioning local state; callbacks never automatically create accounts, brands, stores, or storefronts.
- Verified people without memberships see a valid empty account-selection state; existing members still enter a valid account context.
- Preserve invitation intent across new-person signup and verification without granting membership before authorized acceptance.
- Prove the journey in browser/integration tests, including reload, repeated confirmation, and missing signup local state.

## 3. Create and switch business accounts with server-enforced owner/member boundaries

**Blocked by:** 1, 2.

**What it delivers:** A verified person creates an empty business account using its name, becomes its owner, and switches among authorized accounts without leaking data or state.

- Support first and additional business-account creation with no signup-age or automatic-provisioning dependency; no brands or stores are created implicitly.
- Validate active-account selections against current membership and refresh all account-scoped UI/cache context on switching.
- Enforce account membership on operational reads and writes; members have account-wide operational access but cannot perform owner-only administration.
- Preserve existing legitimate access using the reviewed migration mappings; do not silently convert legacy global authority into a cross-account bypass.
- Prove first/additional account creation, empty-account entry, stale selections, owner/member/nonmember behavior, and direct cross-account API/RLS denial using real integration tests.
- Defer ownership-transfer UI to ticket 7 and invitation/member-management UI to ticket 6, while enforcing their owner-only server boundary from this slice onward.

## 4. Create independent brands inside a business account

**Blocked by:** 3.

**What it delivers:** An authorized person creates and views multiple named brands in the active business account without creating a store or triggering mandatory onboarding.

- Minimal creation requires only a name and the authorized business-account context.
- A business account may have no brands; a brand may have no stores.
- Brand presence is not treated as proof of a store, and empty states remain navigable.
- Creation/listing follows the first-release owner/member operational policy and rejects forged cross-account parents.
- Prove the empty-account → brand journey and absence of automatic store/storefront creation in browser and real backend tests.

## 5. Create physical and online stores under brands without forced publication

**Blocked by:** 4.

**What it delivers:** A person adds multiple physical or online stores to a brand and can enter their operational context without optional configuration or public website publication.

- Minimal creation requires name, exactly one authorized parent brand, and physical/online type; no combined type is offered or accepted.
- Store ownership follows its brand's business account; a brand can contain multiple stores or none.
- Configure addresses, integrations, and storefronts later; creating an online store never publishes a website or creates another brand.
- Expand existing relationships compatibly and migrate only reviewed legacy mappings; preserve operational history and stable references.
- Update affected operational consumers sufficiently to keep supported existing flows usable with the new parent relationship and store types; do not redesign those modules.
- Prove multiple-store creation, type validation, account isolation, absence of unintended publication, and representative legacy operational compatibility with real backend and browser tests.

## 6. Invite and manage business-account members using verified personal identities

**Blocked by:** 3.

**What it delivers:** An owner invites an existing or new person to a particular business account, the intended verified email accepts, and the owner can manage member access without granting platform authority.

- Owner-only invitations carry account context and intended email identity; members and nonmembers cannot issue or manage them through direct requests.
- Existing people sign in; new invitees complete personal registration/verification without creating their own business account.
- Acceptance is email-bound and safely repeatable; wrong-email, invalid, and unusable invitation states have clear outcomes and cannot create unauthorized membership.
- Joining grants account-wide member operational access only; it does not assign a platform role or granular brand/store/module permissions.
- Provide owner-only membership management while preventing members from managing membership or removing an owner through ordinary member removal.
- Prove both invitation journeys, owner-only administration, cross-account denial, repeated acceptance, and updates to available account contexts after membership changes.

## 7. Transfer business-account ownership safely before owner departure

**Blocked by:** 3.

**What it delivers:** An owner can transfer ownership to an existing member before leaving, without losing account control accidentally or leaving an ownerless account.

- Owners retain full access; ordinary members cannot restrict, transfer, or revoke owner authority.
- Ownership transfer requires an eligible existing member of the same business account and an authorized current owner.
- Owner departure is blocked until ownership has been transferred; retries/concurrent requests cannot leave the account ownerless.
- Respect reviewed legacy ownership exceptions rather than silently removing additional owners.
- Demonstrate transfer/departure in the UI and real backend tests, including forged cross-account targets, unauthorized callers, and concurrent/repeated operations.

## 8. Rehearse migration and verify the complete account-to-store and invitation journeys

**Blocked by:** 5, 6, 7.

**What it delivers:** The complete replacement flow is release-verifiable against representative existing data, and obsolete provisioning/onboarding behavior can be retired without breaking operational access.

- Rehearse signup → verification → business account → brand → physical/online stores and both new/existing-person invitation journeys against the integrated implementation.
- Verify account switching, owner/member restrictions, direct API/RLS account isolation, and operational compatibility after migration.
- Compare pre/post records and legitimate access, resolve reviewed migration exceptions, and retain a release blocker for unresolved affected records.
- Contract compatibility paths only after their consumers have moved and tests pass; remove automatic-provisioning and forced-setup behavior that would reintroduce the old model.
- Run relevant browser, database, unit, typecheck, lint, and build checks; document rehearsal results and rollback/release gates without modifying a deployed database without separate authorization.
- Do not implement deferred scoped permissions or unrelated operational redesigns during integration.

## Dependency frontier

- Initially ready: 1 and 2.
- After both: 3.
- After 3: 4, 6, and 7 can proceed independently.
- After 4: 5.
- After 5, 6, and 7: 8.

Each published ticket references the parent specification, includes its acceptance criteria, carries the ready-for-agent label, and declares native blocking dependencies where applicable. Ticket 1 is the explicit up-front compatibility exception; ticket 8 is the expand–contract integration and release-verification boundary. All eight sub-issue links, labels, and expected dependency counts were verified after publication. The parent specification body was not changed.
