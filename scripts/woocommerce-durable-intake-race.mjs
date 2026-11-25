#!/usr/bin/env node
/**
 * Concurrency test for `public.accept_woocommerce_webhook_delivery(...)`.
 *
 *   node scripts/woocommerce-durable-intake-race.mjs
 *
 * The durable-intake RPC is the only writer for accepted WooCommerce webhook
 * evidence, and WooCommerce happily retries a delivery while the first attempt
 * is still in flight. Two simultaneous deliveries must therefore converge on
 * ONE delivery row and ONE pending work row, never on two.
 *
 * Unlike the SQL batteries this file COMMITS its fixtures (concurrency needs
 * several connections to see them) and removes them in a `finally` block. It
 * only ever touches rows it created: every fixture id is derived from
 * RACE_TOKEN, and cleanup deletes by connector id.
 *
 * Local only: refuses any database host that is not 127.0.0.1/localhost.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";

const { Client } = pg;
const DB_URL =
  process.env.LOCAL_SUPABASE_DB_URL ||
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const BUSINESS_ID = "11111111-0000-0000-0000-000000000001";
const EXTERNAL_ORDER_ID = 96001;

function assertLocal(value) {
  const url = new URL(value);
  if (!new Set(["127.0.0.1", "localhost", "[::1]"]).has(url.hostname)) {
    throw new Error(`refusing non-local database host: ${url.hostname}`);
  }
}

function connect() {
  const client = new Client({ connectionString: DB_URL });
  return client.connect().then(() => client);
}

const failures = [];
function check(label, condition, detail = "") {
  if (condition) {
    console.log(`PASS  ${label}`);
  } else {
    failures.push(label);
    console.log(`FAIL  ${label}${detail ? `: ${detail}` : ""}`);
  }
}

/**
 * One delivery attempt. Each call gets its own connection so the advisory lock
 * and the unique indexes are actually exercised across sessions.
 */
async function deliver({ connectorId, deliveryId, fingerprint, externalOrderId, orderNumber }) {
  const client = await connect();
  try {
    const { rows } = await client.query(
      `SELECT public.accept_woocommerce_webhook_delivery(
         $1::uuid, $2::bigint, $3::text, $4::text, $5::text, $6::text, $7::text, $8::text,
         $9::bytea, $10::jsonb, $11::bigint
       ) AS result`,
      [
        connectorId,
        9001,
        deliveryId,
        fingerprint,
        "order.updated",
        "order",
        "https://race.invalid/wp-json/wc/v3/webhooks",
        "1",
        Buffer.from(`{"id":${externalOrderId},"number":"${orderNumber}"}`),
        JSON.stringify({ id: externalOrderId, number: orderNumber }),
        externalOrderId,
      ],
    );
    return rows[0].result;
  } finally {
    await client.end();
  }
}

async function main() {
  assertLocal(DB_URL);
  const token = randomUUID().replace(/-/g, "").slice(0, 12);
  const connectorId = randomUUID();
  const brandId = randomUUID();
  const storeId = randomUUID();
  const sourceId = randomUUID();
  const slug = `woocommerce-intake-race-${token}`;
  const deliveryId = `race-delivery-${token}`;
  const fingerprint = `race-fingerprint-${token}`;

  const admin = await connect();
  try {
    // ---- fixtures (committed: other sessions must see them) ----
    // The business is a stable local fixture shared with the SQL battery. It is
    // idempotent and deliberately not deleted in cleanup: removing a business
    // under session_replication_role = replica would skip FK cascades.
    await admin.query(
      `INSERT INTO public.businesses (id, name, slug, currency, timezone)
       VALUES ($1, 'WooCommerce SQL fixture business', 'woocommerce-sql-fixture', 'BDT', 'Asia/Dhaka')
       ON CONFLICT DO NOTHING`,
      [BUSINESS_ID],
    );
    await admin.query(
      `INSERT INTO public.stores (id, name, url) VALUES ($1, $2, $3)`,
      [storeId, `Intake race store ${token}`, `https://race-${token}.invalid`],
    );
    await admin.query(
      `INSERT INTO public.brands (id, business_id, name, slug, woo_store_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [brandId, BUSINESS_ID, `Intake race brand ${token}`, slug, storeId],
    );
    await admin.query(
      `INSERT INTO public.order_sources (id, brand_id, name, type)
       VALUES ($1, $2, $3, 'woocommerce')`,
      [sourceId, brandId, `Intake race source ${token}`],
    );
    await admin.query(
      `INSERT INTO public.woocommerce_connectors (
         id, business_id, brand_id, store_id, order_source_id, external_store_url,
         external_store_key, credentials_ref, webhook_secret_ref, status,
         outbound_enabled, intake_enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'healthy', false, true)`,
      [
        connectorId,
        BUSINESS_ID,
        brandId,
        storeId,
        sourceId,
        `https://race-${token}.invalid`,
        `race-${token}`,
        "LOCAL_TEST_CREDENTIAL",
        "LOCAL_TEST_SECRET",
      ],
    );

    // ---- grants: service_role only ----
    const grants = await admin.query(
      `SELECT
         has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_exec,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
         has_function_privilege('service_role', p.oid, 'EXECUTE')  AS service_exec
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'accept_woocommerce_webhook_delivery'`,
    );
    const grant = grants.rows[0];
    check("intake RPC is executable by service_role", grant?.service_exec === true);
    check("intake RPC is not executable by anon", grant?.anon_exec === false);
    check("intake RPC is not executable by authenticated", grant?.auth_exec === false);

    // ---- the race: eight simultaneous identical deliveries ----
    const attempts = 8;
    const results = await Promise.all(
      Array.from({ length: attempts }, () =>
        deliver({
          connectorId,
          deliveryId,
          fingerprint,
          externalOrderId: EXTERNAL_ORDER_ID,
          orderNumber: "RACE-1",
        }),
      ),
    );

    const accepted = results.filter((row) => row.status === "accepted");
    const duplicate = results.filter((row) => row.status === "duplicate");
    const conflict = results.filter((row) => row.status === "conflict");

    check(
      `${attempts} concurrent deliveries produced exactly one 'accepted'`,
      accepted.length === 1,
      `got ${accepted.length} (statuses: ${results.map((r) => r.status).join(",")})`,
    );
    check(
      `${attempts} concurrent deliveries produced ${attempts - 1} 'duplicate'`,
      duplicate.length === attempts - 1,
      `got ${duplicate.length}`,
    );
    check("no concurrent delivery was reported as a conflict", conflict.length === 0);
    check(
      "every attempt returned the same delivery id",
      new Set(results.map((row) => row.delivery_id)).size === 1,
      `saw ${new Set(results.map((row) => row.delivery_id)).size} distinct ids`,
    );
    check(
      "every attempt returned the same work id",
      new Set(results.map((row) => row.work_id)).size === 1,
      `saw ${new Set(results.map((row) => row.work_id)).size} distinct ids`,
    );

    const deliveries = await admin.query(
      `SELECT count(*)::int AS n FROM public.woocommerce_webhook_deliveries WHERE connector_id = $1`,
      [connectorId],
    );
    check("exactly one delivery row was persisted", deliveries.rows[0].n === 1, `got ${deliveries.rows[0].n}`);

    const work = await admin.query(
      `SELECT count(*)::int AS n, min(state) AS state, min(direction) AS direction, min(kind) AS kind
       FROM public.woocommerce_sync_work WHERE connector_id = $1`,
      [connectorId],
    );
    check("exactly one work row was persisted", work.rows[0].n === 1, `got ${work.rows[0].n}`);
    check(
      "the work row is a pending inbound webhook",
      work.rows[0].state === "pending" && work.rows[0].direction === "inbound" && work.rows[0].kind === "webhook",
      `${work.rows[0].direction}/${work.rows[0].kind}/${work.rows[0].state}`,
    );

    const raw = await admin.query(
      `SELECT encode(raw_body, 'hex') AS hex, length(raw_body) AS len
       FROM public.woocommerce_webhook_deliveries WHERE connector_id = $1`,
      [connectorId],
    );
    check(
      "the persisted body is the exact bytes that were sent",
      raw.rows[0]?.hex === Buffer.from(`{"id":${EXTERNAL_ORDER_ID},"number":"RACE-1"}`).toString("hex"),
      `got ${raw.rows[0]?.len} bytes`,
    );

    // ---- a second delivery for the same order coalesces onto the same work ----
    const secondDeliveryId = `race-delivery-${token}-2`;
    const second = await deliver({
      connectorId,
      deliveryId: secondDeliveryId,
      fingerprint: `race-fingerprint-${token}-2`,
      externalOrderId: EXTERNAL_ORDER_ID,
      orderNumber: "RACE-1",
    });
    check("a distinct delivery for the same order is accepted", second.status === "accepted", second.status);
    check(
      "the second delivery reuses the existing pending work row",
      second.work_id === results[0].work_id,
      `got ${second.work_id} vs ${results[0].work_id}`,
    );

    const afterSecond = await admin.query(
      `SELECT
         (SELECT count(*)::int FROM public.woocommerce_webhook_deliveries WHERE connector_id = $1) AS deliveries,
         (SELECT count(*)::int FROM public.woocommerce_sync_work WHERE connector_id = $1) AS work`,
      [connectorId],
    );
    check("two deliveries, still one work row", afterSecond.rows[0].deliveries === 2 && afterSecond.rows[0].work === 1,
      `deliveries=${afterSecond.rows[0].deliveries} work=${afterSecond.rows[0].work}`);

    // ---- the same delivery id for a DIFFERENT order is a conflict ----
    const reused = await deliver({
      connectorId,
      deliveryId,
      fingerprint,
      externalOrderId: EXTERNAL_ORDER_ID + 1,
      orderNumber: "RACE-2",
    });
    check("reusing an accepted delivery id for another order is a conflict", reused.status === "conflict", reused.status);
  } finally {
    // ---- cleanup: only this run's connector and everything that cascades ----
    // Accepted evidence is deliberately immutable (BEFORE DELETE raises), so the
    // removal runs with ordinary triggers suppressed. `session_replication_role`
    // is superuser-only and this file refuses any non-local host above.
    try {
      await admin.query("BEGIN");
      await admin.query("SET LOCAL session_replication_role = replica");
      await admin.query(`DELETE FROM public.woocommerce_sync_work WHERE connector_id = $1`, [connectorId]);
      await admin.query(
        `DELETE FROM public.woocommerce_webhook_deliveries WHERE connector_id = $1`,
        [connectorId],
      );
      await admin.query(`DELETE FROM public.woocommerce_connectors WHERE id = $1`, [connectorId]);
      await admin.query(`DELETE FROM public.order_sources WHERE id = $1`, [sourceId]);
      await admin.query(`DELETE FROM public.brands WHERE id = $1`, [brandId]);
      await admin.query(`DELETE FROM public.stores WHERE id = $1`, [storeId]);
      await admin.query("COMMIT");
    } catch (error) {
      try {
        await admin.query("ROLLBACK");
      } catch {
        /* the transaction already aborted */
      }
      console.error(`FAIL: cleanup left fixtures behind for connector ${connectorId}: ${error.message}`);
      failures.push("cleanup");
    } finally {
      await admin.end();
    }
  }

  console.log(
    failures.length === 0
      ? "\nALL GREEN (durable intake concurrency)"
      : `\n${failures.length} check(s) FAILED: ${failures.join("; ")}`,
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
});
