#!/usr/bin/env node
/**
 * Local-only proof for JavaScript -> PostgREST -> PostgreSQL `bytea` transport.
 *
 * The WooCommerce webhook handler sends the raw request body as
 * `\\x<hex>` (see `supabase/functions/woocommerce-webhook/index.ts`). This probe
 * answers the one question that string cannot answer by inspection: does
 * PostgREST hand those bytes to PostgreSQL unchanged?
 *
 * Method: create a disposable `public._probe_bytea_echo(bytea)` on the LOCAL
 * database, call it through the LOCAL PostgREST endpoint as `service_role`, and
 * compare the returned hex against the bytes that were sent. The function is
 * dropped in a `finally` block, so the database is left as it was.
 *
 *   node scripts/webhook-bytea-local-probe.mjs
 *
 * Refuses to run against anything that is not 127.0.0.1/localhost, and needs no
 * environment variables: the local JWT secret is read from the local Auth
 * container's own configuration.
 */
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import pg from "pg";

const { Client } = pg;

const API_URL = process.env.LOCAL_SUPABASE_URL || "http://127.0.0.1:54321";
const DB_URL =
  process.env.LOCAL_SUPABASE_DB_URL ||
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const AUTH_CONTAINER =
  process.env.LOCAL_SUPABASE_AUTH_CONTAINER ||
  "supabase_auth_jiwndicvfkiltgageqwv";
const PROBE_FUNCTION = "_probe_bytea_echo";

// A body that exercises the transport rather than a trivial ASCII string:
// invalid UTF-8, NUL bytes, high bytes, and the `\x` prefix the handler sends.
const PAYLOAD = Buffer.from([
  0x00, 0x01, 0x7f, 0x80, 0xfe, 0xff, 0x5c, 0x78, 0x25, 0x20, 0xc3, 0x28,
  0x0a, 0x0d, 0x09, 0x22, 0x7b, 0x7d, 0x5c, 0x00,
]);

function assertLocal(label, value) {
  const url = new URL(value);
  const hosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if (!hosts.has(url.hostname)) {
    throw new Error(`refusing non-local ${label}: ${url.hostname}`);
  }
}

function localJwtSecret() {
  const raw = execFileSync(
    "docker",
    ["inspect", AUTH_CONTAINER, "--format", "{{json .Config.Env}}"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  const entry = JSON.parse(raw).find((row) => row.startsWith("GOTRUE_JWT_SECRET="));
  if (!entry) throw new Error("local Auth container has no GOTRUE_JWT_SECRET");
  return entry.slice("GOTRUE_JWT_SECRET=".length);
}

function serviceRoleJwt(secret) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    aud: "service_role",
    exp: Math.floor(Date.now() / 1000) + 300,
    iat: Math.floor(Date.now() / 1000),
    iss: "supabase",
    role: "service_role",
  });
  const signature = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

async function main() {
  assertLocal("LOCAL_SUPABASE_URL", API_URL);
  assertLocal("LOCAL_SUPABASE_DB_URL", DB_URL);

  const token = serviceRoleJwt(localJwtSecret());
  const client = new Client({ connectionString: DB_URL });
  await client.connect();

  try {
    await client.query(`
      CREATE OR REPLACE FUNCTION public.${PROBE_FUNCTION}(p_body bytea)
      RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
        SELECT jsonb_build_object('hex', encode(p_body, 'hex'), 'len', length(p_body))
      $$;
    `);
    await client.query(
      `REVOKE ALL ON FUNCTION public.${PROBE_FUNCTION}(bytea) FROM PUBLIC, anon, authenticated;`,
    );
    await client.query(
      `GRANT EXECUTE ON FUNCTION public.${PROBE_FUNCTION}(bytea) TO service_role;`,
    );
    // PostgREST caches the RPC catalogue; without this the new function 404s.
    await client.query("NOTIFY pgrst, 'reload schema';");
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Exactly what the webhook handler sends: a `\x`-prefixed hex string.
    const wire = `\\x${PAYLOAD.toString("hex")}`;
    const response = await fetch(`${API_URL}/rest/v1/rpc/${PROBE_FUNCTION}`, {
      method: "POST",
      headers: {
        apikey: token,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_body: wire }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`PostgREST returned HTTP ${response.status}: ${detail.slice(0, 400)}`);
    }

    const result = await response.json();
    const expectedHex = PAYLOAD.toString("hex");
    const expectedLength = PAYLOAD.length;

    if (result?.hex !== expectedHex || result?.len !== expectedLength) {
      throw new Error(
        `bytea round-trip mismatch: sent ${expectedHex} (${expectedLength} bytes), `
        + `received ${result?.hex} (${result?.len} bytes)`,
      );
    }

    // The other direction: hand the same bytes to PostgreSQL as a parameter
    // (no text encoding involved) and confirm the stored value is identical, so
    // a worker can verify what it persisted and not only what it sent.
    const stored = await client.query("SELECT encode($1::bytea, 'hex') AS hex", [PAYLOAD]);
    if (stored.rows[0]?.hex !== expectedHex) {
      throw new Error("parameterized bytea write did not reproduce the payload");
    }

    console.log(`PASS  bytea transport (${expectedLength} bytes, invalid UTF-8 + NUL + \\x prefix)`);
    console.log(`PASS  PostgREST JSON -> bytea preserved exactly at ${API_URL}`);
    console.log("PASS  disposable probe function dropped; local database unchanged");
    return 0;
  } finally {
    try {
      await client.query(`DROP FUNCTION IF EXISTS public.${PROBE_FUNCTION}(bytea);`);
    } finally {
      await client.end();
    }
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
  });
