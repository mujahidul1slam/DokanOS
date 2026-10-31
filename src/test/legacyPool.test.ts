import { describe, expect, it } from "vitest";
import {
  LEGACY_POOL_ORIGIN_KIND,
  LEGACY_POOL_TAG,
  applyPoolFilter,
  customerReassignPayload,
  likeTerm,
  orderReassignPayload,
  poolCustomerFilters,
  poolOrderFilters,
  sanitizeSearchTerm,
  type ReassignTarget,
} from "@/lib/legacyPool";

/**
 * Task 15 (spec §7): the pool predicates must stay the EXACT shapes
 * `scripts/migrate-enveil-vincent.sql` step 10 writes (tag + unbound binding
 * columns), and a reassignment must write the brand binding the migration's
 * attribution uses — with `legacy` provenance preserved.
 */

const brandWithStore: ReassignTarget["brand"] = {
  id: "brand-1",
  name: "Vincent",
  woo_store_id: "store-1",
};
const brandStoreless: ReassignTarget["brand"] = {
  id: "brand-2",
  name: "Enveil",
  woo_store_id: null,
};
const source: ReassignTarget["source"] = { id: "source-1", name: "Main Showroom" };

describe("legacy pool predicates (scripts/migrate-enveil-vincent.sql step 10)", () => {
  it("orders: the legacy migration tag plus the four binding NULLs the script targets", () => {
    expect(poolOrderFilters).toEqual([
      { column: "source", op: "eq", value: "legacy migration" },
      { column: "store_id", op: "is", value: null },
      { column: "selling_point_id", op: "is", value: null },
      { column: "storefront_id", op: "is", value: null },
      { column: "order_source_id", op: "is", value: null },
    ]);
  });

  it("customers: the tag, origin_kind 'legacy', and the two binding NULLs", () => {
    expect(poolCustomerFilters).toEqual([
      { column: "source", op: "eq", value: "legacy migration" },
      { column: "origin_kind", op: "eq", value: "legacy" },
      { column: "store_id", op: "is", value: null },
      { column: "origin_order_source_id", op: "is", value: null },
    ]);
  });

  it("the tag and kind constants are the script's literals", () => {
    expect(LEGACY_POOL_TAG).toBe("legacy migration");
    expect(LEGACY_POOL_ORIGIN_KIND).toBe("legacy");
  });

  it("applyPoolFilter applies every predicate as the right operator", () => {
    const calls: Array<[string, string, string | null]> = [];
    const chain = {
      is(column: string, value: null) {
        calls.push(["is", column, value]);
        return chain;
      },
      eq(column: string, value: string) {
        calls.push(["eq", column, value]);
        return chain;
      },
    };
    applyPoolFilter(chain, poolCustomerFilters);
    expect(calls).toEqual([
      ["eq", "source", "legacy migration"],
      ["eq", "origin_kind", "legacy"],
      ["is", "store_id", null],
      ["is", "origin_order_source_id", null],
    ]);
  });
});

describe("reassign payloads (spec §7 data mapping: brand + provenance legacy)", () => {
  it("orders bind to the brand's order source and keep the transitional store binding", () => {
    expect(orderReassignPayload({ brand: brandWithStore, source })).toEqual({
      order_source_id: "source-1",
      store_id: "store-1",
    });
  });

  it("orders from a store-less brand bind through the source alone (as the script's inference does)", () => {
    expect(orderReassignPayload({ brand: brandStoreless, source })).toEqual({
      order_source_id: "source-1",
    });
  });

  it("customers bind to the source with provenance kept as legacy", () => {
    expect(customerReassignPayload({ brand: brandWithStore, source })).toEqual({
      origin_order_source_id: "source-1",
      origin_kind: "legacy",
      store_id: "store-1",
    });
  });

  it("customers from a store-less brand keep the legacy provenance without a store binding", () => {
    expect(customerReassignPayload({ brand: brandStoreless, source })).toEqual({
      origin_order_source_id: "source-1",
      origin_kind: "legacy",
    });
  });
});

describe("search terms for PostgREST or() filters", () => {
  it("strips characters that would change the filter grammar", () => {
    expect(sanitizeSearchTerm('ra,him ("x") \'y\'')).toBe("rahim x y");
  });

  it("caps runaway input", () => {
    expect(sanitizeSearchTerm("x".repeat(500))).toHaveLength(80);
  });

  it("wraps non-empty terms as an ilike pattern and returns null for empty ones", () => {
    expect(likeTerm("  rahim  ")).toBe("%rahim%");
    expect(likeTerm("   ")).toBeNull();
  });
});
