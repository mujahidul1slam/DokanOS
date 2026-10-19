/**
 * Issue #15 rehearsal seam: route the reviewed exceptions of an account
 * migration and keep every unresolved affected record as a release blocker.
 *
 * This composes the issue #8 readiness seams ({@link auditLegacyAccounts} and
 * {@link rehearsePreservation}); it adds no new migration behavior and changes
 * no authorization. It exists so the final slice can show, reproducibly, which
 * pre-change blockers a reviewed decision resolves and which stay blocked.
 */
import {
  auditLegacyAccounts,
  rehearsePreservation,
  type LegacyInventory,
  type ReviewedMapping,
} from "./legacy-readiness";

export type RehearsalBlocker = { code: string; resource: string; detail: string };

export type MigrationRouting = {
  /** Blockers present before review that the reviewed decisions resolved. */
  resolved: RehearsalBlocker[];
  /** Blockers that still require an operator decision; never guessed away. */
  releaseBlockers: RehearsalBlocker[];
  ready: boolean;
};

export type MigrationRehearsal = {
  pre: ReturnType<typeof auditLegacyAccounts>;
  routing: MigrationRouting;
  preservation: ReturnType<typeof rehearsePreservation>;
  ready: boolean;
};

const identity = (blocker: RehearsalBlocker) => `${blocker.code}\u0000${blocker.resource}`;

/**
 * A reviewed exception resolves exactly the blocker it covers (its code and
 * resource disappear from the reviewed report). Every other blocker is retained
 * verbatim as a release blocker — a mapping may never silently override an
 * operator decision such as multiple owners or legacy global authority.
 */
export function routeReviewedExceptions(
  bare: RehearsalBlocker[],
  reviewed: RehearsalBlocker[],
): MigrationRouting {
  const remaining = new Set(reviewed.map(identity));
  const resolved = bare.filter((blocker) => !remaining.has(identity(blocker)));
  return { resolved, releaseBlockers: [...reviewed], ready: reviewed.length === 0 };
}

/**
 * Rehearse a reviewed additive slice: audit the pre-change inventory with and
 * without the reviewed mappings, compare pre/post for preservation, and report
 * the release gate. `ready` requires both the preservation rehearsal to pass
 * and every readiness blocker to be resolved.
 */
export function rehearseAccountMigration(
  before: LegacyInventory,
  after: LegacyInventory,
  mappings: ReviewedMapping[] = [],
): MigrationRehearsal {
  const bare = auditLegacyAccounts(before);
  const reviewed = auditLegacyAccounts(before, mappings);
  const routing = routeReviewedExceptions(bare.blockers, reviewed.blockers);
  const preservation = rehearsePreservation(before, after);
  return { pre: reviewed, routing, preservation, ready: routing.ready && preservation.preserved };
}
