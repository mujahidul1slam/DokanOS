import { expect, test, type Page } from "@playwright/test";

const API = "http://127.0.0.1:54321";
const user = {
  id: "00000000-0000-0000-0000-000000000099",
  aud: "authenticated",
  role: "authenticated",
  email: "audit@example.com",
  email_confirmed_at: "2026-11-03T00:00:00Z",
  created_at: "2026-11-03T00:00:00Z",
  updated_at: "2026-11-03T00:00:00Z",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: { full_name: "Migration Audit" },
};
const business = {
  id: "11111111-0000-0000-0000-000000000001",
  name: "Source Only Business",
  slug: "source-only-business",
  logo_url: null,
  currency: "BDT",
  timezone: "Asia/Dhaka",
  address: null,
  email: null,
  phone: null,
  is_active: true,
  onboarding_completed_at: "2026-11-03T00:00:00Z",
};
const brand = {
  id: "22222222-0000-0000-0000-000000000001",
  business_id: business.id,
  name: "Source Only Brand",
  slug: "source-only-brand",
  logo_url: null,
  woo_store_id: null,
  is_active: true,
};
const source = {
  id: "33333333-0000-0000-0000-000000000001",
  brand_id: brand.id,
  name: "Phone Orders",
  type: "manual",
  config: {},
  sync_direction: null,
  last_sync_at: null,
  last_sync_error: null,
  is_stock_holding: true,
  is_default: true,
  accepted_payment_methods: ["cash", "cod"],
};
const sourceOnlyOrder = {
  id: "44444444-0000-0000-0000-000000000001",
  order_number: "SO-1001",
  total: 750,
  subtotal: 750,
  discount: 0,
  shipping_cost: 0,
  tax_amount: 0,
  status: "processing",
  source: "manual",
  payment_status: "unpaid",
  payment_method: "cash",
  created_at: "2026-11-03T03:00:00.000Z",
  customer_id: null,
  customer_name: "Source Customer",
  customer_phone: "01700000000",
  customer_city: "Dhaka",
  consignment_id: null,
  tracking_status: null,
  fulfillment_type: "walkin",
  deleted_at: null,
  store_id: null,
  order_source_id: source.id,
  parent_order_id: null,
  amount_to_collect: 750,
  pathao_recipient_city: null,
  pathao_recipient_zone: null,
  pathao_recipient_area: null,
  pathao_store_id: null,
  item_weight: null,
  special_instruction: null,
  customer_address: null,
  customer_email: null,
  pickup_slip_printed_at: null,
  measurement_slip_printed_at: null,
  stores: null,
  order_source: { id: source.id, name: source.name, type: source.type, brand_id: brand.id, brands: brand },
  order_brands: [{ brand_id: brand.id, is_primary: true, brands: brand }],
  order_items: [{ product_id: null, product_name: "Manual item", quantity: 1 }],
};

async function install(page: Page) {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
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

  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    if (path.endsWith("/auth/v1/user")) return route.fulfill({ json: user });
    if (path.endsWith("/user_business_access")) {
      return route.fulfill({ json: [{ role: "owner", business_id: business.id, businesses: business }] });
    }
    if (path.endsWith("/rpc/set_active_business_context")) return route.fulfill({ json: null });
    if (path.endsWith("/rpc/get_user_permissions")) {
      return route.fulfill({ json: ["dashboard.view", "orders.view", "orders.create", "orders.edit", "analytics.view", "pos.use", "products.view", "customers.view", "settings.view", "storefronts.view"] });
    }
    if (path.endsWith("/rpc/get_user_store_ids")) return route.fulfill({ json: [] });
    if (path.endsWith("/brands") && method === "GET") return route.fulfill({ json: [brand] });
    if (path.endsWith("/order_sources") && method === "GET") return route.fulfill({ json: [source] });
    if (path.endsWith("/stores") && method === "GET") return route.fulfill({ json: [] });
    if (path.endsWith("/orders") && method === "GET") return route.fulfill({ json: [sourceOnlyOrder] });
    if (path.endsWith("/order_items") && method === "GET") return route.fulfill({ json: [] });
    if (path.endsWith("/product_categories") && method === "GET") return route.fulfill({ json: [] });
    if (path.endsWith("/products") && method === "GET") return route.fulfill({ json: [] });
    if (path.endsWith("/categories") && method === "GET") return route.fulfill({ json: [] });
    if (path.endsWith("/pos_returns") && method === "GET") return route.fulfill({ json: [] });
    if (path.endsWith("/order_payments") && method === "GET") return route.fulfill({ json: [] });
    if (path.endsWith("/courier_services") && method === "GET") return route.fulfill({ json: [] });
    if (path.endsWith("/pathao_integrations") && method === "GET") return route.fulfill({ json: [] });
    if (path.endsWith("/invoice_settings") && method === "GET") return route.fulfill({ json: [{ business_name: "Source Only Business", logo_url: null, currency: "BDT" }] });
    if (path.endsWith("/app_settings") && method === "GET") return route.fulfill({ json: [] });
    if (path.includes("/functions/v1/")) return route.fulfill({ json: {} });
    return route.fulfill({ json: [] });
  });
  return consoleErrors;
}

test("migration boundary: source-only business across operational and reporting surfaces", async ({ page }) => {
  const consoleErrors = await install(page);

  await page.goto("/orders");
  await expect(page.getByRole("heading", { name: "Orders", exact: true })).toBeVisible();
  await expect(page.getByRole("table").getByText("#SO-1001", { exact: true })).toBeVisible();

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  await expect(page.getByText("No stores in this business", { exact: true })).toBeVisible();

  await page.goto("/analytics");
  await expect(page.getByRole("heading", { name: "Sales Analytics", exact: true })).toBeVisible();
  await expect(page.getByText("No data", { exact: true }).first()).toBeVisible();

  await page.goto("/pos/reports");
  await expect(page.getByRole("heading", { name: "POS Reports", exact: true })).toBeVisible();
  await expect(page.getByText(/0 orders|No orders/i).first()).toBeVisible();

  await page.goto("/integrations");
  await expect(page.getByRole("heading", { name: "Order Sources", exact: true })).toBeVisible();
  await expect(page.getByText("Phone Orders", { exact: true })).toBeVisible();
  expect(consoleErrors.every((error) => error.includes("realtime/v1/websocket") && error.includes("ERR_CONNECTION_REFUSED"))).toBe(true);
});
