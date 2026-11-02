import { describe, it, expect, vi } from "vitest";
import {
  buildPrintDocument,
  buildSlipCss,
  buildSlipPagesHtml,
  monochromeAccent,
  sourceLabel,
  thermalTextCss,
  type SlipOrderData,
} from "@/lib/pickupSlipHtml";
import { defaultPickupSlipSizing, type PickupSlipTemplateConfig } from "@/hooks/useInvoiceSettings";
import { buildMeasurementSlipHtml, type MeasurementSlipRenderData } from "@/components/orders/MeasurementSlipPrint";
import { applyThermalInvoiceStyles } from "@/components/pos/InvoicePrint";

// The barcode renderer needs real SVG layout; the pickup slip pipeline covers
// it in production. Stub it so these tests stay deterministic.
vi.mock("@/lib/barcodeSvg", () => ({
  makeBarcodeSvg: vi.fn((value: string) => (value ? `<svg>stub-${value}</svg>` : "")),
}));

// No database in unit tests: the print components only reach supabase outside
// the pure builders under test.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const tpl = (overrides: Partial<PickupSlipTemplateConfig> = {}): PickupSlipTemplateConfig => ({
  show_order_number: true,
  show_customer_name: true,
  show_customer_phone: true,
  show_customer_address: true,
  show_items: true,
  show_item_qty: true,
  show_total: true,
  show_due: true,
  show_notes: true,
  title: "PICKUP SLIP",
  show_brand: true,
  show_selling_point: true,
  show_source: true,
  show_pathao_account: true,
  show_dispatch_status: true,
  bold_thermal_text: true,
  custom_fields: [],
  sizing: defaultPickupSlipSizing,
  ...overrides,
});

const order = (overrides: Partial<SlipOrderData> = {}): SlipOrderData => ({
  order_number: "DKN-12847",
  total: 2450,
  amount_to_collect: 2530,
  customer_name: "Tanvir Ahmed",
  customer_phone: "01711-234567",
  customer_address: "House 42, Banani, Dhaka",
  special_instruction: "Call before delivery",
  productItems: [{ name: "Premium Cotton Shirt", qty: 1 }],
  brand: { id: "b1", name: "Nuvia Fashion", accent: "#c0392b" },
  sellingPointName: "Banani Showroom",
  sourceLabel: "WooCommerce",
  pathaoAccount: { name: "Nuvia Courier", pickupStoreName: "Banani Hub", isDefault: true },
  dispatched: false,
  consignmentId: null,
  ...overrides,
});

const slipHtml = (o: SlipOrderData, t: PickupSlipTemplateConfig, mono = false) =>
  buildSlipPagesHtml(o, t, "BDT", { mono })[0];

/** Every #rgb/#rrggbb value in the document. */
const hexColors = (html: string): string[] =>
  (html.match(/#([0-9a-f]{3}|[0-9a-f]{6})\b/gi) || []).map((h) => h.toLowerCase());

const isNeutral = (hex: string): boolean => {
  const body = hex.slice(1);
  const full = body.length === 3 ? body.split("").map((c) => c + c).join("") : body;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return r === g && g === b;
};

describe("pickup slip elements (issue #24)", () => {
  it("renders brand, selling point, source, Pathao Account and dispatch status by default", () => {
    const html = slipHtml(order(), tpl());
    expect(html).toContain("Nuvia Fashion");
    expect(html).toContain("Banani Showroom");
    expect(html).toContain(">Source<");
    expect(html).toContain("WooCommerce");
    expect(html).toContain(">Pathao Account<");
    expect(html).toContain("Nuvia Courier");
    expect(html).toContain("Banani Hub");
    expect(html).toContain(">Status<");
    expect(html).toContain("Not dispatched");
  });

  it("treats every new element toggle as opt-out (undefined still renders)", () => {
    const legacyStyle = tpl({
      show_brand: undefined,
      show_selling_point: undefined,
      show_source: undefined,
      show_pathao_account: undefined,
      show_dispatch_status: undefined,
    });
    const html = slipHtml(order(), legacyStyle);
    expect(html).toContain("Nuvia Fashion");
    expect(html).toContain("Banani Showroom");
    expect(html).toContain(">Source<");
    expect(html).toContain(">Pathao Account<");
    expect(html).toContain(">Status<");
  });

  it("hides the brand block without dropping the Selling Point", () => {
    const html = slipHtml(order(), tpl({ show_brand: false }));
    expect(html).not.toContain("Nuvia Fashion");
    expect(html).not.toContain('class="brand-identity"');
    expect(html).toContain("Banani Showroom");
    expect(html).toContain("Selling Point");
  });

  it("hides the Selling Point independently", () => {
    const html = slipHtml(order(), tpl({ show_selling_point: false }));
    expect(html).toContain("Nuvia Fashion");
    expect(html).not.toContain("Banani Showroom");
  });

  it("hides source, Pathao Account and dispatch status independently", () => {
    const html = slipHtml(
      order(),
      tpl({ show_source: false, show_pathao_account: false, show_dispatch_status: false }),
    );
    expect(html).not.toContain(">Source<");
    expect(html).not.toContain("Pathao Account");
    expect(html).not.toContain(">Status<");
    expect(html).toContain("Nuvia Fashion");
  });
});

describe("Pathao Account line rules (issue #24)", () => {
  it("marks the brand/selling-point default account before dispatch", () => {
    const html = slipHtml(order({ dispatched: false }), tpl());
    expect(html).toContain("Nuvia Courier");
    expect(html).toContain("(default)");
    expect(html).toContain("Not dispatched");
  });

  it("shows the actual account without the default marker once dispatched", () => {
    const html = slipHtml(
      order({
        dispatched: true,
        consignmentId: "PTH-903211",
        pathaoAccount: { name: "Nuvia Courier", pickupStoreName: "Dhanmondi Hub", isDefault: true },
      }),
      tpl(),
    );
    expect(html).toContain("Nuvia Courier");
    expect(html).toContain("Dhanmondi Hub");
    expect(html).not.toContain("(default)");
    expect(html).toContain("Dispatched");
    expect(html).toContain("PTH-903211");
  });

  it("states 'Pathao Account not selected' when nothing is configured", () => {
    const html = slipHtml(order({ pathaoAccount: null }), tpl());
    expect(html).toContain("Pathao Account not selected");
  });

  it("keeps the element hidden when the caller resolved nothing (undefined)", () => {
    const html = slipHtml(order({ pathaoAccount: undefined }), tpl());
    expect(html).not.toContain("Pathao Account");
  });
});

describe("thermal monochrome + bold (issue #24)", () => {
  it("renders strictly neutral colors on thermal, accents degraded to gray", () => {
    const html = buildPrintDocument([order()], tpl(), "thermal", "BDT");
    expect(hexColors(html).every(isNeutral)).toBe(true);
    expect(html).not.toContain("#c0392b");
    expect(html).toContain(monochromeAccent("#c0392b"));
    expect(html).toContain(monochromeAccent("#F5533D")); // Pathao mark degrades too
  });

  it("keeps brand accent colors on A4", () => {
    const html = buildPrintDocument([order()], tpl(), "a4", "BDT");
    expect(html).toContain("#c0392b");
  });

  it("renders all thermal text bold by default and honors the opt-out", () => {
    const boldRule = ".slip, .slip * { font-weight: 700 !important; }";
    expect(buildSlipCss(tpl(), "thermal")).toContain(boldRule);
    expect(buildSlipCss(tpl({ bold_thermal_text: undefined }), "thermal")).toContain(boldRule);
    expect(buildSlipCss(tpl({ bold_thermal_text: false }), "thermal")).not.toContain(boldRule);
  });

  it("leaves A4 styling untouched by the bold option", () => {
    const on = buildSlipCss(tpl({ bold_thermal_text: true }), "a4");
    const off = buildSlipCss(tpl({ bold_thermal_text: false }), "a4");
    expect(on).toBe(off);
  });

  it("derives deterministic neutral accent grays, clamped for legibility", () => {
    expect(monochromeAccent("#c0392b")).toBe(monochromeAccent("#c0392b"));
    expect(isNeutral(monochromeAccent("#c0392b"))).toBe(true);
    expect(isNeutral(monochromeAccent(null))).toBe(true);
    expect(monochromeAccent("#ffffff")).toBe("#666666"); // clamped dark for white text
    expect(monochromeAccent("not-a-color")).toBe(monochromeAccent("#334155"));
  });

  it("labels order sources with glossary wording", () => {
    expect(sourceLabel("pos")).toBe("POS");
    expect(sourceLabel("woocommerce")).toBe("WooCommerce");
    expect(sourceLabel("WOO")).toBe("WooCommerce");
    expect(sourceLabel("manual")).toBe("Manual");
    expect(sourceLabel("exchange")).toBe("Exchange");
    expect(sourceLabel("")).toBe("");
  });

  it("builds shared thermal overrides that flatten color and optionally bold", () => {
    const css = thermalTextCss(".invoice", { bold: true, grayClasses: [".meta"] });
    expect(css).toContain(".invoice, .invoice * { color: #111 !important; }");
    expect(css).toContain(".invoice .meta { color: #444 !important; }");
    expect(css).toContain("font-weight: 700 !important");
    expect(thermalTextCss(".invoice", { bold: false })).not.toContain("font-weight: 700 !important");
  });
});

describe("POS invoice thermal styles (issue #24)", () => {
  const html = "<html><head><title>t</title></head><body><div class='invoice'>x</div></body></html>";

  it("injects monochrome + bold rules for thermal documents", () => {
    const out = applyThermalInvoiceStyles(html, { bold: true });
    expect(out).toContain(".invoice, .invoice * { color: #111 !important; }");
    expect(out).toContain("font-weight: 700 !important");
    expect(out.indexOf("<style>")).toBeLessThan(out.indexOf("</head>"));
  });

  it("omits the bold rule when the option is off", () => {
    const out = applyThermalInvoiceStyles(html, { bold: false });
    expect(out).not.toContain("font-weight: 700 !important");
  });
});

describe("measurement slip (issue #24)", () => {
  const data: MeasurementSlipRenderData = {
    orderNumber: "DKN-12847",
    orderDate: "2026-10-27T10:00:00Z",
    customerName: "Tanvir Ahmed",
    customerPhone: "01711-234567",
    businessName: "DokanOS",
    productLines: [
      {
        product_name: "Premium Cotton Shirt",
        sku: "SKU-1",
        measurements: [
          { groupName: "Body", displayFormat: "label_value", unit: "in", values: [{ name: "Chest", value: "40" }] },
        ],
      },
    ],
    orphans: [],
    detail: {
      brand: { id: "b1", name: "Nuvia Fashion", accent: "#c0392b" },
      sellingPointName: "Banani Showroom",
      sourceLabel: "WooCommerce",
      source: "woocommerce",
      pathaoAccount: { name: "Nuvia Courier", pickupStoreName: "Banani Hub", isDefault: true },
      dispatched: false,
      consignmentId: null,
    },
  };

  it("carries the brand and Pathao Account lines", () => {
    const html = buildMeasurementSlipHtml(data, { print_format: "a4" });
    expect(html).toContain("Nuvia Fashion");
    expect(html).toContain("Nuvia Courier");
    expect(html).toContain("Banani Hub");
    expect(html).toContain("(default)");
    expect(html).not.toContain("Pathao Account not selected");
  });

  it("shows the actual account without the marker once dispatched", () => {
    const html = buildMeasurementSlipHtml(
      { ...data, detail: { ...data.detail, dispatched: true, consignmentId: "PTH-1" } },
      { print_format: "a4" },
    );
    expect(html).not.toContain("(default)");
  });

  it("states 'Pathao Account not selected' when none is configured", () => {
    const html = buildMeasurementSlipHtml(
      { ...data, detail: { ...data.detail, pathaoAccount: null } },
      { print_format: "a4" },
    );
    expect(html).toContain("Pathao Account not selected");
  });

  it("hides the brand and Pathao lines independently", () => {
    const html = buildMeasurementSlipHtml(data, { print_format: "a4", show_brand: false, show_pathao_account: false });
    expect(html).not.toContain("Nuvia Fashion");
    expect(html).not.toContain("Pathao Account");
    expect(html).toContain("Premium Cotton Shirt");
  });

  it("keeps thermal monochrome and all-bold, honoring the bold opt-out", () => {
    const bold = buildMeasurementSlipHtml(data, { print_format: "thermal" });
    expect(hexColors(bold).every(isNeutral)).toBe(true);
    expect(bold).not.toContain("#c0392b");
    expect(bold).toContain("font-weight: 700 !important");

    const notBold = buildMeasurementSlipHtml(data, { print_format: "thermal", bold_thermal_text: false });
    expect(notBold).not.toContain("font-weight: 700 !important");
  });

  it("leaves A4 styling untouched by the bold option", () => {
    const on = buildMeasurementSlipHtml(data, { print_format: "a4", bold_thermal_text: true });
    const off = buildMeasurementSlipHtml(data, { print_format: "a4", bold_thermal_text: false });
    expect(on).toBe(off);
    expect(on).not.toContain("font-weight: 700 !important");
  });
});
