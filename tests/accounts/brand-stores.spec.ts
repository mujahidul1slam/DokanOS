import { expect, test, type Page } from "@playwright/test";

const user = {
  id: "00000000-0000-0000-0000-000000000099",
  aud: "authenticated",
  role: "authenticated",
  email: "store-member@example.com",
  email_confirmed_at: "2026-10-19T00:00:00Z",
  created_at: "2026-10-19T00:00:00Z",
  updated_at: "2026-10-19T00:00:00Z",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: { full_name: "Store Member" },
};

const business = {
  id: "11111111-0000-0000-0000-000000000001",
  name: "Store Account",
  slug: "store-account",
  currency: "BDT",
  timezone: "Asia/Dhaka",
  is_active: true,
  onboarding_completed_at: null,
};

const brands = [
  {
    id: "44444444-0000-0000-0000-000000000001",
    business_id: business.id,
    name: "North Star",
    slug: "north-star",
    logo_url: null,
    woo_store_id: null,
    is_active: true,
  },
  {
    id: "44444444-0000-0000-0000-000000000002",
    business_id: business.id,
    name: "Daylight Goods",
    slug: "daylight-goods",
    logo_url: null,
    woo_store_id: null,
    is_active: true,
  },
];

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

test("a member creates multiple physical and online stores under brands without publishing or extra resources", async ({ page }) => {
  const stores: Array<Record<string, unknown>> = [];
  const writes: Array<{ path: string; body: unknown }> = [];

  await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const body = request.postDataJSON();
    if (["POST", "PATCH", "PUT", "DELETE"].includes(method)) {
      writes.push({ path: url.pathname, body });
    }

    if (url.pathname.endsWith("/user_business_access")) {
      await route.fulfill({ json: [{ role: "member", business_id: business.id, businesses: business }] });
      return;
    }
    // /stores sits behind PermissionGuard(dashboard.view).
    if (url.pathname.endsWith("/rpc/get_user_permissions")) {
      await route.fulfill({ json: ["dashboard.view"] });
      return;
    }
    if (url.pathname.endsWith("/rpc/get_user_store_ids")) {
      await route.fulfill({ json: [] });
      return;
    }
    if (url.pathname.endsWith("/permission_settings")) {
      await route.fulfill({ json: { large_discount_percent: 10, large_discount_amount: null } });
      return;
    }
    if (url.pathname.endsWith("/brands") && method === "GET") {
      await route.fulfill({ json: brands });
      return;
    }
    if (url.pathname.endsWith("/brand_stores") && method === "GET") {
      await route.fulfill({ json: [...stores].sort((a, b) => String(a.name).localeCompare(String(b.name))) });
      return;
    }
    if (url.pathname.endsWith("/rpc/create_brand_store")) {
      const payload = body as { p_brand_id: string; p_name: string; p_store_type: string };
      expect(["physical", "online"]).toContain(payload.p_store_type);
      expect(brands.some((brand) => brand.id === payload.p_brand_id)).toBe(true);
      const store = {
        id: `55555555-0000-0000-0000-${String(stores.length + 1).padStart(12, "0")}`,
        brand_id: payload.p_brand_id,
        name: payload.p_name,
        store_type: payload.p_store_type,
        is_published: false,
        created_at: "2026-10-19T00:00:00Z",
        updated_at: "2026-10-19T00:00:00Z",
      };
      stores.push(store);
      await route.fulfill({ json: store });
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

  await page.goto("/stores");
  await expect(page.getByText("North Star", { exact: true })).toBeVisible();
  await expect(page.getByText("Daylight Goods", { exact: true })).toBeVisible();

  async function createStore(brand: string, name: string, type: "Physical store" | "Online store") {
    await page.getByRole("button", { name: "New Store", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // There is no combined physical-and-online type in the UI.
    await expect(dialog.getByRole("radio")).toHaveCount(2);
    await expect(dialog.getByText(/Physical and online/i)).toHaveCount(0);
    await expect(dialog.getByLabel("Address")).toHaveCount(0);
    await dialog.getByLabel("Store name").fill(name);
    await dialog.getByLabel("Parent brand").selectOption({ label: brand });
    await dialog.getByLabel(type).check();
    await dialog.getByRole("button", { name: "Create store" }).click();
    await expect(dialog).toHaveCount(0);
  }

  await createStore("North Star", "Dhanmondi Outlet", "Physical store");
  await createStore("North Star", "North Star Online", "Online store");
  await createStore("Daylight Goods", "Gulshan Outlet", "Physical store");

  await page.getByText("North Star", { exact: true }).click();
  await expect(page.getByText("Dhanmondi Outlet", { exact: true })).toBeVisible();
  await expect(page.getByText("North Star Online", { exact: true })).toBeVisible();
  await expect(page.getByText(/Unpublished/)).toBeVisible();

  await page.getByText("Daylight Goods", { exact: true }).click();
  await expect(page.getByText("Gulshan Outlet", { exact: true })).toBeVisible();
  await expect(page.getByText("Dhanmondi Outlet", { exact: true })).toHaveCount(0);

  // A store enters the brand's existing operational context without requiring
  // an address, integration or storefront configuration first.
  await page.getByRole("button", { name: /Configure/ }).first().click();
  await expect(page.getByText("No locations yet.")).toBeVisible();

  expect(stores).toHaveLength(3);
  expect(stores.every((store) => store.is_published === false)).toBe(true);
  expect(writes.filter((write) => write.path.endsWith("/rpc/create_brand_store"))).toHaveLength(3);
  expect(writes.some((write) => /\/rest\/v1\/(stores|storefronts|brands)$/.test(write.path))).toBe(false);
  expect(JSON.stringify(writes)).not.toContain("\"is_published\":true");
});
