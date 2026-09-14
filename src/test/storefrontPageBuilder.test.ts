import { describe, it, expect } from "vitest";
import { registry, type SectionType, DEFERRED_SECTION_TYPES } from "@/storefront/sections/registry";

describe("Phase 1: Section Component Registry", () => {
  const expectedTypes: SectionType[] = [
    "hero",
    "featured-products",
    "product-grid",
    "collection-grid",
    "rich-text",
    "image-banner",
    "gallery",
    "testimonials",
    "faq",
  ];

  it("contains all 9 section types", () => {
    for (const t of expectedTypes) {
      expect(registry[t]).toBeDefined();
      expect(registry[t].adminLabel).toBeTruthy();
      expect(typeof registry[t].validate).toBe("function");
      expect(registry[t].defaultProps).toBeDefined();
      expect(Array.isArray(registry[t].adminFields)).toBe(true);
    }
  });

  it("documents deferred section types with rationales (§12 / M6)", () => {
    expect(DEFERRED_SECTION_TYPES).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "contact-form" }),
        expect.objectContaining({ type: "newsletter" }),
      ])
    );
  });

  describe("Validation contracts per type", () => {
    it("validates hero section", () => {
      const { validate, defaultProps } = registry["hero"];
      expect(validate({ ...defaultProps, title: "Summer Capsule" })).toEqual([]);
      expect(validate({ ...defaultProps, title: "" })).toEqual(["Hero needs a title"]);
    });

    it("validates featured-products section", () => {
      const { validate, defaultProps } = registry["featured-products"];
      expect(validate(defaultProps)).toEqual([]);
      expect(validate({ ...defaultProps, limit: 0 })).toContain("Limit must be 1–12");
      expect(validate({ ...defaultProps, limit: 20 })).toContain("Limit must be 1–12");
      expect(validate({ ...defaultProps, columns: 5 })).toContain("Columns must be 2–4");
    });

    it("validates product-grid section", () => {
      const { validate, defaultProps } = registry["product-grid"];
      expect(validate({ ...defaultProps, product_ids: ["p1", "p2"] })).toEqual([]);
      expect(validate({ ...defaultProps, product_ids: [] })).toContain("Pick at least one product");
      expect(validate({ ...defaultProps, product_ids: ["p1"], columns: 1 })).toContain("Columns must be 2–4");
    });

    it("validates collection-grid section", () => {
      const { validate, defaultProps } = registry["collection-grid"];
      expect(validate({ ...defaultProps, collection_ids: ["c1"] })).toEqual([]);
      expect(validate({ ...defaultProps, collection_ids: [] })).toContain("Pick at least one collection");
      expect(validate({ ...defaultProps, collection_ids: ["c1"], columns: 6 })).toContain("Columns must be 2–4");
    });

    it("validates rich-text section", () => {
      const { validate, defaultProps } = registry["rich-text"];
      expect(validate({ ...defaultProps, markdown: "Hello world" })).toEqual([]);
      expect(validate({ ...defaultProps, markdown: "" })).toEqual(["Rich text needs content"]);
    });

    it("validates image-banner section", () => {
      const { validate, defaultProps } = registry["image-banner"];
      expect(validate({ ...defaultProps, image_url: "https://example.com/banner.jpg" })).toEqual([]);
      expect(validate({ ...defaultProps, image_url: "" })).toEqual(["Banner needs an image"]);
    });

    it("validates gallery section", () => {
      const { validate, defaultProps } = registry["gallery"];
      expect(validate({ ...defaultProps, images: [{ url: "https://example.com/a.jpg" }] })).toEqual([]);
      expect(validate({ ...defaultProps, images: [] })).toEqual(["Gallery needs at least one image"]);
      expect(validate({ ...defaultProps, images: [{ url: "" }] })).toEqual(["Gallery needs at least one image"]);
    });

    it("validates testimonials section", () => {
      const { validate, defaultProps } = registry["testimonials"];
      expect(
        validate({ ...defaultProps, items: [{ quote: "Great quality", author: "Rahim" }] })
      ).toEqual([]);
      expect(validate({ ...defaultProps, items: [] })).toEqual(["Add at least one testimonial"]);
      expect(validate({ ...defaultProps, items: [{ quote: "", author: "Rahim" }] })).toEqual([
        "Add at least one testimonial",
      ]);
    });

    it("validates faq section", () => {
      const { validate, defaultProps } = registry["faq"];
      expect(
        validate({ ...defaultProps, items: [{ q: "How long is shipping?", a: "2-3 days" }] })
      ).toEqual([]);
      expect(validate({ ...defaultProps, items: [] })).toEqual(["Add at least one question"]);
      expect(validate({ ...defaultProps, items: [{ q: "", a: "Answer" }] })).toEqual([
        "Add at least one question",
      ]);
    });
  });
});
