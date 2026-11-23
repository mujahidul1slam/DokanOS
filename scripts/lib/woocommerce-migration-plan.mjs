/**
 * Plan checks for scripts/prod-migrate.mjs.
 *
 * WHY THIS EXISTS
 * The recovery runner applies a reviewed, explicitly named set of migrations.
 * That set was a hardcoded list, and it silently fell behind the branch: the
 * two newest WooCommerce migrations were missing from it, so `--dry-run`
 * reported "Nothing to do: every requested migration is already applied" while
 * production was still two migrations short. The operator read that as a clean
 * bill of health and moved on to the next step.
 *
 * A plan check must never be able to say "nothing to do" while the branch
 * carries a migration the target ledger does not have. These helpers make that
 * state detectable before anything is applied.
 */

/**
 * `<timestamp>_<slug>.sql` -> `<timestamp>`, the value the Supabase CLI records
 * in `supabase_migrations.schema_migrations.version`.
 */
export function versionFromFilename(file) {
  const match = /^(\d+)_/.exec(file);
  return match ? match[1] : null;
}

/**
 * Migrations on disk, absent from the target ledger, and absent from the
 * requested set. Empty is the only state in which a default (non `--only`)
 * plan may proceed; anything else means the plan is stale.
 */
export function unrequestedPendingMigrations({ onDisk, requested, applied }) {
  const requestedFiles = new Set(requested);
  return onDisk.filter((file) => {
    if (requestedFiles.has(file)) return false;
    const version = versionFromFilename(file);
    if (!version) return false;
    return !applied.has(version);
  });
}

/** One refusal message, so the script and its test describe the same failure. */
export function stalePlanMessage(omitted) {
  return (
    `the requested migration list is stale: ${omitted.length} migration(s) on disk ` +
    "are not in the target ledger but are not part of this run. Apply them by " +
    "naming every migration with --only, or add them to the default list. " +
    "Refusing rather than reporting a clean ledger.\n" +
    omitted.map((file) => `  ${file}`).join("\n")
  );
}