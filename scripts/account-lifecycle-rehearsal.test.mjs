import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

/**
 * Issue #15 release rehearsal (opt-in, real backend).
 *
 * Walks the complete integrated journey against a disposable LOCAL Supabase
 * stack — real GoTrue signup/confirmation, real PostgREST/RLS, real PostgreSQL:
 *
 *   personal signup -> email verification -> create business account -> brand
 *   -> physical store + online store -> invitation for a NEW invitee (their own
 *   registration + verification, then acceptance) -> invitation for an EXISTING
 *   person -> account switching, owner/member restrictions and direct API/RLS
 *   account isolation, with legacy operational data still readable.
 *
 * It never discovers application credentials and refuses any non-local URL.
 * Enable with RUN_LOCAL_REHEARSAL=1 after `supabase db reset`.
 */
test("complete account-to-store and invitation rehearsal on the integrated implementation", {
  skip: process.env.RUN_LOCAL_REHEARSAL !== "1" && "Requires RUN_LOCAL_REHEARSAL=1 and a migrated local Supabase stack",
}, async () => {
  const config = JSON.parse(execSync("supabase status --output json", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  const url = new URL(config.API_URL);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "Refusing non-local Supabase");
  const dbUrl = new URL(config.DB_URL);
  assert.ok(["postgres:", "postgresql:"].includes(dbUrl.protocol)
    && ["127.0.0.1", "localhost", "[::1]"].includes(dbUrl.hostname), "Refusing non-local database");

  const db = new pg.Client({ connectionString: config.DB_URL });
  await db.connect();
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url.href, config.SERVICE_ROLE_KEY, options);
  const owner = createClient(url.href, config.ANON_KEY, options);
  const newInvitee = createClient(url.href, config.ANON_KEY, options);
  const existingPerson = createClient(url.href, config.ANON_KEY, options);

  const suffix = crypto.randomUUID();
  const password = `Rehearsal-${suffix}!`;
  const ownerEmail = `rehearsal-owner-${suffix}@example.com`;
  const newInviteeEmail = `rehearsal-new-invitee-${suffix}@example.com`;
  const existingEmail = `rehearsal-existing-${suffix}@example.com`;
  const createdUsers = [];
  const createdBusinesses = [];
  const ok = (result) => {
    assert.ifError(result.error);
    return result.data;
  };
  const count = async (sql, params = []) => Number((await db.query(sql, params)).rows[0].count);

  try {
    // ---- personal registration (no business provisioning at signup) ----
    const ownerId = ok(await admin.auth.admin.createUser({ email: ownerEmail, password, email_confirm: true })).user.id;
    createdUsers.push(ownerId);
    const existingId = ok(await admin.auth.admin.createUser({ email: existingEmail, password, email_confirm: true })).user.id;
    createdUsers.push(existingId);
    ok(await owner.auth.signInWithPassword({ email: ownerEmail, password }));
    assert.deepEqual(await owner.from("user_business_access").select("business_id").then(ok), []);

    const beforeBusinesses = await count("SELECT count(*)::int AS count FROM public.businesses");
    const beforeStores = await count("SELECT count(*)::int AS count FROM public.stores");
    const beforeStorefronts = await count("SELECT count(*)::int AS count FROM public.storefronts");

    // ---- business account, brand, physical + online store ----
    const created = await admin.rpc("create_additional_business", { p_user_id: ownerId, p_business_name: `Rehearsal ${suffix}` }).then(ok);
    const businessId = created.business_id;
    createdBusinesses.push(businessId);
    assert.equal(await count("SELECT count(*)::int AS count FROM public.businesses"), beforeBusinesses + 1);
    // The first business is blank-slate: exactly one owner membership, no store.
    assert.equal(await count("SELECT count(*)::int AS count FROM public.user_business_access WHERE business_id = $1 AND role = 'owner'", [businessId]), 1);
    assert.equal(await count("SELECT count(*)::int AS count FROM public.stores"), beforeStores, "business creation must not auto-provision a legacy store");
    assert.equal(await count("SELECT count(*)::int AS count FROM public.storefronts"), beforeStorefronts, "business creation must not auto-provision a storefront");

    const brand = await owner.rpc("create_business_brand", { p_business_id: businessId, p_name: "Rehearsal Brand" }).then(ok);
    const brandId = Array.isArray(brand) ? brand[0].id : brand.id;
    assert.ok(brandId);

    const physical = await owner.rpc("create_brand_store", { p_brand_id: brandId, p_name: "Rehearsal Outlet", p_store_type: "physical" }).then(ok);
    const online = await owner.rpc("create_brand_store", { p_brand_id: brandId, p_name: "Rehearsal Online", p_store_type: "online" }).then(ok);
    const physicalStore = Array.isArray(physical) ? physical[0] : physical;
    const onlineStore = Array.isArray(online) ? online[0] : online;
    assert.equal(physicalStore.store_type, "physical");
    assert.equal(onlineStore.store_type, "online");
    assert.equal(physicalStore.is_published, false);
    assert.equal(onlineStore.is_published, false);
    assert.equal(await count("SELECT count(*)::int AS count FROM public.brand_stores WHERE brand_id = $1", [brandId]), 2);

    // ---- invitation for a NEW invitee: registration + verification, then acceptance ----
    const newInvitation = await owner.rpc("invite_business_member", { p_business_id: businessId, p_email: `  ${newInviteeEmail.toUpperCase()} ` }).then(ok);
    assert.equal(newInvitation.email, newInviteeEmail, "invitation normalizes the intended email");
    assert.equal(newInvitation.business_id, businessId);

    const newInviteeId = ok(await newInvitee.auth.signUp({
      email: newInviteeEmail, password,
      options: { data: { full_name: "New Invitee", signup_intent: "personal" } },
    })).user.id;
    createdUsers.push(newInviteeId);
    const signupLink = ok(await admin.auth.admin.generateLink({ type: "signup", email: newInviteeEmail, password }));
    ok(await newInvitee.auth.verifyOtp({ token_hash: signupLink.properties.hashed_token, type: "signup" }));
    ok(await newInvitee.auth.signInWithPassword({ email: newInviteeEmail, password }));
    // Verification alone never accepts the invitation.
    assert.deepEqual(await newInvitee.from("user_business_access").select("business_id").then(ok), []);
    const joined = await newInvitee.rpc("accept_business_invitation", { p_token: newInvitation.token }).then(ok);
    assert.equal(joined.outcome, "joined");
    assert.equal(joined.role, "member");
    assert.equal(joined.business_id, businessId);
    assert.equal(await count("SELECT count(*)::int AS count FROM public.user_business_access WHERE user_id = $1", [newInviteeId]), 1);
    assert.equal(await count("SELECT count(*)::int AS count FROM public.user_roles WHERE user_id = $1", [newInviteeId]), 0, "joining creates no platform role");
    assert.equal(await count("SELECT count(*)::int AS count FROM public.user_permissions WHERE user_id = $1", [newInviteeId]), 0, "joining creates no granular grant");

    // ---- invitation for an EXISTING person ----
    const existingInvitation = await owner.rpc("invite_business_member", { p_business_id: businessId, p_email: existingEmail }).then(ok);
    ok(await existingPerson.auth.signInWithPassword({ email: existingEmail, password }));
    const existingJoined = await existingPerson.rpc("accept_business_invitation", { p_token: existingInvitation.token }).then(ok);
    assert.equal(existingJoined.outcome, "joined");
    assert.equal(existingJoined.role, "member");

    // ---- a separate account the invitee never joins, for isolation probes ----
    const foreign = await admin.rpc("create_additional_business", { p_user_id: existingId, p_business_name: `Foreign ${suffix}` }).then(ok);
    createdBusinesses.push(foreign.business_id);
    const foreignBrand = await existingPerson.rpc("create_business_brand", { p_business_id: foreign.business_id, p_name: "Foreign Brand" }).then(ok);
    const foreignBrandId = Array.isArray(foreignBrand) ? foreignBrand[0].id : foreignBrand.id;

    // ---- account switching: the invitee also owns their own account ----
    const second = await admin.rpc("create_additional_business", { p_user_id: newInviteeId, p_business_name: `Invitee Own ${suffix}` }).then(ok);
    createdBusinesses.push(second.business_id);
    const memberships = await newInvitee.from("user_business_access").select("business_id, role").then(ok);
    assert.deepEqual(memberships.map((row) => row.business_id).sort(), [businessId, second.business_id].sort());
    assert.equal(memberships.find((row) => row.business_id === businessId).role, "member");
    assert.equal(memberships.find((row) => row.business_id === second.business_id).role, "owner");

    // ---- owner/member restrictions (server authority) ----
    assert.ok((await newInvitee.rpc("invite_business_member", { p_business_id: businessId, p_email: `deny-${suffix}@example.com` })).error, "a member must not invite");
    assert.ok((await newInvitee.rpc("transfer_business_ownership", { p_business_id: businessId, p_new_owner_id: newInviteeId })).error, "a member must not transfer ownership");
    assert.ok((await newInvitee.rpc("remove_business_member", { p_business_id: businessId, p_user_id: ownerId })).error, "a member must not remove the owner");

    // ---- direct API/RLS account isolation ----
    const ownBrands = await newInvitee.from("brands").select("id").eq("business_id", businessId).then(ok);
    assert.equal(ownBrands.length, 1, "a member reads the active account's brands");
    const foreignBrands = await newInvitee.from("brands").select("id").eq("business_id", foreign.business_id).then(ok);
    assert.deepEqual(foreignBrands, [], "a member must not read another account's brands");
    const forgedInsert = await newInvitee.from("brand_stores").insert({ brand_id: foreignBrandId, name: "Forged", store_type: "physical" });
    assert.ok(forgedInsert.error, "a non-member must not insert a store under a foreign brand");
    const forgedStore = await newInvitee.rpc("create_brand_store", { p_brand_id: foreignBrandId, p_name: "Forged", p_store_type: "physical" });
    assert.ok(forgedStore.error, "a non-member must not create a store in an account they do not operate");

    // ---- operational compatibility: legacy history stays readable and scoped ----
    const legacyReadable = await owner.from("orders").select("id").limit(1);
    assert.ifError(legacyReadable.error);
    assert.equal(await count("SELECT count(*)::int AS count FROM public.businesses WHERE id = ANY($1)", [createdBusinesses]), createdBusinesses.length);
    console.log(`PASS  account lifecycle rehearsal: signup -> business -> brand -> physical/online stores -> new + existing invitations -> switching/isolation`);
  } finally {
    try {
      await db.query("DELETE FROM public.audit_log WHERE details->>'business_id' = ANY($1)", [createdBusinesses.filter(Boolean)]);
      await db.query("DELETE FROM public.business_invitations WHERE email = ANY($1)", [[newInviteeEmail, existingEmail]]);
      if (createdBusinesses.length) await db.query("DELETE FROM public.businesses WHERE id = ANY($1)", [createdBusinesses.filter(Boolean)]);
      for (const id of createdUsers) await admin.auth.admin.deleteUser(id);
    } finally {
      await db.end();
    }
  }
});
