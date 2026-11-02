#!/usr/bin/env node
/**
 * verify:env — make environment state observable instead of archaeology.
 *
 * The incidents that motivated this probe (broken worktree .git pointer,
 * deleted functions tree, crashed edge runtime, missing store links) were all
 * invisible until a human touched the app. Run this before any manual session
 * and paste its markdown block into the evidence record.
 *
 * Checks (required, in order):
 *   1. worktree pointer valid        — .git file/dir resolves to a real gitdir with HEAD
 *   2. app shell files present       — the files a broken checkout goes missing
 *   3. Vite / returns 200            — the app actually serves (VERIFY_APP_URL)
 *   4. Supabase stack healthy        — core containers running for this project id
 *   5. edge runtime container up     — the crashed-edge-runtime incident
 *   6. functions count matches repo  — working tree vs git HEAD vs config entries
 *   7. signup-event answers          — the signup kill-switch seam responds
 *
 * Informational (never fails the run): Mailpit reachability, signup_open flag.
 *
 * Usage: npm run verify:env
 *   VERIFY_APP_URL  app origin to probe (default http://127.0.0.1:5173)
 *   SMOKE_SUPABASE_URL  local stack gateway (default http://127.0.0.1:54321)
 *
 * Exit code 0 = every required check passed; 1 = at least one failed.
 */

import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP_URL = process.env.VERIFY_APP_URL || "http://127.0.0.1:5173";
const SUPABASE_URL = process.env.SMOKE_SUPABASE_URL || "http://127.0.0.1:54321";

/** Local demo JWT the Supabase CLI prints for disposable stacks. */
const LOCAL_ANON_KEY_FALLBACK =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicmVmIjoic3VwYWJhc2UtZGVtb19kZW1vX2tleSIsImF1ZCI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNri40-FdQ8JZZkL3QK1V3g1tGlk";

/**
 * Run a command and return trimmed stdout.
 * Uses execFileSync (no shell) for real executables; falls back to execSync
 * on Windows when the command needs shell resolution (e.g. .ps1/.cmd wrappers
 * like supabase). Avoids DEP0190 (shell + args in execFileSync).
 */
const sh = (cmd, args) => {
  try {
    return execFileSync(cmd, args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 20_000,
    }).trim();
  } catch (err) {
    // ENOENT on Windows means the command is a shell wrapper (.cmd/.ps1).
    // Re-run through the shell as a single escaped string.
    if (process.platform === "win32" && err?.code === "ENOENT") {
      const escaped = [cmd, ...args].map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ");
      return execSync(escaped, {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 20_000,
      }).trim();
    }
    throw err;
  }
};

const results = [];
const record = (name, required, ok, detail) => {
  results.push({ name, required, ok, detail });
  return ok;
};

/* ── shared readers ─────────────────────────────────────────────────────── */

const projectId = (() => {
  try {
    const m = readFileSync(join(repoRoot, "supabase", "config.toml"), "utf8").match(
      /^\s*project_id\s*=\s*"([^"]+)"/m,
    );
    return m ? m[1] : null;
  } catch {
    return null;
  }
})();

const dockerPs = (nameFilter) => {
  try {
    return sh("docker", [
      "ps",
      "--filter",
      `name=${nameFilter}`,
      "--format",
      "{{.Names}}\t{{.Status}}",
    ]);
  } catch {
    return null; // docker CLI missing or engine down
  }
};

const fetchWithTimeout = async (url, init = {}) => {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(5000), redirect: "manual" });
  } catch (error) {
    return { ok: false, status: 0, error: String(error?.cause?.code || error?.message || error) };
  }
};

/* ── 1. worktree pointer valid ──────────────────────────────────────────── */

{
  const name = "worktree pointer valid";
  try {
    const dotGit = join(repoRoot, ".git");
    let gitdir = null;
    if (existsSync(dotGit) && statSync(dotGit).isFile()) {
      // Linked worktree: .git is a file pointing at the real gitdir. When that
      // target goes missing the checkout silently loses history — the broken
      // worktree .git pointer incident.
      const m = readFileSync(dotGit, "utf8").match(/^gitdir:\s*(.+)\s*$/m);
      gitdir = m ? resolve(repoRoot, m[1]) : null;
      if (!gitdir || !existsSync(join(gitdir, "HEAD"))) {
        record(name, true, false, `.git points at missing gitdir: ${gitdir ?? "<unparseable>"}`);
      } else {
        const head = sh("git", ["rev-parse", "HEAD"]);
        record(name, true, true, `gitdir ok, HEAD ${head.slice(0, 10)}`);
      }
    } else if (existsSync(join(dotGit, "HEAD"))) {
      const head = sh("git", ["rev-parse", "HEAD"]);
      record(name, true, true, `normal checkout, HEAD ${head.slice(0, 10)}`);
    } else {
      record(name, true, false, "no usable .git at the repository root");
    }
  } catch (error) {
    record(name, true, false, `git probe failed: ${String(error).split("\n")[0]}`);
  }
}

/* ── 2. app shell files present ─────────────────────────────────────────── */

{
  const name = "app shell files present";
  const requiredFiles = [
    "package.json",
    "index.html",
    "vite.config.ts",
    "src/main.tsx",
    "src/App.tsx",
    "src/integrations/supabase/client.ts",
    "supabase/config.toml",
    "supabase/functions/_shared",
    "supabase/migrations",
    "tests/accounts",
  ];
  const missing = requiredFiles.filter((p) => !existsSync(join(repoRoot, p)));
  record(
    name,
    true,
    missing.length === 0,
    missing.length === 0 ? `${requiredFiles.length} paths present` : `missing: ${missing.join(", ")}`,
  );
}

/* ── 3. Vite / returns 200 ──────────────────────────────────────────────── */

{
  const name = "Vite / returns 200";
  const res = await fetchWithTimeout(`${APP_URL}/`);
  record(
    name,
    true,
    res.status === 200,
    res.status === 200
      ? `GET ${APP_URL}/ → 200`
      : `GET ${APP_URL}/ → ${res.status || "connection refused"}${res.error ? ` (${res.error})` : ""} — start the dev server or set VERIFY_APP_URL`,
  );
}

/* ── 4. Supabase stack healthy ──────────────────────────────────────────── */

{
  const name = "Supabase stack healthy";
  if (!projectId) {
    record(name, true, false, "no project_id in supabase/config.toml");
  } else {
    const core = ["db", "kong", "auth", "rest", "storage"];
    const down = core.filter((svc) => {
      const out = dockerPs(`supabase_${svc}_${projectId}`);
      return !out || !out.includes("Up ");
    });
    record(
      name,
      true,
      down.length === 0,
      down.length === 0
        ? `containers up for ${projectId}: ${core.join(", ")}`
        : `down/absent: ${down.join(", ")} (project ${projectId})`,
    );
  }
}

/* ── 5. edge runtime container up ───────────────────────────────────────── */

{
  const name = "edge runtime container up";
  const out = projectId ? dockerPs(`supabase_edge_runtime_${projectId}`) : null;
  record(
    name,
    true,
    !!out && out.includes("Up "),
    out && out.includes("Up ")
      ? out.split("\n")[0]
      : "supabase_edge_runtime container not running — edge functions (signup-event, create-business) will 404; restart it (see docs/agents/manual-test-runbook.md)",
  );
}

/* ── 6. functions count matches the repo ────────────────────────────────── */

{
  const name = "functions count matches the repo";
  try {
    const fnRoot = join(repoRoot, "supabase", "functions");
    const treeCount = existsSync(fnRoot)
      ? readdirSync(fnRoot).filter(
          (d) =>
            !d.startsWith("_") &&
            d !== "adapters" &&
            existsSync(join(fnRoot, d, "index.ts")),
        ).length
      : 0;
    // The working tree can be silently wrong while git still knows the truth
    // (the deleted-functions-tree incident), so compare against the index too.
    const gitCount = sh("git", ["ls-files", "supabase/functions"])
      .split("\n")
      .filter((f) => /^supabase\/functions\/[^/]+\/index\.ts$/.test(f.trim())).length;
    const configEntries = [
      ...readFileSync(join(repoRoot, "supabase", "config.toml"), "utf8").matchAll(
        /^\[functions\.([^\]]+)\]/gm,
      ),
    ].map((m) => m[1]);
    const staleConfig = configEntries.filter((f) => !existsSync(join(fnRoot, f, "index.ts")));
    const ok = treeCount === gitCount && treeCount > 0 && staleConfig.length === 0;
    record(
      name,
      true,
      ok,
      `tree ${treeCount}, git ${gitCount}` +
        (staleConfig.length ? `, stale config entries: ${staleConfig.join(", ")}` : "") +
        (treeCount === 0 ? " (functions tree missing!)" : ""),
    );
  } catch (error) {
    record(name, true, false, `functions probe failed: ${String(error).split("\n")[0]}`);
  }
}

/* ── 7. signup-event answers ────────────────────────────────────────────── */

let anonKey = LOCAL_ANON_KEY_FALLBACK;
{
  // Prefer the keys the CLI prints for THIS stack; fall back to the demo key.
  try {
    const env = sh("supabase", ["status", "-o", "env"]);
    const m = env.match(/^(?:SUPABASE_)?ANON_KEY="?([^"\n]+)"?/m);
    if (m) anonKey = m[1];
  } catch {
    /* keep fallback */
  }
}
{
  const name = "signup-event answers";
  const res = await fetchWithTimeout(`${SUPABASE_URL}/functions/v1/signup-event`, {
    method: "POST",
    headers: { apikey: anonKey, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  record(
    name,
    true,
    res.status !== 0 && res.status !== 404,
    `POST ${SUPABASE_URL}/functions/v1/signup-event → ${res.status || "connection refused"}` +
      (res.status === 404 ? " (function not mounted)" : ""),
  );
}

/* ── informational: Mailpit + signup_open flag ──────────────────────────── */

{
  const name = "mailpit reachable (informational)";
  const res = await fetchWithTimeout("http://127.0.0.1:54324/api/v1/messages");
  record(
    name,
    false,
    res.status === 200,
    res.status === 200
      ? "GET :54324/api/v1/messages → 200 (confirmation links land here)"
      : `GET :54324/api/v1/messages → ${res.status || "connection refused"}`,
  );
}
{
  const name = "signup_open flag (informational)";
  const res = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/app_config?select=value&key=eq.signup_open`, {
    headers: { apikey: anonKey },
  });
  let detail = `GET app_config/signup_open → ${res.status || "connection refused"}`;
  if (res.status === 200) {
    try {
      const rows = await res.json();
      detail = `signup_open = ${JSON.stringify(rows?.[0]?.value ?? null)} (public signup journeys need true)`;
    } catch {
      /* keep status detail */
    }
  }
  record(name, false, res.status === 200, detail);
}

/* ── report ─────────────────────────────────────────────────────────────── */

const stamp = new Date().toISOString();
const requiredFailed = results.filter((r) => r.required && !r.ok);
const row = (r) =>
  `| ${r.required ? "" : "~"} ${r.name} | ${r.ok ? "PASS" : "FAIL"} | ${r.detail.replace(/\|/g, "\\|")} |`;

console.log(`# verify:env — ${stamp}`);
console.log(`repo: ${repoRoot}${projectId ? ` (project ${projectId})` : ""}`);
console.log("");
console.log("| Check | Result | Detail |");
console.log("| --- | --- | --- |");
for (const r of results) console.log(row(r));
console.log("");
console.log(
  requiredFailed.length === 0
    ? `**verify:env green** — ${results.filter((r) => r.required).length} required checks passed.`
    : `**verify:env RED** — ${requiredFailed.length} required check(s) failed: ${requiredFailed.map((r) => r.name).join("; ")}.`,
);
process.exitCode = requiredFailed.length === 0 ? 0 : 1;
