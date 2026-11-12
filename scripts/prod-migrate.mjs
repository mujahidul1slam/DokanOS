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
 * TWO TRANSPORTS, SPLIT ON PURPOSE:
 *   - `--local` talks to the local stack over a direct `pg` connection
 *     (postgresql://postgres:postgres@127.0.0.1:54322/postgres by default,
 *     overridable with LOCAL_SUPABASE_DB_URL). A rehearsal runs on the same
 *     transport as the stack it targets, so the rehearsal exercises the path
 *     that local work actually uses.
 *   - production talks to the Supabase Management API SQL endpoint
 *     (POST /v1/projects/<ref>/database/query) with SUPABASE_ACCESS_TOKEN from
 *     the environment, never from argv. This split exists because the
 *     production database password is not obtainable: Supabase shows it once at
 *     project creation and it is not on this machine, so a direct `pg`
 *     connection to production cannot be opened at all.
 *
 * The Management API cannot bind $1 parameters and returns only the last
 * statement's result set, so the production path builds SQL from validated
 * values through sqlLiteral() and sends one request per migration — the
 * endpoint accepts multi-statement batches (including `begin; … commit;`), so a
 * migration is applied atomically and a failure is attributable to one file.
 * Migration text is sent verbatim, dollar-quoted `$$` function bodies included.
 *
 * PROD_SUPABASE_DB_URL is no longer a transport. If it is exported anyway it is
 * still validated as a target assertion: a local host, or a URL that does not
 * mention the expected ref, is refused, so a stale export cannot make the
 * operator believe this run points somewhere other than the project this script
 * is pinned to.
 *
 * The database password is never printed. Any URL shown is redacted first, and
 * an access token cannot reach a log line either.
 *
 *   node scripts/prod-migrate.mjs --dry-run                 # what would happen
 *   node scripts/prod-migrate.mjs --apply --change-id CHG-123 --expect-ref jiwndicvfkiltgageqwv
 *   node scripts/prod-migrate.mjs --local --apply --change-id REHEARSAL
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const REPO = path.resolve(import.meta.dirname, "..");
const MIGRATIONS_DIR = path.join(REPO, "supabase", "migrations");
const PRODUCTION_REF = "jiwndicvfkiltgageqwv";
const API_BASE = "https://api.supabase.com/v1";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/**
 * Redact the password from any connection string, and any access token, before
 * it reaches a log line.
 */
function redact(value) {
  if (typeof value !== "string") return value;
  return value
    .replace(/(postgres(?:ql)?:\/\/[^:/@]+:)[^@]*@/gi, "$1***@")
    .replace(/\bsbp_[A-Za-z0-9]{10,}/g, "sbp_***")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._-]{10,}/gi, "$1***");
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
  const [, version, name] = match;
  // The production path builds SQL from these two values, so keep them boring.
  // A slug is snake_case (or a UUID); anything else is a refusal, not an escape.
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    fail(`${file} has characters outside [A-Za-z0-9._-] in its slug; refusing to build SQL from it.`);
  }
  return { file, version, name };
}

/** A migration that manages its own transaction cannot be wrapped in ours. */
function carriesOwnTransaction(sql) {
  return /^\s*(BEGIN|COMMIT)\s*;/im.test(sql);
}

/** Only the characters a change record legitimately needs. Blocks SQL injection. */
function assertSafeChangeId(changeId) {
  if (!/^[A-Za-z0-9._:-]{1,64}$/.test(changeId)) {
    fail(`--change-id ${JSON.stringify(changeId)} has characters outside [A-Za-z0-9._:-].`);
  }
}

/** Single-quote a string for SQL. Used only for values validated before this call. */
function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * The Management API takes a whole batch in one request, so the wrapper's
 * `commit;` must be separated from the file's last statement by a real
 * terminator — otherwise `SELECT 1` followed by `commit;` parses as
 * `SELECT 1 commit`, an alias, and the batch commits silently.
 */
function terminateStatement(sql) {
  const trimmed = sql.replace(/\s+$/, "");
  return trimmed.endsWith(";") ? trimmed : `${trimmed}\n;`;
}

function localConnectionString() {
  // Same default the local SQL runner uses; override only for a different local
  // stack. Never a remote host — assertTarget rejects that below.
  return process.env.LOCAL_SUPABASE_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
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
    return {
      label: "local stack",
      host: parsed.hostname,
      port: parsed.port,
      transport: "direct pg",
    };
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
  return {
    label: expectedRef || "remote",
    host: parsed.hostname,
    port: parsed.port,
    transport: "direct pg",
  };
}

/**
 * Production is pinned to PRODUCTION_REF through the Management API, so the
 * endpoint itself is the target assertion. A stale PROD_SUPABASE_DB_URL is
 * still checked when it happens to be exported, so the old refusal gates keep
 * their teeth for anyone who thinks they are pointing this at a database.
 */
function productionTarget(expectedRef) {
  if (expectedRef && expectedRef !== PRODUCTION_REF) {
    fail(`--expect-ref ${expectedRef} is not ${PRODUCTION_REF}. This script only knows one project.`);
  }
  const declared = process.env.PROD_SUPABASE_DB_URL;
  if (declared) assertTarget(declared, false, expectedRef);
  return {
    label: PRODUCTION_REF,
    host: "api.supabase.com",
    port: "443",
    transport: "Management API",
  };
}

/**
 * Direct `pg` transport — the local rehearsal path, unchanged from before.
 * Transactions span queries because they share one connection.
 */
function pgTransport(url) {
  const client = new pg.Client({ connectionString: url });
  return {
    async connect() {
      await client.connect();
    },
    async close() {
      await client.end();
    },
    async readLedger() {
      const { rows } = await client.query(
        "SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version",
      );
      return rows;
    },
    async applyMigration(entry) {
      if (carriesOwnTransaction(entry.sql)) {
        // The file opens and commits its own transaction. Run it verbatim so we
        // do not nest transactions; a failure leaves the block rolled back.
        await client.query(entry.sql);
        return;
      }
      await client.query("BEGIN");
      try {
        await client.query(entry.sql);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    },
    async recordLedger(entry) {
      // The ledger row is written after the DDL succeeded. If this insert fails
      // the run stops loudly rather than re-running an applied migration later.
      await client.query(
        `INSERT INTO supabase_migrations.schema_migrations (version, name)
         VALUES ($1, $2)
         ON CONFLICT (version) DO NOTHING`,
        [entry.version, entry.name],
      );
    },
    async recordAudit(changeId, details) {
      await client.query(
        `INSERT INTO public.audit_log (action, entity_type, entity_id, details)
         VALUES ($1, $2, $3, $4)`,
        ["woocommerce.migrations.applied", "supabase_migrations", changeId, JSON.stringify(details)],
      );
    },
  };
}

/** One request to the Management API SQL endpoint. Returns the last result set. */
async function managementQuery(sql) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    fail(
      "SUPABASE_ACCESS_TOKEN is not set. The production path applies migrations " +
        `through the Supabase Management API for ${PRODUCTION_REF}, which needs an ` +
        "access token in the environment — never as an argument.",
    );
  }
  let response;
  try {
    response = await fetch(`${API_BASE}/projects/${PRODUCTION_REF}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql }),
    });
  } catch (error) {
    throw new Error(`could not reach the Management API: ${error?.message ?? error}`);
  }
  const text = await response.text();
  if (!response.ok) {
    // An error aborts the whole batch, so nothing in this request was committed.
    throw new Error(`the Management API rejected the statement: ${text.slice(0, 400)}`);
  }
  if (!text) return [];
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`the Management API returned non-JSON: ${text.slice(0, 200)}`);
  }
}

/**
 * Management API transport — the production path. No parameters are available,
 * so every value goes through sqlLiteral() after validation, and each migration
 * travels in its own request so a failure names one file.
 */
function managementTransport() {
  if (!process.env.SUPABASE_ACCESS_TOKEN) {
    fail(
      "SUPABASE_ACCESS_TOKEN is not set. The production path applies migrations " +
        `through the Supabase Management API for ${PRODUCTION_REF}, which needs an ` +
        "access token in the environment — never as an argument.",
    );
  }
  return {
    async connect() {},
    async close() {},
    async readLedger() {
      const rows = await managementQuery(
        "SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version",
      );
      return Array.isArray(rows) ? rows : [];
    },
    async applyMigration(entry) {
      // Sent verbatim when the file carries its own BEGIN/COMMIT; wrapped
      // otherwise so a mid-file failure rolls the whole file back instead of
      // leaving half a migration applied.
      const sql = carriesOwnTransaction(entry.sql)
        ? entry.sql
        : `begin;\n${terminateStatement(entry.sql)}\ncommit;`;
      await managementQuery(sql);
    },
    async recordLedger(entry) {
      await managementQuery(
        "INSERT INTO supabase_migrations.schema_migrations (version, name)\n" +
          `VALUES (${sqlLiteral(entry.version)}, ${sqlLiteral(entry.name)})\n` +
          "ON CONFLICT (version) DO NOTHING",
      );
    },
    async recordAudit(changeId, details) {
      const values = [
        sqlLiteral("woocommerce.migrations.applied"),
        sqlLiteral("supabase_migrations"),
        sqlLiteral(changeId),
        `${sqlLiteral(JSON.stringify(details))}::jsonb`,
      ];
      await managementQuery(
        "INSERT INTO public.audit_log (action, entity_type, entity_id, details)\n" +
          `VALUES (${values.join(", ")})`,
      );
    },
  };
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
  if (apply) {
    if (!changeId) {
      fail("--apply requires --change-id. Every production change must be traceable to a record.");
    }
    if (!local) {
      // Production interpolates the change id into SQL (no parameter binding on
      // the Management API), so it is validated first. The local path binds it
      // as $1, so a rehearsal id keeps whatever shape it already had.
      assertSafeChangeId(changeId);
      if (!expectRef) {
        fail(
          "--apply against production requires --expect-ref " +
            `${PRODUCTION_REF} so the target is stated, not implied.`,
        );
      }
    }
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
         "20261112120000_woocommerce_order_number_namespace.sql",
        "20261112130000_woocommerce_order_snapshot_and_prefix.sql",
        "20261112140000_woocommerce_order_snapshot_and_prefix_repair.sql",
        "20261112150000_woocommerce_order_snapshot_prefix_backfill.sql",
      ];

  const metas = requested.map((file) => parseMigration(file));
  assertMigrationsCommitted(requested);

  const files = metas.map((meta) => {
    const full = path.join(MIGRATIONS_DIR, meta.file);
    let sql;
    try {
      sql = readFileSync(full, "utf8");
    } catch {
      fail(`cannot read ${meta.file} — is it committed on this branch?`);
    }
    return { ...meta, sql };
  });

  const url = local ? localConnectionString() : null;
  const target = local ? assertTarget(url, true, expectRef) : productionTarget(expectRef);
  const transport = local ? pgTransport(url) : managementTransport();
  const sha = git("rev-parse", "HEAD");
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");

  console.log(`target   : ${target.label} (${target.host}:${target.port})`);
  console.log(`transport: ${target.transport}`);
  console.log(`branch   : ${branch}`);
  console.log(`commit   : ${sha}`);
  console.log(`change   : ${changeId ?? "(none — dry run)"}`);
  console.log(`mode     : ${apply ? "APPLY" : "DRY RUN"}`);
  console.log("");

  await transport.connect();

  let pending;
  let already;
  try {
    const ledger = await transport.readLedger();
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
      try {
        await transport.applyMigration(entry);
      } catch (error) {
        console.log("FAILED");
        console.error(redact(String(error.message)));
        fail(
          `${entry.version} did not apply. Nothing after it was attempted. ` +
            "The ledger was not written for this version.",
        );
      }

      try {
        await transport.recordLedger(entry);
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

    await transport.recordAudit(changeId, {
      change_id: changeId,
      commit: sha,
      branch,
      target: target.label,
      project_ref: local ? null : expectRef,
      versions: pending.map((entry) => entry.version),
    });

    console.log("");
    console.log(`applied ${pending.length} migration(s); audit_log written under ${changeId}.`);
  } finally {
    await transport.close();
  }
}

main().catch((error) => {
  console.error(redact(error?.stack || String(error)));
  process.exit(1);
});
