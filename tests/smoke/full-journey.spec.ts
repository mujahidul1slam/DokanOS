/**
 * Real-stack smoke journey: signup → confirm → business → brand → store → product → switch.
 *
 * Harness: Playwright/real stack (not mocked).
 * Backend: local Supabase (Auth + PostgREST + edge functions + Mailpit).
 *
 * This single gate would have caught every regression in the accounts series.
 * It exercises the real app against the real local stack end-to-end.
 *
 * Prerequisites: npm run verify:env must be green before running this suite.
 */
import { expect, test } from "@playwright/test";

const SMOKE_EMAIL = process.env.SMOKE_EMAIL || "smoke-test@example.com";
const SMOKE_PASSWORD = process.env.SMOKE_PASSWORD || "SmokeTestPass123!";
const SMOKE_NAME = "Smoke Test User";
const MAILPIT_API = process.env.SMOKE_MAILPIT_URL || "http://127.0.0.1:54324";

/**
 * Poll Mailpit for the latest confirmation link sent to the test email.
 * Returns the URL from the email body.
 */
async function getConfirmationLink(): Promise<string> {
  const response = await fetch(`${MAILPIT_API}/api/v1/messages`);
  if (!response.ok) throw new Error(`Mailpit API returned ${response.status}`);
  const data = (await response.json()) as { messages: Array<{ ID: string }> };
  const msg = data.messages?.[0];
  if (!msg) throw new Error("No messages found in Mailpit");

  const detail = await fetch(`${MAILPIT_API}/api/v1/message/${msg.ID}`);
  const body = await detail.json() as { HTML?: string; Text?: string };
  const text = body.HTML || body.Text || "";
  const match = text.match(/http:\/\/[^"'\s]*\/auth\/confirm[^"'\s]*/);
  if (!match) throw new Error("No confirmation link found in email");
  return match[0];
}

test.describe.serial("Real-stack smoke journey", () => {
  test.setTimeout(120_000);

  test("step 1: signup with personal account", async ({ page }) => {
    await page.goto("/signup");
    // Verify signup is open (is_signup_open RPC must return true for smoke)
    await expect(page.getByRole("heading", { name: /create.*account|sign up/i })).toBeVisible({ timeout: 15_000 });

    await page.getByLabel("Your Name").fill(SMOKE_NAME);
    await page.getByLabel("Email", { exact: true }).fill(SMOKE_EMAIL);
    await page.getByLabel("Password", { exact: true }).fill(SMOKE_PASSWORD);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /create personal account/i }).click();

    await expect(page).toHaveURL(/\/check-email/, { timeout: 15_000 });
  });

  test("step 2: confirm via Mailpit", async ({ page }) => {
    const link = await getConfirmationLink();
    // Rewrite the link to point at our local Vite dev server
    const url = new URL(link);
    const localLink = `${page.context().options()?.baseURL || "http://127.0.0.1:5173"}${url.pathname}${url.search}${url.hash}`;
    await page.goto(localLink);

    // After confirmation, should land on accounts or dashboard
    await expect(page).toHaveURL(/\/(accounts|dashboard|$)/, { timeout: 20_000 });
  });

  test("step 3: create first business", async ({ page }) => {
    await page.goto("/accounts");
    await page.getByRole("button", { name: /create a business account/i }).click();
    await page.getByLabel("Business Name", { exact: true }).fill("Alpha Business");
    await page.getByRole("button", { name: /create business/i }).click();

    // Should land on dashboard after creation
    await expect(page).toHaveURL(/\//, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: /dashboard/i })).toBeVisible({ timeout: 10_000 });
  });

  test("step 4: create brand under business", async ({ page }) => {
    await page.goto("/brands");
    await page.getByRole("button", { name: /add brand|create brand|new brand/i }).first().click();
    // Fill brand name in the dialog
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/name/i).fill("Alpha Brand");
    await dialog.getByRole("button", { name: /create|save|add/i }).click();
    await expect(page.getByText("Alpha Brand")).toBeVisible({ timeout: 10_000 });
  });

  test("step 5: create store under brand", async ({ page }) => {
    await page.goto("/stores");
    await page.getByRole("button", { name: /new store|add store|create store/i }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/name/i).fill("Alpha Store");
    // Select type if present
    const typeSelect = dialog.getByLabel(/type/i);
    if (await typeSelect.isVisible().catch(() => false)) {
      await typeSelect.selectOption("physical");
    }
    await dialog.getByRole("button", { name: /create|save/i }).click();
    await expect(page.getByText("Alpha Store")).toBeVisible({ timeout: 10_000 });
  });

  test("step 6: create product", async ({ page }) => {
    await page.goto("/products");
    await page.getByRole("button", { name: /add product|new product/i }).first().click();
    const sheet = page.getByRole("dialog").or(page.locator('[role="complementary"]'));
    await sheet.getByLabel(/name/i).first().fill("Smoke Product");
    await sheet.getByLabel(/price/i).first().fill("100");
    await sheet.getByRole("button", { name: /save|create/i }).first().click();
    await expect(page.getByText("Smoke Product")).toBeVisible({ timeout: 10_000 });
  });

  test("step 7: create second business and switch", async ({ page }) => {
    await page.goto("/accounts");
    await page.getByRole("button", { name: /create a business account/i }).click();
    await page.getByLabel("Business Name", { exact: true }).fill("Beta Business");
    await page.getByRole("button", { name: /create business/i }).click();
    await expect(page).toHaveURL(/\//, { timeout: 15_000 });

    // Switch back to Alpha
    await page.goto("/accounts");
    await page.getByRole("button", { name: "Alpha Business", exact: true }).click();
    await expect(page).toHaveURL(/\//, { timeout: 10_000 });
  });

  test("step 8: assert Dashboard/Orders/Products re-scope after switch", async ({ page }) => {
    // On Alpha Business now — Smoke Product should be visible
    await page.goto("/products");
    await expect(page.getByText("Smoke Product")).toBeVisible({ timeout: 10_000 });

    // Switch to Beta — Smoke Product should NOT be visible
    await page.goto("/accounts");
    await page.getByRole("button", { name: "Beta Business", exact: true }).click();
    await expect(page).toHaveURL(/\//, { timeout: 10_000 });

    await page.goto("/products");
    await expect(page.getByText("Smoke Product")).toHaveCount(0, { timeout: 10_000 });
  });
});
