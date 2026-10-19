import { expect, test, type Page } from "@playwright/test";

/**
 * Issue #15 end-to-end rehearsal (real browser, integrated app).
 *
 * One owner journey and both invitation journeys, chained end to end:
 *   signup -> verification -> business account -> brand -> physical AND online
 *   store -> invitation for a NEW invitee (registration + verification, then an
 *   explicit acceptance) and for an EXISTING person.
 *
 * The SQL battery, the real-PostgREST probes and the opt-in real-backend
 * rehearsal (scripts/account-lifecycle-rehearsal.test.mjs) prove database
 * authorization; this spec proves the human behaviour and that the retired
 * automatic-provisioning path is never called.
 */

const API = "http://127.0.0.1:54321";

const baseUser = {
  aud: "authenticated",
  role: "authenticated",
  email_confirmed_at: "2026-10-19T00:00:00Z",
  created_at: "2026-10-19T00:00:00Z",
  updated_at: "2026-10-19T00:00:00Z",
  app_metadata: { provider: "email", providers: ["email"] },
};

const owner = { ...baseUser, id: "00000000-0000-0000-0000-000000000001", email: "owner@example.com", user_metadata: { full_name: "Owner Person" } };
const newInvitee = { ...baseUser, id: "00000000-0000-0000-0000-000000000021", email: "new-invitee@example.com", user_metadata: { full_name: "New Invitee" } };
const existingPerson = { ...baseUser, id: "00000000-0000-0000-0000-000000000022", email: "existing@example.com", user_metadata: { full_name: "Existing Person" } };

const business = {
  id: "11111111-0000-0000-0000-000000000001",
  name: "Rehearsal Account",
  slug: "rehearsal-account",
  currency: "BDT",
  timezone: "Asia/Dhaka",
  is_active: true,
  onboarding_completed_at: null,
};

type Membership = { role: string; business_id: string; businesses: typeof business };
type Write = { path: string; method: string; body: unknown };

type World = {
  user: typeof owner;
  memberships: Membership[];
  brands: Record<string, unknown>[];
  stores: Record<string, unknown>[];
  invitations: Record<string, unknown>[];
  describe?: unknown;
  accept?: unknown;
  acceptGrants?: boolean;
  writes: Write[];
  paths: string[];
};

async function installHarness(page: Page, world: World) {
  await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const body = (() => {
      try {
        return request.postDataJSON() as Record<string, unknown> | null;
      } catch {
        return null;
      }
    })();
    world.paths.push(url.pathname);
    if (["POST", "PATCH", "PUT", "DELETE"].includes(method)) world.writes.push({ path: url.pathname, method, body });

    if (url.pathname.endsWith("/auth/v1/signup")) {
      await route.fulfill({ json: { user: world.user, session: null } });
      return;
    }
    if (url.pathname.endsWith("/auth/v1/user")) {
      await route.fulfill({ json: world.user });
      return;
    }
    if (url.pathname.endsWith("/functions/v1/create-business")) {
      // The owner's own business creation is the only membership it grants.
      world.memberships = [{ role: "owner", business_id: business.id, businesses: business }];
      await route.fulfill({ json: { business_id: business.id } });
      return;
    }
    if (url.pathname.endsWith("/user_business_access")) {
      await route.fulfill({ json: [...world.memberships] });
      return;
    }
    if (url.pathname.endsWith("/rpc/get_user_permissions") || url.pathname.endsWith("/rpc/get_user_store_ids")) {
      await route.fulfill({ json: [] });
      return;
    }
    if (url.pathname.endsWith("/permission_settings")) {
      await route.fulfill({ json: { large_discount_percent: 10, large_discount_amount: null } });
      return;
    }
    if (url.pathname.endsWith("/brands") && method === "GET") {
      await route.fulfill({ json: [...world.brands] });
      return;
    }
    if (url.pathname.endsWith("/brand_stores") && method === "GET") {
      await route.fulfill({ json: [...world.stores] });
      return;
    }
    if (url.pathname.endsWith("/selling_points")) {
      await route.fulfill({ status: 200, headers: { "content-range": "*/0" }, json: [] });
      return;
    }
    if (url.pathname.endsWith("/rpc/create_business_brand")) {
      const brand = {
        id: `44444444-0000-0000-0000-${String(world.brands.length + 1).padStart(12, "0")}`,
        business_id: business.id,
        name: body?.p_name,
        slug: "rehearsal-brand",
        logo_url: null,
        woo_store_id: null,
        is_active: true,
      };
      world.brands.push(brand);
      await route.fulfill({ json: brand });
      return;
    }
    if (url.pathname.endsWith("/rpc/create_brand_store")) {
      const store = {
        id: `55555555-0000-0000-0000-${String(world.stores.length + 1).padStart(12, "0")}`,
        brand_id: body?.p_brand_id,
        name: body?.p_name,
        store_type: body?.p_store_type,
        is_published: false,
      };
      world.stores.push(store);
      await route.fulfill({ json: store });
      return;
    }
    if (url.pathname.endsWith("/rpc/invite_business_member")) {
      const invitation = {
        id: `22222222-0000-0000-0000-${String(world.invitations.length + 1).padStart(12, "0")}`,
        email: String(body?.p_email ?? "").toLowerCase(),
        role: "member",
        status: "pending",
        token: "rehearsal-invite-token",
        expires_at: "2026-11-02T00:00:00Z",
      };
      world.invitations.unshift(invitation);
      await route.fulfill({ json: { ...invitation, business_id: business.id, business_name: business.name } });
      return;
    }
    if (url.pathname.endsWith("/rpc/describe_business_invitation")) {
      await route.fulfill({ json: world.describe ?? { status: "pending", business_name: business.name, email_matches: true } });
      return;
    }
    if (url.pathname.endsWith("/rpc/accept_business_invitation")) {
      if (world.acceptGrants !== false) {
        world.memberships = [{ role: "member", business_id: business.id, businesses: business }];
      }
      await route.fulfill({
        json: world.accept ?? { outcome: "joined", business_id: business.id, business_name: business.name, role: "member" },
      });
      return;
    }
    if (url.pathname.endsWith("/rpc/list_business_members")) {
      await route.fulfill({ json: [{ user_id: world.user.id, email: world.user.email, full_name: "Rehearsal Person", role: "member", joined_at: "2026-10-19T01:00:00Z" }] });
      return;
    }
    if (url.pathname.endsWith("/rpc/list_business_invitations")) {
      await route.fulfill({ json: world.invitations });
      return;
    }
    if (url.pathname.endsWith("/app_config")) {
      await route.fulfill({ json: { value: true } });
      return;
    }
    await route.fulfill({ json: [] });
  });
}

async function signedIn(page: Page, user: typeof owner, businessId?: string) {
  await page.addInitScript(({ user, businessId }) => {
    localStorage.setItem("sb-127-auth-token", JSON.stringify({
      access_token: "browser-test-token",
      refresh_token: "browser-test-refresh",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      expires_in: 3600,
      token_type: "bearer",
      user,
    }));
    if (businessId) localStorage.setItem("dokanos-active-business-id", businessId);
  }, { user, businessId });
}

function world(): World {
  return { user: owner, memberships: [], brands: [], stores: [], invitations: [], writes: [], paths: [] };
}

test("an owner rehearses signup -> verification -> business -> brand -> physical and online stores without old-model provisioning", async ({ page }) => {
  const state = world();
  state.user = owner;
  await installHarness(page, state);

  // ---- personal signup: no business details, no forced provisioning ----
  await page.goto("/signup");
  await page.getByLabel("Your Name").fill("Owner Person");
  await expect(page.getByLabel("Business Name")).toHaveCount(0);
  await page.getByLabel("Email", { exact: true }).fill(owner.email);
  await page.getByLabel("Password", { exact: true }).fill("RehearsalPass123!");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create personal account" }).click();
  await expect(page).toHaveURL(/\/check-email\?email=/);
  expect(state.paths.some((path) => path.endsWith("/signup-provision"))).toBe(false);
  expect(state.paths.some((path) => path.endsWith("/signup-event"))).toBe(true);

  // ---- verification reaches account selection with no memberships ----
  await signedIn(page, owner);
  await page.goto("/auth/confirm");
  await expect(page).toHaveURL(/\/accounts$/);
  await expect(page.getByText("You don't belong to a business account yet.")).toBeVisible();

  // ---- create the business account: this alone creates no brand/store ----
  await page.getByRole("button", { name: "Create a business account", exact: true }).click();
  await page.getByLabel("Business Name", { exact: true }).fill(business.name);
  await page.getByRole("button", { name: "Create Business", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(state.memberships.map((row) => row.role)).toEqual(["owner"]);
  expect(state.writes.some((write) => /\/rest\/v1\/(brands|stores|storefronts)$/.test(write.path))).toBe(false);

  // ---- a brand under the account ----
  await page.goto("/brands");
  await page.getByRole("button", { name: "New Brand" }).click();
  await page.getByLabel("Brand name").fill("Rehearsal Brand");
  await page.getByRole("button", { name: "Create brand" }).click();
  await expect(page.getByText("Rehearsal Brand", { exact: true })).toBeVisible();
  expect(state.brands).toHaveLength(1);
  expect(state.brands[0].woo_store_id).toBeNull();

  // ---- a physical and an online store under that brand ----
  await page.goto("/stores");
  await expect(page.getByText("Rehearsal Brand", { exact: true })).toBeVisible();
  for (const [name, type] of [["Rehearsal Outlet", "Physical store"], ["Rehearsal Online", "Online store"]] as const) {
    await page.getByRole("button", { name: "New Store", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Store name").fill(name);
    await dialog.getByLabel("Parent brand").selectOption({ label: "Rehearsal Brand" });
    await dialog.getByLabel(type).check();
    await dialog.getByRole("button", { name: "Create store" }).click();
    await expect(dialog).toHaveCount(0);
  }
  expect(state.stores.map((store) => store.store_type).sort()).toEqual(["online", "physical"]);
  expect(state.stores.every((store) => store.is_published === false)).toBe(true);

  // No business, brand, store, storefront or platform role was auto-provisioned.
  expect(state.paths.some((path) => path.endsWith("/signup-provision"))).toBe(false);
  expect(state.writes.some((write) => write.path.endsWith("/provision_owner_business"))).toBe(false);
});

test("a brand-new invitee registers, verifies, and only then explicitly accepts the invitation", async ({ page }) => {
  const state = world();
  state.user = newInvitee;
  await installHarness(page, state);

  await page.goto("/signup?invite=rehearsal-invite-token");
  await page.getByLabel("Your Name").fill("New Invitee");
  await page.getByLabel("Email", { exact: true }).fill(newInvitee.email);
  await page.getByLabel("Password", { exact: true }).fill("RehearsalPass123!");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create personal account" }).click();
  await expect(page).toHaveURL(/\/check-email\?.*invite=rehearsal-invite-token/);

  // A fresh-device confirmation keeps the invitation intent but does not accept it.
  await signedIn(page, newInvitee);
  await page.goto("/auth/confirm?invite=rehearsal-invite-token");
  await expect(page).toHaveURL(/\/accounts\?invite=rehearsal-invite-token$/);
  await expect(page.getByText("Your invitation is saved. Verification does not accept it or grant access.")).toBeVisible();
  await expect(page.getByText("You're invited to join Rehearsal Account.")).toBeVisible();
  expect(state.paths.some((path) => path.endsWith("/rpc/accept_business_invitation"))).toBe(false);

  // The explicit acceptance is the only step that grants membership.
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page.getByText(/You've joined the business account/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Rehearsal Account", exact: true })).toBeVisible();
  expect(state.memberships).toEqual([{ role: "member", business_id: business.id, businesses: business }]);
  expect(state.paths.some((path) => path.endsWith("/signup-provision"))).toBe(false);
  expect(state.writes.some((write) => write.path.endsWith("/rest/v1/user_roles"))).toBe(false);
});

test("an existing person accepts the invitation and is a member without any owner controls", async ({ page }) => {
  const state = world();
  state.user = existingPerson;
  await installHarness(page, state);
  await signedIn(page, existingPerson);

  await page.goto("/accounts?invite=rehearsal-invite-token");
  await expect(page.getByText("You're invited to join Rehearsal Account.")).toBeVisible();
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page.getByText(/You've joined the business account/)).toBeVisible();
  expect(state.memberships).toEqual([{ role: "member", business_id: business.id, businesses: business }]);

  // An ordinary member sees the directory but no invitation or removal controls.
  await page.goto("/members");
  await expect(page.getByRole("heading", { name: "Members", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send invitation" })).toHaveCount(0);
  expect(state.writes.some((write) => write.path.endsWith("/rpc/invite_business_member"))).toBe(false);
});
