import { describe, expect, it } from "vitest";
import {
  buildStockHolders,
  holderKey,
  mergeTransferLines,
  normalizeFulfillmentPreference,
  parseHolderKey,
  validateTransfer,
  type StockHolder,
  type TransferLine,
} from "@/lib/stockHolders";

const warehouse = (id: string, name: string, isDefault = false): StockHolder => ({
  key: holderKey("warehouse", id),
  kind: "warehouse",
  id,
  name,
  brandId: "brand-1",
  isDefault,
});

const showroom = (id: string, name: string): StockHolder => ({
  key: holderKey("source", id),
  kind: "source",
  id,
  name,
  brandId: "brand-1",
});

describe("stock holders (spec §3)", () => {
  it("builds holders from warehouses + stock-holding sources only", () => {
    const holders = buildStockHolders(
      [{ id: "w1", brand_id: "brand-1", name: "Main Warehouse", is_default: true }],
      [
        { id: "s1", brand_id: "brand-1", name: "Main Showroom", is_stock_holding: true },
        { id: "s2", brand_id: "brand-1", name: "Facebook", is_stock_holding: false },
        { id: "s3", brand_id: "brand-1", name: "Pop-up", is_stock_holding: null }, // default-off here
      ],
    );
    expect(holders.map((h) => h.key)).toEqual(["warehouse:w1", "source:s1"]);
    expect(holders[0].isDefault).toBe(true);
  });

  it("round-trips holder keys and rejects junk", () => {
    expect(holderKey("source", "abc")).toBe("source:abc");
    expect(parseHolderKey("warehouse:w1")).toEqual({ kind: "warehouse", id: "w1" });
    expect(parseHolderKey("nonsense")).toBeNull();
    expect(parseHolderKey("warehouse:")).toBeNull();
  });

  it("normalizes fulfillment preference: valid ids in order, no dups, no dangling", () => {
    const holders = [warehouse("w1", "W1"), showroom("s1", "Showroom"), warehouse("w2", "W2")];
    expect(normalizeFulfillmentPreference(["s1", "w2", "s1", "gone", "w1"], holders)).toEqual([
      "s1",
      "w2",
      "w1",
    ]);
    expect(normalizeFulfillmentPreference("not-an-array", holders)).toEqual([]);
    expect(normalizeFulfillmentPreference(null, holders)).toEqual([]);
    expect(normalizeFulfillmentPreference([42, { id: "w1" }], holders)).toEqual([]);
  });
});

describe("transfers (Q14)", () => {
  const from = warehouse("w1", "Main Warehouse");
  const to = showroom("s1", "Main Showroom");

  it("merges duplicate lines and drops non-positive noise", () => {
    const lines: TransferLine[] = [
      { productId: "p1", variationId: null, quantity: 3 },
      { productId: "p1", variationId: null, quantity: 2 },
      { productId: "p2", variationId: "v1", quantity: 1 },
      { productId: "p2", variationId: "v2", quantity: 0 },
      { productId: "p3", variationId: null, quantity: -5 },
    ];
    expect(mergeTransferLines(lines)).toEqual([
      { productId: "p1", variationId: null, quantity: 5, label: undefined },
      { productId: "p2", variationId: "v1", quantity: 1, label: undefined },
    ]);
  });

  it("validates endpoints, brand, and lines", () => {
    expect(validateTransfer({ brandId: "brand-1", from, to, lines: [{ productId: "p1", variationId: null, quantity: 1 }] })).toBeNull();
    expect(validateTransfer({ brandId: "brand-1", from, to: from, lines: [{ productId: "p1", variationId: null, quantity: 1 }] })).toMatch("different");
    expect(validateTransfer({ brandId: "brand-2", from, to, lines: [{ productId: "p1", variationId: null, quantity: 1 }] })).toMatch("belong");
    expect(validateTransfer({ brandId: "brand-1", from, to, lines: [] })).toMatch("item");
    expect(validateTransfer({ brandId: "brand-1", from, to, lines: [{ productId: "p1", variationId: null, quantity: 0 }] })).toMatch("item");
  });
});
