## Problem Statement

People cannot reliably sign up and organize their businesses using the current flow. Personal registration requires a business name, email confirmation provisions a business automatically, and onboarding couples brand, internal store, and storefront creation. Elsewhere, a brand can exist without a store, but routing sometimes treats any brand as evidence of a store.

The intended model has no Fusion umbrella account: a personal account can belong to multiple business accounts, each business account can have multiple people, each business account contains brands, and each store belongs to exactly one brand. Physical outlets and online shops are separate stores. Existing invitations and global permissions do not consistently express this model or enforce its boundaries.

## Solution

Separate personal signup from business setup. A person registers with their name, email, password, and required consent, then verifies their email. Registration creates no business account, brand, store, or storefront. After verification, a person without memberships can create a business account or join through an invitation.

A business account starts empty and requires only a name. Its owner can add a brand using only a name, then add a physical or online store using a name, parent brand, and store type. Operational configuration happens afterward; creating an online store never automatically publishes a public website.

The first release supports email-bound invitations and a simple owner/member distinction. Owners have unrestricted account authority; members have account-wide operational access but cannot manage invitations, membership, ownership, or business-account deletion. All access is bounded by business-account membership and enforced on the server. Configurable child-resource, module, and action permissions are deferred.

Existing data and legitimate access must be preserved. Migration mappings must be inspected and verified before use; ambiguous mappings require an explicit decision rather than inferred reassignment or deletion.

## User Stories

1. As a new person, I want to register without naming a business, so that my identity is independent of business setup.
2. As a new person, I want to provide my name, email, password, and required consent, so that I can create my personal account.
3. As a new person, I want to verify my email, so that my identity can be trusted when creating or joining a business account.
4. As a person awaiting verification, I want clear confirmation and recovery guidance, so that I know how to finish registration.
5. As a verified person, I want registration to create no business account automatically, so that I control whether and when I start a business.
6. As a person without memberships, I want a useful account-selection screen, so that an empty personal account is not treated as an error.
7. As a person without memberships, I want to create a business account, so that I can start organizing my operation.
8. As an invited person, I want to join through an invitation instead of creating a business account, so that I do not create unwanted accounts.
9. As a person, I want to own multiple business accounts, so that I can keep separate businesses separate.
10. As a person, I want to join other people's business accounts, so that I can collaborate without sharing a login.
11. As a person with several memberships, I want to switch between business accounts, so that I can work in the correct context.
12. As a person switching accounts, I want brands, stores, and operational data to refresh to the selected account, so that I never work with stale context.
13. As a new owner, I want business-account creation to require only a business name, so that setup does not block account creation.
14. As an owner, I want my new business account to be usable without brands or stores, so that I can configure it gradually.
15. As an owner, I want to add a brand with only its name, so that commercial identity is independent of operational setup.
16. As an owner, I want multiple brands within a business account, so that I can organize distinct commercial identities.
17. As an owner, I want a brand to exist without stores, so that creating a brand does not create unrelated resources.
18. As an owner, I want multiple stores under one brand, so that the brand can operate through multiple outlets or shops.
19. As an owner, I want each store to belong to exactly one brand, so that its ownership and account boundary are unambiguous.
20. As an owner, I want to create a store using a name, brand, and physical/online type, so that I can establish its identity before configuring it.
21. As an owner, I want physical outlets and online shops represented as separate stores, so that their operational identity is not conflated.
22. As an owner, I want no combined physical-and-online store type, so that the agreed store distinction remains explicit.
23. As an owner, I want to defer addresses, integrations, and other configuration, so that minimal store creation succeeds without them.
24. As an owner, I want an online store to remain unpublished until I deliberately configure and publish its storefront, so that incomplete shops do not become public.
25. As an owner, I want to invite someone by email, so that they can join my business account using their own identity.
26. As an existing person, I want to accept an invitation after signing in with the invited verified email, so that membership attaches to my existing personal account.
27. As a new invited person, I want to register and verify my invited email before joining, so that I do not need a separate business account.
28. As an invited person, I want an invitation to work only for its intended email identity, so that someone else cannot claim it.
29. As an owner, I want an accepted invitation to grant membership only in the intended business account, so that it does not grant platform-wide authority.
30. As a member, I want account-wide operational access for this first release, so that I can work without waiting for granular permission configuration.
31. As an owner, I want membership and invitation management restricted to me, so that ordinary members cannot expand access.
32. As an owner, I want full account access that cannot be reduced by member settings, so that account control cannot be accidentally removed.
33. As an owner, I want ownership transferred before I leave, so that my business account is not orphaned.
34. As a member, I want to be unable to transfer ownership or delete the business account, so that sensitive authority remains with its owner.
35. As any person, I want direct API requests to respect business-account membership, so that hidden buttons are not the only security boundary.
36. As a business-account participant, I want another account's identifiers to be unusable for reading or modifying my account's resources, so that cross-account requests cannot leak or change data.
37. As a returning person, I want existing business accounts, brands, stores, and legitimate access preserved, so that this change does not erase my work.
38. As an operator, I want ambiguous legacy relationships reported before migration, so that business ownership is not guessed.
39. As a person retrying a completed operation, I want safe handling of repeated confirmation or invitation acceptance, so that retries do not create duplicate businesses or memberships.
40. As a returning person, I want reloads and sign-in to restore a valid account context, so that stale local state cannot place me in an inaccessible account.

## Implementation Decisions

- Use the existing authenticated personal identity and many-to-many business membership foundation; do not introduce a Fusion account or another organizational layer.
- Treat the existing business concept as the business account. Keep public terminology consistent with the domain glossary; a mechanical rename of every legacy technical identifier is not required.
- Decouple registration and confirmation from owner-business provisioning. Personal confirmation must succeed without a business name, business-provisioning anchor, or automatic business creation.
- Business creation is an explicit authenticated, verified-person operation, available both to people without memberships and to people already belonging to other accounts. A newly created account grants its creator owner membership.
- Routing and empty states must depend on actual personal session and account membership, not the presence of a brand or store. Query parameters and persisted account selections must be validated against current membership.
- Support the hierarchy business account → brands → stores. A brand has zero or more stores; each store has exactly one parent brand, which determines its business account.
- Introduce an explicit physical/online store distinction. Neither minimal brand creation nor minimal store creation creates the other resource, requires optional configuration, or publishes a storefront.
- Adapt existing store consumers using an expand-and-migrate approach where needed so operational modules continue working. Legacy technical store records, locations, and selling points are not automatically equivalent to the newly agreed store concept.
- Use the existing authenticated backend and database authorization boundaries rather than adding a parallel authentication system.
- Invitations must carry business-account context and intended recipient identity. Invitation acceptance requires an authenticated identity with the matching verified email; repeated acceptance must not duplicate membership or elevate authority.
- A new invitee's registration must preserve invitation intent across verification without trusting unauthenticated account identifiers as authorization.
- The first-release authorization model distinguishes protected owner authority from account-wide member operational access. Member access does not include invitation/membership management, ownership changes, or business-account deletion. Full account isolation applies independently of deferred granular permissions.
- Enforce ownership and membership checks in authoritative database/API paths for reads and writes, including operational module access. UI guards are supporting UX, not a security boundary.
- Ownership transfer and owner departure must preserve an owner and avoid a race that leaves the account ownerless. Existing legacy ownership configurations require audit before normalization; do not silently remove additional owners.
- Existing global platform roles and global grants must not become implicit business-account memberships. Audit and explicitly resolve their transition, preserving legitimate intended access without retaining an accidental cross-account bypass.
- Inventory existing memberships, global grants, brand/store references, locations, and selling points before migration. Automatically migrate only demonstrably unambiguous mappings; halt the affected migration path on unresolved shared, orphaned, or type-ambiguous records and request a reviewed mapping.
- Preserve identifiers and operational history wherever possible. Migration fixtures must verify data preservation and authorized access, not only successful schema changes. Do not apply migrations to a deployed database as part of writing this specification.
- Retry and recovery behavior must avoid duplicate memberships and unintended account/resource creation. Retain useful backend errors rather than generic success/failure messages.

## Testing Decisions

- Test externally observable behavior and authorization outcomes, not component structure, hook internals, or SQL helper implementation details.
- Prefer existing boundaries. The primary end-to-end seam is the browser interacting with the running application and its real local/test authentication and database services. Add supporting direct API/database requests only where a browser cannot prove that bypassing the UI is denied.
- Extend the existing browser test tooling for signup, verification, valid empty states, account creation/switching, independent brand/store creation, and invitations for both existing and new personal accounts.
- Exercise verification callbacks and invitation handoffs with controlled test email/verification facilities. Cover reloads, repeated callbacks, sign-out/sign-in, missing local signup state, and invalid or already-used invitation paths.
- Extend existing database/RLS test prior art with authenticated owner, member, nonmember, and multi-account identities. Cover account-wide operational reads/writes, owner-only management, forged parent/account identifiers, ownership transfer/departure, and cross-account access attempts.
- Verify that a member cannot call owner-only operations directly, and that legacy platform-role or empty-store-assignment behavior cannot accidentally bypass account isolation.
- Use real schema/RPC tests for resource creation: empty business accounts and brands, multiple stores per brand, exactly one brand per store, physical/online typing, and no unintended resource creation or publication.
- Extend existing signup helper, onboarding routing/guard, store-creation wrapper, and signup-RPC test prior art where relevant. Mocked wrapper tests supplement rather than replace integration authorization tests.
- Run migration rehearsals against representative pre-change fixtures, including unambiguous mappings, multiple owners, unlinked/shared store references, ambiguous store types, and legacy global grants. Assert preservation of operational records and intended access; ambiguous cases must produce a blocker rather than destructive guesswork.
- Run the existing unit suite, type checking, linting, build, and relevant database/browser suites as appropriate to each vertical slice. Do not reset or modify a non-test database to run tests.
- The user approved these browser, real API/database authorization, and migration-testing boundaries before publication.

## Out of Scope

- A Fusion umbrella account or a second business layer.
- Configurable brand/store access, all-current-and-future versus selected-store grants, inherited child restrictions, module restrictions, and fine-grained action permissions. These remain future requirements, not permissions silently implemented in this release.
- A combined physical-and-online store type.
- Automatic brand/store creation during personal signup, business-account creation, or brand creation.
- Automatic storefront publication or a redesign of storefronts, integrations, inventory, fulfillment, or other operational modules beyond compatibility and account-level access enforcement required by this change.
- Unapproved deletion, merging, reassignment, or privilege changes to ambiguous existing data.
- Implementation of unrelated account-management features merely because the authorization model reserves them for owners.

## Further Notes

The user confirmed the requirements and delivery scope after replacing the earlier Fusion-account proposal. This specification supersedes decisions that depended on that umbrella layer.

The agreed future permission model supports choosing all current/future stores versus explicitly selected stores, parent-to-child inheritance with explicit restrictions taking precedence, and separate view/action permissions. This release must not present those controls as available or depend on them for baseline account isolation.

Repository inspection is not evidence of the deployed database state. Actual migration mappings and exceptional legacy access require inspection and approval during implementation before production changes. Such unresolved records are explicit release gates for affected data, not authority for an agent to invent business ownership or store type.

Work is intended to be delivered in independently testable vertical slices. Existing unrelated worktree changes must be preserved. Publishing this specification and its approved tickets does not authorize immediate application implementation or deployed database mutation.
