/**
 * Task 6 (domain revamp, spec §2): shared vocabulary for the per-brand order
 * source model — "one real-world place/channel orders come from, nothing else
 * represents that".
 *
 * Connected sources (Storefront, Facebook, WhatsApp…) receive or sync orders;
 * manual sources are user-named and staff-picked when entering an order.
 * Walk-in sales attach to the showroom/physical-store source itself.
 *
 * The DB enum lives in `supabase/migrations/20261031090000_unified_order_sources.sql`
 * (`order_source_type`); this module is the UI-side mirror. `woocommerce` stays
 * in the enum because rows created before the legacy Woo retirement still carry
 * it, but it is read-only here: no connection config, no sync controls.
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
  /**
   * Legacy Woo retirement: the type survives only for order sources that
   * already exist. It cannot be created or connected, so the create dialog
   * hides it and no connect/sync controls are rendered for it.
   */
  legacy?: boolean;
}

export const ORDER_SOURCE_TYPES: readonly OrderSourceTypeInfo[] = [
  {
    value: "woocommerce",
    label: "WooCommerce (legacy)",
    kind: "connected",
    holdsStockByDefault: false,
    hint: "Retired integration — kept for sources created before the legacy Woo retirement.",
    legacy: true,
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

/**
 * Default order source for a brand's manually entered orders (Add Order form):
 * 1. the source the operator marked as default on the Integrations page,
 * 2. otherwise the brand's Facebook/Instagram source (the most common manual
 *    channel — Facebook wins over Instagram),
 * 3. otherwise the first source.
 *
 * Walk-in orders bypass this — they attach to the showroom/physical-store
 * source via `pickWalkInSource`.
 */
export function pickDefaultOrderSource<
  T extends { type: string; is_default?: boolean | null },
>(sources: readonly T[]): T | null {
  if (sources.length === 0) return null;
  return (
    sources.find((s) => s.is_default) ??
    sources.find((s) => s.type === "facebook" || s.type === "instagram") ??
    sources[0]
  );
}

/**
 * Fallback label for orders without an order_sources row (legacy text
 * attribution): POS / WooCommerce [store] / capitalized source text / Manual.
 */
export function sourceFallbackLabel(source: string | null | undefined, storeName?: string | null): string {
  if (source === "pos") return "POS";
  if (source === "online" || source === "woo" || source === "woocommerce") {
    return storeName ? `WooCommerce [${storeName}]` : "WooCommerce";
  }
  // Manual orders (phone, fb/ig, whatsapp, etc.) — show the source label directly
  return source ? source.charAt(0).toUpperCase() + source.slice(1) : "Manual";
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
  /**
   * Default source for the brand's manually entered orders (Add Order form).
   * At most one per brand — enforced by a partial unique index in the DB;
   * picked on the Integrations page.
   */
  is_default?: boolean | null;
  /**
   * The `stores.id` this source ships stock from. Legacy Woo sources carry the
   * old store binding here; the Add Order form derives its stock store from the
   * chosen source/brand instead of asking the operator to pick one by hand.
   */
  legacy_woo_store_id?: string | null;
  ship_from_store: boolean;
  /** Ordered stock-holder id list (spec §3) — normalized via `normalizeFulfillmentPreference`. */
  fulfillment_preference: unknown;
  /** Accepted payment method codes (spec §4) — normalized via `normalizeAcceptedMethods`. */
  accepted_payment_methods: unknown;
  created_at: string;
  updated_at: string;
}

/**
 * Display state for the connection column: manual sources are staff-entered,
 * physical sources live in a venue (nothing to connect), legacy types have no
 * connection any more, and digital sources are "connected" once their config is
 * complete and "needs_setup" until then.
 */
export function orderSourceConnectionState(
  source: Pick<OrderSourceRow, "type" | "config">,
): "manual" | "physical" | "legacy" | "connected" | "needs_setup" {
  const info = orderSourceTypeInfo(source.type);
  if (!info || info.kind === "manual") return "manual";
  if (info.legacy) return "legacy";
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
// Spec §7 row mapping — what each legacy row collapsed into at the Task 8
// mapping migration. After the Task 16 contract drop only the Woo-store
// record remains visible (the legacy contract tables are gone); this label
// documents what that row became. Display-only.
// ---------------------------------------------------------------------------

export const LEGACY_WOO_STORE_MAPPING = "1 order source · WooCommerce (config: URL + API keys)";
