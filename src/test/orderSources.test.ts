import { describe, expect, it } from "vitest";
import {
  LEGACY_WOO_STORE_MAPPING,
  ORDER_SOURCE_TYPES,
  isPhysicalSourceType,
  orderSourceConfigFields,
  orderSourceConnectionState,
  orderSourceLabel,
  orderSourceTypeInfo,
  pickWalkInSource,
} from "@/lib/orderSources";

describe("orderSources vocabulary (spec §2)", () => {
  it("mirrors the order_source_type enum exactly (8 values)", () => {
    expect(ORDER_SOURCE_TYPES.map((t) => t.value).sort()).toEqual(
      [
        "facebook",
        "instagram",
        "manual",
        "physical_store",
        "showroom",
        "storefront",
        "whatsapp",
        "woocommerce",
      ].sort(),
    );
  });

  it("labels lookup falls back to the raw type for unknown values", () => {
    expect(orderSourceLabel("woocommerce")).toBe("WooCommerce");
    expect(orderSourceLabel("tiktok")).toBe("tiktok");
    expect(orderSourceTypeInfo("tiktok")).toBeUndefined();
  });

  it("physical types hold stock by default, digital ones never do", () => {
    expect(isPhysicalSourceType("showroom")).toBe(true);
    expect(isPhysicalSourceType("physical_store")).toBe(true);
    for (const t of ["woocommerce", "storefront", "facebook", "instagram", "whatsapp", "manual"]) {
      expect(isPhysicalSourceType(t)).toBe(false);
    }
    const physical = ORDER_SOURCE_TYPES.filter((t) => t.holdsStockByDefault).map((t) => t.value);
    expect(physical.sort()).toEqual(["physical_store", "showroom"]);
  });

  it("walk-ins attach to the showroom source first, physical store as fallback", () => {
    const sources = [
      { id: "a", type: "manual" },
      { id: "b", type: "physical_store" },
      { id: "c", type: "showroom" },
    ];
    expect(pickWalkInSource(sources)?.id).toBe("c");
    expect(pickWalkInSource(sources.slice(0, 2))?.id).toBe("b");
    expect(pickWalkInSource([{ id: "a", type: "manual" }])).toBeNull();
    expect(pickWalkInSource([])).toBeNull();
  });
});

describe("connection config on the source (spec §2)", () => {
  it("WooCommerce takes URL + API keys; storefront takes a slug; manual takes none", () => {
    expect(orderSourceConfigFields("woocommerce").map((f) => f.key)).toEqual([
      "url",
      "consumer_key",
      "consumer_secret",
    ]);
    expect(orderSourceConfigFields("storefront").map((f) => f.key)).toEqual(["slug"]);
    expect(orderSourceConfigFields("manual")).toEqual([]);
    expect(orderSourceConfigFields("showroom")).toEqual([]);
  });

  it("connection state: manual stays manual, physical is a venue, connected needs full config", () => {
    expect(orderSourceConnectionState({ type: "manual", config: {} })).toBe("manual");
    expect(orderSourceConnectionState({ type: "woocommerce", config: {} })).toBe("needs_setup");
    expect(
      orderSourceConnectionState({
        type: "woocommerce",
        config: { url: "https://shop.example.com", consumer_key: "ck_x", consumer_secret: "cs_y" },
      }),
    ).toBe("connected");
    expect(orderSourceConnectionState({ type: "showroom", config: null })).toBe("physical");
  });
});

describe("spec §7 legacy mapping labels", () => {
  it("labels the surviving legacy Woo-store record", () => {
    expect(LEGACY_WOO_STORE_MAPPING).toContain("WooCommerce");
  });
});
