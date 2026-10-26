import { describe, it, expect } from "vitest";
import { fetchAllRows, SUPABASE_MAX_ROWS } from "@/lib/supabasePage";

interface Row {
  id: number;
  product_id?: string;
}

/**
 * Build a fake supabase page-query factory over a fixed dataset, mirroring the
 * hosted Supabase REST behavior: any single request silently truncates at
 * SUPABASE_MAX_ROWS (HTTP 200, no error) unless the caller pages via
 * range windows.
 */
function makeFakeQuery(rows: Row[], enforceServerCap = true) {
  let requested: { from: number; to: number }[] = [];
  const factory = ({ from, to }: { from: number; to: number }) => {
    requested.push({ from, to });
    let slice = rows.slice(from, to + 1);
    if (enforceServerCap && slice.length > SUPABASE_MAX_ROWS) {
      slice = slice.slice(0, SUPABASE_MAX_ROWS);
    }
    return Promise.resolve({ data: slice, error: null });
  };
  return { factory, requested: () => requested };
}

describe("fetchAllRows (paged Supabase fetching)", () => {
  it("returns all rows from a single short page", async () => {
    const rows = Array.from({ length: 42 }, (_, i) => ({ id: i }));
    const { factory, requested } = makeFakeQuery(rows);
    const out = await fetchAllRows(factory);
    expect(out).toHaveLength(42);
    expect(requested()).toEqual([{ from: 0, to: SUPABASE_MAX_ROWS - 1 }]);
  });

  // Regression: the Add Order variation-selector bug. product_variations had
  // 1180 rows; the unpaginated fetch was silently truncated at 1000 by the
  // hosted Supabase max-rows cap (HTTP 200, no error), so products whose
  // variations fell past the boundary showed no variation selector (added
  // without a size) or only some of their sizes.
  it("pages past the 1000-row server cap instead of being silently truncated", async () => {
    const rows = Array.from({ length: 1180 }, (_, i) => ({
      id: i,
      product_id: `prod-${Math.floor(i / 4)}`,
    }));
    const { factory, requested } = makeFakeQuery(rows);
    const out = await fetchAllRows(factory);
    expect(out).toHaveLength(1180);
    expect(requested()).toEqual([
      { from: 0, to: 999 },
      { from: 1000, to: 1999 },
    ]);
  });

  it("handles a table with an exact multiple of the page size", async () => {
    const rows = Array.from({ length: SUPABASE_MAX_ROWS * 2 }, (_, i) => ({ id: i }));
    const { factory, requested } = makeFakeQuery(rows);
    const out = await fetchAllRows(factory);
    expect(out).toHaveLength(2000);
    // Last full page is followed by an empty page (short page terminates).
    expect(requested()).toEqual([
      { from: 0, to: 999 },
      { from: 1000, to: 1999 },
      { from: 2000, to: 2999 },
    ]);
  });

  it("returns an empty array for an empty table without throwing", async () => {
    const { factory } = makeFakeQuery([]);
    const out = await fetchAllRows(factory);
    expect(out).toEqual([]);
  });

  it("throws on a query error so a failed fetch is never silent", async () => {
    const failing = () =>
      Promise.resolve({ data: null, error: { message: "network error" } });
    await expect(fetchAllRows(failing)).rejects.toThrow("network error");
  });

  it("treats null data as an empty page", async () => {
    const ok = () => Promise.resolve({ data: null, error: null });
    const out = await fetchAllRows(ok);
    expect(out).toEqual([]);
  });

  it("respects a custom page size", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ id: i }));
    const { factory, requested } = makeFakeQuery(rows);
    const out = await fetchAllRows(factory, 10);
    expect(out).toHaveLength(25);
    expect(requested()).toEqual([
      { from: 0, to: 9 },
      { from: 10, to: 19 },
      { from: 20, to: 29 },
    ]);
  });

  it("rejects a pageSize below 1", async () => {
    const { factory } = makeFakeQuery([{ id: 1 }]);
    await expect(fetchAllRows(factory, 0)).rejects.toThrow("pageSize must be >= 1");
  });
});
