import { expect, test, type Page } from "@playwright/test";

const user = {
  id: "00000000-0000-0000-0000-000000000099",
  aud: "authenticated",
  role: "authenticated",
  email: "brand-member@example.com",
  email_confirmed_at: "2026-10-19T00:00:00Z",
  created_at: "2026-10-19T00:00:00Z",
  updated_at: "2026-10-19T00:00:00Z",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: { full_name: "Brand Member" },
};

const business = {
  id: "11111111-0000-0000-0000-000000000001",
  name: "Empty Account",
  slug: "empty-account",
  currency: "BDT",
  timezone: "Asia/Dhaka",
  is_active: true,
  onboarding_completed_at: null,
};

async function signedIn(page: Page) {
  await page.addInitScript(({ user, businessId }) => {
    localStorage.setItem("sb-127-auth-token", JSON.stringify({
      access_token: "browser-test-token",
      refresh_token: "browser-test-refresh",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      expires_in: 3600,
      token_type: "bearer",
      user,
    }));
    localStorage.setItem("dokanos-active-business-id", businessId);
  }, { user, businessId: business.id });
}

test("an empty account can create and list independent name-only brands without stores or storefronts", async ({ page }) => {
  const brands: Array<Record<string, unknown>> = [];
  const writes: string[] = [];

  await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (["POST", "PATCH", "PUT", "DELETE"].includes(method)) writes.push(url.pathname);

    if (url.pathname.endsWith("/user_business_access")) {
      await route.fulfill({ json: [{ role: "member", business_id: business.id, businesses: business }] });
      return;
    }
    if (url.pathname.endsWith("/brands") && method === "GET") {
      await route.fulfill({ json: brands });
      return;
    }
    if (url.pathname.endsWith("/rpc/create_business_brand")) {
      const body = request.postDataJSON() as { p_business_id: string; p_name: string };
      expect(body).toEqual({ p_business_id: business.id, p_name: body.p_name });
      const brand = {
        id: `44444444-0000-0000-0000-${String(brands.length + 1).padStart(12, "0")}`,
        business_id: business.id,
        name: body.p_name,
        slug: `brand-${brands.length + 1}`,
        logo_url: null,
        woo_store_id: null,
        is_active: true,
      };
      brands.push(brand);
      await route.fulfill({ json: brand });
      return;
    }
    if (url.pathname.endsWith("/selling_points")) {
      await route.fulfill({ status: 200, headers: { "content-range": "*/0" }, json: [] });
      return;
    }
    if (url.pathname.endsWith("/app_config")) {
      await route.fulfill({ json: { value: true } });
      return;
    }
    if (url.pathname.endsWith("/user")) {
      await route.fulfill({ json: user });
      return;
    }
    await route.fulfill({ json: [] });
  });
  await signedIn(page);

  await page.goto("/brands");
  await expect(page).toHaveURL(/\/brands$/);
  await expect(page.getByRole("link", { name: "Brands", exact: true })).toBeVisible();
  await expect(page.getByText("0 brands under Empty Account")).toBeVisible();
  await expect(page.getByText(/No brands yet/)).toBeVisible();

  for (const name of ["North Star", "Daylight Goods"]) {
    await page.getByRole("button", { name: "New Brand" }).click();
    await expect(page.getByLabel("Slug")).toHaveCount(0);
    await page.getByLabel("Brand name").fill(name);
    await page.getByRole("button", { name: "Create brand" }).click();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }

  await expect(page.getByText("2 brands under Empty Account")).toBeVisible();
  expect(brands.every((brand) => brand.woo_store_id === null)).toBe(true);
  expect(writes.some((path) => /\/rest\/v1\/(stores|storefronts)$/.test(path))).toBe(false);
  await expect(page).toHaveURL(/\/brands$/);
});
