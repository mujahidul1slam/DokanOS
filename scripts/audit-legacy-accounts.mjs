#!/usr/bin/env node
// Node >= 22.18 (native TypeScript stripping). Never imports the application or its credentials.
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { auditLegacyAccounts, rehearsePreservation } from "../src/lib/accounts/legacy-readiness.ts";

try {
  const { values } = parseArgs({ options: {
    fixture: { type: "string" }, database: { type: "boolean" }, mappings: { type: "string" },
    baseline: { type: "string" }, out: { type: "string" },
  } });
  if (!values.out || Boolean(values.fixture) === Boolean(values.database)) {
    throw new Error("Use exactly one of --fixture <inventory.json> or --database, and --out <new-report.json>.");
  }
  const read = (file) => JSON.parse(readFileSync(file, "utf8"));
  let inventory;
  if (values.database) {
    if (!process.env.AUDIT_DATABASE_URL) throw new Error("Set AUDIT_DATABASE_URL explicitly; no application/deployed credentials are discovered automatically.");
    const { collectLegacyInventory } = await import("./lib/collect-legacy-accounts.mjs");
    inventory = await collectLegacyInventory(process.env.AUDIT_DATABASE_URL);
  } else {
    inventory = read(values.fixture);
  }
  const report = auditLegacyAccounts(inventory, values.mappings ? read(values.mappings) : []);
  if (values.baseline) {
    const baseline = read(values.baseline);
    report.preservation = rehearsePreservation(baseline.inventory ?? baseline, inventory);
    report.ready = report.ready && report.preservation.preserved;
  }
  // Evidence is private and append-only. No raw database values or report on stdout.
  writeFileSync(values.out, JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(`${values.out}: ${report.ready ? "ready for reviewed additive slice" : "BLOCKED"}; ${report.blockers.length} readiness blocker(s).`);
  process.exitCode = report.ready ? 0 : 2;
} catch (error) {
  console.error(`Audit failed: ${error.message}`);
  process.exitCode = 1;
}
