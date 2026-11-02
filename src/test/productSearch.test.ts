import { describe, expect, it } from "vitest";
import {
  buildProductIndex,
  normalizeSearchText,
  searchProductIndex,
  searchProducts,
  tokenizeSearchText,
  type SearchableProduct,
  type SearchableVariation,
} from "@/lib/productSearch";

// ---------------------------------------------------------------------------
// Fixtures — a small Bangladeshi retail catalog. Products p1..p7 with three
// variations covering every attributes jsonb shape ./variations accepts.
// ---------------------------------------------------------------------------

const PRODUCTS: SearchableProduct[] = [
  { id: "p1", name: "Cotton Panjabi", sku: "PNJ-COT-01", barcode: "8941100123450" },
  { id: "p2", name: "T-Shirt", sku: "TSH-BLK-M", barcode: "8941100123451" },
  { id: "p3", name: "Three Piece", sku: "3PC-001", barcode: null },
  { id: "p4", name: "Water Bottle 500ml", sku: null, barcode: null },
  { id: "p5", name: "শার্ট", sku: "SHT-BN-01", barcode: null },
  { id: "p6", name: "Leather Shoes", sku: "SHS-LTR-01", barcode: null },
  { id: "p7", name: "Cotton Shirt", sku: "SHT-COT-01", barcode: null },
];

const VARIATIONS: SearchableVariation[] = [
  {
    id: "v1",
    product_id: "p1",
    name: "Blue XL",
    sku: "PNJ-COT-01-BL-XL",
    attributes: [{ name: "Color", option: "Blue" }, { name: "Size", option: "XL" }],
  },
  {
    id: "v2",
    product_id: "p1",
    name: "Green L",
    sku: "PNJ-COT-01-GR-L",
    attributes: [{ key: "Color", value: "Green" }, { key: "Size", value: "L" }],
  },
  {
    id: "v3",
    product_id: "p2",
    name: "Black M",
    sku: "TSH-BLK-M-CH",
    attributes: [{ Color: "Charcoal" }],
  },
];

const ids = (results: Array<{ product: { id: string } }>) => results.map((r) => r.product.id);
const kinds = (results: Array<{ kind: string }>) => results.map((r) => r.kind);

// ---------------------------------------------------------------------------
// Exact SKU/barcode short-circuit (scanner behavior kept)
// ---------------------------------------------------------------------------

describe("exact SKU/barcode short-circuit (scanners)", () => {
  it("returns only exact-code matches when the query equals a SKU", () => {
    const results = searchProducts(PRODUCTS, "PNJ-COT-01", { variations: VARIATIONS });
    expect(ids(results)).toEqual(["p1"]);
    expect(results[0].kind).toBe("exact-code");
    expect(results[0].matchedVariationIds).toEqual([]);
  });

  it("keeps the scanner path noise-free even when other rows would fuzzy-match", () => {
    const results = searchProducts(PRODUCTS, "TSH-BLK-M", { variations: VARIATIONS });
    expect(ids(results)).toEqual(["p2"]);
    expect(results[0].kind).toBe("exact-code");
  });

  it("matches barcode with surrounding whitespace and case differences", () => {
    const results = searchProducts(PRODUCTS, " 8941100123451\n", { variations: VARIATIONS });
    expect(ids(results)).toEqual(["p2"]);
    expect(results[0].kind).toBe("exact-code");

    const lower = searchProducts(PRODUCTS, "tsh-blk-m", { variations: VARIATIONS });
    expect(ids(lower)).toEqual(["p2"]);
  });

  it("short-circuits to the owning product for an exact variation SKU", () => {
    const results = searchProducts(PRODUCTS, "PNJ-COT-01-BL-XL", { variations: VARIATIONS });
    expect(ids(results)).toEqual(["p1"]);
    expect(results[0].kind).toBe("exact-code");
    expect(results[0].matchedVariationIds).toEqual(["v1"]);
  });

  it("ranks product-level codes above variation-level codes", () => {
    const products: SearchableProduct[] = [
      { id: "x1", name: "Own Code", sku: "ABC" },
      { id: "x2", name: "Var Code", sku: null },
    ];
    const variations: SearchableVariation[] = [
      { id: "vx", product_id: "x2", name: "One", sku: "ABC" },
    ];
    const results = searchProducts(products, "abc", { variations });
    expect(ids(results)).toEqual(["x1", "x2"]);
    expect(kinds(results)).toEqual(["exact-code", "exact-code"]);
    expect(results[1].matchedVariationIds).toEqual(["vx"]);
  });

  it("is spacing- and punctuation-insensitive on codes", () => {
    const results = searchProducts(PRODUCTS, "pnj cot 01", { variations: VARIATIONS });
    expect(ids(results)).toEqual(["p1"]);
    expect(results[0].kind).toBe("exact-code");
  });
});

// ---------------------------------------------------------------------------
// Partial-word matching and typo tolerance
// ---------------------------------------------------------------------------

describe("partial-word matching", () => {
  it("matches a word prefix inside the name ('panj' → Cotton Panjabi)", () => {
    const results = searchProducts(PRODUCTS, "panj", { variations: VARIATIONS });
    expect(ids(results)).toEqual(["p1"]);
    expect(results[0].kind).toBe("word");
  });

  it("matches a mid-word fragment ('hirt' → T-Shirt / Cotton Shirt)", () => {
    const results = searchProducts(PRODUCTS, "hirt", { variations: VARIATIONS });
    expect(ids(results)).toEqual(["p2", "p7"]);
    expect(kinds(results)).toEqual(["substring", "substring"]);
  });

  it("matches a word-prefix fragment ('shir' → T-Shirt)", () => {
    const results = searchProducts(PRODUCTS, "shir", { variations: VARIATIONS });
    expect(ids(results)[0]).toBe("p2");
    expect(results[0].kind).toBe("word");
  });

  it("matches multi-word queries with AND semantics, order-free", () => {
    expect(ids(searchProducts(PRODUCTS, "cotton panj", { variations: VARIATIONS }))).toEqual(["p1"]);
    expect(ids(searchProducts(PRODUCTS, "shirt cotton", { variations: VARIATIONS }))).toEqual(["p7"]);
    expect(ids(searchProducts(PRODUCTS, "cotton shirt", { variations: VARIATIONS }))).toContain("p7");
  });
});

describe("typo tolerance", () => {
  it("tolerates a transposition ('shrit' → T-Shirt)", () => {
    const results = searchProducts(PRODUCTS, "shrit", { variations: VARIATIONS });
    expect(ids(results)).toEqual(["p2", "p7"]);
    expect(results[0].kind).toBe("fuzzy");
  });

  it("tolerates a Banglish misspelling ('punjaby' → Cotton Panjabi)", () => {
    const results = searchProducts(PRODUCTS, "punjaby", { variations: VARIATIONS });
    expect(ids(results)).toEqual(["p1"]);
    expect(results[0].kind).toBe("fuzzy");
  });

  it("does not noise-match unrelated products", () => {
    expect(searchProducts(PRODUCTS, "zzzqqq", { variations: VARIATIONS })).toEqual([]);
    // Short tokens stay strict (no fuzzy) — 'xl' is an exact attribute word here.
    const short = searchProducts(PRODUCTS, "xq", { variations: VARIATIONS });
    expect(short).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Variation attribute text
// ---------------------------------------------------------------------------

describe("variation attribute text", () => {
  it("finds a product by an attribute option ('blue' → Color: Blue)", () => {
    const results = searchProducts(PRODUCTS, "blue", { variations: VARIATIONS });
    expect(ids(results)).toEqual(["p1"]);
    expect(results[0].kind).toBe("variation");
    expect(results[0].matchedVariationIds).toEqual(["v1"]);
  });

  it("finds the exact variation from attribute words ('green l')", () => {
    const results = searchProducts(PRODUCTS, "green l", { variations: VARIATIONS });
    expect(ids(results)).toEqual(["p1"]);
    expect(results[0].kind).toBe("variation");
    expect(results[0].matchedVariationIds).toEqual(["v2"]);
  });

  it("finds the exact variation via attribute name + option ('size xl')", () => {
    const results = searchProducts(PRODUCTS, "size xl", { variations: VARIATIONS });
    expect(ids(results)).toEqual(["p1"]);
    expect(results[0].matchedVariationIds).toEqual(["v1"]);
  });

  it("reports the variation when an 'xl' query arrives as a SKU fragment", () => {
    // "XL" is inside PNJ-COT-01-BL-XL, so this lands in the code tier —
    // the caller still gets matchedVariationIds to open the variation modal.
    const results = searchProducts(PRODUCTS, "xl", { variations: VARIATIONS });
    expect(ids(results)).toEqual(["p1"]);
    expect(results[0].kind).toBe("code");
    expect(results[0].matchedVariationIds).toEqual(["v1"]);
  });

  it("finds products by variation name alone", () => {
    const products: SearchableProduct[] = [{ id: "m1", name: "Mystery Tee" }];
    const variations: SearchableVariation[] = [
      { id: "mv1", product_id: "m1", name: null, attributes: "Red / XXL" },
    ];
    const results = searchProducts(products, "xxl", { variations });
    expect(ids(results)).toEqual(["m1"]);
    expect(results[0].kind).toBe("variation");
    expect(results[0].matchedVariationIds).toEqual(["mv1"]);
  });
});

// ---------------------------------------------------------------------------
// Bangla <-> Latin normalization
// ---------------------------------------------------------------------------

describe("Bangla <-> Latin normalization", () => {
  it("Bangla query finds the Bangla-named product first and English ones after", () => {
    const results = searchProducts(PRODUCTS, "শার্ট", { variations: VARIATIONS });
    expect(ids(results)).toEqual(["p5", "p2", "p7"]);
    expect(results[0].kind).toBe("exact-name");
  });

  it("English query finds the Bangla-named product (cross-script)", () => {
    const results = searchProducts(PRODUCTS, "shirt", { variations: VARIATIONS });
    expect(ids(results)).toEqual(["p2", "p7", "p5"]);
    expect(kinds(results)).toEqual(["word", "word", "fuzzy"]);
  });

  it("transliterates Bangla digits", () => {
    const results = searchProducts(PRODUCTS, "৫০০ml", { variations: VARIATIONS });
    expect(ids(results)).toEqual(["p4"]);
    expect(results[0].kind).toBe("word");
  });

  it("normalizeSearchText/tokenizeSearchText fold both scripts", () => {
    expect(normalizeSearchText("T-Shirt (Blue)")).toBe("t shirt blue");
    expect(normalizeSearchText("শার্ট")).toBe("shart");
    expect(normalizeSearchText("৫০০ ml")).toBe("500 ml");
    expect(normalizeSearchText("")).toBe("");
    expect(normalizeSearchText(undefined as unknown as string)).toBe("");
    expect(tokenizeSearchText("Water Bottle 500ml")).toEqual(["water", "bottle", "500ml"]);
    expect(tokenizeSearchText("  ")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

describe("ranking", () => {
  const RANK_PRODUCTS: SearchableProduct[] = [
    { id: "r1", name: "Shirt" },
    { id: "r2", name: "Shirt Cover" },
    { id: "r3", name: "T-Shirt" },
    { id: "r4", name: "XTshirt Jersey" },
    { id: "r5", name: "Shrit Khan" },
  ];

  it("orders exact-name > name-prefix > word > substring > fuzzy", () => {
    const results = searchProducts(RANK_PRODUCTS, "shirt");
    expect(ids(results)).toEqual(["r1", "r2", "r3", "r4", "r5"]);
    expect(kinds(results)).toEqual([
      "exact-name",
      "name-prefix",
      "word",
      "substring",
      "fuzzy",
    ]);
  });

  it("breaks score ties by shorter name first", () => {
    const products: SearchableProduct[] = [
      { id: "y", name: "Shirt Cover" },
      { id: "x", name: "Shirt X" },
    ];
    expect(ids(searchProducts(products, "shirt"))).toEqual(["x", "y"]);
  });

  it("breaks remaining ties alphabetically, deterministically", () => {
    const products: SearchableProduct[] = [
      { id: "b", name: "Grey Shirt" },
      { id: "a", name: "Blue Shirt" },
    ];
    const first = searchProducts(products, "shirt");
    expect(ids(first)).toEqual(["a", "b"]);
    expect(searchProducts(products, "shirt")).toEqual(first);
  });

  it("applies limit after ranking", () => {
    expect(ids(searchProducts(PRODUCTS, "shirt", { variations: VARIATIONS, limit: 1 }))).toEqual(["p2"]);
    expect(searchProducts(PRODUCTS, "shirt", { variations: VARIATIONS, limit: 0 })).toEqual([]);
    expect(
      searchProducts(PRODUCTS, "shirt", { variations: VARIATIONS, limit: 2 }),
    ).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Empty queries, index reuse, robustness
// ---------------------------------------------------------------------------

describe("empty queries and robustness", () => {
  it("returns [] for empty / whitespace / punctuation-only queries", () => {
    expect(searchProducts(PRODUCTS, "", { variations: VARIATIONS })).toEqual([]);
    expect(searchProducts(PRODUCTS, "   ", { variations: VARIATIONS })).toEqual([]);
    expect(searchProducts(PRODUCTS, "!!!", { variations: VARIATIONS })).toEqual([]);
    expect(searchProducts(PRODUCTS, undefined as unknown as string, { variations: VARIATIONS })).toEqual([]);
  });

  it("searchProductIndex matches searchProducts (index reuse path)", () => {
    const index = buildProductIndex(PRODUCTS, VARIATIONS);
    const viaIndex = searchProductIndex(index, "shirt");
    const oneShot = searchProducts(PRODUCTS, "shirt", { variations: VARIATIONS });
    expect(viaIndex).toEqual(oneShot);
  });

  it("survives malformed product/variation rows", () => {
    const products = [
      { id: "n1", name: "" },
      { id: "n2" },
    ] as unknown as SearchableProduct[];
    const variations = [
      { id: "bad", product_id: 123, attributes: "x" },
      { id: "also-bad", product_id: "p1", attributes: 42 },
    ] as unknown as SearchableVariation[];
    expect(() => searchProducts(products, "shirt", { variations })).not.toThrow();
    expect(searchProducts(products, "shirt", { variations })).toEqual([]);
    const ok = searchProducts(PRODUCTS, "green l", { variations: [...VARIATIONS, ...variations] });
    expect(ok[0].matchedVariationIds).toEqual(["v2"]);
  });
});

// ---------------------------------------------------------------------------
// Regression fixtures (issue #33)
// ---------------------------------------------------------------------------
// The issue asks for 2-3 real failing queries from the requester as regression
// fixtures. The issue thread has no comments yet, so these stand-ins encode the
// failure modes the issue text names (Bangla/Latin mismatch, partial words,
// typos). REPLACE with the requester's verbatim queries once collected.

describe("regression fixtures (issue #33 — placeholder until requester queries land)", () => {
  it("fixture 1: Banglish typo 'punjaby' finds Cotton Panjabi", () => {
    expect(ids(searchProducts(PRODUCTS, "punjaby", { variations: VARIATIONS }))).toEqual(["p1"]);
  });

  it("fixture 2: transposed 'shrit' finds T-Shirt", () => {
    expect(ids(searchProducts(PRODUCTS, "shrit", { variations: VARIATIONS }))[0]).toBe("p2");
  });

  it("fixture 3: Bangla 'শার্ট' finds the Bangla-named product first", () => {
    expect(ids(searchProducts(PRODUCTS, "শার্ট", { variations: VARIATIONS }))[0]).toBe("p5");
  });

  it("fixture 4: attribute-only query 'blue xl' finds the product", () => {
    const results = searchProducts(PRODUCTS, "blue xl", { variations: VARIATIONS });
    expect(ids(results)).toEqual(["p1"]);
    expect(results[0].matchedVariationIds).toEqual(["v1"]);
  });
});
