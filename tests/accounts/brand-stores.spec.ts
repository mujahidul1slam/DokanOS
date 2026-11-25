import { expect, test, type Page } from "@playwright/test";

/**
 * Order sources under brands (formerly "stores under brands").
 *
 * The Task 16 contract migration dropped `brand_stores` and
 * `create_brand_store(uuid, text, text)`, and the Brands page was reduced to
 * brand-only CRUD. A merchant now names the places orders come from as ORDER
 * SOURCES on the Integrations page (one section per brand). This spec drives
 * that surface: physical and digital sources under two brands, with no store
 * row, storefront, or publish state created as a side effect.
 */

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

test("a member creates physical and digital order sources under brands without publishing or extra resources", async ({ page }) => {
  const sources: Array<Record<string, unknown>> = [];
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
      await route.fulfill({ json: [{ role: "manager", business_id: business.id, businesses: business }] });
      return;
    }
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
    if (url.pathname.endsWith("/order_sources") && method === "GET") {
      await route.fulfill({ json: [...sources].sort((a, b) => String(a.name).localeCompare(String(b.name))) });
      return;
    }
    if (url.pathname.endsWith("/order_sources") && method === "POST") {
      const payload = body as { brand_id: string; name: string; type: string };
      // Only the non-legacy source types the dialog offers may be created here.
      expect(["physical_store", "storefront"]).toContain(payload.type);
      expect(brands.some((brand) => brand.id === payload.brand_id)).toBe(true);
      const source = {
        id: `66666666-0000-0000-0000-${String(sources.length + 1).padStart(12, "0")}`,
        brand_id: payload.brand_id,
        name: payload.name,
        type: payload.type,
        config: {},
        sync_direction: null,
        last_sync_at: null,
        last_sync_error: null,
        is_stock_holding: payload.type === "physical_store",
        is_default: false,
        ship_from_store: false,
        fulfillment_preference: [],
        accepted_payment_methods: ["cod", "cash"],
        legacy_woo_store_id: null,
      };
      sources.push(source);
      await route.fulfill({ json: source });
      return;
    }
    // The panel reads these to scope the legacy store binding and order counts.
    if (url.pathname.endsWith("/stores")) {
      await route.fulfill({ json: [] });
      return;
    }
    if (url.pathname.endsWith("/warehouses")) {
      await route.fulfill({ json: [] });
      return;
    }
    if (url.pathname.endsWith("/orders")) {
      await route.fulfill({ json: [] });
      return;
    }
    // 2435c1b moved the signup kill switch from an app_config row read to the
    // is_signup_open() RPC (fail-closed UI) and the suite died silently with
    // the call. Mock the CURRENT contract; keep the retired app_config shape
    // green while both lines coexist.
    if (url.pathname.endsWith("/rpc/is_signup_open")) {
      await route.fulfill({ json: true });
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

  await page.goto("/integrations");
  await expect(page.getByRole("heading", { name: "Order Sources", exact: true })).toBeVisible();
  for (const brand of brands) {
    await expect(page.getByRole("heading", { name: brand.name, exact: true })).toBeVisible();
  }

  async function createSource(brandName: string, name: string, type: "Physical store" | "Storefront") {
    const section = page.getByRole("region", { name: `Order sources — ${brandName}` });
    await section.getByRole("button", { name: "Add source" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // Seven non-legacy source types; the retired WooCommerce type is not offered.
    await expect(dialog.getByRole("radio")).toHaveCount(7);
    await expect(dialog.getByText(/WooCommerce \(legacy\)/i)).toHaveCount(0);
    await expect(dialog.getByLabel("Address")).toHaveCount(0);
    await dialog.getByLabel("Name", { exact: true }).fill(name);
    await dialog.getByLabel(type).check();
    await dialog.getByRole("button", { name: "Create source" }).click();
    await expect(dialog).toHaveCount(0);
  }

  await createSource("North Star", "Dhanmondi Outlet", "Physical store");
  await createSource("North Star", "North Star Online", "Storefront");
  await createSource("Daylight Goods", "Gulshan Outlet", "Physical store");

  // Each brand section lists its own sources inline, so every created source is
  // visible at once without navigating away.
  await expect(page.getByText("Dhanmondi Outlet", { exact: true })).toBeVisible();
  await expect(page.getByText("North Star Online", { exact: true })).toBeVisible();
  await expect(page.getByText("Gulshan Outlet", { exact: true })).toBeVisible();

  // A source enters the brand's operational context without requiring an
  // address, integration or storefront configuration first; brand scoping is
  // asserted on the created rows (each landed under the brand picked).
  const brandId = (name: string) => brands.find((brand) => brand.name === name)?.id;
  expect(sources.map((source) => `${String(source.brand_id)}:${String(source.name)}`).sort()).toEqual(
    [
      `${brandId("Daylight Goods")}:Gulshan Outlet`,
      `${brandId("North Star")}:Dhanmondi Outlet`,
      `${brandId("North Star")}:North Star Online`,
    ].sort(),
  );

  expect(sources).toHaveLength(3);
  // Physical sources hold stock by default; the storefront source does not.
  expect(sources.find((source) => source.name === "Dhanmondi Outlet")?.is_stock_holding).toBe(true);
  expect(sources.find((source) => source.name === "North Star Online")?.is_stock_holding).toBe(false);
  expect(writes.filter((write) => write.path.endsWith("/rest/v1/order_sources"))).toHaveLength(3);
  // Creating a source must not mint a legacy store row, a storefront, or a brand.
  expect(writes.some((write) => /\/rest\/v1\/(stores|storefronts|brands)$/.test(write.path))).toBe(false);
  expect(JSON.stringify(writes)).not.toContain("\"is_published\":true");
});
