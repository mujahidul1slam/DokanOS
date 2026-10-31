import { expect, test, type Page } from "@playwright/test";

// Task 3 (spec §5/§6b): the one-time "Set up your profile" step after email
// verification. The Supabase REST layer is mocked on 127.0.0.1:54321 and
// Cloudflare is aborted, the same way the other account specs run.

const user = {
  id: "00000000-0000-0000-0000-0000000000a1",
  aud: "authenticated",
  role: "authenticated",
  email: "setup.person@example.com",
  email_confirmed_at: "2026-10-30T00:00:00Z",
  created_at: "2026-10-30T00:00:00Z",
  updated_at: "2026-10-30T00:00:00Z",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: { full_name: "Setup Person" },
};

const business = {
  id: "11111111-0000-0000-0000-000000000001",
  name: "Setup Shop",
  slug: "setup-shop",
  currency: "BDT",
  timezone: "Asia/Dhaka",
  is_active: true,
};

interface ProfileRow {
  id: string;
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  profile_setup_completed_at: string | null;
}

interface Request {
  path: string;
  method: string;
  body: Record<string, unknown> | null;
}

/** The row handle_new_user creates at signup: the name only, setup still owed. */
const signupProfile = (): ProfileRow => ({
  id: "22222222-0000-0000-0000-000000000001",
  user_id: user.id,
  full_name: "Setup Person",
  avatar_url: null,
  phone: null,
  profile_setup_completed_at: null,
});

/** Mocks the REST layer around one stateful profile row, and records every request. */
async function api(page: Page, profile: ProfileRow) {
  const requests: Request[] = [];
  await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const body = request.postDataJSON() as Record<string, unknown> | null;
    requests.push({ path: url.pathname, method: request.method(), body });
    let data: unknown = [];
    if (url.pathname.endsWith("/rpc/is_signup_open")) data = true;
    if (url.pathname.endsWith("/user_business_access")) {
      data = [{ role: "owner", business_id: business.id, businesses: business }];
    }
    if (url.pathname.endsWith("/user")) data = user;
    if (url.pathname.endsWith("/profiles")) {
      if (request.method() === "PATCH") {
        Object.assign(profile, body);
        data = { id: profile.id };
      } else {
        data = profile;
      }
    }
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

const profileWrite = (requests: Request[]) =>
  requests.find((r) => r.method === "PATCH" && r.path.endsWith("/profiles"));

test("a verified person without a completed setup is sent to the setup step after confirmation", async ({ page }) => {
  await api(page, signupProfile());
  await signedIn(page);
  await page.goto("/auth/confirm");
  await expect(page).toHaveURL(/\/profile\/setup$/);
  await expect(page.getByRole("heading", { name: "Set up your profile" })).toBeVisible();
  await expect(page.getByLabel("Full name", { exact: true })).toHaveValue("Setup Person");
});

test("skipping setup marks it done and changes no field already on the account", async ({ page }) => {
  const profile = signupProfile();
  const requests = await api(page, profile);
  await signedIn(page);
  await page.goto("/profile/setup");
  await page.getByRole("button", { name: "Skip for now" }).click();

  await expect.poll(() => profileWrite(requests) !== undefined).toBe(true);
  const write = profileWrite(requests);
  expect(write?.body).toHaveProperty("profile_setup_completed_at");
  expect(write?.body).not.toHaveProperty("full_name");
  expect(write?.body).not.toHaveProperty("phone");
  expect(write?.body).not.toHaveProperty("avatar_url");
  expect(profile.full_name).toBe("Setup Person");
  expect(profile.phone).toBeNull();
  await expect(page).toHaveURL(/\/accounts$/);
});

test("saving setup stores the name and a normalized phone, then opens the business flow", async ({ page }) => {
  const profile = signupProfile();
  const requests = await api(page, profile);
  await signedIn(page);
  await page.goto("/profile/setup");
  await page.getByLabel("Phone", { exact: true }).fill("+880 1711-234567");
  await page.getByRole("button", { name: "Save and continue" }).click();

  await expect.poll(() => profileWrite(requests) !== undefined).toBe(true);
  const write = profileWrite(requests);
  expect(write?.body).toMatchObject({ full_name: "Setup Person", phone: "01711234567" });
  expect(typeof write?.body?.profile_setup_completed_at).toBe("string");
  expect(profile.phone).toBe("01711234567");
  // A new person has no business yet, so the business flow (not the dashboard) is the destination.
  await expect(page).toHaveURL(/\/accounts$/);
});

test("an invalid phone is refused before any write, and the person can correct it", async ({ page }) => {
  const requests = await api(page, signupProfile());
  await signedIn(page);
  await page.goto("/profile/setup");
  await page.getByLabel("Phone", { exact: true }).fill("12345");
  await page.getByRole("button", { name: "Save and continue" }).click();

  await expect(page.getByRole("alert").filter({ hasText: "Enter a valid Bangladeshi mobile number" })).toBeVisible();
  await expect(page).toHaveURL(/\/profile\/setup$/);
  expect(profileWrite(requests)).toBeUndefined();
});

test("a person who already completed or skipped setup is not prompted again after verification", async ({ page }) => {
  await api(page, { ...signupProfile(), profile_setup_completed_at: "2026-10-30T14:00:00Z" });
  await signedIn(page);
  await page.goto("/auth/confirm");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Set up your profile" })).toHaveCount(0);
});

test("invitation intent survives the setup step, and the step never accepts it", async ({ page }) => {
  const requests = await api(page, signupProfile());
  await signedIn(page);
  await page.goto("/auth/confirm?invite=setup-invitation");
  await expect(page).toHaveURL(/\/profile\/setup\?invite=setup-invitation$/);
  await page.getByRole("button", { name: "Skip for now" }).click();

  await expect(page).toHaveURL(/\/accounts\?invite=setup-invitation$/);
  await expect(page.getByText("Your invitation is saved. Verification does not accept it or grant access.")).toBeVisible();
  expect(requests.some((r) => /accept_business_invitation/.test(r.path))).toBe(false);
});
