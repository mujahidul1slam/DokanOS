#!/usr/bin/env node
/**
 * Reviewed production scheduler control.
 *
 * Pausing or resuming a pg_cron job is a production change like any other, so
 * it goes through a script instead of a dashboard query:
 *
 *   1. Refuses to run without --dry-run or --apply.
 *   2. Refuses --apply without --change-id, and writes that id to
 *      public.audit_log together with the before and after state.
 *   3. Refuses --apply without --expect-ref, so the target project is stated
 *      rather than implied.
 *   4. Requires --job-id AND --expect-name together. The job is only touched if
 *      the numeric id and the name agree, so a renumbered or renamed job is a
 *      refusal, not a silent wrong-job pause.
 *   5. Refuses a no-op: pausing an already-paused job, or resuming a running
 *      one, fails loudly instead of writing a misleading audit row.
 *   6. Prints the before and after state and never prints a secret.
 *
 * Transport: Supabase Management API SQL endpoint. This deliberately avoids
 * needing the database password, which Supabase only shows once. The access
 * token comes from SUPABASE_ACCESS_TOKEN in the environment, never from argv.
 *
 *   node scripts/prod-schedule.mjs --status --job-id 18 --expect-name woocommerce-sync-worker-5min
 *   node scripts/prod-schedule.mjs --pause --job-id 18 --expect-name woocommerce-sync-worker-5min --dry-run
 *   node scripts/prod-schedule.mjs --pause --job-id 18 --expect-name woocommerce-sync-worker-5min \
 *     --apply --change-id CHG-2026-11-12-01 --expect-ref jiwndicvfkiltgageqwv
 */
import { execFileSync } from "node:child_process";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
const PRODUCTION_REF = "jiwndicvfkiltgageqwv";
const API_BASE = "https://api.supabase.com/v1";

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

async function readJob(jobId) {
  const rows = await query(
    "SELECT jobid, jobname, schedule, active FROM cron.job " + `WHERE jobid = ${Number(jobId)}`,
  );
  return rows[0];
}

async function main() {
  const status = flag("--status");
  const pause = flag("--pause");
  const resume = flag("--resume");
  const apply = flag("--apply");
  const dryRun = flag("--dry-run");
  const changeId = arg("--change-id");
  const expectRef = arg("--expect-ref");
  const jobIdRaw = arg("--job-id");
  const expectName = arg("--expect-name");

  const actions = [status, pause, resume].filter(Boolean).length;
  if (actions !== 1) {
    fail("pass exactly one of --status, --pause, or --resume.");
  }
  if (!status && !apply && !dryRun) {
    fail("pass either --dry-run (read-only) or --apply (changes the database). Nothing was done.");
  }
  if (!jobIdRaw || !/^\d+$/.test(jobIdRaw)) {
    fail("--job-id <numeric id> is required. The scheduler identity must be stated, not guessed.");
  }
  if (!expectName) {
    fail(
      "--expect-name is required. The job is only touched when the id and the name " +
        "agree, so a renumbered job is a refusal rather than a wrong-job change.",
    );
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

  const jobId = Number(jobIdRaw);
  const before = await readJob(jobId);
  if (!before) fail(`no cron job with jobid ${jobId}.`);
  if (before.jobname !== expectName) {
    fail(
      `jobid ${jobId} is named ${JSON.stringify(before.jobname)}, not ` +
        `${JSON.stringify(expectName)}. Refusing to change a job that does not match.`,
    );
  }

  const targetActive = pause ? false : resume ? true : before.active;
  const action = pause ? "pause" : resume ? "resume" : "status";

  const sha = git("rev-parse", "HEAD");
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");

  console.log(`target   : ${PRODUCTION_REF}`);
  console.log(`job      : ${before.jobid} ${before.jobname} (${before.schedule})`);
  console.log(`action   : ${action}`);
  console.log(`before   : active=${before.active}`);
  console.log(`after    : active=${targetActive}`);
  console.log(`branch   : ${branch || "(unknown)"}`);
  console.log(`commit   : ${sha || "(unknown)"}`);
  console.log(`change   : ${changeId ?? "(none)"}`);
  console.log(`mode     : ${apply ? "APPLY" : "READ-ONLY"}`);
  console.log("");

  if (status) {
    console.log("status only — nothing was changed.");
    return;
  }

  if (before.active === targetActive) {
    fail(
      `jobid ${jobId} is already active=${before.active}. Nothing to ${action}; ` +
        "writing an audit row for a no-op would misrepresent the change record.",
    );
  }

  if (!apply) {
    console.log(`DRY RUN — would ${action} jobid ${jobId}. Nothing was changed.`);
    return;
  }

  const auditAction = pause ? "woocommerce.scheduler.paused" : "woocommerce.scheduler.resumed";
  const details = {
    change_id: changeId,
    commit: sha,
    branch,
    project_ref: PRODUCTION_REF,
    job: { jobid: before.jobid, jobname: before.jobname, schedule: before.schedule },
    before: { active: before.active },
    after: { active: targetActive },
  };

  // One transaction: change the job and record the change together, so the
  // audit row cannot exist without the change or vice versa.
  const sql = [
    "BEGIN;",
    `SELECT cron.alter_job(job_id := ${jobId}, active := ${targetActive});`,
    "INSERT INTO public.audit_log (action, entity_type, entity_id, details) VALUES (",
    `  ${sqlLiteral(auditAction)},`,
    "  'cron.job',",
    `  ${sqlLiteral(String(jobId))},`,
    `  ${sqlLiteral(JSON.stringify(details))}::jsonb`,
    ");",
    "COMMIT;",
  ].join("\n");

  await query(sql);

  const after = await readJob(jobId);
  if (!after) fail("the job disappeared after the change. Investigate immediately.");
  if (after.active !== targetActive) {
    fail(
      `expected active=${targetActive} after the change but found active=${after.active}. ` +
        "The change did not take effect.",
    );
  }

  console.log(`${action}d jobid ${jobId} (${after.jobname}).`);
  console.log(`after    : active=${after.active}`);
  console.log(`audit    : public.audit_log action=${auditAction} entity_id=${jobId} change=${changeId}`);
}

main().catch((error) => {
  console.error(`FAILED: ${error?.message ?? error}`);
  process.exit(1);
});
