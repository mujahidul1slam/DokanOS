#!/usr/bin/env node
/**
 * Reviewed production migration runner.
 *
 * This exists because the two obvious paths are both forbidden:
 *   - `supabase db push` applies whatever is on disk with no change record.
 *   - ad-hoc SQL in a dashboard has no record at all.
 *
 * What this does instead:
 *   1. Refuses to run unless the migration files are committed and match the
 *      git HEAD, so what runs is exactly what was reviewed.
 *   2. Refuses to run without an explicit --change-id, which is written to
 *      public.audit_log next to the git SHA and the exact version list.
 *   3. Refuses to run without --apply. The default is a dry run that reads the
 *      ledger and prints what would happen, and changes nothing.
 *   4. Refuses to run if the target project ref is not the one named on the
 *      command line, so a wrong --remote cannot silently hit production.
 *   5. Refuses to run if any requested migration is already in the ledger, or
 *      if the ledger is in a state this run did not expect.
 *   6. Applies each migration and writes its ledger row, then records the whole
 *      run in public.audit_log.
 *
 * The database password is never printed. Any URL shown is redacted first.
 *
 *   node scripts/prod-migrate.mjs --dry-run                 # what would happen
 *   node scripts/prod-migrate.mjs --apply --change-id CHG-123
 *   node scripts/prod-migrate.mjs --local --apply --change-id REHEARSAL
 *
 * Connection string comes from PROD_SUPABASE_DB_URL (production) or the local
 * stack (--local), never from an argument, so it stays out of shell history.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const REPO = path.resolve(import.meta.dirname, "..");
const MIGRATIONS_DIR = path.join(REPO, "supabase", "migrations");
const PRODUCTION_REF = "jiwndicvfkiltgageqwv";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** Redact the password from any connection string before it reaches a log. */
function redact(value) {
  if (typeof value !== "string") return value;
  return value.replace(/(postgres(?:ql)?:\/\/[^:/@]+:)[^@]*@/gi, "$1***@");
}

function fail(message) {
  console.error(`REFUSED: ${message}`);
  process.exit(1);
}

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function flag(name) {
  return process.argv.includes(name);
}

function git(...args) {
  return execFileSync("git", args, { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

/**
 * Every migration this run may touch must be committed and identical to HEAD.
 * A dirty file means the thing that runs is not the thing that was reviewed.
 */
function assertMigrationsCommitted(versions) {
  const dirty = git("status", "--porcelain", "--", "supabase/migrations");
  if (dirty) {
    fail(
      "supabase/migrations has uncommitted changes. Commit and push first so the " +
        "run matches the reviewed commit.\n" +
        dirty,
    );
  }
  for (const version of versions) {
    const tracked = git("ls-files", "--", `supabase/migrations/${version}`);
    if (!tracked) fail(`${version} is not tracked by git.`);
  }
}

/**
 * The CLI records the bare timestamp as `version` and the slug as `name`
 * (e.g. version `20261110101000`, name `woocommerce_cutover_permissions`).
 * Deriving the version from the whole filename instead makes every applied
 * migration look pending, which would re-apply it.
 */
function parseMigration(file) {
  const match = /^(\d+)_(.+)\.sql$/.exec(file);
  if (!match) fail(`${file} is not named <timestamp>_<slug>.sql`);
  return { file, version: match[1], name: match[2] };
}
/** A migration that manages its own transaction cannot be wrapped in ours. */
function carriesOwnTransaction(sql) {
  return /^\s*(BEGIN|COMMIT)\s*;/im.test(sql);
}

function connectionString(local) {
  if (local) {
    // Same default the local SQL runner uses; override only for a different
    // local stack. Never a remote host — assertTarget rejects that below.
    return process.env.LOCAL_SUPABASE_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  }
  const url = process.env.PROD_SUPABASE_DB_URL;
  if (!url) {
    fail(
      "PROD_SUPABASE_DB_URL is not set. Export the connection string for " +
        `${PRODUCTION_REF} rather than passing it as an argument.`,
    );
  }
  return url;
}

/** Guard the target so a mistyped flag cannot point this at the wrong project. */
function assertTarget(url, local, expectedRef) {
  const parsed = new URL(url);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    fail("the connection string is not a postgres URL.");
  }
  if (local) {
    if (!LOCAL_HOSTS.has(parsed.hostname)) {
      fail(`--local was passed but the host is ${parsed.hostname}, which is not local.`);
    }
    return { label: "local stack", host: parsed.hostname, port: parsed.port };
  }
  if (LOCAL_HOSTS.has(parsed.hostname)) {
    fail(`production mode was used but the host is ${parsed.hostname}, which is local.`);
  }
  if (expectedRef && !url.includes(expectedRef)) {
    fail(
      `the connection string does not mention ${expectedRef}. Pass ` +
        `--expect-ref ${expectedRef} only for the project you mean to change.`,
    );
  }
  return { label: expectedRef || "remote", host: parsed.hostname, port: parsed.port };
}

async function readLedger(client) {
  const { rows } = await client.query(
    "SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version",
  );
  return rows;
}

async function main() {
  const local = flag("--local");
  const apply = flag("--apply");
  const changeId = arg("--change-id");
  const expectRef = arg("--expect-ref");
  const only = process.argv
    .filter((value, index) => process.argv[index - 1] === "--only")
    .flatMap((value) => value.split(",").map((entry) => entry.trim()).filter(Boolean));

  if (!apply && !flag("--dry-run")) {
    fail("pass either --dry-run (read-only) or --apply (changes the database). Nothing was done.");
  }
  if (apply && !changeId) {
    fail("--apply requires --change-id. Every production change must be traceable to a record.");
  }
  if (apply && !local && !expectRef) {
    fail(
      "--apply against production requires --expect-ref " +
        `${PRODUCTION_REF} so the target is stated, not implied.`,
    );
  }

  // Which migrations are in scope: the four this recovery is missing, unless
  // the operator narrows it with --only.
  const requested = only.length
    ? only
    : [
        "20261110110000_woocommerce_conflict_resolution.sql",
        "20261110111000_woocommerce_sync_corrections_policy.sql",
        "20261111100000_woocommerce_durable_intake.sql",
        "20261111110000_woocommerce_duplicate_finish.sql",
      ];

  const versions = requested.map((file) => parseMigration(file).version);
  assertMigrationsCommitted(requested);

  const files = requested.map((file) => {
    const meta = parseMigration(file);
    const full = path.join(MIGRATIONS_DIR, file);
    let sql;
    try {
      sql = readFileSync(full, "utf8");
    } catch {
      fail(`cannot read ${file} — is it committed on this branch?`);
    }
    return { ...meta, sql };
  });

  const url = connectionString(local);
  const target = assertTarget(url, local, expectRef);
  const sha = git("rev-parse", "HEAD");
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");

  console.log(`target   : ${target.label} (${target.host}:${target.port})`);
  console.log(`branch   : ${branch}`);
  console.log(`commit   : ${sha}`);
  console.log(`change   : ${changeId ?? "(none — dry run)"}`);
  console.log(`mode     : ${apply ? "APPLY" : "DRY RUN"}`);
  console.log("");

  const client = new pg.Client({ connectionString: url });
  await client.connect();

  let pending;
  let already;
  try {
    const ledger = await readLedger(client);
    const applied = new Set(ledger.map((row) => row.version));
    pending = files.filter((entry) => !applied.has(entry.version));
    already = files.filter((entry) => applied.has(entry.version));

    console.log(`ledger   : ${ledger.length} applied migrations`);
    for (const entry of files) {
      const state = applied.has(entry.version) ? "already applied" : "pending";
      console.log(`  ${entry.version}  ${state}`);
    }
    console.log("");

    // A partially applied set means something ran outside this runner. Stop and
    // let a human reconcile rather than guessing at the remaining half.
    if (already.length && pending.length) {
      fail(
        `${already.length} of ${files.length} requested migrations are already applied. ` +
          "This run expected all of them to be pending. Reconcile before continuing.",
      );
    }
    if (!pending.length) {
      console.log("Nothing to do: every requested migration is already applied.");
      return;
    }

    if (!apply) {
      console.log("DRY RUN — nothing was changed. Re-run with --apply --change-id <id>.");
      return;
    }

    for (const entry of pending) {
      process.stdout.write(`applying ${entry.version} … `);
      const own = carriesOwnTransaction(entry.sql);
      try {
        if (own) {
          // The file opens and commits its own transaction. Run it verbatim so
          // we do not nest transactions; a failure leaves the block rolled back.
          await client.query(entry.sql);
        } else {
          await client.query("BEGIN");
          try {
            await client.query(entry.sql);
            await client.query("COMMIT");
          } catch (error) {
            await client.query("ROLLBACK");
            throw error;
          }
        }
      } catch (error) {
        console.log("FAILED");
        console.error(redact(String(error.message)));
        fail(
          `${entry.version} did not apply. Nothing after it was attempted. ` +
            "The ledger was not written for this version.",
        );
      }

      // The ledger row is written after the DDL succeeded. If this insert fails
      // the run stops loudly rather than re-running an applied migration later.
      try {
        await client.query(
          `INSERT INTO supabase_migrations.schema_migrations (version, name)
           VALUES ($1, $2)
           ON CONFLICT (version) DO NOTHING`,
          [entry.version, entry.name],
        );
      } catch (error) {
        console.log("APPLIED BUT LEDGER FAILED");
        console.error(redact(String(error.message)));
        fail(
          `${entry.version} applied but its ledger row did not. Do not re-run. ` +
            "Insert the ledger row by hand through the reviewed path, then continue.",
        );
      }
      console.log("ok");
    }

    await client.query(
      `INSERT INTO public.audit_log (action, entity_type, entity_id, details)
       VALUES ($1, $2, $3, $4)`,
      [
        "woocommerce.migrations.applied",
        "supabase_migrations",
        changeId,
        JSON.stringify({
          change_id: changeId,
          commit: sha,
          branch,
          target: target.label,
          project_ref: local ? null : expectRef,
          versions: pending.map((entry) => entry.version),
        }),
      ],
    );

    console.log("");
    console.log(`applied ${pending.length} migration(s); audit_log written under ${changeId}.`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(redact(error?.stack || String(error)));
  process.exit(1);
});
