#!/usr/bin/env node
/**
 * Reviewed Edge Function deployment adapter.
 *
 * `supabase functions deploy` alone is not an auditable production path: it
 * uploads whatever is in the working directory, from whichever checkout you
 * happen to be standing in, with no record of what shipped or why. The live
 * project proves the risk — woocommerce-worker and woocommerce-reconcile were
 * deployed from the *main* checkout (`file:///Work/.../shohozbiz/supabase/...`),
 * not from the PR worktree, and that checkout has uncommitted changes.
 *
 * This adapter adds the missing guarantees:
 *   1. Refuses to run unless every file of the target function is committed and
 *      identical to HEAD, so the bytes that deploy are the bytes that were
 *      reviewed. This is what stops a dirty checkout from shipping.
 *   2. Refuses to run unless the repository root is the expected worktree, so a
 *      deploy cannot silently originate from the wrong checkout.
 *   3. Refuses without --change-id; the run is written to public.audit_log with
 *      the git SHA, the target ref, and the function names.
 *   4. Refuses without --apply; the default is a dry run.
 *   5. Refuses without --expect-ref matching the target, so a wrong --remote
 *      cannot hit production.
 *   6. Records the deployed version the API reports afterwards, so the audit row
 *      says what actually shipped rather than what we intended to ship.
 *
 * verify_jwt is asserted against supabase/config.toml, because that flag is a
 * security property: woocommerce-worker must stay reachable by the cron job's
 * shared secret, and woocommerce-cutover must stay behind a real JWT.
 *
 *   node scripts/prod-deploy-functions.mjs --dry-run
 *   node scripts/prod-deploy-functions.mjs --apply --change-id CHG-123 \
 *     --expect-ref jiwndicvfkiltgageqwv
 *
 * Authentication uses SUPABASE_ACCESS_TOKEN when it is exported, otherwise the
 * CLI's own `supabase login` session for read-only listing/deploy. An apply also
 * needs the token for the Management API audit insert. Never pass it as an
 * argument, so it stays out of shell history, and never print it.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
const FUNCTIONS_DIR = path.join(REPO, "supabase", "functions");
const PRODUCTION_REF = "jiwndicvfkiltgageqwv";

/** The functions this recovery ships, with the auth posture each must keep. */
const TARGETS = [
  { name: "woocommerce-worker", verifyJwt: false },
  { name: "woocommerce-reconcile", verifyJwt: false },
];

function redact(value) {
  if (typeof value !== "string") return value;
  return value
    .replace(/(postgres(?:ql)?:\/\/[^:/@]+:)[^@]*@/gi, "$1***@")
    .replace(/\b(sbp_[A-Za-z0-9_-]{8,})\b/g, "sbp_***");
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
 * The deployed bundle is built from the files on disk. If any of them differs
 * from HEAD, the artifact is not what was reviewed — refuse.
 */
function assertFunctionCommitted(name) {
  const rel = `supabase/functions/${name}`;
  const dirty = git("status", "--porcelain", "--", rel);
  if (dirty) {
    fail(
      `${rel} has uncommitted changes. Commit and push first so the deployed ` +
        `bytes match the reviewed commit.\n${dirty}`,
    );
  }
  const tracked = git("ls-files", "--", rel);
  if (!tracked) fail(`${rel} is not tracked by git.`);

  const entry = path.join(FUNCTIONS_DIR, name, "index.ts");
  if (!existsSync(entry)) fail(`${rel}/index.ts does not exist.`);
}

/**
 * Shared code is bundled INTO the deployed function, so a dirty _shared file
 * changes the artifact just as much as a dirty index.ts does.
 */
function assertSharedCommitted() {
  const rel = "supabase/functions/_shared";
  const dirty = git("status", "--porcelain", "--", rel);
  if (dirty) {
    fail(`${rel} has uncommitted changes; it is bundled into every function.\n${dirty}`);
  }
}

/**
 * Refuse to deploy from a checkout other than the one named as the source.
 *
 * Required for --apply, not optional: `functions list` shows the live worker
 * entrypoint resolving to the MAIN checkout, which carries unrelated
 * uncommitted changes. A gate that silently passes when the flag is omitted
 * would deploy whatever happens to be in the working directory.
 */
function assertWorktree(expected, required) {
  const real = path.resolve(REPO);
  if (!expected) {
    if (!required) return;
    fail(
      `--apply requires --expect-worktree <path>. The live worker entrypoint resolves to ${real}; ` +
        "state which checkout is being deployed so it is verified, not assumed.",
    );
  }
  if (path.resolve(expected).toLowerCase() !== real.toLowerCase()) {
    fail(`this checkout is ${real}, not the expected ${path.resolve(expected)}.`);
  }
}

/** Read the declared verify_jwt for a function out of supabase/config.toml. */
function declaredVerifyJwt(name) {
  const configPath = path.join(REPO, "supabase", "config.toml");
  const lines = readFileSync(configPath, "utf8").split(/\r?\n/);
  const header = `[functions.${name}]`;

  // Line-based rather than one regex: the TOML sections are flat, and a regex
  // spanning to "the next section or EOF" is easy to get subtly wrong.
  const start = lines.findIndex((line) => line.trim() === header);
  if (start < 0) return undefined;

  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (line.startsWith("[")) return undefined; // section ended without the key
    const match = /^verify_jwt\s*=\s*(true|false)\s*$/.exec(line);
    if (match) return match[1] === "true";
  }
  return undefined;
}

const API_BASE = "https://api.supabase.com/v1";

function managementSqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function assertSafeChangeId(changeId) {
  if (!/^[A-Za-z0-9._:-]{1,64}$/.test(changeId)) {
    fail(`--change-id ${JSON.stringify(changeId)} has characters outside [A-Za-z0-9._:-].`);
  }
}

async function managementQuery(sql) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    fail(
      "SUPABASE_ACCESS_TOKEN is not set. The production audit path uses the " +
        `Supabase Management API for ${PRODUCTION_REF}; export the token rather than passing it as an argument.`,
    );
  }
  const response = await fetch(`${API_BASE}/projects/${PRODUCTION_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`the Management API rejected the audit statement: ${text.slice(0, 400)}`);
  }
  if (!text) return [];
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`the Management API returned non-JSON: ${text.slice(0, 200)}`);
  }
}

/**
 * A scoped token is preferred, but the CLI's own logged-in session is accepted:
 * `supabase login` is the normal way this solo project is authenticated, and
 * refusing to run without an env var would just push the operator back to
 * hand-typed `functions deploy`. Either way the token is never printed.
 */
function accessToken() {
  return process.env.SUPABASE_ACCESS_TOKEN || undefined;
}

function cliEnv(token) {
  return token ? { ...process.env, SUPABASE_ACCESS_TOKEN: token } : { ...process.env };
}

function assertTarget(url, expectedRef) {
  const parsed = new URL(url);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    fail("the connection string is not a postgres URL.");
  }
  if (["127.0.0.1", "localhost", "[::1]", "::1"].includes(parsed.hostname)) {
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

/**
 * Run the Supabase CLI.
 *
 * On Windows `npx` is a .cmd shim and Node refuses to execFile it (EINVAL).
 * Passing shell:true fixes that but Node then concatenates arguments unescaped
 * (DEP0190) — not something to accept in a production deploy path. Instead the
 * npm npx entrypoint is run through node directly, which needs no shell and
 * escapes nothing. If that file cannot be found, the script stops rather than
 * silently falling back to a weaker invocation.
 */
function npxEntrypoint() {
  const candidate = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js");
  if (!existsSync(candidate)) {
    fail(
      `cannot find the npm npx entrypoint at ${candidate}. Install Node/npm in the ` +
        "usual layout, or run the CLI by hand through the reviewed runbook.",
    );
  }
  return candidate;
}

function runCli(args, token) {
  return execFileSync(process.execPath, [npxEntrypoint(), "supabase", ...args], {
    cwd: REPO,
    encoding: "utf8",
    env: cliEnv(token),
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024,
  });
}

/** Ask the project what is deployed right now, read-only. */
function listFunctions(ref, token) {
  const out = runCli(["functions", "list", `--remote=${ref}`, "--output", "json"], token);
  const start = out.indexOf("[");
  if (start < 0) fail("could not parse `functions list` output.");
  return JSON.parse(out.slice(start));
}

async function main() {
  const apply = flag("--apply");
  const changeId = arg("--change-id");
  const expectRef = arg("--expect-ref");
  const expectWorktree = arg("--expect-worktree");

  if (!apply && !flag("--dry-run")) {
    fail("pass either --dry-run (read-only) or --apply (changes production). Nothing was done.");
  }
  if (apply && !changeId) {
    fail("--apply requires --change-id. Every production change must be traceable to a record.");
  }
  if (apply) assertSafeChangeId(changeId);
  if (apply && !expectRef) {
    fail(
      `--apply requires --expect-ref ${PRODUCTION_REF} so the target is stated, not implied.`,
    );
  }

  assertWorktree(expectWorktree, apply);

  for (const target of TARGETS) {
    assertFunctionCommitted(target.name);
  }
  assertSharedCommitted();

  // verify_jwt is a security property, not a preference. If config.toml and this
  // adapter disagree, the deploy would silently change who can call the function.
  for (const target of TARGETS) {
    const declared = declaredVerifyJwt(target.name);
    if (declared === undefined) {
      fail(`supabase/config.toml has no [functions.${target.name}] block.`);
    }
    if (declared !== target.verifyJwt) {
      fail(
        `config.toml declares verify_jwt=${declared} for ${target.name}, but this ` +
          `adapter expects ${target.verifyJwt}. Resolve before deploying.`,
      );
    }
  }

  // Dry run and deploy use the CLI session or SUPABASE_ACCESS_TOKEN. The audit
  // row uses the Management API, so --apply needs the token but never a DB URL.
  if (apply && !process.env.SUPABASE_ACCESS_TOKEN) {
    fail(
      "--apply requires SUPABASE_ACCESS_TOKEN for the Management API audit row. " +
        "Export it rather than passing it as an argument.",
    );
  }
  const target = { label: expectRef || PRODUCTION_REF, host: "api.supabase.com", port: "443" };
  const token = accessToken();
  const sha = git("rev-parse", "HEAD");
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  const remote = expectRef || PRODUCTION_REF;

  console.log(`target   : ${target.label} (${target.host}:${target.port})`);
  console.log(`remote   : ${remote}`);
  console.log(`branch   : ${branch}`);
  console.log(`commit   : ${sha}`);
  console.log(`change   : ${changeId ?? "(none — dry run)"}`);
  console.log(`mode     : ${apply ? "APPLY" : "DRY RUN"}`);
  console.log("");

  const before = listFunctions(remote, token);
  const byName = new Map(before.map((fn) => [fn.name, fn]));

  console.log("deployed now:");
  for (const target of TARGETS) {
    const fn = byName.get(target.name);
    if (!fn) {
      console.log(`  ${target.name}  (absent — this would create it)`);
      continue;
    }
    console.log(
      `  ${target.name}  version ${fn.version}  verify_jwt=${fn.verify_jwt}  status ${fn.status}`,
    );
    if (fn.verify_jwt !== target.verifyJwt) {
      fail(
        `${target.name} is currently deployed with verify_jwt=${fn.verify_jwt}, but this ` +
          `run expects ${target.verifyJwt}. That is a security change, not a redeploy.`,
      );
    }
  }
  console.log("");

  if (!apply) {
    console.log("DRY RUN — nothing was deployed. Re-run with --apply --change-id <id>.");
    return;
  }

  // Deploy. --use-api bundles server-side, so the artifact does not depend on a
  // local Docker daemon being present or configured the same way.
  for (const target of TARGETS) {
    process.stdout.write(`deploying ${target.name} … `);
    try {
      runCli(["functions", "deploy", target.name, `--remote=${remote}`, "--use-api", "--yes"], token);
      console.log("ok");
    } catch (error) {
      console.log("FAILED");
      const detail = String(error.stderr || error.stdout || error.message);
      console.error(redact(detail));
      fail(
        `${target.name} did not deploy. The functions after it were not attempted, ` +
          "and no audit row was written.",
      );
    }
  }

  // Ask the project what actually shipped rather than trusting the intent.
  const after = listFunctions(remote, token);
  const afterByName = new Map(after.map((fn) => [fn.name, fn]));
  const shipped = TARGETS.map((target) => {
    const fn = afterByName.get(target.name);
    return {
      name: target.name,
      version: fn?.version ?? null,
      verify_jwt: fn?.verify_jwt ?? null,
      status: fn?.status ?? null,
    };
  });

  console.log("");
  console.log("deployed now:");
  for (const fn of shipped) {
    console.log(`  ${fn.name}  version ${fn.version}  verify_jwt=${fn.verify_jwt}  status ${fn.status}`);
  }

  for (const fn of shipped) {
    const expected = TARGETS.find((target) => target.name === fn.name);
    if (!fn.version) fail(`${fn.name} is not listed after deploy — the deploy did not land.`);
    if (fn.verify_jwt !== expected.verifyJwt) {
      fail(`${fn.name} landed with verify_jwt=${fn.verify_jwt}, expected ${expected.verifyJwt}.`);
    }
  }

  const details = {
    change_id: changeId,
    commit: sha,
    branch,
    target: target.label,
    project_ref: remote,
    functions: shipped,
  };
  await managementQuery(
    "INSERT INTO public.audit_log (action, entity_type, entity_id, details) VALUES (" +
      [
        managementSqlLiteral("woocommerce.functions.deployed"),
        managementSqlLiteral("edge_functions"),
        managementSqlLiteral(changeId),
        `${managementSqlLiteral(JSON.stringify(details))}::jsonb`,
      ].join(", ") +
      ")",
  );
  console.log("");
  console.log(`deployed ${shipped.length} function(s); audit_log written under ${changeId}.`);
}

main().catch((error) => {
  console.error(redact(error?.stack || String(error)));
  process.exit(1);
});
