import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

// Opt-in local integration test. Never use credentials from .env or a deployed DB.
test("personal signup, confirmation and recovery do not accept invitations or expose another account", {
  skip: process.env.RUN_LOCAL_AUTH_TESTS !== "1" && "Requires RUN_LOCAL_AUTH_TESTS=1 and a migrated local Supabase stack",
}, async () => {
  const config = JSON.parse(execSync("supabase status --output json", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  const url = new URL(config.API_URL);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "Refusing non-local Supabase");
  const dbUrl = new URL(config.DB_URL);
  assert.ok(["postgres:", "postgresql:"].includes(dbUrl.protocol) &&
    ["127.0.0.1", "localhost", "[::1]"].includes(dbUrl.hostname), "Refusing non-local database");
  // Privileged fixture setup/inspection is not application authorization. Do
  // not require new service_role Data API grants just to populate test data.
  const db = new pg.Client({ connectionString: config.DB_URL });
  await db.connect();
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url.href, config.SERVICE_ROLE_KEY, options);
  const owner = createClient(url.href, config.ANON_KEY, options);
  const person = createClient(url.href, config.ANON_KEY, options);
  const suffix = crypto.randomUUID();
  const email = `personal-${suffix}@example.com`;
  const password = `Personal-${suffix}!`;
  let inviterId;
  let personId;
  let businessId;
  const ok = (result) => {
    assert.ifError(result.error);
    return result.data;
  };
  const resourceCounts = async () => {
    const counts = [];
    for (const table of ["businesses", "brands", "stores", "storefronts"]) {
      const result = await db.query(`SELECT count(*)::integer AS count FROM public.${table}`);
      counts.push(result.rows[0].count);
    }
    return counts;
  };

  try {
    inviterId = ok(await admin.auth.admin.createUser({ email: `inviter-${suffix}@example.com`, password, email_confirm: true })).user.id;
    businessId = (await db.query("INSERT INTO public.businesses (name, slug) VALUES ($1, $2) RETURNING id", ["Preserved Account", `fixture-${suffix}`])).rows[0].id;
    await db.query("INSERT INTO public.user_business_access (user_id, business_id, role) VALUES ($1, $2, 'owner')", [inviterId, businessId]);
    await db.query("INSERT INTO public.invitations (email, role, invited_by) VALUES ($1, 'admin', $2)", [email, inviterId]);
    ok(await owner.auth.signInWithPassword({ email: `inviter-${suffix}@example.com`, password }));
    assert.equal(ok(await owner.from("businesses").select("id").eq("id", businessId).single()).id, businessId);
    assert.equal(ok(await owner.from("user_business_access").select("role").eq("business_id", businessId).single()).role, "owner");
    const before = await resourceCounts();

    personId = ok(await person.auth.signUp({ email, password, options: { data: { full_name: "Personal Fixture", signup_intent: "personal", role: "admin" } } })).user.id;
    const link = ok(await admin.auth.admin.generateLink({ type: "signup", email, password }));
    const token_hash = link.properties.hashed_token;
    ok(await person.auth.verifyOtp({ token_hash, type: "signup" }));
    const repeated = await person.auth.verifyOtp({ token_hash, type: "signup" });
    assert.ok(repeated.error, "Confirmation links must not be reusable");
    ok(await person.auth.signInWithPassword({ email, password }));

    assert.deepEqual(ok(await person.from("user_business_access").select("business_id")), []);
    assert.deepEqual(ok(await person.from("businesses").select("id")), []);
    assert.deepEqual(ok(await person.from("businesses").update({ name: "Unauthorized" }).eq("id", businessId).select("id")), []);
    assert.equal((await person.from("businesses").insert({ name: "Unauthorized", slug: `deny-${suffix}` })).error?.code, "42501");
    assert.equal((await person.from("user_business_access").insert({ user_id: personId, business_id: businessId, role: "owner" })).error?.code, "42501");
    assert.equal((await person.rpc("get_member_access", { p_user: inviterId, p_business: businessId })).error?.code, "42501");
    assert.equal((await person.rpc("set_member_business_role", { p_user: personId, p_business: businessId, p_role: "owner" })).error?.code, "42501");
    assert.deepEqual(ok(await person.from("user_business_access").delete().eq("user_id", inviterId).select("user_id")), []);
    assert.deepEqual((await db.query("SELECT role FROM public.user_roles WHERE user_id = $1", [personId])).rows, []);
    assert.deepEqual((await db.query("SELECT accepted_at FROM public.invitations WHERE email = $1", [email])).rows, [{ accepted_at: null }]);
    assert.equal(ok(await person.from("profiles").select("full_name").eq("user_id", personId).single()).full_name, "Personal Fixture");
    assert.deepEqual(ok(await person.from("profiles").select("user_id").eq("user_id", inviterId)), []);
    assert.equal((await person.from("profiles").insert({ user_id: inviterId, full_name: "Unauthorized" })).error?.code, "42501");
    assert.deepEqual(ok(await person.from("profiles").update({ full_name: "Unauthorized" }).eq("user_id", inviterId).select("user_id")), []);

    const recovery = ok(await admin.auth.admin.generateLink({ type: "recovery", email }));
    ok(await person.auth.verifyOtp({ token_hash: recovery.properties.hashed_token, type: "recovery" }));
    ok(await person.auth.updateUser({ password: `${password}-recovered` }));
    ok(await person.auth.signOut());
    ok(await person.auth.signInWithPassword({ email, password: `${password}-recovered` }));
    assert.deepEqual(ok(await person.from("user_business_access").select("business_id")), []);
    assert.deepEqual(await resourceCounts(), before);
    assert.equal((await db.query("SELECT name FROM public.businesses WHERE id = $1", [businessId])).rows[0].name, "Preserved Account");
  } finally {
    await person.auth.signOut();
    await owner.auth.signOut();
    try {
      await db.query("DELETE FROM public.invitations WHERE email = $1", [email]);
      if (businessId) await db.query("DELETE FROM public.businesses WHERE id = $1", [businessId]);
      if (personId) ok(await admin.auth.admin.deleteUser(personId));
      if (inviterId) ok(await admin.auth.admin.deleteUser(inviterId));
    } finally {
      await db.end();
    }
  }
});
