/**
 * Task 13 (domain revamp, spec §6a/§6b): who is offered the business-creation
 * onboarding wizard.
 *
 * Spec §6a scopes the wizard to businesses "created from scratch" and says
 * invited members never see it; §6b gives invited members only Task 3's
 * personal profile setup. The membership row records how it came to exist
 * (`user_business_access.joined_via`, migration 20261102090000):
 *
 *   created — the member created the business → wizard offered.
 *   invited — joined through an accepted invitation → never offered.
 *   granted — added directly by an owner/admin (or unknown legacy) → not
 *             creation, so not offered.
 *
 * The rule fails closed: anything but an explicit "created" keeps the wizard
 * out of sight (route guard + settings card both use this predicate).
 */

/** Membership provenance values stored in `user_business_access.joined_via`. */
export type MembershipJoinVia = "created" | "invited" | "granted";

export function shouldOfferBusinessOnboarding(joinedVia: string | null | undefined): boolean {
  return joinedVia === "created";
}
