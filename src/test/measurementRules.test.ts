import { describe, expect, it } from "vitest";
import {
  formatMeasurementPendingMarker,
  getDescendantIds,
  getGroupsWithoutRows,
  getMeasurementEntryStatus,
  getMissingMeasurementGroups,
  parseMeasurementRulesConfig,
  resolveGroupIdsForProduct,
  type AssignmentRule,
  type CategoryNode,
} from "@/lib/measurementRules";

/**
 * Fixture tree:
 *
 *   pants (main)
 *   ├── jeans
 *   │   ├── slim
 *   │   └── relaxed
 *   └── formal
 *   shirts (main)
 */
const CATEGORIES: CategoryNode[] = [
  { id: "pants", parent_id: null },
  { id: "jeans", parent_id: "pants" },
  { id: "slim", parent_id: "jeans" },
  { id: "relaxed", parent_id: "jeans" },
  { id: "formal", parent_id: "pants" },
  { id: "shirts", parent_id: null },
];

const resolve = (
  productId: string,
  productCategoryIds: string[],
  assignments: AssignmentRule[],
  extra?: Partial<Parameters<typeof resolveGroupIdsForProduct>[0]>,
) =>
  resolveGroupIdsForProduct({
    productId,
    productCategoryIds,
    categories: CATEGORIES,
    assignments,
    ...extra,
  });

describe("direct assignment matching", () => {
  it("applies a group assigned to a subcategory to products in that subcategory", () => {
    // Issue #28: "Assigning a measurement group to a subcategory applies to that subcategory."
    const assignments: AssignmentRule[] = [{ groupId: "g-pant", categoryId: "jeans", productId: null }];
    expect(resolve("p1", ["jeans"], assignments)).toEqual(["g-pant"]);
  });

  it("does not apply the group to products outside the assigned subcategory", () => {
    const assignments: AssignmentRule[] = [{ groupId: "g-pant", categoryId: "jeans", productId: null }];
    expect(resolve("p2", ["formal"], assignments)).toEqual([]);
  });

  it("does not cascade a direct assignment to subcategories of the assigned category", () => {
    const assignments: AssignmentRule[] = [{ groupId: "g-pant", categoryId: "jeans", productId: null }];
    expect(resolve("p3", ["slim"], assignments)).toEqual([]);
  });

  it("applies a product assignment only to that product", () => {
    const assignments: AssignmentRule[] = [{ groupId: "g-pant", categoryId: null, productId: "p1" }];
    expect(resolve("p1", [], assignments)).toEqual(["g-pant"]);
    expect(resolve("p2", [], assignments)).toEqual([]);
  });
});

describe("category cascade (scope: cascade_all)", () => {
  const assignments: AssignmentRule[] = [
    { groupId: "g-pant", categoryId: "pants", productId: null, scope: "cascade_all" },
  ];

  it("includes products in the assigned category itself", () => {
    expect(resolve("p1", ["pants"], assignments)).toEqual(["g-pant"]);
  });

  it("cascades to nested subcategories", () => {
    expect(resolve("p2", ["jeans"], assignments)).toEqual(["g-pant"]);
    expect(resolve("p3", ["slim"], assignments)).toEqual(["g-pant"]);
  });

  it("includes subcategories created after the assignment (dynamic cascade, no snapshot)", () => {
    // The same assignment row, resolved later against a tree that grew a new subcategory.
    const grownTree: CategoryNode[] = [...CATEGORIES, { id: "bootcut", parent_id: "jeans" }];
    expect(
      resolveGroupIdsForProduct({
        productId: "p4",
        productCategoryIds: ["bootcut"],
        categories: grownTree,
        assignments,
      })
    ).toEqual(["g-pant"]);
  });

  it("does not reach an unrelated category", () => {
    expect(resolve("p5", ["shirts"], assignments)).toEqual([]);
  });
});

describe("category cascade with exclusions (scope: cascade_except)", () => {
  const assignments: AssignmentRule[] = [
    {
      groupId: "g-pant",
      categoryId: "pants",
      productId: null,
      scope: "cascade_except",
      excludedCategoryIds: ["jeans"],
    },
  ];

  it("applies to all subcategories except the excluded ones", () => {
    expect(resolve("p1", ["formal"], assignments)).toEqual(["g-pant"]);
    expect(resolve("p2", ["jeans"], assignments)).toEqual([]);
  });

  it("an exclusion covers the excluded subcategory's whole subtree", () => {
    expect(resolve("p3", ["slim"], assignments)).toEqual([]);
    expect(resolve("p4", ["relaxed"], assignments)).toEqual([]);
  });

  it("an exclusion vetoes the group even when the product also matches a non-excluded category", () => {
    // Regression: a jeans product tagged with both "jeans" and a non-excluded
    // sibling ("formal") used to match through the sibling and get measured,
    // so excluding "jeans" did not actually stop the fields for jeans items.
    expect(resolve("p5", ["jeans", "formal"], assignments)).toEqual([]);
  });

  it("still includes subcategories created after the assignment", () => {
    const grownTree: CategoryNode[] = [...CATEGORIES, { id: "chino", parent_id: "pants" }];
    expect(
      resolveGroupIdsForProduct({
        productId: "p6",
        productCategoryIds: ["chino"],
        categories: grownTree,
        assignments,
      })
    ).toEqual(["g-pant"]);
  });
});

describe("category cascade with selected subcategories (scope: cascade_selected)", () => {
  const assignments: AssignmentRule[] = [
    {
      groupId: "g-pant",
      categoryId: "pants",
      productId: null,
      scope: "cascade_selected",
      includedCategoryIds: ["jeans"],
    },
  ];

  it("includes the assigned category itself", () => {
    expect(resolve("p1", ["pants"], assignments)).toEqual(["g-pant"]);
  });

  it("applies to the selected subcategories and their subtrees", () => {
    expect(resolve("p2", ["jeans"], assignments)).toEqual(["g-pant"]);
    expect(resolve("p3", ["slim"], assignments)).toEqual(["g-pant"]);
  });

  it("does not apply to subcategories that were not selected", () => {
    expect(resolve("p4", ["formal"], assignments)).toEqual([]);
  });

  it("includes subcategories created later under a selected subcategory", () => {
    const grownTree: CategoryNode[] = [...CATEGORIES, { id: "bootcut", parent_id: "jeans" }];
    expect(
      resolveGroupIdsForProduct({
        productId: "p5",
        productCategoryIds: ["bootcut"],
        categories: grownTree,
        assignments,
      })
    ).toEqual(["g-pant"]);
  });
});

describe("getDescendantIds", () => {
  it("lists all descendants of a category, never the category itself", () => {
    expect(getDescendantIds(CATEGORIES, "pants").sort()).toEqual([
      "formal",
      "jeans",
      "relaxed",
      "slim",
    ]);
    expect(getDescendantIds(CATEGORIES, "slim")).toEqual([]);
    expect(getDescendantIds(CATEGORIES, "shirts")).toEqual([]);
  });
});

describe("measurement rules config parsing (app_settings payload)", () => {
  it("returns an empty config for missing or invalid data", () => {
    const empty = { categoryScopes: {}, productOverrides: {} };
    expect(parseMeasurementRulesConfig(null)).toEqual(empty);
    expect(parseMeasurementRulesConfig("junk")).toEqual(empty);
    expect(parseMeasurementRulesConfig(42)).toEqual(empty);
  });

  it("normalizes scope entries and drops unknown scopes", () => {
    expect(
      parseMeasurementRulesConfig({
        categoryScopes: {
          a: { scope: "bogus" },
          b: { scope: "cascade_all" },
          c: { scope: "cascade_selected", includedCategoryIds: ["x", 5, "y"] },
          d: { scope: "cascade_except", excludedCategoryIds: ["z"] },
          e: { scope: "direct" },
        },
        productOverrides: { p: { neverMeasure: true }, q: {}, r: { neverMeasure: false } },
      })
    ).toEqual({
      categoryScopes: {
        b: { scope: "cascade_all", includedCategoryIds: [], excludedCategoryIds: [] },
        c: { scope: "cascade_selected", includedCategoryIds: ["x", "y"], excludedCategoryIds: [] },
        d: { scope: "cascade_except", includedCategoryIds: [], excludedCategoryIds: ["z"] },
      },
      productOverrides: { p: { neverMeasure: true } },
    });
  });
});

describe("per-product never-measure override", () => {
  const assignments: AssignmentRule[] = [
    { groupId: "g-pant", categoryId: "pants", productId: null, scope: "cascade_all" },
    { groupId: "g-waist", categoryId: null, productId: "p1" },
    { groupId: "g-arm", categoryId: "shirts", productId: null },
  ];

  it("wins over every assignment (category, cascade and product rows)", () => {
    expect(resolve("p1", ["jeans", "shirts"], assignments, { neverMeasureProductIds: ["p1"] })).toEqual([]);
  });

  it("does not affect other products", () => {
    expect(
      resolve("p2", ["jeans"], assignments, { neverMeasureProductIds: ["p1"] })
    ).toEqual(["g-pant"]);
  });
});

describe("assignment union", () => {
  it("accumulates groups across matching assignments without duplicates", () => {
    const assignments: AssignmentRule[] = [
      { groupId: "g-pant", categoryId: "jeans", productId: null },
      { groupId: "g-pant", categoryId: null, productId: "p1" },
      { groupId: "g-waist", categoryId: "pants", productId: null, scope: "cascade_all" },
    ];
    expect(resolve("p1", ["jeans"], assignments)).toEqual(["g-pant", "g-waist"]);
  });

  it("ignores rows that target neither a product nor a category", () => {
    const assignments: AssignmentRule[] = [{ groupId: "g-x", categoryId: null, productId: null }];
    expect(resolve("p1", ["jeans"], assignments)).toEqual([]);
  });
});

describe("deferred measurement entry status", () => {
  const expected = [
    { id: "g1", name: "Pant Measurements" },
    { id: "g2", name: "Waist" },
  ];

  it("is not_required when no groups are expected for the product", () => {
    expect(
      getMeasurementEntryStatus([], [{ groupName: "Pant Measurements", values: [{ name: "L", value: "32" }] }])
    ).toBe("not_required");
  });

  it("is pending when groups are expected but none were captured", () => {
    expect(getMeasurementEntryStatus(expected, [])).toBe("pending");
  });

  it("is complete when every expected group was captured with values", () => {
    expect(
      getMeasurementEntryStatus(expected, [
        { groupId: "g1", groupName: "Pant Measurements", values: [{ name: "Length", value: "32" }] },
        { groupId: "g2", groupName: "Waist", values: [{ name: "W", value: "34" }] },
      ])
    ).toBe("complete");
  });

  it("is partial when only some expected groups were captured", () => {
    expect(
      getMeasurementEntryStatus(expected, [
        { groupId: "g1", groupName: "Pant Measurements", values: [{ name: "Length", value: "32" }] },
      ])
    ).toBe("partial");
  });

  it("matches captured names carrying a size suffix (size-preset auto-fill)", () => {
    // MeasurementSlipPrint saves preset-derived rows as "<group name> (Size L)".
    expect(
      getMeasurementEntryStatus(expected, [
        { groupName: "Pant Measurements (Size L)", values: [{ name: "Length", value: "32" }] },
        { groupName: "Waist (Size L)", values: [{ name: "W", value: "34" }] },
      ])
    ).toBe("complete");
  });

  it("prefers group id matching over names", () => {
    expect(
      getMeasurementEntryStatus(expected, [
        { groupId: "g1", groupName: "Renamed group", values: [{ name: "Length", value: "32" }] },
        { groupId: "g2", groupName: "Waist", values: [{ name: "W", value: "34" }] },
      ])
    ).toBe("complete");
  });

  it("does not count captured entries without values as captured", () => {
    expect(
      getMeasurementEntryStatus(expected, [
        { groupId: "g1", groupName: "Pant Measurements", values: [{ name: "Length", value: "  " }] },
      ])
    ).toBe("pending");
    expect(
      getMeasurementEntryStatus(expected, [
        { groupName: "Pant Measurements", values: [] },
      ])
    ).toBe("pending");
  });
});

describe("missing measurement groups", () => {
  it("lists the expected groups not yet captured", () => {
    const expected = [
      { id: "g1", name: "Pant Measurements" },
      { id: "g2", name: "Waist" },
    ];
    expect(
      getMissingMeasurementGroups(expected, [
        { groupName: "Pant Measurements (Size L)", values: [{ name: "Length", value: "32" }] },
      ])
    ).toEqual([{ id: "g2", name: "Waist" }]);
    expect(getMissingMeasurementGroups(expected, [])).toEqual(expected);
    expect(getMissingMeasurementGroups([], [])).toEqual([]);
  });
});

describe("groups without any measurement row (add-measurements affordance)", () => {
  const expected = [
    { id: "g1", name: "Pant Measurements" },
    { id: "g2", name: "Waist" },
  ];

  it("lists every expected group when nothing was entered yet", () => {
    expect(getGroupsWithoutRows(expected, [])).toEqual(expected);
    expect(getGroupsWithoutRows([], [])).toEqual([]);
  });

  it("treats a row with empty values as an open entry that covers its group", () => {
    // Unlike getMissingMeasurementGroups: the entry UI is already on screen,
    // so 'Add measurements' must not offer the same group a second time.
    expect(
      getGroupsWithoutRows(expected, [
        { groupName: "Pant Measurements", values: [{ name: "Length", value: "" }] },
      ])
    ).toEqual([{ id: "g2", name: "Waist" }]);
    expect(
      getGroupsWithoutRows(expected, [{ groupName: "Pant Measurements", values: [] }])
    ).toEqual([{ id: "g2", name: "Waist" }]);
  });

  it("matches rows whose group name carries a size-preset suffix", () => {
    expect(
      getGroupsWithoutRows(expected, [
        { groupName: "Pant Measurements (Size L)", values: [{ name: "Length", value: "32" }] },
      ])
    ).toEqual([{ id: "g2", name: "Waist" }]);
  });

  it("returns nothing when every group already has a row", () => {
    expect(
      getGroupsWithoutRows(expected, [
        { groupName: "Pant Measurements", values: [] },
        { groupName: "Waist (Size M)", values: [{ name: "W", value: "34" }] },
      ])
    ).toEqual([]);
  });
});

describe("measurements-pending marker", () => {
  it("prints 'Measurements pending' when nothing was captured", () => {
    expect(formatMeasurementPendingMarker("pending")).toBe("Measurements pending");
  });

  it("names the missing groups when partially captured", () => {
    expect(formatMeasurementPendingMarker("partial", ["Waist", "Sleeve"])).toBe(
      "Measurements pending: Waist, Sleeve"
    );
  });

  it("has no marker when nothing is required or everything is captured", () => {
    expect(formatMeasurementPendingMarker("not_required")).toBeNull();
    expect(formatMeasurementPendingMarker("complete")).toBeNull();
    expect(formatMeasurementPendingMarker("partial", [])).toBe("Measurements pending");
  });
});
