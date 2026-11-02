import { describe, it, expect } from "vitest";
import {
  buildPosDailyPrintDocument,
  type PosDailySummaryData,
} from "@/pages/posReports/posDailyPrint";

const summary = (overrides: Partial<PosDailySummaryData> = {}): PosDailySummaryData => ({
  dateLabel: "Oct 27, 2026",
  businessName: "DokanOS",
  storeLabel: "All Stores",
  currencySymbol: "৳",
  printedAt: "10/27/2026, 8:00:00 PM",
  sales: {
    orderCount: 12,
    gross: 24500,
    discounts: 500,
    returns: 300,
    net: 23700,
    shipping: 800,
    tax: 120,
    totalInvoiced: 24620,
  },
  cash: {
    collectedTotal: 22000,
    onPriorOrders: 1500,
    refundsTotal: 300,
    netCash: 21700,
    byMethod: [
      { name: "Cash", value: 15000 },
      { name: "Bkash", value: 7000 },
    ],
  },
  fulfillment: {
    walkinDelivered: 5,
    pickupPending: 1,
    pickupCompleted: 2,
    deliveryPending: 2,
    deliveryCompleted: 2,
    cancelled: 1,
    returned: 1,
  },
  topProducts: [{ name: "Premium Cotton Shirt", qty: 4, revenue: 6000 }],
  ...overrides,
});

/** Every #rgb/#rrggbb value in the document. */
const hexColors = (html: string): string[] =>
  (html.match(/#([0-9a-f]{3}|[0-9a-f]{6})\b/gi) || []).map((h) => h.toLowerCase());

const isNeutral = (hex: string): boolean => {
  const body = hex.slice(1);
  const full = body.length === 3 ? body.split("").map((c) => c + c).join("") : body;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return r === g && g === b;
};

describe("POS daily summary print (issue #24)", () => {
  it("renders the one-day summary through the printWindow document pattern", () => {
    const html = buildPosDailyPrintDocument(summary(), "thermal");
    expect(html).toContain("POS Daily Summary");
    expect(html).toContain("Oct 27, 2026");
    expect(html).toContain("DokanOS");
    expect(html).toContain("All Stores");
    expect(html).toContain("window.print()"); // PRINT_BOOTSTRAP, no second print() call
  });

  it("shows sales, cash-by-method, fulfillment and top product figures", () => {
    const html = buildPosDailyPrintDocument(summary(), "a4");
    expect(html).toContain("Net sales");
    // Locale-agnostic: mirror the builder's own number formatting.
    expect(html).toContain(Number(23700).toLocaleString());
    expect(html).toContain("Cash");
    expect(html).toContain("Bkash");
    expect(html).toContain("Net cash");
    expect(html).toContain("Fulfillment");
    expect(html).toContain("Top Products");
    expect(html).toContain("Premium Cotton Shirt");
  });

  it("renders thermal as strictly monochrome with all-bold text by default", () => {
    const html = buildPosDailyPrintDocument(summary(), "thermal");
    expect(hexColors(html).every(isNeutral)).toBe(true);
    expect(html).toContain("font-weight: 700 !important");
  });

  it("honors the bold opt-out on thermal", () => {
    const html = buildPosDailyPrintDocument(summary(), "thermal", { bold: false });
    expect(html).not.toContain("font-weight: 700 !important");
  });

  it("uses thermal @page geometry for thermal and plain A4 otherwise", () => {
    expect(buildPosDailyPrintDocument(summary(), "thermal")).toContain("80mm auto");
    const a4 = buildPosDailyPrintDocument(summary(), "a4");
    expect(a4).toContain("size: A4");
    expect(a4).not.toContain("font-weight: 700 !important");
  });

  it("escapes external strings before they enter the document", () => {
    const html = buildPosDailyPrintDocument(
      summary({ topProducts: [{ name: "<script>alert(1)</script>", qty: 1, revenue: 10 }] }),
      "a4",
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
