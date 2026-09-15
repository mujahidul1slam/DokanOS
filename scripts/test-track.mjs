import { chromium } from "@playwright/test";

async function testTrack() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  await page.goto("http://localhost:4173/storefront/enveil/track", { waitUntil: "networkidle" });
  const inputs = await page.$$("input");
  await inputs[0].fill("ORD-99999");
  await inputs[1].fill("01711000000");
  await page.click('button:has-text("Track")');
  await page.waitForTimeout(1500);
  const text = await page.evaluate(() => document.body.innerText);
  console.log("TRACK TEXT OUTPUT:\n", text);
  await browser.close();
}

testTrack();
