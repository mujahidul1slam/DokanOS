import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

// Opt-in local integration test. Never use credentials from .env or a deployed DB.
test("personal signup, confirmation and recovery do not accept invitations or expose another account", {
  skip: process.env.RUN_LOCAL_AUTH_TESTS !== "1" && "Requires RUN_LOCAL_AUTH_TESTS=1 and a migrated local Supabase stack",
}, async () => {
  const config = JSON.parse(execFileSync("supabase", ["status", "--output", "json"], { encoding: "utf8" }));
  const url = new URL(config.API_URL);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "Refusing non-local Supabase");
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url.href, config.SERVICE_ROLE_KEY, options);
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
  const resourceCounts = async () => Promise.all(["businesses", "brands", "woo_stores", "storefronts"].map(async (table) => {
    const result = await admin.from(table).select("id", { head: true, count: "exact" });
    ok(result);
    return result.count;
  }));

  try {
    inviterId = ok(await admin.auth.admin.createUser({ email: `inviter-${suffix}@example.com`, password, email_confirm: true })).user.id;
    businessId = ok(await admin.from("businesses").insert({ name: "Preserved Account", slug: `fixture-${suffix}` }).select("id").single()).id;
    ok(await admin.from("user_business_access").insert({ user_id: inviterId, business_id: businessId, role: "owner" }));
    ok(await admin.from("invitations").insert({ email, role: "admin", invited_by: inviterId }));
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
    assert.deepEqual(ok(await admin.from("user_roles").select("role").eq("user_id", personId)), []);
    assert.deepEqual(ok(await admin.from("invitations").select("accepted_at").eq("email", email)), [{ accepted_at: null }]);
    assert.equal(ok(await person.from("profiles").select("full_name").eq("user_id", personId).single()).full_name, "Personal Fixture");

    const recovery = ok(await admin.auth.admin.generateLink({ type: "recovery", email }));
    ok(await person.auth.verifyOtp({ token_hash: recovery.properties.hashed_token, type: "recovery" }));
    ok(await person.auth.updateUser({ password: `${password}-recovered` }));
    ok(await person.auth.signOut());
    ok(await person.auth.signInWithPassword({ email, password: `${password}-recovered` }));
    assert.deepEqual(ok(await person.from("user_business_access").select("business_id")), []);
    assert.deepEqual(await resourceCounts(), before);
    assert.equal(ok(await admin.from("businesses").select("name").eq("id", businessId).single()).name, "Preserved Account");
  } finally {
    await person.auth.signOut();
    await admin.from("invitations").delete().eq("email", email);
    if (businessId) await admin.from("businesses").delete().eq("id", businessId);
    if (personId) await admin.auth.admin.deleteUser(personId);
    if (inviterId) await admin.auth.admin.deleteUser(inviterId);
  }
});
