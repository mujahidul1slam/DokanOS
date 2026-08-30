import { describe, it, expect, vi } from "vitest";
import type { Cart } from "@/components/pos/types";
import { defaultInvoiceSizing, defaultInvoiceTemplate, type InvoiceTemplateConfig } from "@/hooks/useInvoiceSettings";
import { buildInvoiceCss, buildInvoiceInnerHtml, buildInvoicePrintDocument, type InvoiceBizInfo } from "@/lib/invoiceHtml";

// The barcode renderer needs real SVG layout; its correctness is covered by the
// pickup slip print pipeline in production. Stub it so these tests exercise
// the builder logic deterministically.
vi.mock("@/lib/barcodeSvg", () => ({
  makeBarcodeSvg: vi.fn((value: string) => (value ? `<svg>stub-${value}</svg>` : "")),
}));

const biz: InvoiceBizInfo = {
  business_name: "DokanOS",
  tagline: "Shop Smart",
  address: "Banani, Dhaka",
  phone: "01700000000",
  email: "hello@dokanos.com",
  logo_url: "https://example.com/logo.png",
  footer_text: "Thank you!",
  terms_text: "No returns after 7 days.",
};

const cart: Cart = {
  id: "cart-1",
  label: "TEST",
  items: [
    { uid: "i1", productId: "p1", name: "Cotton Shirt", variationLabel: "L / Navy", price: 1000, qty: 2, customTailoring: false },
    { uid: "i2", productId: "p2", name: "Wool Blazer", price: 1500, qty: 1, customTailoring: true },
  ],
  customer: { name: "Tanvir Ahmed", phone: "01711234567", address: "House 42, Banani", city: "Dhaka", zone: "" },
  fulfillment: "delivery",
  shippingAddress: "",
  pathaoZone: "",
  discount: 200,
  discountType: "flat",
  shippingFee: 80,
  payments: [{ id: "pay1", method: "cash", amount: 1500 }],
  notes: "Handle with care.",
  taxRate: 0,
};

// subtotal 3500, total = 3500 - 200 + 80 = 3380, paid 1500, due 1880
const data = { orderNumber: "DKN-1001", cart, subtotal: 3500, total: 3380 };
const date = new Date("2026-08-31T10:00:00Z");

const tpl = (over: Partial<InvoiceTemplateConfig> = {}): InvoiceTemplateConfig => ({
  ...defaultInvoiceTemplate,
  ...over,
  sizing: { ...defaultInvoiceSizing, ...(over.sizing || {}) },
});

describe("buildInvoiceInnerHtml", () => {
  it("renders business header, invoice number, customer and totals", () => {
    const html = buildInvoiceInnerHtml(data, tpl(), biz, date);
    expect(html).toContain("DokanOS");
    expect(html).toContain("Invoice: DKN-1001");
    expect(html).toContain("Tanvir Ahmed");
    expect(html).toContain("Total: ৳3,380");
    expect(html).toContain("Shop Smart");
  });

  it("computes and renders the due amount from payments", () => {
    const html = buildInvoiceInnerHtml(data, tpl(), biz, date);
    expect(html).toContain("Due Amount: ৳1,880");
  });

  it("omits disabled sections", () => {
    const html = buildInvoiceInnerHtml(
      data,
      tpl({ show_total: false, show_customer: false, show_due: false, show_notes: false }),
      biz,
      date,
    );
    expect(html).not.toContain("total-row");
    expect(html).not.toContain("customer-block");
    expect(html).not.toContain("due-row");
    expect(html).not.toContain("Notes:");
  });

  it("omits zero-value discount and shipping rows", () => {
    const free = { ...data, cart: { ...cart, discount: 0, shippingFee: 0 }, total: 3500 };
    const html = buildInvoiceInnerHtml(free, tpl(), biz, date);
    expect(html).not.toContain("Discount:");
    expect(html).not.toContain("Shipping:");
  });

  it("renders qty / price / line-total columns per template flags", () => {
    const full = buildInvoiceInnerHtml(data, tpl(), biz, date);
    expect(full).toContain('class="qty"');
    expect(full).toContain("৳2,000"); // 1000 x 2 line total
    const noQty = buildInvoiceInnerHtml(data, tpl({ show_item_qty: false, show_item_price: false, show_item_total: false }), biz, date);
    expect(noQty).not.toContain('class="qty"');
    expect(noQty).not.toContain('class="price"');
  });

  it("renders only custom fields that have both label and value", () => {
    const html = buildInvoiceInnerHtml(
      data,
      tpl({ custom_fields: [{ label: "Served By", value: "Rafi" }, { label: "", value: "x" }, { label: "y", value: "" }] }),
      biz,
      date,
    );
    expect(html).toContain("Served By:");
    expect(html).not.toContain(">x<");
  });

  it("renders the barcode only when enabled", () => {
    const off = buildInvoiceInnerHtml(data, tpl({ show_barcode: false }), biz, date);
    expect(off).not.toContain("barcode");
    const on = buildInvoiceInnerHtml(data, tpl({ show_barcode: true }), biz, date);
    expect(on).toContain("stub-DKN-1001");
  });
});

describe("buildInvoiceCss", () => {
  it("drives thermal width and padding from sizing", () => {
    const css = buildInvoiceCss(tpl({ sizing: { ...defaultInvoiceSizing, thermal_width_mm: 58, thermal_padding_mm: 3 } }), "thermal");
    expect(css).toContain("width: 58mm");
    expect(css).toContain("padding: 3mm");
  });

  it("uses full width and configured padding on A4", () => {
    const css = buildInvoiceCss(tpl({ sizing: { ...defaultInvoiceSizing, a4_padding_mm: 7 } }), "a4");
    expect(css).toContain("width: 100%");
    expect(css).toContain("padding: 7mm");
  });

  it("reflects font-size customizations", () => {
    const css = buildInvoiceCss(tpl({ sizing: { ...defaultInvoiceSizing, total_size: 24 } }), "thermal");
    expect(css).toContain("font-size: 24px");
  });
});

describe("buildInvoicePrintDocument", () => {
  it("sets the thermal @page size and embeds the print bootstrap", () => {
    const doc = buildInvoicePrintDocument(data, tpl(), biz, "thermal");
    expect(doc).toContain("@page { size: 80mm auto; margin: 0; }");
    expect(doc).toContain("window.print");
    expect(doc).toContain("Invoice: DKN-1001");
  });

  it("sets A4 @page margin from sizing", () => {
    const doc = buildInvoicePrintDocument(data, tpl({ sizing: { ...defaultInvoiceSizing, a4_margin_mm: 12 } }), biz, "a4");
    expect(doc).toContain("@page { size: A4; margin: 12mm; }");
  });
});
