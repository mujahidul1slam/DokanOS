import { supabase } from "@/integrations/supabase/client";
import { readEdgeFnError } from "@/lib/edgeFnError";
import type { PathaoAccountOption } from "@/lib/dispatchAccounts";
import {
  buildCourierItemDescription,
  type CourierItemLine,
} from "@/lib/courierDescription";

/**
 * Create & Dispatch (issue #23): the dispatch half of Add Order.
 *
 * `buildDispatchOrderPayload` mirrors DispatchDialog.doDispatch's per-order
 * `order_payload` exactly, plus the optional courier product description
 * (`item_description`) resolved on the client. `dispatchOrderViaAccount`
 * invokes the same `pathao-courier` `create_bulk` action (single entry) with
 * the SELECTED identity-strip Pathao Account and maps the per-entry result to
 * an outcome union.
 *
 * Idempotency: a "Retry dispatch" only ever calls `dispatchOrderViaAccount`
 * again — never the order-create path. The edge function additionally refuses
 * to book a second parcel for an order that already has an active consignment
 * (`skipped`/`has_existing`), which maps to `already_dispatched` here so a
 * retry after a lost response reports the existing consignment number instead
 * of failing or double-booking.
 */

export interface DispatchOrderInput {
  orderId: string;
  orderNumber: string;
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
  recipientCity: number;
  recipientZone: number;
  recipientArea?: number | null;
  itemQuantity: number;
  itemWeight?: number | null;
  amountToCollect: number;
  /** order_items-style lines, used only for the optional product description. */
  itemLines: CourierItemLine[];
  /** Per-Pathao-Account option (default OFF): describe products on the parcel. */
  includeItemDescription: boolean;
}

export interface DispatchEntry {
  order_id: string;
  order_payload: Record<string, unknown>;
}

/**
 * Idempotency key for one Add Order form session, stored on orders.idempotency_key.
 * The unique partial index uq_orders_idempotency_key turns any double-submit of
 * the create path (e.g. a Create & Dispatch retry that reaches creation again)
 * into a fetch of the already-created order instead of a duplicate insert.
 */
export function newCreateIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `add-order-${crypto.randomUUID()}`;
  }
  return `add-order-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Build one `create_bulk` entry. Field shape matches DispatchDialog.doDispatch;
 * `item_description` (Pathao's parcel description field) is included only when
 * the account's courier-description option is ON and lines produce text.
 * `special_instruction` is intentionally never set — the Pathao API does not
 * require it for item information (issue #23).
 */
export function buildDispatchOrderPayload(
  input: DispatchOrderInput,
  account: PathaoAccountOption,
): DispatchEntry {
  const order_payload: Record<string, unknown> = {
    store_id: account.pathaoStoreId,
    merchant_order_id: input.orderNumber,
    recipient_name: input.recipientName,
    recipient_phone: input.recipientPhone,
    recipient_address: input.recipientAddress,
    recipient_city: Number(input.recipientCity),
    recipient_zone: Number(input.recipientZone),
    delivery_type: 48,
    item_type: 2,
    item_quantity: input.itemQuantity,
    item_weight: Number(input.itemWeight) || 0.5,
    amount_to_collect: Number(input.amountToCollect) || 0,
  };
  if (input.recipientArea != null) {
    order_payload.recipient_area = Number(input.recipientArea);
  }
  if (input.includeItemDescription) {
    const description = buildCourierItemDescription(input.itemLines);
    if (description) order_payload.item_description = description;
  }
  return { order_id: input.orderId, order_payload };
}

export type DispatchOutcome =
  | { status: "dispatched"; consignmentId: string }
  | { status: "already_dispatched"; consignmentId: string }
  | { status: "failed"; error: string };

export interface DispatchEntryResult {
  order_id?: string;
  success?: boolean;
  consignment_id?: string | null;
  skipped?: boolean;
  has_existing?: boolean;
  existing_consignment_id?: string | null;
  error?: string;
}

/** Map one create_bulk per-entry result (or a missing one) to an outcome. */
export function mapDispatchEntryResult(
  result: DispatchEntryResult | null | undefined,
): DispatchOutcome {
  if (result?.success && result.consignment_id) {
    return { status: "dispatched", consignmentId: result.consignment_id };
  }
  // Edge-function dispatch idempotency guard: the order already has an active
  // courier entry. That is a completed dispatch (possibly one whose response
  // was lost), so report the existing consignment instead of failing.
  const existing = result?.existing_consignment_id ?? result?.consignment_id ?? null;
  if ((result?.skipped || result?.has_existing) && existing) {
    return { status: "already_dispatched", consignmentId: existing };
  }
  return { status: "failed", error: result?.error || "Pathao dispatch failed" };
}

/**
 * Dispatch one already-created order through the given Pathao Account.
 * Never creates or re-creates the order itself.
 */
export async function dispatchOrderViaAccount(
  entry: DispatchEntry,
  account: PathaoAccountOption,
): Promise<DispatchOutcome> {
  try {
    const { data, error } = await supabase.functions.invoke("pathao-courier", {
      body: {
        action: "create_bulk",
        orders: [entry],
        integration_id: account.integrationId ?? undefined,
      },
    });
    if (error) {
      const body = await readEdgeFnError(error);
      return {
        status: "failed",
        error: body?.error || body?.message || error.message || "Dispatch failed",
      };
    }
    const results: DispatchEntryResult[] = data?.data?.results || [];
    return mapDispatchEntryResult(results[0]);
  } catch (err: any) {
    return { status: "failed", error: err?.message || "Dispatch failed" };
  }
}
