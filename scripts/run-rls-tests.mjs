#!/usr/bin/env node
/**
 * RLS battery runner (W0). Requires: local Supabase stack (Docker Desktop)
 * running; `supabase status` resolves a local DB URL.
 *
 *   supabase db reset   # applies all migrations, wipes fixtures
 *   node scripts/run-rls-tests.mjs
 *
 * Seeds fixture users/roles/businesses, then executes supabase/tests/rls/*.sql
 * in filename order as multi-statement batches; reports uncaught SQLSTATE
 * errors and recovers before the next file. Shapes A/A'/B/C catch expected errors, so
 * an uncaught error is always a real policy bug.
 */
import { execSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const { Client } = pg;
const REPO = process.cwd();
const TESTS_DIR = path.join(REPO, "supabase", "tests", "rls");

// ---- fixture UUIDs (must match the *_test.sql files) ----
const FIXTURE_IDS = [
  "00000000-0000-0000-0000-00000000000a", // ADMIN
  "00000000-0000-0000-0000-00000000000b", // STAFF (app_settings fixture)
  "00000000-0000-0000-0000-00000000000c", // STAFF_MGMT (settings.manage override)
  "00000000-0000-0000-0000-000000000001", // OWNER_A
  "00000000-0000-0000-0000-000000000002", // OWNER_A2
  "00000000-0000-0000-0000-000000000003", // UBA_ADMIN_A
  "00000000-0000-0000-0000-000000000004", // MEMBER_A
  "00000000-0000-0000-0000-000000000005", // VIEWER_A
  "00000000-0000-0000-0000-000000000006", // OWNER_B
  "00000000-0000-0000-0000-000000000007", // OUTSIDER
  "00000000-0000-0000-0000-000000000008", // SPARE_A
  "00000000-0000-0000-0000-000000000009", // SPARE_B
];
const BIZ_A = "11111111-0000-0000-0000-000000000001";
const B_OTHER = "11111111-0000-0000-0000-000000000002";
const ADMIN = "00000000-0000-0000-0000-00000000000a";
const STAFF_NO = "00000000-0000-0000-0000-00000000000b";
const STAFF_MGMT = "00000000-0000-0000-0000-00000000000c";

function localStatus() {
  try {
    const out = execSync("supabase status --output json", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const { DB_URL } = JSON.parse(out);
    const url = new URL(DB_URL);
    if (!["postgres:", "postgresql:"].includes(url.protocol) ||
        !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
      throw new Error("Refusing non-local Supabase DB URL");
    }
    return JSON.parse(out);
  } catch {
    console.error("FAIL: could not resolve local Supabase DB URL. Is Docker running?");
    // CLI errors may include local credentials; do not echo raw status output.
    process.exit(1);
  }
}

function jwtFor(status, userId) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    aud: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 300,
    role: "authenticated",
    sub: userId,
  });
  const signature = createHmac("sha256", status.JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

async function runApiChecks(client, status) {
  const storeA = "33333333-0000-0000-0000-000000000011";
  const storeB = "33333333-0000-0000-0000-000000000012";
  const productA = "55555555-0000-0000-0000-000000000011";
  const productB = "55555555-0000-0000-0000-000000000012";
  await client.query(`
    INSERT INTO public.stores (id, name, url) VALUES
      ('${storeA}', 'API Store A', 'https://api-a.test'),
      ('${storeB}', 'API Store B', 'https://api-b.test')
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.brands (id, business_id, name, slug, woo_store_id) VALUES
      ('44444444-0000-0000-0000-000000000011', '${BIZ_A}', 'API Brand A', 'issue-10-api-brand-a', '${storeA}'),
      ('44444444-0000-0000-0000-000000000012', '${B_OTHER}', 'API Brand B', 'issue-10-api-brand-b', '${storeB}')
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.products (id, store_id, name) VALUES
      ('${productA}', '${storeA}', 'API Product A'),
      ('${productB}', '${storeB}', 'API Product B')
    ON CONFLICT (id) DO NOTHING;
  `);

  const headersFor = (userId) => ({
    apikey: status.ANON_KEY,
    Authorization: `Bearer ${jwtFor(status, userId)}`,
    "Content-Type": "application/json",
  });
  const productIds = async (userId) => {
    const response = await fetch(`${status.API_URL}/rest/v1/products?select=id&id=in.(${productA},${productB})`, {
      headers: headersFor(userId),
    });
    if (!response.ok) throw new Error(`API SELECT failed (${response.status})`);
    return (await response.json()).map((row) => row.id).sort();
  };

  try {
    const ownerIds = await productIds(FIXTURE_IDS[3]);
    const memberIds = await productIds(FIXTURE_IDS[6]);
    const nonmemberIds = await productIds(FIXTURE_IDS[9]);
    const globalStaffIds = await productIds(FIXTURE_IDS[1]);
    if (ownerIds.join() !== productA || memberIds.join() !== productA) {
      throw new Error("owner/member API read did not stay inside Biz A");
    }
    if (nonmemberIds.length || globalStaffIds.length) {
      throw new Error("nonmember or legacy global role crossed the API account boundary");
    }
    const forged = await fetch(`${status.API_URL}/rest/v1/products`, {
      method: "POST",
      headers: { ...headersFor(FIXTURE_IDS[6]), Prefer: "return=representation" },
      body: JSON.stringify({ store_id: storeB, name: "Forged API Product" }),
    });
    if (forged.ok) throw new Error("forged cross-account store id was accepted by the API");
    console.log("PASS  account_boundaries_api (owner/member/nonmember + forged id)");
  } finally {
    await client.query(`
      DELETE FROM public.products WHERE id IN ('${productA}', '${productB}') OR name = 'Forged API Product';
      DELETE FROM public.brands WHERE id IN (
        '44444444-0000-0000-0000-000000000011',
        '44444444-0000-0000-0000-000000000012'
      );
      DELETE FROM public.stores WHERE id IN ('${storeA}', '${storeB}');
    `);
  }
}

async function seed(client) {
  // auth.users rows (fixture emails; passwords never exercised)
  const names = [
    "admin", "staff_no", "staff_mgmt",
    "owner_a", "owner_a2", "uba_admin_a", "member_a", "viewer_a",
    "owner_b", "outsider", "spare_a", "spare_b",
  ];
  for (let i = 0; i < FIXTURE_IDS.length; i++) {
    await client.query(
      `INSERT INTO auth.users
         (id, aud, role, email, encrypted_password, email_confirmed_at,
          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
       VALUES ($1, 'authenticated', 'authenticated', $2,
          'local-fixture-password-never-used-for-login', now(),
          '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now())
       ON CONFLICT (id) DO NOTHING`,
      [FIXTURE_IDS[i], `${names[i]}@dokanos.test`],
    );
  }
  // Legacy signup may provision roles/memberships; replace them deterministically.
  await client.query(`DELETE FROM public.user_roles WHERE user_id = ANY($1)`, [FIXTURE_IDS]);
  await client.query(`DELETE FROM public.user_business_access WHERE user_id = ANY($1)`, [FIXTURE_IDS]);
  await client.query(
    `INSERT INTO public.user_roles (user_id, role)
     VALUES ($1, 'admin'), ($2, 'staff'), ($3, 'staff'),
            ($4, 'staff'), ($5, 'staff'), ($6, 'staff'), ($7, 'staff'), ($8, 'staff'),
            ($9, 'staff'), ($10, 'staff'), ($11, 'staff'), ($12, 'staff')`,
    FIXTURE_IDS,
  );
  // businesses
  await client.query(
    `INSERT INTO public.businesses (id, name, slug, currency, timezone)
     VALUES ($1, 'Biz A Fixture', 'biz-a-fixture', 'BDT', 'Asia/Dhaka'),
            ($2, 'Biz B Fixture', 'biz-b-fixture', 'BDT', 'Asia/Dhaka')
     ON CONFLICT (id) DO NOTHING`,
    [BIZ_A, B_OTHER],
  );
  // user_business_access
  await client.query(
    `INSERT INTO public.user_business_access (user_id, business_id, role) VALUES
       ($1, $7, 'owner'),   -- OWNER_A
       ($2, $7, 'owner'),   -- OWNER_A2
       ($3, $7, 'admin'),   -- UBA_ADMIN_A
       ($4, $7, 'member'),  -- MEMBER_A
       ($5, $7, 'viewer'),  -- VIEWER_A
       ($6, $8, 'owner')    -- OWNER_B
     ON CONFLICT (user_id, business_id) DO NOTHING`,
    [FIXTURE_IDS[3], FIXTURE_IDS[4], FIXTURE_IDS[5], FIXTURE_IDS[6], FIXTURE_IDS[7], FIXTURE_IDS[8], BIZ_A, B_OTHER],
  );
  // app_settings fixture row (W4 A' survival pins value)
  await client.query(
    `INSERT INTO public.app_settings (key, value) VALUES ('battery_flag', '{"enabled":false}'::jsonb)
     ON CONFLICT (key) DO NOTHING`,
  );
  // settings.manage override for STAFF_MGMT (W4 B path)
  await client.query(
    `INSERT INTO public.user_permissions (user_id, permission, granted)
     VALUES ($1, 'settings.manage', true)
     ON CONFLICT (user_id, permission) DO NOTHING`,
    [STAFF_MGMT],
  );
}

async function run() {
  const status = localStatus();
  const client = new Client({ connectionString: status.DB_URL });
  await client.connect();
  try {
    await seed(client);
    const files = readdirSync(TESTS_DIR)
      .filter((f) => f.endsWith("_test.sql"))
      .sort();
    if (files.length === 0) {
      console.log("SKIP: no *_test.sql files found");
      return;
    }
    let failures = 0;
    for (const f of files) {
      const sql = readFileSync(path.join(TESTS_DIR, f), "utf8");
      try {
        await client.query(sql);
        console.log(`PASS  ${f}`);
      } catch (e) {
        failures++;
        console.log(`FAIL  ${f}: ${e.message}`);
        // Each file owns transactions. A failed batch can leave one aborted;
        // recover before running the next file so its verdict is independent.
        await client.query("ROLLBACK");
        await client.query("RESET ROLE");
      }
    }
    if (failures === 0) {
      try {
        await runApiChecks(client, status);
      } catch (e) {
        failures++;
        console.log(`FAIL  account_boundaries_api: ${e.message}`);
      }
    }
    console.log(failures === 0 ? `\nALL GREEN (${files.length} files)` : `\n${failures} file(s) FAILED`);
    process.exitCode = failures === 0 ? 0 : 1;
  } finally {
    await client.end();
  }
}

run().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
