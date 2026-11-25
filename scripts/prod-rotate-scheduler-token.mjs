#!/usr/bin/env node
/**
 * Reviewed production rotation of the scheduler shared secret.
 *
 * Why this exists
 * ---------------
 * `sync_worker_cron_token` is the only gate on the woocommerce-worker and
 * woocommerce-reconcile Edge Functions (both run with verify_jwt = false). The
 * token is a Vault secret; the pg_cron jobs read it at dispatch time, so they
 * survive a rotation untouched. Anything *else* holding a copy is locked out
 * the moment the value changes. That is what makes rotation the one lever that
 * works when the caller of an endpoint cannot be identified from logs.
 *
 * Guarantees
 * ----------
 *   1. Refuses to run without --dry-run or --apply.
 *   2. Refuses --apply without --change-id, and writes that id to
 *      public.audit_log in the same transaction as the rotation, so the audit
 *      row cannot exist without the change or the change without the row.
 *   3. Refuses --apply without --expect-ref, so the target project is stated.
 *   4. Refuses unless --expect-secret-name and --expect-secret-id both match the
 *      live row. A renamed or recreated secret is a refusal, not a silent
 *      rotation of the wrong credential.
 *   5. Refuses if the live secret is empty or shorter than 16 characters --
 *      that is a broken credential, not something to rotate over.
 *   6. NEVER prints the token, the old value, or the new value. The audit row
 *      carries only a short SHA-256 fingerprint so two rotations can be told
 *      apart without leaking either secret.
 *   7. --sync-github-secret pipes the new value to `gh secret set` on stdin, so
 *      the token never appears in argv, a shell history, or a log line.
 *
 * Transport: Supabase Management API SQL endpoint, because the database
 * password is not obtainable on this machine. The access token comes from
 * SUPABASE_ACCESS_TOKEN in the environment, never from argv.
 *
 *   node scripts/prod-rotate-scheduler-token.mjs --status \
 *     --expect-secret-name sync_worker_cron_token
 *
 *   node scripts/prod-rotate-scheduler-token.mjs --rotate \
 *     --expect-secret-name sync_worker_cron_token \
 *     --expect-secret-id fdba4c03-96b0-4591-baa7-1ae8d6168b98 \
 *     --dry-run
 *
 *   node scripts/prod-rotate-scheduler-token.mjs --rotate \
 *     --expect-secret-name sync_worker_cron_token \
 *     --expect-secret-id fdba4c03-96b0-4591-baa7-1ae8d6168b98 \
 *     --apply --change-id CHG-2026-11-12-01 \
 *     --expect-ref jiwndicvfkiltgageqwv --sync-github-secret
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
const PRODUCTION_REF = "jiwndicvfkiltgageqwv";
const API_BASE = "https://api.supabase.com/v1";
const GITHUB_SECRET_NAME = "SYNC_WORKER_CRON_TOKEN";
const TOKEN_BYTES = 16; // 32 hex characters, matching the existing secret length.

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
  try {
    return execFileSync("git", args, {
      cwd: REPO,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

/** Only the characters a change record legitimately needs. Blocks SQL injection. */
function assertSafeChangeId(changeId) {
  if (!/^[A-Za-z0-9._:-]{1,64}$/.test(changeId)) {
    fail(`--change-id ${JSON.stringify(changeId)} has characters outside [A-Za-z0-9._:-].`);
  }
}

/** A secret name is a Vault identifier, not free text. */
function assertSafeSecretName(name) {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(name)) {
    fail(`--expect-secret-name ${JSON.stringify(name)} has characters outside [A-Za-z0-9._-].`);
  }
}

function assertSafeUuid(value, label) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    fail(`${label} must be a uuid, got ${JSON.stringify(value)}.`);
  }
}

/** Single-quote a string for SQL. Used only for values already validated above. */
function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function query(sql) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    fail(
      "SUPABASE_ACCESS_TOKEN is not set. Export the access token for the " +
        `${PRODUCTION_REF} project rather than passing it as an argument.`,
    );
  }
  const response = await fetch(`${API_BASE}/projects/${PRODUCTION_REF}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  const text = await response.text();
  if (!response.ok) {
    fail(`the database query endpoint rejected the statement: ${text.slice(0, 400)}`);
  }
  try {
    return text ? JSON.parse(text) : [];
  } catch {
    fail(`the database query endpoint returned non-JSON: ${text.slice(0, 200)}`);
  }
}

async function readSecret(name) {
  const rows = await query(
    "SELECT id::text AS id, name, description, created_at::text AS created_at, " +
      "updated_at::text AS updated_at, length(decrypted_secret) AS secret_length " +
      "FROM vault.decrypted_secrets " +
      `WHERE name = ${sqlLiteral(name)}`,
  );
  return rows[0];
}

/**
 * Push the new value to the GitHub repository secret so the Pathao workflow,
 * which legitimately holds a copy of the same token, does not break. The value
 * goes over stdin: it never appears in argv or in any log line.
 */
function syncGithubSecret(token) {
  execFileSync("gh", ["secret", "set", GITHUB_SECRET_NAME], {
    cwd: REPO,
    input: token,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

async function main() {
  const status = flag("--status");
  const rotate = flag("--rotate");
  const apply = flag("--apply");
  const dryRun = flag("--dry-run");
  const changeId = arg("--change-id");
  const expectRef = arg("--expect-ref");
  const expectName = arg("--expect-secret-name");
  const expectId = arg("--expect-secret-id");
  const syncGithub = flag("--sync-github-secret");

  if ([status, rotate].filter(Boolean).length !== 1) {
    fail("pass exactly one of --status or --rotate.");
  }
  if (!status && !apply && !dryRun) {
    fail("pass either --dry-run (read-only) or --apply (changes the database). Nothing was done.");
  }
  if (!expectName) {
    fail(
      "--expect-secret-name is required. The secret is only rotated when the name " +
        "is stated, so a recreated secret is a refusal rather than a wrong-secret rotation.",
    );
  }
  assertSafeSecretName(expectName);
  if (rotate && !status) {
    if (!expectId) {
      fail(
        "--expect-secret-id is required for --rotate. Rotation must target the exact row " +
          "that was inspected, not whichever row currently carries the name.",
      );
    }
    assertSafeUuid(expectId, "--expect-secret-id");
  }
  if (apply && !status) {
    if (!changeId) {
      fail("--apply requires --change-id. Every production change must be traceable to a record.");
    }
    assertSafeChangeId(changeId);
    if (!expectRef) {
      fail(
        "--apply requires --expect-ref " +
          `${PRODUCTION_REF} so the target is stated, not implied.`,
      );
    }
    if (expectRef !== PRODUCTION_REF) {
      fail(`--expect-ref ${expectRef} is not ${PRODUCTION_REF}. This script only knows one project.`);
    }
  }

  const before = await readSecret(expectName);
  if (!before) fail(`no vault secret named ${JSON.stringify(expectName)}.`);
  if (rotate && before.id !== expectId) {
    fail(
      `the vault secret named ${JSON.stringify(expectName)} has id ${before.id}, not ` +
        `${expectId}. Refusing to rotate a credential that does not match.`,
    );
  }
  if (rotate && (!before.secret_length || before.secret_length < 16)) {
    fail(
      `the live secret is ${before.secret_length ?? 0} characters long. That is a broken ` +
        "credential, not something to rotate over. Investigate before rotating.",
    );
  }

  const sha = git("rev-parse", "HEAD");
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  const action = status ? "status" : "rotate";

  console.log(`target       : ${PRODUCTION_REF}`);
  console.log(`secret       : ${before.name} (${before.id})`);
  console.log(`length       : ${before.secret_length}`);
  console.log(`updated_at   : ${before.updated_at}`);
  console.log(`action       : ${action}`);
  console.log(`github sync  : ${syncGithub ? GITHUB_SECRET_NAME : "(not requested)"}`);
  console.log(`branch       : ${branch || "(unknown)"}`);
  console.log(`commit       : ${sha || "(unknown)"}`);
  console.log(`change       : ${changeId ?? "(none)"}`);
  console.log(`mode         : ${apply ? "APPLY" : "READ-ONLY"}`);
  console.log("");

  if (status) {
    console.log("status only — nothing was changed. The value was never read.");
    return;
  }

  if (!apply) {
    console.log(`DRY RUN — would rotate ${before.name}. Nothing was changed.`);
    console.log("No token was generated. Pass --apply with --change-id to perform it.");
    return;
  }

  // Generate the replacement here and never log it.
  const token = crypto.randomBytes(TOKEN_BYTES).toString("hex");
  const fingerprint = crypto.createHash("sha256").update(token).digest("hex").slice(0, 8);

  const details = {
    change_id: changeId,
    commit: sha,
    branch,
    project_ref: PRODUCTION_REF,
    secret: { id: before.id, name: before.name },
    before: { updated_at: before.updated_at, length: before.secret_length },
    after: { length: token.length, fingerprint },
    github_secret_synced: syncGithub,
    note:
      "Rotation locks out any holder of the previous token. pg_cron jobs read the " +
      "Vault secret at dispatch time and are unaffected.",
  };

  // One transaction: rotate and record together.
  const sql = [
    "BEGIN;",
    "SELECT vault.update_secret(",
    `  ${sqlLiteral(before.id)}::uuid,`,
    `  ${sqlLiteral(token)},`,
    "  NULL,",
    "  NULL,",
    "  NULL",
    ");",
    "INSERT INTO public.audit_log (action, entity_type, entity_id, details) VALUES (",
    "  'woocommerce.scheduler.token_rotated',",
    "  'vault.secrets',",
    `  ${sqlLiteral(before.id)},`,
    `  ${sqlLiteral(JSON.stringify(details))}::jsonb`,
    ");",
    "COMMIT;",
  ].join("\n");

  await query(sql);

  const after = await readSecret(before.name);
  if (!after) fail("the secret disappeared after rotation. Investigate immediately.");
  if (after.secret_length !== token.length) {
    fail(
      `expected the secret to be ${token.length} characters after rotation but found ` +
        `${after.secret_length}. The rotation did not take effect.`,
    );
  }
  if (after.updated_at === before.updated_at) {
    fail(
      "the secret's updated_at did not change. The rotation did not take effect; " +
        "treat the old token as still live.",
    );
  }

  let githubResult = "not requested";
  if (syncGithub) {
    try {
      syncGithubSecret(token);
      githubResult = `${GITHUB_SECRET_NAME} updated`;
    } catch (error) {
      githubResult = `FAILED (${error?.message ?? error})`;
    }
  }

  console.log(`rotated ${after.name} (${after.id}).`);
  console.log(`after        : length=${after.secret_length} updated_at=${after.updated_at}`);
  console.log(`fingerprint  : sha256:${fingerprint} (first 8 hex chars, not the secret)`);
  console.log(`github       : ${githubResult}`);
  console.log(
    `audit        : public.audit_log action=woocommerce.scheduler.token_rotated ` +
      `entity_id=${after.id} change=${changeId}`,
  );
  if (syncGithub && githubResult.startsWith("FAILED")) {
    console.log("");
    console.log(
      "WARNING: the vault rotated but the GitHub secret did not. The Pathao workflow " +
        "will now fail until it is updated with the new value.",
    );
  }
}

main().catch((error) => {
  console.error(`FAILED: ${error?.message ?? error}`);
  process.exit(1);
});
