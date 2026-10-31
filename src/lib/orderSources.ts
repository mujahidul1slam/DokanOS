/**
 * Task 6 (domain revamp, spec §2): shared vocabulary for the per-brand order
 * source model — "one real-world place/channel orders come from, nothing else
 * represents that".
 *
 * Connected sources (WooCommerce, Storefront, Facebook, WhatsApp…) receive or
 * sync orders; manual sources are user-named and staff-picked when entering an
 * order. Walk-in sales attach to the showroom/physical-store source itself.
 *
 * The DB enum lives in `supabase/migrations/20261031090000_unified_order_sources.sql`
 * (`order_source_type`); this module is the UI-side mirror plus the spec §7
 * legacy-mapping labels used by the read-only legacy section of the page.
 */

export type OrderSourceType =
  | "woocommerce"
  | "storefront"
  | "showroom"
  | "physical_store"
  | "facebook"
  | "instagram"
  | "whatsapp"
  | "manual";

export interface OrderSourceTypeInfo {
  value: OrderSourceType;
  label: string;
  /** Connected sources receive/sync orders; manual ones are staff-entered. */
  kind: "connected" | "manual";
  /** Physical sources hold stock by default (mirrors the DB trigger). */
  holdsStockByDefault: boolean;
  /** One-line helper shown in the create dialog. */
  hint: string;
}

export const ORDER_SOURCE_TYPES: readonly OrderSourceTypeInfo[] = [
  {
    value: "woocommerce",
    label: "WooCommerce",
    kind: "connected",
    holdsStockByDefault: false,
    hint: "Orders and products sync from a WooCommerce store (URL + API keys).",
  },
  {
    value: "storefront",
    label: "Storefront",
    kind: "connected",
    holdsStockByDefault: false,
    hint: "A Dokan OS storefront — checkout orders land here.",
  },
  {
    value: "showroom",
    label: "Showroom",
    kind: "connected",
    holdsStockByDefault: true,
    hint: "A physical showroom. Walk-in and POS sales attach here; holds stock.",
  },
  {
    value: "physical_store",
    label: "Physical store",
    kind: "connected",
    holdsStockByDefault: true,
    hint: "A retail outlet or branch. Holds stock.",
  },
  {
    value: "facebook",
    label: "Facebook",
    kind: "connected",
    holdsStockByDefault: false,
    hint: "Orders taken via a Facebook page.",
  },
  {
    value: "instagram",
    label: "Instagram",
    kind: "connected",
    holdsStockByDefault: false,
    hint: "Orders taken via an Instagram account.",
  },
  {
    value: "whatsapp",
    label: "WhatsApp",
    kind: "connected",
    holdsStockByDefault: false,
    hint: "Orders taken via a WhatsApp business number.",
  },
  {
    value: "manual",
    label: "Manual",
    kind: "manual",
    holdsStockByDefault: false,
    hint: "A channel you name yourself — Phone, Wholesale, Referral…",
  },
];

const TYPE_INFO: Record<string, OrderSourceTypeInfo> = Object.fromEntries(
  ORDER_SOURCE_TYPES.map((t) => [t.value, t]),
);

export function orderSourceTypeInfo(type: string): OrderSourceTypeInfo | undefined {
  return TYPE_INFO[type];
}

export function orderSourceLabel(type: string): string {
  return TYPE_INFO[type]?.label ?? type;
}

/** Physical sources hold stock by default; digital ones never do (spec §3). */
export function isPhysicalSourceType(type: string): boolean {
  return type === "showroom" || type === "physical_store";
}

/**
 * Walk-in sales attach to the showroom/physical-store source itself (spec §2).
 * Showroom wins over a generic physical store; anything else is not a walk-in
 * target.
 */
export function pickWalkInSource<T extends { type: string }>(sources: readonly T[]): T | null {
  return (
    sources.find((s) => s.type === "showroom") ??
    sources.find((s) => s.type === "physical_store") ??
    null
  );
}

export interface OrderSourceConfigField {
  key: string;
  label: string;
  placeholder?: string;
  /** Credentials are masked in the UI and never echoed back in plaintext. */
  secret?: boolean;
}

/**
 * Connection config lives ON the source (spec §2) — the fields each connected
 * type needs. Manual and physical sources take no connection config.
 */
export function orderSourceConfigFields(type: string): OrderSourceConfigField[] {
  switch (type) {
    case "woocommerce":
      return [
        { key: "url", label: "Store URL", placeholder: "https://shop.example.com" },
        { key: "consumer_key", label: "Consumer key", placeholder: "ck_…", secret: true },
        { key: "consumer_secret", label: "Consumer secret", placeholder: "cs_…", secret: true },
      ];
    case "storefront":
      return [{ key: "slug", label: "Storefront slug", placeholder: "my-store" }];
    case "facebook":
      return [{ key: "page_url", label: "Facebook page URL", placeholder: "https://facebook.com/…" }];
    case "instagram":
      return [{ key: "handle", label: "Instagram handle", placeholder: "@yourbrand" }];
    case "whatsapp":
      return [{ key: "phone", label: "WhatsApp business number", placeholder: "+8801XXXXXXXXX" }];
    default:
      return [];
  }
}

/** A row of the per-brand `order_sources` table (columns we read/write). */
export interface OrderSourceRow {
  id: string;
  brand_id: string;
  name: string;
  type: string;
  config: Record<string, unknown> | null;
  sync_direction: string | null;
  last_sync_at: string | null;
  last_sync_error: string | null;
  is_stock_holding: boolean | null;
  created_at: string;
  updated_at: string;
}

/**
 * Display state for the connection column: manual sources are staff-entered,
 * physical sources live in a venue (nothing to connect), digital sources are
 * "connected" once their config is complete and "needs_setup" until then.
 */
export function orderSourceConnectionState(
  source: Pick<OrderSourceRow, "type" | "config">,
): "manual" | "physical" | "connected" | "needs_setup" {
  const info = orderSourceTypeInfo(source.type);
  if (!info || info.kind === "manual") return "manual";
  if (isPhysicalSourceType(source.type)) return "physical";
  const fields = orderSourceConfigFields(source.type);
  const config = source.config ?? {};
  const configured = fields.every((f) => {
    const value = config[f.key];
    return typeof value === "string" && value.trim().length > 0;
  });
  return configured ? "connected" : "needs_setup";
}

// ---------------------------------------------------------------------------
// Spec §7 row mapping — what each legacy row collapses into at Task 8.
// Used by the read-only legacy section so nothing is lost from the page before
// the mapping migration runs. Labels are display-only; all migration logic is
// id-based (never name-based).
// ---------------------------------------------------------------------------

export const LEGACY_WOO_STORE_MAPPING = "1 order source · WooCommerce (config: URL + API keys)";

export const LEGACY_BRAND_STORE_MAPPING =
  "absorbed — its id becomes the audit mapping on the order source";

export const LEGACY_STOREFRONT_MAPPING = "1 order source · Storefront";

const LEGACY_SP_MAPPING: Record<string, string> = {
  woocommerce: "1 order source · WooCommerce",
  dokanos_storefront: "1 order source · Storefront",
  showroom_pos: "merges into its showroom source (POS binds there)",
  facebook: "1 order source · Facebook",
  instagram: "1 order source · Instagram",
  whatsapp: "1 order source · WhatsApp",
};

export function legacySellingPointMapping(type: string): string {
  return LEGACY_SP_MAPPING[type] ?? "1 manual order source (user-named)";
}
