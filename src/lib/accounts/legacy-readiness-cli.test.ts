import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const cli = path.resolve("scripts/audit-legacy-accounts.mjs");
const fixtures = path.resolve("scripts/fixtures/account-readiness");

describe("read-only account audit command", () => {
  it("writes a safe fixture report and refuses to overwrite existing evidence", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "accounts-audit-"));
    try {
      const output = path.join(dir, "report.json");
      const args = [cli, "--fixture", path.join(fixtures, "safe.json"), "--mappings", path.join(fixtures, "reviewed-mappings.json"), "--out", output];
      execFileSync(process.execPath, args);
      expect(JSON.parse(readFileSync(output, "utf8")).ready).toBe(true);
      const retry = spawnSync(process.execPath, args, { encoding: "utf8" });
      expect(retry.status).toBe(1);
      expect(JSON.parse(readFileSync(output, "utf8")).ready).toBe(true);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("writes blockers and exits 2 for ambiguous data instead of reassigning resources or access", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "accounts-audit-"));
    try {
      const input = path.join(fixtures, "ambiguous.json");
      const original = readFileSync(input, "utf8");
      const output = path.join(dir, "blocked.json");
      const result = spawnSync(process.execPath, [cli, "--fixture", input, "--mappings", path.join(fixtures, "reviewed-mappings.json"), "--out", output], { encoding: "utf8" });
      expect(result.status).toBe(2);
      const report = JSON.parse(readFileSync(output, "utf8"));
      expect(report.ready).toBe(false);
      expect(report.blockers).toContainEqual(expect.objectContaining({ code: "shared-resource", resource: "stores:woo" }));
      expect(report.inventory.tables.user_business_access).toHaveLength(3);
      expect(readFileSync(input, "utf8")).toBe(original);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
