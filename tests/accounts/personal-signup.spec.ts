import { expect, test, type Page } from "@playwright/test";

const user = {
  id: "00000000-0000-0000-0000-000000000099",
  aud: "authenticated",
  role: "authenticated",
  email: "person@example.com",
  email_confirmed_at: "2026-10-19T00:00:00Z",
  created_at: "2026-10-19T00:00:00Z",
  updated_at: "2026-10-19T00:00:00Z",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: { full_name: "Sarah Jenkins" },
};

async function api(page: Page, memberships: unknown[] = []) {
  const requests: { path: string; url: string; method: string; body: {
    data?: Record<string, unknown>;
    meta?: Record<string, unknown>;
    password?: string;
  } | null }[] = [];
  await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const body = request.postDataJSON();
    requests.push({ path: url.pathname, url: url.href, method: request.method(), body });
    let data: unknown = [];
    if (url.pathname.endsWith("/app_config")) data = { value: true };
    if (url.pathname.endsWith("/user_business_access")) data = memberships;
    if (url.pathname.endsWith("/signup")) data = { user, session: null };
    if (url.pathname.endsWith("/user")) data = user;
    if (url.pathname.includes("/functions/")) data = { status: "ok" };
    await route.fulfill({ json: data });
  });
  return requests;
}

async function signedIn(page: Page) {
  await page.addInitScript(({ user }) => {
    localStorage.setItem("sb-127-auth-token", JSON.stringify({
      access_token: "browser-test-token",
      refresh_token: "browser-test-refresh",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      expires_in: 3600,
      token_type: "bearer",
      user,
    }));
  }, { user });
}

test("a person signs up with no business details or business-provisioning state", async ({ page }) => {
  const requests = await api(page);
  await page.goto("/signup");
  await page.getByLabel("Your Name").fill("Sarah Jenkins");
  await expect(page.getByLabel("Business Name")).toHaveCount(0);
  await page.getByLabel("Email", { exact: true }).fill("person@example.com");
  await page.getByLabel("Password", { exact: true }).fill("PersonalPass123!");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create personal account" }).click();
  await expect(page).toHaveURL(/\/check-email\?email=/);
  const signup = requests.find((r) => r.path === "/auth/v1/signup");
  expect(signup?.body?.data).toEqual({ full_name: "Sarah Jenkins", signup_intent: "personal" });
  const event = requests.find((r) => r.path.endsWith("/signup-event"));
  expect(event?.body?.meta).toEqual({ signup_intent: "personal", consent: true });
  expect(requests.some((r) => r.path.endsWith("/signup-provision"))).toBe(false);
});

for (const type of ["signup", "recovery"]) test(`a ${type} URL establishes a fresh session without provisioning`, async ({ page }) => {
  const requests = await api(page);
  const token = [
    { alg: "HS256", typ: "JWT" },
    { sub: user.id, aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 },
  ].map((part) => Buffer.from(JSON.stringify(part)).toString("base64url")).join(".") + ".test-signature";
  await page.goto(`/auth/confirm?invite=fresh-device#access_token=${token}&refresh_token=test-refresh&expires_in=3600&token_type=bearer&type=${type}`);
  await expect(page).toHaveURL(type === "recovery" ? /\/reset-password\?invite=fresh-device$/ : /\/accounts\?invite=fresh-device$/);
  const result = type === "recovery" ? page.getByLabel("New Password", { exact: true }) : page.getByText("You don't belong to a business account yet.");
  await expect(result).toBeVisible();
  await page.reload();
  await expect(result).toBeVisible();
  expect(requests.some((r) => /signup-provision|create-business|accept.*invit/.test(r.path))).toBe(false);
});

test("a recovery callback lets a person without memberships reset their password", async ({ page }) => {
  const requests = await api(page);
  await signedIn(page);
  await page.goto("/auth/confirm?type=recovery&invite=recovery-invitation");
  await expect(page).toHaveURL(/\/reset-password\?invite=recovery-invitation$/);
  await page.reload();
  await page.getByLabel("New Password", { exact: true }).fill("NewPersonalPass123!");
  await page.getByLabel("Confirm Password").fill("NewPersonalPass123!");
  await page.getByRole("button", { name: "Update Password" }).click();
  await expect(page).toHaveURL(/\/accounts\?invite=recovery-invitation$/);
  expect(requests.find((r) => r.path === "/auth/v1/user" && r.method === "PUT")?.body).toMatchObject({ password: "NewPersonalPass123!" });
  expect(requests.some((r) => /signup-provision|create-business|accept.*invit/.test(r.path))).toBe(false);
});

test("existing members select their authorized account and the retired wizard redirects", async ({ page }) => {
  const business = {
    id: "11111111-0000-0000-0000-000000000001",
    name: "Existing Account",
    slug: "existing-account",
    currency: "BDT",
    timezone: "Asia/Dhaka",
    is_active: true,
  };
  await api(page, [{ role: "owner", business_id: business.id, businesses: business }]);
  await signedIn(page);
  await page.addInitScript(() => {
    localStorage.setItem("dokanos-active-business-id", "not-a-membership");
    localStorage.setItem("dokanos_signup_nonce", "stale-provisioning-nonce");
    localStorage.setItem("dokanos_signup_business_name", "Do Not Create");
  });
  await page.goto("/auth/confirm");
  await page.getByRole("button", { name: "Existing Account", exact: true }).click();
  // Selecting an account must not force onboarding: an account with no store
  // is a valid app destination. Setup stays available on explicit navigation.
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

test("explicitly creating another business switches setup to that business, not the old one", async ({ page }) => {
  const original = { id: "11111111-0000-0000-0000-000000000001", name: "Original Account", slug: "original", is_active: true };
  const created = { id: "11111111-0000-0000-0000-000000000002", name: "New Account", slug: "new", is_active: true };
  const memberships = [{ role: "owner", business_id: original.id, businesses: original }];
  await api(page, memberships);
  await signedIn(page);
  await page.route("**/functions/v1/create-business", async (route) => {
    memberships.push({ role: "owner", business_id: created.id, businesses: created });
    await route.fulfill({ json: { business_id: created.id } });
  });
  await page.goto("/accounts");
  await page.getByRole("button", { name: "Create a business account", exact: true }).click();
  await page.getByLabel("Business Name", { exact: true }).fill("New Account");
  await page.getByRole("button", { name: "Create Business", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: /New Account/ })).toBeVisible();
});

test("a verified person creates their first empty business and becomes its owner", async ({ page }) => {
  const created = { id: "11111111-0000-0000-0000-000000000003", name: "First Account", slug: "first", is_active: true };
  const memberships: unknown[] = [];
  const requests = await api(page, memberships);
  await signedIn(page);
  await page.route("**/functions/v1/create-business", async (route) => {
    memberships.push({ role: "owner", business_id: created.id, businesses: created });
    await route.fulfill({ json: { business_id: created.id } });
  });

  await page.goto("/accounts");
  await page.getByRole("button", { name: "Create a business account", exact: true }).click();
  await page.getByLabel("Business Name", { exact: true }).fill("First Account");
  await page.getByRole("button", { name: "Create Business", exact: true }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("dokanos-active-business-id"))).toBe(created.id);
  expect(requests.some((request) =>
    ["POST", "PATCH", "PUT", "DELETE"].includes(request.method)
    && /\/rest\/v1\/(brands|selling_points|stores)$/.test(request.path)
  )).toBe(false);
  expect(requests.some((request) =>
    ["POST", "PATCH", "PUT", "DELETE"].includes(request.method)
      && /\/rest\/v1\/(brands|brand_stores|stores|storefronts|selling_points)$/.test(request.path)
  )).toBe(false);
});

test("switching revalidates a stale account membership before changing context", async ({ page }) => {
  const retained = { id: "11111111-0000-0000-0000-000000000001", name: "Retained Account", slug: "retained", is_active: true };
  const revoked = { id: "11111111-0000-0000-0000-000000000002", name: "Revoked Account", slug: "revoked", is_active: true };
  const memberships = [
    { role: "owner", business_id: retained.id, businesses: retained },
    { role: "member", business_id: revoked.id, businesses: revoked },
  ];
  await api(page, memberships);
  await signedIn(page);
  await page.addInitScript((id) => localStorage.setItem("dokanos-active-business-id", id), retained.id);
  await page.goto("/accounts");
  await expect(page.getByRole("button", { name: "Revoked Account", exact: true })).toBeVisible();

  memberships.splice(1, 1);
  await page.getByRole("button", { name: "Revoked Account", exact: true }).click();

  await expect(page).toHaveURL(/\/accounts$/);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("dokanos-active-business-id"))).toBe(retained.id);
  await expect(page.getByRole("button", { name: "Revoked Account", exact: true })).toHaveCount(0);
});

test("switching accounts refreshes account-scoped permissions and resources", async ({ page }) => {
  const first = { id: "11111111-0000-0000-0000-000000000001", name: "First Context", slug: "first-context", is_active: true };
  const second = { id: "11111111-0000-0000-0000-000000000002", name: "Second Context", slug: "second-context", is_active: true };
  const requests = await api(page, [
    { role: "owner", business_id: first.id, businesses: first },
    { role: "member", business_id: second.id, businesses: second },
  ]);
  await signedIn(page);
  await page.addInitScript((id) => localStorage.setItem("dokanos-active-business-id", id), first.id);
  await page.goto("/accounts");
  const permissionLoadsBefore = requests.filter((request) => request.path.endsWith("/rpc/get_user_permissions")).length;

  await page.getByRole("button", { name: "Second Context", exact: true }).click();

  await expect.poll(() => page.evaluate(() => localStorage.getItem("dokanos-active-business-id"))).toBe(second.id);
  await expect.poll(() => requests.filter((request) => request.path.endsWith("/rpc/get_user_permissions")).length)
    .toBeGreaterThan(permissionLoadsBefore);
  await expect.poll(() => requests.some((request) =>
    request.path.endsWith("/brands") && new URL(request.url).searchParams.get("business_id")?.includes(second.id)
  )).toBe(true);
});

test("an invalid confirmation preserves invitation intent without offering business setup", async ({ page }) => {
  const requests = await api(page);
  await page.goto("/auth/confirm?error=access_denied&invite=retry-invitation");
  await expect(page.getByText(/invalid or expired/)).toBeVisible();
  await page.getByRole("link", { name: "Sign in to continue" }).click();
  await expect(page).toHaveURL(/\/login\?invite=retry-invitation$/);
  await page.getByRole("link", { name: "Create account", exact: true }).click();
  await expect(page).toHaveURL(/\/signup\?invite=retry-invitation$/);
  expect(requests.some((r) => r.path.endsWith("/signup-provision"))).toBe(false);
});

test("a missing-session callback can request another confirmation without signup state", async ({ page }) => {
  const requests = await api(page);
  await page.goto("/auth/confirm?invite=resend-invitation");
  await page.getByRole("link", { name: "Request a new confirmation link" }).click();
  await page.getByLabel("Email", { exact: true }).fill("person@example.com");
  await page.getByRole("button", { name: "Resend confirmation email", exact: true }).click();
  await expect.poll(() => requests.find((r) => r.path.endsWith("/auth-resend"))?.body).toMatchObject({
    email: "person@example.com", invite: "resend-invitation",
  });
  expect(requests.some((r) => r.path.endsWith("/signup-provision"))).toBe(false);
});

test("confirmation and repeated visits reach empty account selection without signup local state", async ({ page }) => {
  const requests = await api(page);
  await signedIn(page);
  for (let visit = 0; visit < 2; visit++) {
    await page.goto("/auth/confirm");
    await expect(page).toHaveURL(/\/accounts$/);
    await expect(page.getByRole("heading", { name: "Choose a business account" })).toBeVisible();
    await expect(page.getByText("You don't belong to a business account yet.")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("button", { name: "Create a business account" })).toBeVisible();
  }
  expect(requests.filter((r) => r.method !== "GET" && !/\/auth\/|\/rpc\/get_user_(permissions|store_ids)$/.test(r.path))).toEqual([]);
});

test("invitation intent survives signup, a fresh-device confirmation, and reload without accepting it", async ({ page }) => {
  const requests = await api(page);
  await page.goto("/signup?invite=pending-invitation-token");
  await page.getByLabel("Your Name").fill("Sarah Jenkins");
  await page.getByLabel("Email", { exact: true }).fill("person@example.com");
  await page.getByLabel("Password", { exact: true }).fill("PersonalPass123!");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create personal account" }).click();
  await expect(page).toHaveURL(/\/check-email\?.*invite=pending-invitation-token/);
  const signup = requests.find((r) => r.path === "/auth/v1/signup");
  expect(new URL(signup!.url).searchParams.get("redirect_to")).toBe("http://127.0.0.1:4175/auth/confirm?invite=pending-invitation-token");
  await signedIn(page);
  await page.goto("/auth/confirm?invite=pending-invitation-token");
  await expect(page).toHaveURL(/\/accounts\?invite=pending-invitation-token$/);
  await expect(page.getByText("Your invitation is saved. Verification does not accept it or grant access.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("You don't belong to a business account yet.")).toBeVisible();
  expect(requests.some((r) => /accept.*invit|signup-provision/.test(r.path))).toBe(false);
});
