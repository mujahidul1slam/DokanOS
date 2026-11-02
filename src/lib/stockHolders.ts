/**
 * Task 7 (domain revamp, spec §3): stock holders and holder→holder transfers.
 *
 * Stock lives at warehouses (stock-only) and at stock-holding order sources
 * (showrooms, physical stores — the per-source `is_stock_holding` toggle).
 * `product_locations` rows point at exactly one holder (CHECK enforced).
 *
 * Transfers v1: one `stock_transfers` line per product/variation between two
 * distinct holders of one brand, and the movement is applied to the
 * `product_locations` quantities (this module's action — the migration is
 * schema only). The `product_locations_stock_sync` trigger keeps the
 * `products.stock_quantity` aggregate consistent automatically.
 *
 * `order_sources.fulfillment_preference` is the ordered bare-id list of the
 * holders stock should be drawn from first (Q13).
 */

export type StockHolderKind = "warehouse" | "source";

import { supabase } from "@/integrations/supabase/client";

export interface StockHolder {
  /** Stable identity across the two holder tables: `warehouse:<id>` / `source:<id>`. */
  key: string;
  kind: StockHolderKind;
  /** The warehouse id, or the stock-holding order source id. */
  id: string;
  name: string;
  brandId: string;
  /** Warehouses only: the brand's default warehouse. */
  isDefault?: boolean;
}

export interface WarehouseRow {
  id: string;
  brand_id: string;
  name: string;
  is_default: boolean;
  address: string | null;
  city: string | null;
  zone: string | null;
  area: string | null;
  phone: string | null;
}

export interface StockHoldingSourceRow {
  id: string;
  brand_id: string;
  name: string;
  type: string;
  is_stock_holding: boolean | null;
}

export const holderKey = (kind: StockHolderKind, id: string): string => `${kind}:${id}`;

export function parseHolderKey(key: string): { kind: StockHolderKind; id: string } | null {
  const [kind, id] = key.split(":");
  if ((kind !== "warehouse" && kind !== "source") || !id) return null;
  return { kind, id };
}

/**
 * The brand's stock holders: its warehouses plus its order sources with
 * `is_stock_holding` (digital sources never hold stock — spec §3). Accepts
 * structural subsets of the rows so callers can select just the columns they
 * need.
 */
export function buildStockHolders(
  warehouses: ReadonlyArray<{ id: string; brand_id: string; name: string; is_default: boolean }>,
  sources: ReadonlyArray<{ id: string; brand_id: string; name: string; is_stock_holding: boolean | null }>,
): StockHolder[] {
  return [
    ...warehouses.map((w) => ({
      key: holderKey("warehouse", w.id),
      kind: "warehouse" as const,
      id: w.id,
      name: w.name,
      brandId: w.brand_id,
      isDefault: w.is_default,
    })),
    ...sources
      .filter((s) => s.is_stock_holding === true)
      .map((s) => ({
        key: holderKey("source", s.id),
        kind: "source" as const,
        id: s.id,
        name: s.name,
        brandId: s.brand_id,
      })),
  ];
}

/**
 * Sanitize a stored `fulfillment_preference` (ordered holder-id list): keep only
 * ids that are current holders of the brand, dedup, preserve order. Unknown ids
 * (deleted holders) drop silently — the preference must never dangle.
 */
export function normalizeFulfillmentPreference(
  raw: unknown,
  holders: readonly StockHolder[],
): string[] {
  if (!Array.isArray(raw)) return [];
  const valid = new Set(holders.map((h) => h.id));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || !valid.has(item) || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Transfers (Q14) — one line per product/variation, from ≠ to.
// ---------------------------------------------------------------------------

export interface TransferLine {
  productId: string;
  variationId: string | null;
  quantity: number;
  /** Display label for error messages — never used for matching. */
  label?: string;
}

export interface TransferRequest {
  brandId: string;
  from: StockHolder;
  to: StockHolder;
  lines: TransferLine[];
  note?: string | null;
}

export interface MergedTransferLine {
  productId: string;
  variationId: string | null;
  quantity: number;
  label?: string;
}

/**
 * Merge duplicate product/variation lines (summing quantities) and drop
 * non-positive noise, so one movement = one `stock_transfers` line and one
 * from/to `product_locations` delta per product/variation.
 */
export function mergeTransferLines(lines: readonly TransferLine[]): MergedTransferLine[] {
  const merged = new Map<string, MergedTransferLine>();
  for (const line of lines) {
    if (!line.productId || !Number.isFinite(line.quantity) || line.quantity <= 0) continue;
    const key = `${line.productId}:${line.variationId ?? ""}`;
    const existing = merged.get(key);
    if (existing) existing.quantity += line.quantity;
    else merged.set(key, { productId: line.productId, variationId: line.variationId, quantity: line.quantity, label: line.label });
  }
  return [...merged.values()];
}

/** Human-readable error for an invalid transfer, or null when it is valid. */
export function validateTransfer(request: Omit<TransferRequest, "note">): string | null {
  const { from, to, lines, brandId } = request;
  if (from.key === to.key) return "Pick two different stock holders";
  if (from.brandId !== brandId || to.brandId !== brandId) return "Both holders must belong to this brand";
  const merged = mergeTransferLines(lines);
  if (merged.length === 0) return "Add at least one item with a quantity above zero";
  return null;
}

// ---------------------------------------------------------------------------
// Applying a transfer: move product_locations quantities and record the ledger.
// Client-side (no RPC in v1): everything is validated against the from-side
// first, then applied line by line — a mid-flight failure is reported honestly
// with the partial state rather than rolled back.
// ---------------------------------------------------------------------------

const holderColumn = (holder: StockHolder): "warehouse_id" | "stock_holder_order_source_id" =>
  holder.kind === "warehouse" ? "warehouse_id" : "stock_holder_order_source_id";

interface OnHandRow {
  id: string;
  stock_quantity: number;
}

async function readOnHand(line: MergedTransferLine, holder: StockHolder): Promise<OnHandRow | null> {
  let query = supabase
    .from("product_locations")
    .select("id, stock_quantity")
    .eq("product_id", line.productId)
    .eq(holderColumn(holder), holder.id);
  query = line.variationId ? query.eq("variation_id", line.variationId) : query.is("variation_id", null);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  return (data as OnHandRow | null) ?? null;
}

export async function applyStockTransfer(request: TransferRequest): Promise<MergedTransferLine[]> {
  const invalid = validateTransfer(request);
  if (invalid) throw new Error(invalid);
  const { from, to, brandId, note } = request;
  const lines = mergeTransferLines(request.lines);

  // Phase 1: verify the from side covers every line (merged per product/variation).
  for (const line of lines) {
    const onHand = await readOnHand(line, from);
    const label = line.label ?? "one of the items";
    if (!onHand) throw new Error(`${from.name} has no stock row for ${label}`);
    if (onHand.stock_quantity < line.quantity) {
      throw new Error(
        `Not enough stock at ${from.name} for ${label}: have ${onHand.stock_quantity}, need ${line.quantity}`,
      );
    }
  }

  // Phase 2: move quantities and record one ledger line per product/variation.
  for (const line of lines) {
    const fromRow = await readOnHand(line, from);
    if (!fromRow) throw new Error(`${from.name} has no stock row for ${line.label ?? "an item"} (changed mid-transfer)`);
    const decrease = await supabase
      .from("product_locations")
      .update({ stock_quantity: fromRow.stock_quantity - line.quantity })
      .eq("id", fromRow.id);
    if (decrease.error) throw new Error(decrease.error.message);

    const toRow = await readOnHand(line, to);
    if (toRow) {
      const increase = await supabase
        .from("product_locations")
        .update({ stock_quantity: toRow.stock_quantity + line.quantity })
        .eq("id", toRow.id);
      if (increase.error) throw new Error(increase.error.message);
    } else {
      const insert =
        to.kind === "warehouse"
          ? await supabase.from("product_locations").insert({
              product_id: line.productId,
              variation_id: line.variationId,
              warehouse_id: to.id,
              stock_quantity: line.quantity,
            })
          : await supabase.from("product_locations").insert({
              product_id: line.productId,
              variation_id: line.variationId,
              stock_holder_order_source_id: to.id,
              stock_quantity: line.quantity,
            });
      if (insert.error) throw new Error(insert.error.message);
    }

    const ledger = await supabase.from("stock_transfers").insert({
      brand_id: brandId,
      product_id: line.productId,
      variation_id: line.variationId,
      quantity: line.quantity,
      note: note || null,
      from_warehouse_id: from.kind === "warehouse" ? from.id : null,
      from_order_source_id: from.kind === "source" ? from.id : null,
      to_warehouse_id: to.kind === "warehouse" ? to.id : null,
      to_order_source_id: to.kind === "source" ? to.id : null,
    });
    if (ledger.error) throw new Error(ledger.error.message);
  }

  return lines;
}
