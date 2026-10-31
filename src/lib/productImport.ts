/**
 * Task 14 (spec §6a step 5): product import actions.
 *
 * "CSV is an action, not an entity" — there is no CSV source type; a one-shot
 * CSV file is parsed into validated drafts and inserted as ordinary `products`
 * rows carrying provenance `origin_kind = 'csv'` (spec §7: products remember
 * how they arrived). WooCommerce import is not handled here: it is the sync
 * worker kicked from the product-import step ("connection push → import
 * products", spec §6a step 3).
 */

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

/** The `products` insert row shape from the generated Supabase types. */
type ProductInsert = Database["public"]["Tables"]["products"]["Insert"];

export interface ProductCsvDraft {
  name: string;
  sku: string | null;
  price: number;
  category: string | null;
  stock_quantity: number;
  description: string | null;
  image_url: string | null;
  barcode: string | null;
}

export interface ProductCsvError {
  /** 1-based line number in the file (header is line 1). */
  line: number;
  message: string;
}

/** One usable CSV row: its draft plus the file line it came from. */
export interface ProductCsvRow {
  line: number;
  draft: ProductCsvDraft;
}

export interface ProductCsvParseResult {
  rows: ProductCsvRow[];
  errors: ProductCsvError[];
}

/** The canonical header; column matching is case-insensitive and trimmed. */
export const PRODUCT_CSV_HEADERS = [
  "name",
  "sku",
  "price",
  "category",
  "stock_quantity",
  "description",
  "image_url",
  "barcode",
] as const;

/** Rows for the downloadable template (header only — an empty starter file). */
export function productCsvTemplate(): { headers: string[]; rows: string[][] } {
  return { headers: [...PRODUCT_CSV_HEADERS], rows: [] };
}

/** One raw CSV record with the 1-based file line it starts on. */
interface RawRecord {
  fields: string[];
  line: number;
}

/**
 * Split a CSV document into records (RFC 4180 subset): double-quoted fields may
 * contain commas, doubled quotes and newlines. Records are separated by
 * newlines outside quotes; every record keeps its starting line number.
 */
function parseCsvRecords(text: string): RawRecord[] {
  const records: RawRecord[] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;

  const endField = () => {
    record.push(field);
    field = "";
  };
  const endRecord = () => {
    endField();
    records.push({ fields: record, line: recordLine });
    record = [];
    recordLine = line;
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n") line += 1;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field.trim() === "") {
      // A quote opens a quoted field (tolerate leading spaces before it).
      field = "";
      inQuotes = true;
    } else if (ch === ",") {
      endField();
    } else if (ch === "\r") {
      // handled with the following \n
    } else if (ch === "\n") {
      line += 1;
      endRecord();
    } else {
      field += ch;
    }
  }
  if (field !== "" || record.length > 0) endRecord();
  return records;
}

function headerIndex(header: string[]): Map<string, number> {
  const index = new Map<string, number>();
  header.forEach((raw, i) => {
    const key = raw.trim().toLowerCase();
    if (key && !index.has(key)) index.set(key, i);
  });
  return index;
}

function parseNumber(
  raw: string,
  line: number,
  column: string,
  errors: ProductCsvError[],
): number | null {
  const value = raw.trim();
  if (value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    errors.push({ line, message: `${column} must be a non-negative number (got "${raw.trim()}")` });
    return null;
  }
  return n;
}

/**
 * Parse a product CSV: header row (with at least `name`), then one product per
 * row. Bad rows are reported per line and skipped; good rows are returned in
 * file order. Unparsable rows never block the rest of the file.
 */
export function parseProductsCsv(text: string): ProductCsvParseResult {
  const errors: ProductCsvError[] = [];
  const rows: ProductCsvRow[] = [];

  const clean = text.replace(/^\uFEFF/, "");
  const records = parseCsvRecords(clean).filter((record) =>
    record.fields.some((field) => field.trim() !== ""),
  );
  if (records.length === 0) {
    errors.push({ line: 1, message: "The file is empty." });
    return { rows, errors };
  }

  const headerRecord = records[0];
  const header = headerRecord.fields;
  const index = headerIndex(header);
  if (!index.has("name")) {
    errors.push({ line: headerRecord.line, message: "The header row must include a 'name' column." });
    return { rows, errors };
  }

  const cell = (record: string[], key: string): string => {
    const i = index.get(key);
    return i === undefined ? "" : (record[i] ?? "").trim();
  };

  records.slice(1).forEach((raw) => {
    const line = raw.line;
    const record = raw.fields;
    const name = cell(record, "name");
    if (name === "") {
      errors.push({ line, message: "name is required." });
      return;
    }
    const price = parseNumber(cell(record, "price"), line, "price", errors);
    const stockQuantity = parseNumber(cell(record, "stock_quantity"), line, "stock_quantity", errors);
    if ((cell(record, "price") !== "" && price === null) || (cell(record, "stock_quantity") !== "" && stockQuantity === null)) {
      return;
    }
    rows.push({
      line,
      draft: {
        name,
        sku: cell(record, "sku") || null,
        price: price ?? 0,
        category: cell(record, "category") || null,
        stock_quantity: stockQuantity ?? 0,
        description: cell(record, "description") || null,
        image_url: cell(record, "image_url") || null,
        barcode: cell(record, "barcode") || null,
      },
    });
  });

  return { rows, errors };
}

/** The `products` insert payload for one draft (provenance `csv`, spec §7). */
export function buildProductInsert(
  draft: ProductCsvDraft,
  storeId: string,
): ProductInsert {
  return {
    name: draft.name,
    sku: draft.sku,
    price: draft.price,
    category: draft.category,
    stock_quantity: draft.stock_quantity,
    description: draft.description,
    image_url: draft.image_url,
    barcode: draft.barcode,
    manage_stock: true,
    stock_status: draft.stock_quantity > 0 ? "instock" : "outofstock",
    is_active: true,
    store_id: storeId,
    origin_kind: "csv",
    origin_order_source_id: null,
  };
}

export interface ImportResult {
  imported: number;
  failed: ProductCsvError[];
}

/**
 * Insert parsed rows as products in the target store. One batch request when
 * possible; on a batch failure the batch is retried row-by-row so a single bad
 * row (e.g. a duplicate SKU) is reported — against its CSV line — instead of
 * sinking the whole import.
 */
export async function importProductDrafts(
  rows: readonly ProductCsvRow[],
  storeId: string,
): Promise<ImportResult> {
  const result: ImportResult = { imported: 0, failed: [] };
  if (rows.length === 0) return result;
  const payloads = rows.map((row) => buildProductInsert(row.draft, storeId));

  const { error } = await supabase.from("products").insert(payloads);
  if (!error) {
    result.imported = payloads.length;
    return result;
  }

  for (let i = 0; i < rows.length; i += 1) {
    const { error: rowError } = await supabase.from("products").insert(payloads[i]);
    if (rowError) {
      result.failed.push({ line: rows[i].line, message: rowError.message });
    } else {
      result.imported += 1;
    }
  }
  return result;
}
