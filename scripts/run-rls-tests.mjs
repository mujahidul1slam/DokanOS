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

  const brandNames = ["Issue 11 API Brand A", "Issue 11 API Brand B"];
  const brandsFor = async (userId, businessId) => {
    const response = await fetch(
      `${status.API_URL}/rest/v1/brands?select=id,name,business_id,woo_store_id&business_id=eq.${businessId}`,
      { headers: headersFor(userId) },
    );
    if (!response.ok) throw new Error(`brand API SELECT failed (${response.status})`);
    return response.json();
  };
  const createBrand = (userId, businessId, name) => fetch(
    `${status.API_URL}/rest/v1/rpc/create_business_brand`,
    {
      method: "POST",
      headers: { ...headersFor(userId), Prefer: "return=representation" },
      body: JSON.stringify({ p_business_id: businessId, p_name: name }),
    },
  );

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

    // Issue #11: name-only brand creation and listing through real PostgREST.
    await client.query(
      `DELETE FROM public.brands WHERE business_id = '${BIZ_A}' AND name = ANY($1)`,
      [brandNames],
    );
    await client.query(
      `DELETE FROM public.audit_log
       WHERE action = 'create_brand' AND details->>'business_id' = '${BIZ_A}'
         AND details->>'name' = ANY($1)`,
      [brandNames],
    );
    const storesBefore = (await client.query("SELECT count(*)::int AS n FROM public.stores")).rows[0].n;
    const storefrontsBefore = (await client.query("SELECT count(*)::int AS n FROM public.storefronts")).rows[0].n;

    for (const name of brandNames) {
      const response = await createBrand(FIXTURE_IDS[6], BIZ_A, name);
      const payload = response.ok ? await response.json() : null;
      const brand = Array.isArray(payload) ? payload[0] : payload;
      if (!response.ok || brand?.name !== name || brand?.business_id !== BIZ_A || brand?.woo_store_id !== null) {
        throw new Error(`member could not create a name-only own-account brand (${response.status})`);
      }
    }

    const memberBrands = await brandsFor(FIXTURE_IDS[6], BIZ_A);
    const ownerBrands = await brandsFor(FIXTURE_IDS[3], BIZ_A);
    const ownNames = memberBrands.map((brand) => brand.name).filter((name) => brandNames.includes(name)).sort();
    const ownerNames = ownerBrands.map((brand) => brand.name).filter((name) => brandNames.includes(name)).sort();
    if (ownNames.join() !== [...brandNames].sort().join() || ownerNames.join() !== ownNames.join()) {
      throw new Error("owner/member brand listing did not return both own-account brands");
    }
    for (const [label, userId, businessId] of [
      ["nonmember", FIXTURE_IDS[9], BIZ_A],
      ["other-account owner", FIXTURE_IDS[8], BIZ_A],
      ["legacy global role", FIXTURE_IDS[1], BIZ_A],
    ]) {
      const visible = (await brandsFor(userId, businessId)).filter((brand) => brandNames.includes(brand.name));
      if (visible.length) throw new Error(`${label} listed another account's brands`);
    }

    const forgedBrand = await createBrand(FIXTURE_IDS[6], B_OTHER, "Issue 11 Forged Brand");
    if (forgedBrand.ok) throw new Error("forged cross-account business parent was accepted by the API");
    const viewerBrand = await createBrand(FIXTURE_IDS[7], BIZ_A, "Issue 11 Viewer Brand");
    if (viewerBrand.ok) throw new Error("read-only viewer created a brand through the API");
    const globalStaffBrand = await createBrand(FIXTURE_IDS[1], BIZ_A, "Issue 11 Staff Brand");
    if (globalStaffBrand.ok) throw new Error("legacy global role created an account brand through the API");

    const storesAfter = (await client.query("SELECT count(*)::int AS n FROM public.stores")).rows[0].n;
    const storefrontsAfter = (await client.query("SELECT count(*)::int AS n FROM public.storefronts")).rows[0].n;
    if (storesAfter !== storesBefore || storefrontsAfter !== storefrontsBefore) {
      throw new Error("brand creation implicitly created a store/storefront");
    }
    const auditCount = (await client.query(
      `SELECT count(*)::int AS n FROM public.audit_log
       WHERE action = 'create_brand' AND details->>'business_id' = '${BIZ_A}'
         AND details->>'name' = ANY($1)`,
      [brandNames],
    )).rows[0].n;
    if (auditCount !== brandNames.length) {
      throw new Error("brand creation did not write the audit trail");
    }
    console.log("PASS  account_boundaries_api (owner/member/nonmember + forged id)");
    console.log("PASS  brand_boundaries_api (member create/list, forged parent, viewer/global denial, no store)");
  } finally {
    await client.query(`
      DELETE FROM public.products WHERE id IN ('${productA}', '${productB}') OR name = 'Forged API Product';
      DELETE FROM public.brands WHERE id IN (
        '44444444-0000-0000-0000-000000000011',
        '44444444-0000-0000-0000-000000000012'
      ) OR name LIKE 'Issue 11 % Brand%';
      DELETE FROM public.audit_log
      WHERE action = 'create_brand' AND details->>'name' LIKE 'Issue 11 % Brand%';
      DELETE FROM public.stores WHERE id IN ('${storeA}', '${storeB}');
    `);
  }
}

async function runBrandStoreApiChecks(client, status) {
  const OWNER_A = FIXTURE_IDS[3];
  const MEMBER_A = FIXTURE_IDS[6];
  const VIEWER_A = FIXTURE_IDS[7];
  const OWNER_B = FIXTURE_IDS[8];
  const LEGACY_STAFF = FIXTURE_IDS[1];
  const BRAND_NAME = "Issue 12 API Brand A";
  const STORE_PHYSICAL = "Issue 12 API Outlet";
  const STORE_ONLINE = "Issue 12 API Online";

  const headersFor = (userId) => ({
    apikey: status.ANON_KEY,
    Authorization: `Bearer ${jwtFor(status, userId)}`,
    "Content-Type": "application/json",
  });
  const createBrand = (userId, businessId, name) => fetch(
    `${status.API_URL}/rest/v1/rpc/create_business_brand`,
    {
      method: "POST",
      headers: { ...headersFor(userId), Prefer: "return=representation" },
      body: JSON.stringify({ p_business_id: businessId, p_name: name }),
    },
  );
  const createStore = (userId, brandId, name, storeType) => fetch(
    `${status.API_URL}/rest/v1/rpc/create_brand_store`,
    {
      method: "POST",
      headers: { ...headersFor(userId), Prefer: "return=representation" },
      body: JSON.stringify({ p_brand_id: brandId, p_name: name, p_store_type: storeType }),
    },
  );
  const storesFor = async (userId, brandId) => {
    const response = await fetch(
      `${status.API_URL}/rest/v1/brand_stores?select=id,name,store_type,is_published,brand_id,legacy_location_id,legacy_selling_point_id,legacy_woo_store_id&brand_id=eq.${brandId}`,
      { headers: headersFor(userId) },
    );
    if (!response.ok) throw new Error(`brand_stores API SELECT failed (${response.status})`);
    return response.json();
  };
  const directInsert = (userId, body) => fetch(`${status.API_URL}/rest/v1/brand_stores`, {
    method: "POST",
    headers: { ...headersFor(userId), Prefer: "return=representation" },
    body: JSON.stringify(body),
  });

  let brandId = null;
  let otherBrandId = null;
  try {
    // A member creates the parent brand through the real API.
    const brandResponse = await createBrand(MEMBER_A, BIZ_A, BRAND_NAME);
    const brandPayload = brandResponse.ok ? await brandResponse.json() : null;
    const brand = Array.isArray(brandPayload) ? brandPayload[0] : brandPayload;
    if (!brandResponse.ok || !brand?.id || brand?.business_id !== BIZ_A) {
      throw new Error(`could not create the parent brand through the API (${brandResponse.status})`);
    }
    brandId = brand.id;

    // A brand in another account is the forged parent target.
    const otherResponse = await createBrand(OWNER_B, B_OTHER, "Issue 12 API Brand B");
    const otherPayload = otherResponse.ok ? await otherResponse.json() : null;
    const otherBrand = Array.isArray(otherPayload) ? otherPayload[0] : otherPayload;
    if (!otherResponse.ok || !otherBrand?.id || otherBrand?.business_id !== B_OTHER) {
      throw new Error(`could not create the other-account brand (${otherResponse.status})`);
    }
    otherBrandId = otherBrand.id;

    const countsBefore = (await client.query(`
      SELECT
        (SELECT count(*)::int FROM public.stores)       AS stores,
        (SELECT count(*)::int FROM public.storefronts)  AS storefronts,
        (SELECT count(*)::int FROM public.brands)       AS brands,
        (SELECT count(*)::int FROM public.selling_points WHERE type = 'woocommerce') AS woo_points
    `)).rows[0];

    // Multiple creation under one brand with explicit physical/online types.
    for (const [name, type] of [[STORE_PHYSICAL, "physical"], [STORE_ONLINE, "online"]]) {
      const response = await createStore(MEMBER_A, brandId, name, type);
      const payload = response.ok ? await response.json() : null;
      const store = Array.isArray(payload) ? payload[0] : payload;
      if (!response.ok || store?.store_type !== type || store?.brand_id !== brandId || store?.is_published !== false) {
        throw new Error(`member could not create an explicit ${type} store (${response.status})`);
      }
      if (store?.legacy_location_id || store?.legacy_selling_point_id || store?.legacy_woo_store_id) {
        throw new Error("minimal store creation attached an unreviewed legacy reference");
      }
    }

    // Owner and member both see exactly the two own-account stores.
    for (const [label, userId] of [["owner", OWNER_A], ["member", MEMBER_A], ["viewer", VIEWER_A]]) {
      const stores = await storesFor(userId, brandId);
      const names = stores.map((store) => store.name).sort();
      if (stores.length !== 2 || names.join() !== [STORE_ONLINE, STORE_PHYSICAL].sort().join()) {
        throw new Error(`${label} did not list both own-account stores`);
      }
      if (stores.some((store) => store.is_published !== false)) {
        throw new Error(`${label} saw an implicitly published store`);
      }
    }

    // Another account and a legacy global role see nothing, even with the brand id.
    for (const [label, userId] of [["other-account owner", OWNER_B], ["legacy global role", LEGACY_STAFF]]) {
      if ((await storesFor(userId, brandId)).length) {
        throw new Error(`${label} listed another account's brand stores`);
      }
    }

    // No combined/unknown/empty type is accepted, and nothing is created.
    for (const type of ["both", "physical_online", "hybrid", "PHYSICAL", ""]) {
      const response = await createStore(MEMBER_A, brandId, `Issue 12 API Invalid ${type}`, type);
      if (response.ok) throw new Error(`API accepted invalid store type "${type}"`);
    }

    // Forged parent, viewer and legacy global role are all denied.
    const forgedParent = await createStore(MEMBER_A, otherBrandId, "Issue 12 API Forged", "physical");
    if (forgedParent.ok) throw new Error("forged cross-account parent brand was accepted by the API");
    const forgedOwnerB = await createStore(OWNER_B, brandId, "Issue 12 API Owner B", "online");
    if (forgedOwnerB.ok) throw new Error("other-account owner created a store under a foreign brand");
    const viewerStore = await createStore(VIEWER_A, brandId, "Issue 12 API Viewer", "online");
    if (viewerStore.ok) throw new Error("read-only viewer created a store through the API");
    const globalStore = await createStore(LEGACY_STAFF, brandId, "Issue 12 API Global", "online");
    if (globalStore.ok) throw new Error("legacy global role created an account store through the API");

    // Direct Data API inserts obey the same type, publication and ownership rules.
    const direct = await directInsert(MEMBER_A, {
      brand_id: brandId, name: "Issue 12 API Direct Outlet", store_type: "physical",
    });
    if (!direct.ok) throw new Error(`direct valid insert was rejected (${direct.status})`);
    for (const [label, body] of [
      ["invalid type", { brand_id: brandId, name: "Issue 12 API Direct Hybrid", store_type: "hybrid" }],
      ["published", { brand_id: brandId, name: "Issue 12 API Direct Published", store_type: "online", is_published: true }],
      ["foreign brand", { brand_id: otherBrandId, name: "Issue 12 API Direct Foreign", store_type: "physical" }],
      ["foreign insert as other account", { brand_id: brandId, name: "Issue 12 API Direct Other", store_type: "physical" }],
    ]) {
      const actor = label === "foreign insert as other account" ? OWNER_B : MEMBER_A;
      const response = await directInsert(actor, body);
      if (response.ok) throw new Error(`direct insert accepted a ${label} row`);
    }

    // Creation manufactured no legacy connector, storefront, brand or Woo point.
    const countsAfter = (await client.query(`
      SELECT
        (SELECT count(*)::int FROM public.stores)       AS stores,
        (SELECT count(*)::int FROM public.storefronts)  AS storefronts,
        (SELECT count(*)::int FROM public.brands)       AS brands,
        (SELECT count(*)::int FROM public.selling_points WHERE type = 'woocommerce') AS woo_points
    `)).rows[0];
    if (countsAfter.stores !== countsBefore.stores
        || countsAfter.storefronts !== countsBefore.storefronts
        || countsAfter.brands !== countsBefore.brands
        || countsAfter.woo_points !== countsBefore.woo_points) {
      throw new Error("store creation implicitly created a legacy store, storefront, brand or Woo selling point");
    }

    // Exactly one audit event per successful RPC store (the two explicit
    // creation calls; the direct insert is a table write, not an RPC).
    const audit = (await client.query(
      `SELECT count(*)::int AS n FROM public.audit_log
       WHERE action = 'create_brand_store' AND details->>'brand_id' = $1`,
      [brandId],
    )).rows[0].n;
    if (audit !== 2) throw new Error(`brand store audit trail was not written once per RPC store (${audit})`);

    // Legacy operational data (Woo orders/products) stays readable and intact.
    const legacyReadable = (await client.query(`
      SELECT
        (SELECT count(*)::int FROM public.orders)   AS orders,
        (SELECT count(*)::int FROM public.products) AS products
    `)).rows[0];
    if (legacyReadable.orders === null || legacyReadable.products === null) {
      throw new Error("legacy operational tables became unreadable");
    }

    console.log("PASS  brand_store_boundaries_api (multi-create, invalid type, forged/viewer/global denial, no publish)");
    console.log("PASS  brand_store_direct_insert_api (type/publication/ownership parity, audit, legacy intact)");
  } finally {
    await client.query(`
      DELETE FROM public.brand_stores WHERE name LIKE 'Issue 12 API%';
      DELETE FROM public.audit_log
       WHERE action = 'create_brand_store' AND details->>'name' LIKE 'Issue 12 API%';
      DELETE FROM public.brands WHERE name IN ('${BRAND_NAME}', 'Issue 12 API Brand B');
      DELETE FROM public.audit_log
       WHERE action = 'create_brand' AND details->>'name' IN ('${BRAND_NAME}', 'Issue 12 API Brand B');
    `);
  }
}

async function runBusinessInvitationApiChecks(client, status) {
  const OWNER_A = FIXTURE_IDS[3];
  const UBA_ADMIN_A = FIXTURE_IDS[5];
  const MEMBER_A = FIXTURE_IDS[6];
  const VIEWER_A = FIXTURE_IDS[7];
  const OWNER_B = FIXTURE_IDS[8];
  const OUTSIDER = FIXTURE_IDS[9];

  // Fresh identities owned by this probe, so nothing depends on incidental
  // fixture membership left behind by earlier battery files:
  //   INVITEE     — completed personal registration/verification (a new person)
  //   OTHER_PERSON— a different, verified person
  //   UNVERIFIED  — has not confirmed an email address yet
  const INVITEE = "00000000-0000-0000-0000-000000000021";
  const OTHER_PERSON = "00000000-0000-0000-0000-000000000022";
  const UNVERIFIED = "00000000-0000-0000-0000-000000000023";
  const INVITEE_EMAIL = "issue13-invitee@dokanos.test";
  const OTHER_EMAIL = "issue13-other@dokanos.test";
  const UNVERIFIED_EMAIL = "issue13-unverified@dokanos.test";
  const IDENTITIES = [INVITEE, OTHER_PERSON, UNVERIFIED];
  const EMAILS = [INVITEE_EMAIL, OTHER_EMAIL, UNVERIFIED_EMAIL];

  const rpc = (userId, fn, body) => fetch(`${status.API_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: status.ANON_KEY,
      Authorization: `Bearer ${jwtFor(status, userId)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payloadOf = async (response) => (response.ok ? response.json() : null);
  const reasonOf = async (response) => {
    if (response.ok) return "";
    try {
      return `: ${(await response.json()).message ?? ""}`;
    } catch {
      return "";
    }
  };

  const invite = (actor, businessId, email) =>
    rpc(actor, "invite_business_member", { p_business_id: businessId, p_email: email });
  const accept = (actor, token) => rpc(actor, "accept_business_invitation", { p_token: token });
  const describe = (actor, token) => rpc(actor, "describe_business_invitation", { p_token: token });
  const listInvites = (actor, businessId) =>
    rpc(actor, "list_business_invitations", { p_business_id: businessId });
  const listMembers = (actor, businessId) =>
    rpc(actor, "list_business_members", { p_business_id: businessId });
  const removeMember = (actor, businessId, userId) =>
    rpc(actor, "remove_business_member", { p_business_id: businessId, p_user_id: userId });
  const revokeInvite = (actor, invitationId) =>
    rpc(actor, "revoke_business_invitation", { p_invitation_id: invitationId });

  try {
    // Personal identities exist independently of any business account.
    await client.query(`DELETE FROM public.business_invitations WHERE email = ANY($1)`, [EMAILS]);
    await client.query(`DELETE FROM auth.users WHERE id = ANY($1)`, [IDENTITIES]);
    await client.query(`
      INSERT INTO auth.users
        (id, aud, role, email, encrypted_password, email_confirmed_at,
         raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      VALUES
        ($1, 'authenticated', 'authenticated', $4,
         'local-fixture-password-never-used-for-login', now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
        ($2, 'authenticated', 'authenticated', $5,
         'local-fixture-password-never-used-for-login', now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
        ($3, 'authenticated', 'authenticated', $6,
         'local-fixture-password-never-used-for-login', NULL,
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now())
    `, [...IDENTITIES, ...EMAILS]);

    // ---- owner-only issuance, carrying the account context and the identity ----
    const issued = await invite(OWNER_A, BIZ_A, "  Issue13-Invitee@Dokanos.TEST ");
    const invitation = await payloadOf(issued);
    if (!issued.ok || invitation?.business_id !== BIZ_A || invitation?.email !== INVITEE_EMAIL
        || invitation?.role !== "member" || invitation?.status !== "pending"
        || invitation?.business_name !== "Biz A Fixture" || !invitation?.token) {
      throw new Error(`owner invitation failed or lost its account context `
        + `(${issued.status}${await reasonOf(issued)})`);
    }

    for (const [label, actor, businessId] of [
      ["account member", MEMBER_A, BIZ_A],
      ["read-only viewer", VIEWER_A, BIZ_A],
      ["account admin", UBA_ADMIN_A, BIZ_A],
      ["nonmember", OUTSIDER, BIZ_A],
      ["other-account owner", OWNER_B, BIZ_A],
      ["owner of another account", OWNER_A, B_OTHER],
    ]) {
      const response = await invite(actor, businessId, "issue13-denied@dokanos.test");
      if (response.ok) throw new Error(`the ${label} issued an account invitation through the API`);
    }

    // ---- the invitation ledger is not a client table ----
    const authHeaders = (userId, extra = {}) => ({
      apikey: status.ANON_KEY,
      Authorization: `Bearer ${jwtFor(status, userId)}`,
      ...extra,
    });
    const directRead = await fetch(`${status.API_URL}/rest/v1/business_invitations?select=token,email`, {
      headers: authHeaders(OWNER_A),
    });
    if (directRead.ok && (await directRead.json()).length) {
      throw new Error("the invitation ledger was readable through a direct Data API request");
    }
    const directInsert = await fetch(`${status.API_URL}/rest/v1/business_invitations`, {
      method: "POST",
      headers: authHeaders(OWNER_A, { "Content-Type": "application/json", Prefer: "return=representation" }),
      body: JSON.stringify({ business_id: BIZ_A, email: "issue13-direct@dokanos.test" }),
    });
    if (directInsert.ok) throw new Error("the invitation ledger accepted a direct client insert");
    const directUpdate = await fetch(
      `${status.API_URL}/rest/v1/business_invitations?email=eq.${INVITEE_EMAIL}`,
      {
        method: "PATCH",
        headers: authHeaders(OWNER_A, { "Content-Type": "application/json", Prefer: "return=representation" }),
        body: JSON.stringify({ expires_at: "2099-01-01T00:00:00Z" }),
      },
    );
    if (directUpdate.ok && (await directUpdate.json()).length) {
      throw new Error("the invitation ledger accepted a direct client update");
    }

    // ---- describe gives every arrival a clear, honest outcome ----
    const described = await payloadOf(await describe(INVITEE, invitation.token));
    if (described?.status !== "pending" || described?.email_matches !== true
        || described?.business_name !== "Biz A Fixture") {
      throw new Error("the intended identity did not see a pending matching invitation");
    }
    const describedWrong = await payloadOf(await describe(OTHER_PERSON, invitation.token));
    if (describedWrong?.status !== "pending" || describedWrong?.email_matches !== false) {
      throw new Error("a different identity was told the invitation matched their email");
    }
    const describedUnknown = await payloadOf(await describe(INVITEE, "issue13-unknown-token"));
    if (describedUnknown?.status !== "invalid" || describedUnknown?.email_matches !== false) {
      throw new Error("an unknown token was not reported as invalid");
    }

    // ---- acceptance is bound to the verified intended identity ----
    const wrongIdentity = await accept(OTHER_PERSON, invitation.token);
    if (wrongIdentity.ok) throw new Error("the wrong identity accepted an invitation through the API");
    const wrongMembership = (await client.query(
      `SELECT count(*)::int AS n FROM public.user_business_access
        WHERE user_id = $1 AND business_id = $2`, [OTHER_PERSON, BIZ_A],
    )).rows[0].n;
    if (wrongMembership !== 0) throw new Error("a refused wrong-email acceptance still created membership");
    const stillOpen = await payloadOf(await listInvites(OWNER_A, BIZ_A));
    if (!stillOpen.some((row) => row.email === INVITEE_EMAIL && row.status === "pending")) {
      throw new Error("a refused wrong-email attempt consumed the invitation");
    }

    // An unverified identity cannot accept, even with a valid matching token.
    const unverifiedInvite = await payloadOf(await invite(OWNER_A, BIZ_A, UNVERIFIED_EMAIL));
    if (!unverifiedInvite?.token) throw new Error("could not open the unverified identity's invitation");
    const unverifiedAccept = await accept(UNVERIFIED, unverifiedInvite.token);
    if (unverifiedAccept.ok) throw new Error("an unverified identity accepted an invitation through the API");

    const joined = await payloadOf(await accept(INVITEE, invitation.token));
    if (joined?.outcome !== "joined" || joined?.role !== "member" || joined?.business_id !== BIZ_A) {
      throw new Error("the intended identity did not join with account-wide member access");
    }
    const grant = (await client.query(`
      SELECT
        (SELECT count(*)::int FROM public.user_roles WHERE user_id = $1)        AS roles,
        (SELECT count(*)::int FROM public.user_store_access WHERE user_id = $1) AS stores,
        (SELECT count(*)::int FROM public.user_permissions WHERE user_id = $1)  AS perms,
        (SELECT count(*)::int FROM public.businesses WHERE email = $2)          AS accounts
    `, [INVITEE, INVITEE_EMAIL])).rows[0];
    if (grant.roles !== 0 || grant.stores !== 0 || grant.perms !== 0 || grant.accounts !== 0) {
      throw new Error("joining assigned a platform role, a granular grant or its own business account");
    }

    // Account-wide operational access: the new member can read the account's
    // brands and member directory and still cannot cross into another account.
    const brandsAsMember = await fetch(
      `${status.API_URL}/rest/v1/brands?select=id,business_id&business_id=eq.${BIZ_A}`,
      { headers: authHeaders(INVITEE) },
    );
    if (!brandsAsMember.ok) throw new Error("a new account member could not read the account's brands");
    const foreignBrands = await fetch(
      `${status.API_URL}/rest/v1/brands?select=id&business_id=eq.${B_OTHER}`,
      { headers: authHeaders(INVITEE) },
    );
    if (!foreignBrands.ok || (await foreignBrands.json()).length) {
      throw new Error("a new account member read another account's brands");
    }
    const membersAsMember = await payloadOf(await listMembers(INVITEE, BIZ_A));
    if (!Array.isArray(membersAsMember)
        || !membersAsMember.some((row) => row.user_id === INVITEE && row.role === "member")
        || membersAsMember.some((row) => "token" in row || "email_matches" in row)) {
      throw new Error("the member directory was unavailable, wrong or exposed invitation data");
    }

    // ---- acceptance is safely repeatable ----
    const repeated = await payloadOf(await accept(INVITEE, invitation.token));
    if (repeated?.outcome !== "already_member" || repeated?.role !== "member") {
      throw new Error("a repeated acceptance did not report the existing membership");
    }
    const membershipRows = (await client.query(
      `SELECT count(*)::int AS n FROM public.user_business_access
        WHERE user_id = $1 AND business_id = $2`, [INVITEE, BIZ_A],
    )).rows[0].n;
    if (membershipRows !== 1) throw new Error("a repeated acceptance duplicated the membership row");

    // ---- the invitation directory is owner-only ----
    const ownerDirectory = await payloadOf(await listInvites(OWNER_A, BIZ_A));
    if (!Array.isArray(ownerDirectory)
        || !ownerDirectory.some((row) => row.email === INVITEE_EMAIL && row.status === "accepted")) {
      throw new Error("the owner could not review the account's invitation ledger");
    }
    for (const [label, actor] of [
      ["account member", MEMBER_A],
      ["read-only viewer", VIEWER_A],
      ["account admin", UBA_ADMIN_A],
      ["nonmember", OUTSIDER],
      ["other-account owner", OWNER_B],
    ]) {
      const response = await listInvites(actor, BIZ_A);
      if (response.ok) throw new Error(`the ${label} listed the account's invitations through the API`);
    }

    // ---- only the owner withdraws an open invitation ----
    const revocable = await payloadOf(await invite(OWNER_A, BIZ_A, OTHER_EMAIL));
    if (!revocable?.id) throw new Error("could not open the invitation used for the revoke probe");
    for (const [label, actor] of [
      ["account member", MEMBER_A],
      ["account admin", UBA_ADMIN_A],
      ["other-account owner", OWNER_B],
    ]) {
      const response = await revokeInvite(actor, revocable.id);
      if (response.ok) throw new Error(`the ${label} revoked an account invitation through the API`);
    }
    const revoked = await payloadOf(await revokeInvite(OWNER_A, revocable.id));
    if (revoked?.revoked !== true || revoked?.status !== "revoked") {
      throw new Error("the owner could not withdraw an open invitation");
    }
    const revokedDescription = await payloadOf(await describe(OTHER_PERSON, revocable.token));
    if (revokedDescription?.status !== "revoked") {
      throw new Error("a withdrawn invitation was not reported as revoked");
    }
    const revokedAccept = await accept(OTHER_PERSON, revocable.token);
    if (revokedAccept.ok) throw new Error("a withdrawn invitation was accepted through the API");

    // ---- owner-only membership management; an owner is never removed ----
    for (const [label, actor, target] of [
      ["account member", MEMBER_A, VIEWER_A],
      ["read-only viewer", VIEWER_A, MEMBER_A],
      ["account admin", UBA_ADMIN_A, MEMBER_A],
      ["nonmember", OUTSIDER, MEMBER_A],
      ["other-account owner", OWNER_B, MEMBER_A],
    ]) {
      const response = await removeMember(actor, BIZ_A, target);
      if (response.ok) throw new Error(`the ${label} removed a member through the API`);
    }
    const removedCoOwner = await removeMember(OWNER_A, BIZ_A, FIXTURE_IDS[4]);
    if (removedCoOwner.ok) throw new Error("the owner removed a co-owner through ordinary member removal");
    const removedSelf = await removeMember(OWNER_A, BIZ_A, OWNER_A);
    if (removedSelf.ok) throw new Error("the owner removed themselves through ordinary member removal");
    const removedMissing = await removeMember(OWNER_A, BIZ_A, OUTSIDER);
    if (removedMissing.ok) throw new Error("removing a nonmember was reported as success");

    const removed = await payloadOf(await removeMember(OWNER_A, BIZ_A, INVITEE));
    if (removed?.removed !== true) throw new Error("the owner could not remove an ordinary member");
    // The removal immediately narrows the person's available account contexts.
    const afterRemoval = await listMembers(INVITEE, BIZ_A);
    if (afterRemoval.ok) throw new Error("a removed member still listed the account's members");
    const remaining = (await client.query(
      `SELECT count(*)::int AS n FROM public.user_business_access
        WHERE user_id = $1 AND business_id = $2`, [INVITEE, BIZ_A],
    )).rows[0].n;
    if (remaining !== 0) throw new Error("member removal left the membership row behind");
    const ownerRows = (await client.query(
      `SELECT count(*)::int AS n FROM public.user_business_access
        WHERE business_id = $1 AND role = 'owner'`, [BIZ_A],
    )).rows[0].n;
    if (ownerRows < 1) throw new Error("member management left the account without an owner");

    console.log("PASS  business_invitation_boundaries_api (owner-only issuance, no direct ledger access, describe)");
    console.log("PASS  business_invitation_acceptance_api (wrong email, unverified, join, repeat, revoke, refreshed contexts)");
  } finally {
    await client.query(`DELETE FROM public.business_invitations WHERE email = ANY($1)`, [EMAILS]);
    await client.query(
      `DELETE FROM public.audit_log
        WHERE action IN ('invite_business_member', 'accept_business_invitation',
                         'revoke_business_invitation', 'remove_business_member')
          AND details->>'business_id' IN ($1, $2)`,
      [BIZ_A, B_OTHER],
    );
    await client.query(`DELETE FROM auth.users WHERE id = ANY($1)`, [IDENTITIES]);
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
      try {
        await runBrandStoreApiChecks(client, status);
      } catch (e) {
        failures++;
        console.log(`FAIL  brand_store_boundaries_api: ${e.message}`);
      }
      try {
        await runBusinessInvitationApiChecks(client, status);
      } catch (e) {
        failures++;
        console.log(`FAIL  business_invitation_boundaries_api: ${e.message}`);
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
