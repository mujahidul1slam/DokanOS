import { describe, expect, it } from "vitest";
import {
  PRODUCT_CSV_HEADERS,
  buildProductInsert,
  parseProductsCsv,
  productCsvTemplate,
} from "./productImport";

// Task 14 (spec §6a step 5): "CSV is an action, not an entity" — the one-shot
// CSV action's parser and product payloads (provenance `csv`, spec §7).

describe("parseProductsCsv", () => {
  it("parses a simple file with the canonical header", () => {
    const { rows, errors } = parseProductsCsv(
      "name,sku,price,category,stock_quantity,description,image_url,barcode\n" +
        "Tee,TEE-1,499,Shirts,12,Cotton tee,https://img/1.jpg,B1",
    );
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].draft).toEqual({
      name: "Tee",
      sku: "TEE-1",
      price: 499,
      category: "Shirts",
      stock_quantity: 12,
      description: "Cotton tee",
      image_url: "https://img/1.jpg",
      barcode: "B1",
    });
    expect(rows[0].line).toBe(2);
  });

  it("matches header columns case-insensitively and tolerates extra columns", () => {
    const { rows, errors } = parseProductsCsv(
      "Name,PRICE,extra\nMug,120,ignored\n",
    );
    expect(errors).toEqual([]);
    expect(rows[0].draft.name).toBe("Mug");
    expect(rows[0].draft.price).toBe(120);
  });

  it("defaults optional numbers to 0 and optional text to null", () => {
    const { rows } = parseProductsCsv("name\nJust a name\n");
    expect(rows[0].draft).toEqual({
      name: "Just a name",
      sku: null,
      price: 0,
      category: null,
      stock_quantity: 0,
      description: null,
      image_url: null,
      barcode: null,
    });
  });

  it("handles quoted fields with commas, doubled quotes and embedded newlines", () => {
    const { rows, errors } = parseProductsCsv(
      'name,description\n"Shirt, red","Says ""hi""\nSecond line"\n',
    );
    expect(errors).toEqual([]);
    expect(rows[0].draft.name).toBe("Shirt, red");
    expect(rows[0].draft.description).toBe('Says "hi"\nSecond line');
  });

  it("handles CRLF line endings and a UTF-8 BOM", () => {
    const { rows, errors } = parseProductsCsv(
      "\uFEFFname,price\r\nBom Product,10\r\n",
    );
    expect(errors).toEqual([]);
    expect(rows[0].draft.name).toBe("Bom Product");
  });

  it("skips blank lines", () => {
    const { rows, errors } = parseProductsCsv("name,price\n\nA,1\n\n");
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].line).toBe(3);
  });

  it("rejects a file without a name column", () => {
    const { rows, errors } = parseProductsCsv("sku,price\nX,1\n");
    expect(rows).toEqual([]);
    expect(errors).toEqual([{ line: 1, message: "The header row must include a 'name' column." }]);
  });

  it("reports an empty file", () => {
    const { rows, errors } = parseProductsCsv("   \n");
    expect(rows).toEqual([]);
    expect(errors).toEqual([{ line: 1, message: "The file is empty." }]);
  });

  it("skips rows with a missing name or bad numbers, keeping the rest with true line numbers", () => {
    const { rows, errors } = parseProductsCsv(
      "name,price,stock_quantity\n" +
        ",10,1\n" + // line 2: missing name
        "Good,20,2\n" + // line 3: fine
        "Bad Price,abc,1\n" + // line 4: non-numeric price
        "Negative,-5,1\n", // line 5: negative price
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].draft.name).toBe("Good");
    expect(rows[0].line).toBe(3);
    expect(errors).toEqual([
      { line: 2, message: "name is required." },
      { line: 4, message: 'price must be a non-negative number (got "abc")' },
      { line: 5, message: 'price must be a non-negative number (got "-5")' },
    ]);
  });
});

describe("buildProductInsert (provenance `csv` — spec §7)", () => {
  const draft = {
    name: "Tee",
    sku: "TEE-1",
    price: 499,
    category: "Shirts",
    stock_quantity: 12,
    description: "Cotton",
    image_url: null,
    barcode: null,
  };

  it("stamps the CSV provenance and the target store", () => {
    const payload = buildProductInsert(draft, "store-1");
    expect(payload).toMatchObject({
      name: "Tee",
      sku: "TEE-1",
      price: 499,
      category: "Shirts",
      stock_quantity: 12,
      description: "Cotton",
      manage_stock: true,
      stock_status: "instock",
      is_active: true,
      store_id: "store-1",
      origin_kind: "csv",
      origin_order_source_id: null,
    });
  });

  it("marks zero-stock imports out of stock", () => {
    const payload = buildProductInsert({ ...draft, stock_quantity: 0 }, "store-1");
    expect(payload.stock_status).toBe("outofstock");
    expect(payload.stock_quantity).toBe(0);
  });
});

describe("productCsvTemplate", () => {
  it("offers the canonical columns", () => {
    expect(productCsvTemplate().headers).toEqual([...PRODUCT_CSV_HEADERS]);
  });
});
