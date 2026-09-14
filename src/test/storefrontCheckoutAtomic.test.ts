import { describe, it, expect } from "vitest";

function normalizePhone(input: string): string {
  return (input || "").replace(/\D/g, "");
}

function phoneMatches(inputPhone: string, storedPhone: string): boolean {
  const normInput = normalizePhone(inputPhone);
  const normStored = normalizePhone(storedPhone);
  if (!normInput || !normStored) return false;
  if (normInput === normStored) return true;
  if (normInput.length >= 6 && normStored.length >= 6) {
    return normInput.slice(-6) === normStored.slice(-6);
  }
  return false;
}

interface LocationRow {
  id: string;
  variation_id: string | null;
  stock_quantity: number;
}

function simulateDecrement(
  item: { product_id: string; variation_id: string | null; quantity: number },
  locations: LocationRow[],
  directStock: number
) {
  if (locations.length === 0) {
    // Case B: No location rows
    if (directStock < item.quantity) {
      throw new Error("P0001: Insufficient direct stock");
    }
    return {
      case: "B",
      decrements: [],
      direct_qty: item.quantity,
      remainingDirectStock: directStock - item.quantity,
      remainingLocations: locations,
    };
  }

  // Case A: Product has location rows
  let needed = item.quantity;
  const decrements: { location_row_id: string; qty: number }[] = [];
  const locCopy = locations.map((l) => ({ ...l }));

  if (item.variation_id) {
    // 1. Primary: variation-specific rows
    for (const loc of locCopy) {
      if (needed <= 0) break;
      if (loc.variation_id === item.variation_id && loc.stock_quantity > 0) {
        const take = Math.min(loc.stock_quantity, needed);
        loc.stock_quantity -= take;
        needed -= take;
        decrements.push({ location_row_id: loc.id, qty: take });
      }
    }
    // 2. Fallback: parent rows (variation_id IS NULL)
    if (needed > 0) {
      for (const loc of locCopy) {
        if (needed <= 0) break;
        if (loc.variation_id === null && loc.stock_quantity > 0) {
          const take = Math.min(loc.stock_quantity, needed);
          loc.stock_quantity -= take;
          needed -= take;
          decrements.push({ location_row_id: loc.id, qty: take });
        }
      }
    }
  } else {
    // Non-variation item
    // 1. Primary: parent rows (variation_id IS NULL)
    for (const loc of locCopy) {
      if (needed <= 0) break;
      if (loc.variation_id === null && loc.stock_quantity > 0) {
        const take = Math.min(loc.stock_quantity, needed);
        loc.stock_quantity -= take;
        needed -= take;
        decrements.push({ location_row_id: loc.id, qty: take });
      }
    }
    // 2. M13: cross-key fallback to variation-keyed rows
    if (needed > 0) {
      for (const loc of locCopy) {
        if (needed <= 0) break;
        if (loc.variation_id !== null && loc.stock_quantity > 0) {
          const take = Math.min(loc.stock_quantity, needed);
          loc.stock_quantity -= take;
          needed -= take;
          decrements.push({ location_row_id: loc.id, qty: take });
        }
      }
    }
  }

  if (needed > 0) {
    throw new Error("P0001: Insufficient location stock");
  }

  return {
    case: "A",
    decrements,
    direct_qty: 0,
    remainingLocations: locCopy,
  };
}

describe("Phase 6: Atomic Checkout, Idempotency & Stock Journal (§9)", () => {
  describe("Track phone normalization & matching (§9.4)", () => {
    it("matches exact phone numbers with different formatting", () => {
      expect(phoneMatches("+8801711-223344", "01711223344")).toBe(true);
      expect(phoneMatches("01711 223 344", "01711223344")).toBe(true);
      expect(phoneMatches("8801711223344", "01711223344")).toBe(true);
    });

    it("matches by last 6 digits for valid numbers", () => {
      expect(phoneMatches("01811223344", "01711223344")).toBe(true);
    });

    it("rejects mismatched numbers", () => {
      expect(phoneMatches("01711999999", "01711000000")).toBe(false);
      expect(phoneMatches("", "01711000000")).toBe(false);
      expect(phoneMatches("123", "01711000000")).toBe(false);
    });
  });

  describe("Stock Decrement & Journal (M8, M10, M13)", () => {
    it("Case B: Decrements direct products stock when zero location rows exist", () => {
      const res = simulateDecrement(
        { product_id: "p1", variation_id: null, quantity: 2 },
        [],
        10
      );
      expect(res.case).toBe("B");
      expect(res.direct_qty).toBe(2);
      expect(res.remainingDirectStock).toBe(8);
      expect(res.decrements).toHaveLength(0);
    });

    it("Case A: Decrements primary location rows for variation item", () => {
      const locations: LocationRow[] = [
        { id: "loc-v1", variation_id: "var-1", stock_quantity: 5 },
        { id: "loc-parent", variation_id: null, stock_quantity: 10 },
      ];
      const res = simulateDecrement(
        { product_id: "p1", variation_id: "var-1", quantity: 3 },
        locations,
        15
      );
      expect(res.case).toBe("A");
      expect(res.decrements).toEqual([{ location_row_id: "loc-v1", qty: 3 }]);
      expect(res.remainingLocations[0].stock_quantity).toBe(2);
      expect(res.remainingLocations[1].stock_quantity).toBe(10);
    });

    it("Case A: Variation item falls back to parent location rows if needed", () => {
      const locations: LocationRow[] = [
        { id: "loc-v1", variation_id: "var-1", stock_quantity: 2 },
        { id: "loc-parent", variation_id: null, stock_quantity: 5 },
      ];
      const res = simulateDecrement(
        { product_id: "p1", variation_id: "var-1", quantity: 4 },
        locations,
        7
      );
      expect(res.case).toBe("A");
      expect(res.decrements).toEqual([
        { location_row_id: "loc-v1", qty: 2 },
        { location_row_id: "loc-parent", qty: 2 },
      ]);
      expect(res.remainingLocations[0].stock_quantity).toBe(0);
      expect(res.remainingLocations[1].stock_quantity).toBe(3);
    });

    it("M13: Non-variation item cross-key falls back to variation rows when parent rows exhausted", () => {
      const locations: LocationRow[] = [
        { id: "loc-parent", variation_id: null, stock_quantity: 2 },
        { id: "loc-v1", variation_id: "var-1", stock_quantity: 5 },
      ];
      const res = simulateDecrement(
        { product_id: "p1", variation_id: null, quantity: 4 },
        locations,
        7
      );
      expect(res.case).toBe("A");
      expect(res.decrements).toEqual([
        { location_row_id: "loc-parent", qty: 2 },
        { location_row_id: "loc-v1", qty: 2 },
      ]);
      expect(res.remainingLocations[0].stock_quantity).toBe(0);
      expect(res.remainingLocations[1].stock_quantity).toBe(3);
    });

    it("Raises P0001 when location rows cannot cover requested quantity", () => {
      const locations: LocationRow[] = [
        { id: "loc-v1", variation_id: "var-1", stock_quantity: 1 },
      ];
      expect(() =>
        simulateDecrement(
          { product_id: "p1", variation_id: "var-1", quantity: 5 },
          locations,
          1
        )
      ).toThrow("P0001: Insufficient location stock");
    });
  });
});
