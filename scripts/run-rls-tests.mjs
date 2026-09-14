#!/usr/bin/env node
/**
 * RLS battery runner (W0). Requires: local Supabase stack (Docker Desktop)
 * running; `supabase status` resolves a local DB URL.
 *
 *   supabase db reset   # applies all migrations, wipes fixtures
 *   node scripts/run-rls-tests.mjs
 *
 * Seeds fixture users/roles/businesses, then executes supabase/tests/rls/*.sql
 * in filename order as multi-statement batches; fails on the first uncaught
 * SQLSTATE error. Shapes A/A'/B/C guarantee expected errors never escape, so
 * an uncaught error is always a real policy bug.
 */
import { execSync } from "node:child_process";
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

function dbUrl() {
  try {
    const out = execSync("supabase status", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const m = out.match(/postgres(?:ql)?:\/\/\S+/);
    if (!m) throw new Error("no DB URL in supabase status output");
    return m[0];
  } catch (e) {
    console.error("FAIL: could not resolve local Supabase DB URL. Is Docker running?");
    console.error(e.message);
    process.exit(1);
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
  // user_roles: wipe handle_new_user's first-user admin side-effect, re-seed deterministically
  await client.query(`DELETE FROM public.user_roles WHERE user_id = ANY($1)`, [FIXTURE_IDS]);
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
       ($1, $A, 'owner'),   -- OWNER_A
       ($2, $A, 'owner'),   -- OWNER_A2
       ($3, $A, 'admin'),   -- UBA_ADMIN_A
       ($4, $A, 'member'),  -- MEMBER_A
       ($5, $A, 'viewer'),  -- VIEWER_A
       ($6, $B, 'owner')    -- OWNER_B
     ON CONFLICT (user_id, business_id) DO NOTHING`,
    [FIXTURE_IDS[3], FIXTURE_IDS[4], FIXTURE_IDS[5], FIXTURE_IDS[6], FIXTURE_IDS[7], FIXTURE_IDS[8]],
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
  const url = dbUrl();
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await seed(client);
    const files = readdirSync(TESTS_DIR)
      .filter((f) => f.endsWith("_test.sql"))
      .sort();
    if (files.length === 0) {
      console.log("SKIP: no *_test.sql files found");
      process.exit(0);
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
      }
    }
    console.log(failures === 0 ? `\nALL GREEN (${files.length} files)` : `\n${failures} file(s) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  } finally {
    await client.end();
  }
}

run().catch((e) => {
  console.error(e.message);
  process.exit(1);
});