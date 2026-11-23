import { test } from "node:test";
import assert from "node:assert/strict";

import {
  stalePlanMessage,
  unrequestedPendingMigrations,
  versionFromFilename,
} from "./woocommerce-migration-plan.mjs";

const ON_DISK = [
  "20261110110000_woocommerce_conflict_resolution.sql",
  "20261111100000_woocommerce_durable_intake.sql",
  "20261112160000_woocommerce_order_contract_v2.sql",
  "20261113130000_woocommerce_work_identity_liveness.sql",
];

test("versionFromFilename reads the ledger timestamp, not the whole filename", () => {
  assert.equal(
    versionFromFilename("20261112160000_woocommerce_order_contract_v2.sql"),
    "20261112160000",
  );
  assert.equal(versionFromFilename("not-a-migration.sql"), null);
});

test("a plan that names every unapplied migration is complete", () => {
  const applied = new Set(["20261110110000"]);
  const requested = [
    "20261111100000_woocommerce_durable_intake.sql",
    "20261112160000_woocommerce_order_contract_v2.sql",
    "20261113130000_woocommerce_work_identity_liveness.sql",
  ];
  assert.deepEqual(unrequestedPendingMigrations({ onDisk: ON_DISK, requested, applied }), []);
});

/**
 * The regression this guards: production held an older ledger and the plan
 * stopped at 20261112150000, so the two newest files were never requested and
 * the run printed a false "Nothing to do".
 */
test("a plan that omits an unapplied migration on disk is rejected", () => {
  const applied = new Set(["20261110110000"]);
  const requested = ["20261111100000_woocommerce_durable_intake.sql"];
  assert.deepEqual(unrequestedPendingMigrations({ onDisk: ON_DISK, requested, applied }), [
    "20261112160000_woocommerce_order_contract_v2.sql",
    "20261113130000_woocommerce_work_identity_liveness.sql",
  ]);
});

test("an unrequested migration that is already applied is not a stale plan", () => {
  const applied = new Set(["20261110110000", "20261111100000", "20261112160000", "20261113130000"]);
  assert.deepEqual(
    unrequestedPendingMigrations({
      onDisk: ON_DISK,
      requested: ["20261110110000_woocommerce_conflict_resolution.sql"],
      applied,
    }),
    [],
  );
});

test("the refusal names every omitted migration", () => {
  const message = stalePlanMessage([
    "20261112160000_woocommerce_order_contract_v2.sql",
    "20261113130000_woocommerce_work_identity_liveness.sql",
  ]);
  assert.match(message, /is stale: 2 migration/);
  assert.match(message, /20261112160000_woocommerce_order_contract_v2\.sql/);
  assert.match(message, /20261113130000_woocommerce_work_identity_liveness\.sql/);
});