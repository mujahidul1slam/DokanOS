import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

// Opt-in real local Auth + PostgREST probe for issue #14. Never discovers
// application env files or a deployed project; it only talks to the local
// Supabase stack that `supabase status` reports.
test("ownership transfer and owner departure use real authenticated PostgREST authority", {
  skip: process.env.RUN_LOCAL_AUTH_TESTS !== "1" && "Requires RUN_LOCAL_AUTH_TESTS=1 and a migrated local Supabase stack",
}, async () => {
  const config = JSON.parse(execSync("supabase status --output json", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  const url = new URL(config.API_URL);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "Refusing non-local Supabase");
  const dbUrl = new URL(config.DB_URL);
  assert.ok(["postgres:", "postgresql:"].includes(dbUrl.protocol) &&
    ["127.0.0.1", "localhost", "[::1]"].includes(dbUrl.hostname), "Refusing non-local database");

  const db = new pg.Client({ connectionString: config.DB_URL });
  await db.connect();
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url.href, config.SERVICE_ROLE_KEY, options);
  const suffix = crypto.randomUUID();
  const password = `Ownership-${suffix}!`;
  let businessId;
  let otherBusinessId;
  const userIds = [];

  const client = () => createClient(url.href, config.ANON_KEY, options);
  const owner = client();
  const coOwner = client();
  const member = client();
  const member2 = client();
  const outsider = client();
  const ok = (result) => {
    assert.ifError(result.error);
    return result.data;
  };
  const denied = (result) => {
    assert.ok(result.error, "operation unexpectedly succeeded");
    return result.error;
  };
  const roleOf = async (userId, id = businessId) => (await db.query(
    "SELECT role FROM public.user_business_access WHERE user_id = $1 AND business_id = $2",
    [userId, id],
  )).rows[0]?.role ?? null;
  const ownerCount = async (id = businessId) => (await db.query(
    "SELECT count(*)::integer AS n FROM public.user_business_access WHERE business_id = $1 AND role = 'owner'",
    [id],
  )).rows[0].n;
  const resetRoles = async () => {
    await db.query("DELETE FROM public.user_business_access WHERE business_id = $1", [businessId]);
    await db.query(
      `INSERT INTO public.user_business_access (user_id, business_id, role) VALUES
         ($1, $5, 'owner'), ($2, $5, 'owner'), ($3, $5, 'member'), ($4, $5, 'member')`,
      [userIds[0], userIds[1], userIds[2], userIds[3], businessId],
    );
  };

  try {
    const createPerson = async (label) => {
      const email = `${label}-${suffix}@example.com`;
      const { user } = ok(await admin.auth.admin.createUser({ email, password, email_confirm: true }));
      userIds.push(user.id);
      const person = [owner, coOwner, member, member2, outsider][userIds.length - 1];
      ok(await person.auth.signInWithPassword({ email, password }));
      return user.id;
    };
    await createPerson("owner");
    await createPerson("co-owner");
    await createPerson("member");
    await createPerson("member2");
    await createPerson("outsider");

    businessId = (await db.query(
      "INSERT INTO public.businesses (name, slug) VALUES ($1, $2) RETURNING id",
      ["Issue 14 Real Auth Account", `issue-14-real-${suffix}`],
    )).rows[0].id;
    otherBusinessId = (await db.query(
      "INSERT INTO public.businesses (name, slug) VALUES ($1, $2) RETURNING id",
      ["Issue 14 Real Auth Other", `issue-14-real-other-${suffix}`],
    )).rows[0].id;
    await db.query(
      `INSERT INTO public.user_business_access (user_id, business_id, role) VALUES
         ($1, $6, 'owner'), ($2, $6, 'owner'), ($3, $6, 'member'), ($4, $6, 'member'),
         ($5, $7, 'owner')`,
      [userIds[0], userIds[1], userIds[2], userIds[3], userIds[4], businessId, otherBusinessId],
    );

    // ---- the caller must be a current owner ----
    denied(await member.rpc("transfer_business_ownership", {
      p_business_id: businessId, p_new_owner_id: userIds[1],
    }));
    denied(await member2.rpc("transfer_business_ownership", {
      p_business_id: businessId, p_new_owner_id: userIds[1],
    }));
    denied(await outsider.rpc("transfer_business_ownership", {
      p_business_id: businessId, p_new_owner_id: userIds[1],
    }));
    denied(await member.rpc("set_member_business_role", {
      p_user: userIds[0], p_business: businessId, p_role: "viewer",
    }));
    assert.equal(await roleOf(userIds[0]), "owner");
    assert.equal(await roleOf(userIds[1]), "owner");

    // ---- the target must be an existing member of THIS account ----
    denied(await owner.rpc("transfer_business_ownership", {
      p_business_id: businessId, p_new_owner_id: userIds[4],
    }));
    denied(await owner.rpc("transfer_business_ownership", {
      p_business_id: businessId, p_new_owner_id: "00000000-0000-0000-0000-000000000099",
    }));
    denied(await owner.rpc("transfer_business_ownership", {
      p_business_id: businessId, p_new_owner_id: userIds[0],
    }));
    assert.equal(await ownerCount(), 2);

    // ---- owner transfers to an existing same-account member ----
    const transfer = ok(await owner.rpc("transfer_business_ownership", {
      p_business_id: businessId, p_new_owner_id: userIds[2],
    }));
    assert.equal(transfer.transferred, true);
    assert.equal(transfer.previous_owner_id, userIds[0]);
    assert.equal(transfer.new_owner_id, userIds[2]);
    assert.equal(await roleOf(userIds[2]), "owner");
    assert.equal(await roleOf(userIds[0]), "member");
    assert.equal(await roleOf(userIds[1]), "owner", "reviewed legacy co-owner must survive");
    assert.equal(await roleOf(userIds[3]), "member");
    assert.ok(await ownerCount() >= 1);

    // Repeated transfer and repeated departure remain safe.
    denied(await owner.rpc("transfer_business_ownership", {
      p_business_id: businessId, p_new_owner_id: userIds[3],
    }));
    ok(await owner.rpc("leave_business_account", { p_business_id: businessId }));
    assert.equal(await roleOf(userIds[0]), null);
    denied(await owner.rpc("leave_business_account", { p_business_id: businessId }));
    assert.ok(await ownerCount() >= 1);

    // ---- owner departure is blocked until ownership is transferred ----
    await resetRoles();
    const blockedOwner = denied(await owner.rpc("leave_business_account", { p_business_id: businessId }));
    assert.match(blockedOwner.message, /OWNER_TRANSFER_REQUIRED/);
    const blockedCoOwner = denied(await coOwner.rpc("leave_business_account", { p_business_id: businessId }));
    assert.match(blockedCoOwner.message, /OWNER_TRANSFER_REQUIRED/);
    assert.equal(await roleOf(userIds[0]), "owner");
    assert.equal(await roleOf(userIds[1]), "owner");

    // ---- competing transfers cannot both win or leave the account ownerless ----
    await resetRoles();
    const competing = await Promise.all([
      owner.rpc("transfer_business_ownership", { p_business_id: businessId, p_new_owner_id: userIds[2] }),
      owner.rpc("transfer_business_ownership", { p_business_id: businessId, p_new_owner_id: userIds[3] }),
    ]);
    assert.equal(competing.filter((result) => !result.error).length, 1);
    assert.equal(await roleOf(userIds[0]), "member");
    const winners = [await roleOf(userIds[2]), await roleOf(userIds[3])].filter((role) => role === "owner");
    assert.equal(winners.length, 1);
    assert.ok(await ownerCount() >= 1);

    // ---- a concurrent transfer and owner departure serialize safely ----
    await resetRoles();
    const [transferRace, leaveRace] = await Promise.all([
      owner.rpc("transfer_business_ownership", { p_business_id: businessId, p_new_owner_id: userIds[2] }),
      owner.rpc("leave_business_account", { p_business_id: businessId }),
    ]);
    assert.ifError(transferRace.error);
    if (!leaveRace.error) assert.equal(await roleOf(userIds[0]), null);
    else assert.equal(await roleOf(userIds[0]), "member");
    assert.equal(await roleOf(userIds[2]), "owner");
    assert.ok(await ownerCount() >= 1);

    // ---- ordinary members can leave concurrently; owners stay untouched ----
    await resetRoles();
    const leaves = await Promise.all([
      member.rpc("leave_business_account", { p_business_id: businessId }),
      member2.rpc("leave_business_account", { p_business_id: businessId }),
    ]);
    leaves.forEach((result) => assert.ifError(result.error));
    assert.equal(await roleOf(userIds[2]), null);
    assert.equal(await roleOf(userIds[3]), null);
    assert.equal(await roleOf(userIds[0]), "owner");
    assert.equal(await roleOf(userIds[1]), "owner");

    // No ownership operation manufactured a platform role or another account.
    const grantCounts = (await db.query(
      `SELECT
         (SELECT count(*)::integer FROM public.user_roles WHERE user_id = ANY($1)) AS roles,
         (SELECT count(*)::integer FROM public.businesses WHERE id = ANY($2)) AS accounts`,
      [userIds, [businessId, otherBusinessId]],
    )).rows[0];
    assert.equal(grantCounts.roles, 0);
    assert.equal(grantCounts.accounts, 2);
  } finally {
    await Promise.all([owner, coOwner, member, member2, outsider].map((person) => person.auth.signOut()));
    await db.query("DELETE FROM public.businesses WHERE id = ANY($1)", [[businessId, otherBusinessId].filter(Boolean)]);
    for (const id of userIds) {
      try { ok(await admin.auth.admin.deleteUser(id)); } catch { /* best-effort cleanup */ }
    }
    await db.end();
  }
});
