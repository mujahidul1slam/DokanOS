import { supabase } from "@/integrations/supabase/client";

/**
 * Courier product descriptions (issue #23).
 *
 * An optional per-Pathao-Account setting, default OFF. When ON for the account
 * a dispatch uses, the courier parcel description (Pathao create-order
 * `item_description`) carries the order's product lines: product names,
 * quantities, and variation/size labels taken from order_items.product_name's
 * "Name - variationLabel" convention.
 *
 * The option persists without schema change as one app_settings KV row
 * holding a per-account map `{ [PathaoAccountOption.key]: true }` — the
 * preOrderSettings/stockSettings pattern. Absent keys mean OFF.
 */

/** app_settings key holding the per-account enable map. */
export const COURIER_DESCRIPTION_SETTINGS_KEY = "courier_product_descriptions";

/**
 * Safe truncation cap for Pathao `item_description`.
 *
 * The official Pathao Merchant API docs document no length limit for
 * `item_description` ("Parcel description"); their longest documented string
 * field, recipient_address, caps at 220 chars. 255 is the conventional string
 * column cap used across the Aladdin API surface, so descriptions are cut
 * there conservatively. Parameterized in {@link truncateCourierDescription}
 * so tests (and future doc discoveries) can retune it in one place.
 */
export const PATHAO_ITEM_DESCRIPTION_MAX = 255;

export interface CourierItemLine {
  /** order_items.product_name: "Name - variationLabel", or just "Name". */
  product_name: string;
  quantity: number;
}

export interface ParsedCourierProductName {
  /** Product name without the variation/size label. */
  name: string;
  /** Variation/size label, or null when product_name carries none. */
  variationLabel: string | null;
}

/**
 * order_items.product_name convention, shared by the create path and the
 * courier description builder: "Name - variationLabel" (or just "Name").
 */
export function formatOrderItemProductName(
  name: string,
  variationLabel?: string | null,
): string {
  const label = (variationLabel ?? "").trim();
  return label ? `${name} - ${label}` : name;
}

/**
 * Split order_items.product_name's "Name - variationLabel" convention.
 * A name without the " - " separator parses as a plain product name.
 */
export function parseCourierProductName(productName: string): ParsedCourierProductName {
  const trimmed = (productName ?? "").trim();
  const sep = trimmed.indexOf(" - ");
  if (sep <= 0) return { name: trimmed, variationLabel: null };
  const variationLabel = trimmed.slice(sep + 3).trim();
  return {
    name: trimmed.slice(0, sep).trim(),
    variationLabel: variationLabel || null,
  };
}

/**
 * Build the courier item description from order lines, e.g.
 * "2x Shirt (XL), 1x Pan (32)". Lines without a usable name or quantity are
 * skipped; an empty result means the caller should omit the field entirely.
 * The result never exceeds `maxLength`.
 */
export function buildCourierItemDescription(
  lines: CourierItemLine[],
  maxLength: number = PATHAO_ITEM_DESCRIPTION_MAX,
): string {
  const parts: string[] = [];
  for (const line of lines) {
    const { name, variationLabel } = parseCourierProductName(line.product_name ?? "");
    const qty = Math.floor(Number(line.quantity));
    if (!name || !Number.isFinite(qty) || qty <= 0) continue;
    parts.push(`${qty}x ${name}${variationLabel ? ` (${variationLabel})` : ""}`);
  }
  if (parts.length === 0) return "";
  return truncateCourierDescription(parts.join(", "), maxLength);
}

/**
 * Truncate safely to the API limit: the result never exceeds `maxLength`,
 * never splits a surrogate pair at the cut point, and drops a dangling
 * separator or unclosed parenthesis before the ellipsis.
 */
export function truncateCourierDescription(
  text: string,
  maxLength: number = PATHAO_ITEM_DESCRIPTION_MAX,
): string {
  const limit = Math.max(1, Math.floor(maxLength));
  if (text.length <= limit) return text;
  const ellipsis = "\u2026"; // …
  let cut = text.slice(0, limit - ellipsis.length);
  // Don't leave half of a surrogate pair (emoji in product names) behind.
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  // Don't end mid-list: drop a trailing partial item ("Shirt, 2x " / "Shirt (").
  cut = cut.replace(/\(\s*$/u, "").replace(/[\s,;.\u2013\u2014-]+$/u, "");
  return cut + ellipsis;
}

// ---------------------------------------------------------------------------
// Persistence: one app_settings KV row, per-account map under one key.
// ---------------------------------------------------------------------------

/** Per-account enable map. Absent keys are OFF (the default). */
export type CourierDescriptionOptions = Record<string, boolean>;

/** Pure merge: only enabled accounts are stored; disabling removes the key. */
export function mergeCourierDescriptionOption(
  options: CourierDescriptionOptions,
  accountKey: string,
  enabled: boolean,
): CourierDescriptionOptions {
  const next: CourierDescriptionOptions = { ...options };
  if (enabled) next[accountKey] = true;
  else delete next[accountKey];
  return next;
}

/** Default-OFF read helper for the resolved account key. */
export function isCourierDescriptionEnabled(
  options: CourierDescriptionOptions,
  accountKey: string | null | undefined,
): boolean {
  return Boolean(accountKey && options[accountKey]);
}

function sanitizeOptions(value: unknown): CourierDescriptionOptions {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: CourierDescriptionOptions = {};
  for (const [key, flag] of Object.entries(value as Record<string, unknown>)) {
    if (flag === true) out[key] = true;
  }
  return out;
}

/**
 * Fetch the per-account enable map from app_settings ({} when unset).
 * Errors fall back to the safe default: everything OFF.
 */
export async function fetchCourierDescriptionOptions(): Promise<CourierDescriptionOptions> {
  try {
    const { data, error } = await supabase
      .from("app_settings" as any)
      .select("value")
      .eq("key", COURIER_DESCRIPTION_SETTINGS_KEY)
      .maybeSingle();
    if (error) return {};
    return sanitizeOptions((data as any)?.value);
  } catch {
    return {};
  }
}

/**
 * Persist one account's option under the shared app_settings key.
 * Read-modify-write keeps other accounts' flags intact. Returns the new map.
 */
export async function setCourierDescriptionOption(
  accountKey: string,
  enabled: boolean,
): Promise<CourierDescriptionOptions> {
  const current = await fetchCourierDescriptionOptions();
  const next = mergeCourierDescriptionOption(current, accountKey, enabled);
  const { error } = await supabase
    .from("app_settings" as any)
    .upsert(
      { key: COURIER_DESCRIPTION_SETTINGS_KEY, value: next },
      { onConflict: "key" },
    );
  if (error) throw error;
  return next;
}
