#!/usr/bin/env node
/**
 * Real-stack smoke journey runner.
 *
 * This is the opt-in gate that would have caught every regression in the
 * accounts series. It runs the real app against the real local Supabase stack
 * and walks: signup → confirm via Mailpit → create business → brand → store →
 * product → switch business → assert Dashboard/Orders/Products re-scope.
 *
 * Prerequisites (run `npm run verify:env` first):
 *   - Vite dev server running (VERIFY_APP_URL, default http://127.0.0.1:5173)
 *   - Local Supabase stack healthy (`supabase start`)
 *   - Migrations applied (`supabase db reset`)
 *   - Mailpit reachable at :54324 for confirmation links
 *   - Playwright browsers installed (`npx playwright install chromium`)
 *
 * Usage:
 *   npm run test:smoke
 *
 * Environment:
 *   VERIFY_APP_URL       app origin (default http://127.0.0.1:5173)
 *   SMOKE_SUPABASE_URL   local gateway (default http://127.0.0.1:54321)
 *   SMOKE_MAILPIT_URL    Mailpit API (default http://127.0.0.1:54324)
 *   SMOKE_EMAIL          test email (default smoke-test@example.com)
 *   SMOKE_PASSWORD       test password (default SmokeTestPass123!)
 */

import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const smokeDir = resolve(repoRoot, "tests", "smoke");

if (!existsSync(smokeDir)) {
  console.error("tests/smoke/ directory not found. Create smoke specs there first.");
  process.exit(1);
}

const configPath = resolve(repoRoot, "playwright.smoke.config.ts");
if (!existsSync(configPath)) {
  console.error("playwright.smoke.config.ts not found at repo root.");
  process.exit(1);
}

console.log("# Real-stack smoke journey");
console.log(`app: ${process.env.VERIFY_APP_URL || "http://127.0.0.1:5173"}`);
console.log(`stack: ${process.env.SMOKE_SUPABASE_URL || "http://127.0.0.1:54321"}`);
console.log(`mailpit: ${process.env.SMOKE_MAILPIT_URL || "http://127.0.0.1:54324"}`);
console.log("");

try {
  const output = execFileSync(
    "npx",
    ["playwright", "test", "--config", configPath, "--reporter=line"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: "inherit",
      timeout: 300_000,
    },
  );
  console.log("\n**smoke on real stack green**");
} catch (err) {
  console.error("\n**smoke on real stack RED** — see failures above.");
  process.exit(1);
}
