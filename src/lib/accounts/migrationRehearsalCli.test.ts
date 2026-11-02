import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const cli = path.resolve("scripts/audit-legacy-accounts.mjs");
const fixtures = path.resolve("scripts/fixtures/account-readiness/rehearsal");
const mappings = path.join(fixtures, "reviewed-mappings.json");

function runPre(dir: string, name = "pre-report.json") {
  const out = path.join(dir, name);
  const result = spawnSync(process.execPath, [
    cli, "--fixture", path.join(fixtures, "pre-change.json"), "--mappings", mappings, "--out", out,
  ], { encoding: "utf8" });
  return { out, result, report: JSON.parse(readFileSync(out, "utf8")) };
}

describe("account migration rehearsal command", () => {
  it("rehearses the post-change inventory against the pre-change baseline and keeps the open blocker", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "accounts-rehearsal-"));
    try {
      const pre = runPre(dir);
      expect(pre.result.status).toBe(2);
      expect(pre.report.ready).toBe(false);
      expect(pre.report.blockers).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "multiple-owners" }),
        expect.objectContaining({ code: "shared-resource", resource: "stores:shared" }),
        expect.objectContaining({ code: "global-authority" }),
      ]));

      const out = path.join(dir, "rehearsal-report.json");
      const result = spawnSync(process.execPath, [
        cli, "--fixture", path.join(fixtures, "post-change.json"), "--mappings", mappings,
        "--baseline", pre.out, "--out", out,
      ], { encoding: "utf8" });
      expect(result.status).toBe(2);
      const report = JSON.parse(readFileSync(out, "utf8"));
      // Additive rows are permitted and every fingerprinted legacy row survives.
      expect(report.preservation).toEqual({ preserved: true, violations: [] });
      // The migration stays blocked until a human resolves the records a mapping cannot.
      expect(report.ready).toBe(false);
      expect(report.blockers).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "multiple-owners", resource: "businesses:account" }),
        expect.objectContaining({ code: "global-authority", resource: "user_roles:global-admin" }),
      ]));
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("blocks a destructive post-change inventory and never overwrites prior evidence", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "accounts-rehearsal-"));
    try {
      const pre = runPre(dir);
      const destructive = path.join(dir, "destructive.json");
      const inventory = JSON.parse(readFileSync(path.join(fixtures, "post-change.json"), "utf8"));
      inventory.tables.orders = [];
      writeFileSync(destructive, JSON.stringify(inventory));

      const out = path.join(dir, "destructive-report.json");
      const args = [
        cli, "--fixture", destructive, "--mappings", mappings, "--baseline", pre.out, "--out", out,
      ];
      const result = spawnSync(process.execPath, args, { encoding: "utf8" });
      expect(result.status).toBe(2);
      expect(JSON.parse(readFileSync(out, "utf8")).preservation.preserved).toBe(false);

      // Re-running the identical command must refuse to overwrite the evidence.
      const retry = spawnSync(process.execPath, args, { encoding: "utf8" });
      expect(retry.status).toBe(1);
      expect(JSON.parse(readFileSync(out, "utf8")).preservation.preserved).toBe(false);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("keeps the committed rehearsal fixtures immutable", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "accounts-rehearsal-"));
    try {
      const before = ["pre-change.json", "post-change.json", "reviewed-mappings.json"]
        .map((name) => readFileSync(path.join(fixtures, name), "utf8"));
      const result = spawnSync(process.execPath, [
        cli, "--fixture", path.join(fixtures, "post-change.json"), "--mappings", mappings,
        "--out", path.join(dir, "report.json"),
      ], { encoding: "utf8" });
      expect(result.status).toBe(2);
      const after = ["pre-change.json", "post-change.json", "reviewed-mappings.json"]
        .map((name) => readFileSync(path.join(fixtures, name), "utf8"));
      expect(after).toEqual(before);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
