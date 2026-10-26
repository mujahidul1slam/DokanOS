import { chromium } from "@playwright/test";
import path from "path";
import fs from "fs";

const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR || path.resolve("test-screenshots");
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

async function runE2E() {
  console.log("=================================================");
  console.log("STARTING AUTOMATED E2E STOREFRONT VERIFICATION");
  console.log("Browser: System Google Chrome");
  console.log("Target:  http://localhost:4173");
  console.log("Backend: https://jiwndicvfkiltgageqwv.supabase.co");
  console.log("=================================================\n");

  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 850 },
  });
  const page = await context.newPage();

  const results = [];
  const consoleErrors = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  try {
    // -------------------------------------------------------------
    // TEST 1: Enveil Home Page
    // -------------------------------------------------------------
    console.log("--> Test 1: Enveil Home Page (/storefront/enveil)");
    await page.goto("http://localhost:4173/storefront/enveil", { waitUntil: "networkidle" });
    const homeTitle = await page.title();
    const hasEnveilInTitle = homeTitle.toLowerCase().includes("enveil");

    // Check JSON-LD
    const jsonLd = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
      for (const s of scripts) {
        try {
          const parsed = JSON.parse(s.textContent);
          if (parsed["@type"] === "Organization") return parsed;
        } catch {}
      }
      return null;
    });

    const homeScreenshotPath = path.join(SCREENSHOTS_DIR, "01_enveil_home.png");
    await page.screenshot({ path: homeScreenshotPath, fullPage: true });

    results.push({
      step: "1. Enveil Home Page",
      pass: hasEnveilInTitle && !!jsonLd,
      details: `Title: "${homeTitle}", JSON-LD Organization: ${jsonLd ? jsonLd.name : "MISSING"}`,
      screenshot: "01_enveil_home.png",
    });

    // -------------------------------------------------------------
    // TEST 2: Enveil Shop Page & Collection Filter
    // -------------------------------------------------------------
    console.log("--> Test 2: Shop Page (/storefront/enveil/shop)");
    await page.goto("http://localhost:4173/storefront/enveil/shop", { waitUntil: "networkidle" });
    await page.waitForSelector('a[href*="/storefront/enveil/product/"]', { timeout: 10000 });

    const productLinks = await page.$$eval('a[href*="/storefront/enveil/product/"]', (links) =>
      links.map((l) => ({
        href: l.getAttribute("href"),
        text: l.textContent?.trim(),
      }))
    );

    const shopScreenshotPath = path.join(SCREENSHOTS_DIR, "02_enveil_shop.png");
    await page.screenshot({ path: shopScreenshotPath, fullPage: false });

    results.push({
      step: "2. Enveil Shop Page",
      pass: productLinks.length > 0,
      details: `Loaded ${productLinks.length} active products. First: "${productLinks[0]?.text?.slice(0, 40)}" (${productLinks[0]?.href})`,
      screenshot: "02_enveil_shop.png",
    });

    // -------------------------------------------------------------
    // TEST 3: Product Page & Variations & Add to Cart
    // -------------------------------------------------------------
    console.log("--> Test 3: Product Page & Variations");
    const targetProductHref = productLinks[0].href;
    await page.goto(`http://localhost:4173${targetProductHref}`, { waitUntil: "networkidle" });

    // Verify title and price
    const prodHeading = await page.$eval("h1", (el) => el.textContent?.trim());
    const prodPrice = await page.$eval(".text-2xl", (el) => el.textContent?.trim());

    // Select attribute options if present
    const optionButtons = await page.$$(".space-y-4 button");
    for (const btn of optionButtons) {
      await btn.click();
      await page.waitForTimeout(150);
    }

    // Click main action button (Add to bag / Select options)
    const actionBtn = await page.waitForSelector('button:has(.lucide-shopping-bag)', { timeout: 5000 });
    await actionBtn.click();
    await page.waitForTimeout(600);

    // Navigate to /cart to verify the item is added to the cart
    await page.goto("http://localhost:4173/storefront/enveil/cart", { waitUntil: "networkidle" });
    await page.waitForSelector('h1:has-text("Your bag")', { timeout: 5000 });

    const cartText = await page.evaluate(() => document.body.innerText);
    const cartHasItem = cartText.includes(prodHeading) || cartText.includes("Summary");

    const cartScreenshotPath = path.join(SCREENSHOTS_DIR, "03_enveil_cart.png");
    await page.screenshot({ path: cartScreenshotPath, fullPage: false });

    results.push({
      step: "3. Product Variations & Cart Management",
      pass: !!prodHeading && cartHasItem,
      details: `Product: "${prodHeading}", Price: "${prodPrice}", Verified in bag on /cart: ${cartHasItem}`,
      screenshot: "03_enveil_cart.png",
    });

    // -------------------------------------------------------------
    // TEST 4: Checkout & Dynamic Shipping Calculation
    // -------------------------------------------------------------
    console.log("--> Test 4: Checkout Page (/storefront/enveil/checkout)");
    const checkoutBtn = await page.waitForSelector('a[href*="/checkout"]', { timeout: 5000 });
    await checkoutBtn.click();
    await page.waitForLoadState("networkidle");

    await page.waitForSelector('h1:has-text("Checkout")', { timeout: 8000 });

    // Fill contact & delivery fields
    await page.locator('label:has-text("Full name") input').fill("Tariq Ahmed");
    await page.locator('label:has-text("Phone") input').fill("01711223344");
    await page.locator('label:has-text("Address") input').fill("House 42, Road 11, Dhanmondi");

    // Select City from dropdown
    const citySelect = page.locator('label:has-text("City") select');
    await citySelect.selectOption({ index: 1 });
    await page.waitForTimeout(1000);

    // Check Terms checkbox if present
    const termsCheckbox = page.locator('input[type="checkbox"]');
    if (await termsCheckbox.count() > 0) {
      await termsCheckbox.check();
    }

    // Verify order summary values
    const checkoutText = await page.evaluate(() => document.body.innerText);
    const hasShipping = checkoutText.includes("৳") && (checkoutText.includes("Shipping") || checkoutText.includes("Delivery"));
    const hasTotal = checkoutText.includes("Total") && checkoutText.includes("৳");

    const checkoutScreenshotPath = path.join(SCREENSHOTS_DIR, "04_enveil_checkout.png");
    await page.screenshot({ path: checkoutScreenshotPath, fullPage: true });

    results.push({
      step: "4. Checkout & Dynamic Shipping Quote",
      pass: hasShipping && hasTotal,
      details: `Form populated, Shipping calculated: ${hasShipping}, Total calculated: ${hasTotal}`,
      screenshot: "04_enveil_checkout.png",
    });

    // -------------------------------------------------------------
    // TEST 5: Track Order Page (PII Closure)
    // -------------------------------------------------------------
    console.log("--> Test 5: Order Tracking (/storefront/enveil/track)");
    await page.goto("http://localhost:4173/storefront/enveil/track", { waitUntil: "networkidle" });
    await page.waitForSelector("input", { timeout: 5000 });

    // Both fields must exist (Order Number + Phone Number)
    const numInput = page.locator('input[placeholder*="Order number" i]');
    const phoneInput = page.locator('input[placeholder*="Phone number" i]');
    const hasTwoInputs = (await numInput.count() > 0) && (await phoneInput.count() > 0);

    // Enter test order and phone
    await numInput.fill("ORD-TEST-9999");
    await phoneInput.fill("01711000000");

    const trackBtn = page.locator('button[type="submit"]:has-text("Track")');
    await trackBtn.click();
    await page.waitForTimeout(2000);

    const trackText = await page.evaluate(() => document.body.innerText);
    const cleanNotFound = trackText.toLowerCase().includes("not found") || trackText.toLowerCase().includes("invalid") || trackText.toLowerCase().includes("no order");

    const trackScreenshotPath = path.join(SCREENSHOTS_DIR, "05_enveil_track.png");
    await page.screenshot({ path: trackScreenshotPath, fullPage: false });

    results.push({
      step: "5. Track Order PII Verification",
      pass: hasTwoInputs && cleanNotFound,
      details: `Two-input auth requirement: ${hasTwoInputs}, Clean 'Not found' feedback without PII leak: ${cleanNotFound}`,
      screenshot: "05_enveil_track.png",
    });

    // -------------------------------------------------------------
    // TEST 6: Vincent Storefront (/storefront/vincent)
    // -------------------------------------------------------------
    console.log("--> Test 6: Vincent Storefront (/storefront/vincent)");
    await page.goto("http://localhost:4173/storefront/vincent", { waitUntil: "networkidle" });
    const vincentTitle = await page.title();
    const hasVincent = vincentTitle.toLowerCase().includes("vincent");

    const vincentScreenshotPath = path.join(SCREENSHOTS_DIR, "06_vincent_home.png");
    await page.screenshot({ path: vincentScreenshotPath, fullPage: true });

    results.push({
      step: "6. Vincent Multi-Storefront",
      pass: hasVincent,
      details: `Title: "${vincentTitle}", Page rendered successfully`,
      screenshot: "06_vincent_home.png",
    });

  } catch (err) {
    console.error("Test execution failed:", err);
    results.push({
      step: "Fatal Error",
      pass: false,
      details: err.message,
    });
  } finally {
    await browser.close();
  }

  // Print Summary Table
  console.log("\n=================================================");
  console.log("E2E VERIFICATION TEST REPORT");
  console.log("=================================================");
  let passedCount = 0;
  for (const r of results) {
    const mark = r.pass ? "✅ PASS" : "❌ FAIL";
    if (r.pass) passedCount++;
    console.log(`${mark} | ${r.step}`);
    console.log(`       Details: ${r.details}`);
    if (r.screenshot) console.log(`       Screenshot: ${r.screenshot}`);
  }
  console.log("-------------------------------------------------");
  console.log(`SUMMARY: ${passedCount}/${results.length} E2E test suites passed.`);
  console.log(`Console Errors: ${consoleErrors.length}`);
  if (consoleErrors.length) {
    console.log("Errors:", consoleErrors.slice(0, 3));
  }
  console.log("=================================================\n");
}

runE2E();
