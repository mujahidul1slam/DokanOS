/**
 * Storefront settings object (Phase 5) — single source of truth for the
 * checkout/UX settings schema and its defaults-merge (`lib/settings.ts` on the
 * client + edge fn). Defaults reproduce today's behavior exactly: `{}` =
 * flat-rate COD/bKash/Nagad, no threshold, no announcement.
 *
 * Extension (parity plan): per-surface settings — card, product, shop,
 * header, animations, delivery, payment_config. All optional on read; when a
 * key is missing the surface falls back to its built-in defaults.
 */

export interface StorefrontCardSettings {
  /** Classic | Minimal | Bordered | Elevated */
  style: "classic" | "minimal" | "bordered" | "elevated";
  corner_px: number;
  shadow: "none" | "soft" | "medium";
  image_ratio: "square" | "tall" | "wide";
  hover: "zoom" | "lift" | "none";
  show_wishlist: boolean;
  show_category: boolean;
  show_price: boolean;
  show_add_to_cart: boolean;
  show_buy_now: boolean;
  card_bg: string;
  card_border: string;
  price_color: string;
  button_layout: "side" | "stacked";
  button_position: "below" | "overlay";
  add_to_cart_icon: "cart" | "bag" | "plus" | "none";
  buy_now_icon: "zap" | "arrow" | "bag" | "cart" | "none";
  add_to_cart_bg: string;
  add_to_cart_text: string;
  buy_now_bg: string;
  buy_now_text: string;
  buy_now_border: string;
  font: string; // "theme" | font key
  spacing: string; // "theme" | "compact" | "comfortable"
}

export interface StorefrontProductPageSettings {
  layout: "classic" | "split" | "gallery-left";
  image_shape: "landscape" | "square" | "portrait";
  video_style: "first" | "below";
  info_panel: "card" | "open";
  related_per_row_pc: number;
  related_per_row_phone: number;
  accent_override: string; // "" = inherit theme accent
  atc_corners: "rounded" | "pill" | "square";
  atc_height: "compact" | "default" | "large";
  atc_arrangement: "stacked" | "side";
  price_in_button: boolean;
  atc_fill: "solid" | "outline" | "tinted";
  atc_color: string;
  atc_text_color: string;
  buy_corners: "rounded" | "pill" | "square";
  buy_height: "compact" | "default" | "large";
  buy_fill: "solid" | "outline" | "tinted";
  buy_color: string;
  buy_text_color: string;
  show_category_label: boolean;
  show_wishlist: boolean;
  show_size_chart: boolean;
  show_sku: boolean;
  show_quantity: boolean;
  show_price_breakdown: boolean;
  show_stock_status: boolean;
  show_sold_count: boolean;
  show_share: boolean;
  trust_badges: string[];
}

export interface StorefrontShopPageSettings {
  per_page: number;
  columns_pc: number;
  columns_phone: number;
  heading: string;
  heading_desc: string;
  result_count: boolean;
  show_sorting: boolean;
  show_filters: boolean;
  price_bands: number[]; // ascending band edges in ৳, e.g. [0, 500, 1000, 2000, 5000]
  pagination: "numbers" | "load-more" | "buttons";
}

export interface StorefrontHeaderFooterSettings {
  show_dark_toggle: boolean;
  custom_icons: { icon: string; href: string }[];
  custom_links: { label: string; href: string }[];
  show_footer_cta: boolean;
}

export interface StorefrontAnimationSettings {
  enabled: boolean;
  effect:
    | "none" | "fade" | "rise" | "drop" | "slide-l" | "slide-r"
    | "zoom-in" | "zoom-out" | "blur" | "flip" | "tilt" | "bounce";
  speed_ms: number;
  strength: "subtle" | "medium" | "strong";
  cascade: boolean;
  cascade_gap_ms: number;
  play_once: boolean;
  animate_on_load: boolean;
  animate_on_phones: boolean;
}

export interface StorefrontDeliverySettings {
  default_charge: number;
  default_label: string;
  cod_enabled: boolean;
  cod_instructions: string;
  non_refundable: boolean;
  per_product: boolean;
  show_upazila: boolean;
  simple_address: boolean;
  advance_payment_enabled: boolean;
  advance_percent: number;
}

export interface StorefrontPaymentMethod {
  label: string;
  type: "send-money" | "payment" | "cash-out";
  account_name: string;
  account_number: string;
  instructions: string;
  ask_for_phone: boolean;
}

export interface StorefrontPaymentsSettings {
  bkash: StorefrontPaymentMethod;
  nagad: StorefrontPaymentMethod;
  rocket: StorefrontPaymentMethod;
  upay: StorefrontPaymentMethod;
  mcash: StorefrontPaymentMethod;
  cod: { instructions: string };
}

export interface StorefrontSettings {
  checkout: {
    methods: { cod: boolean; bkash: boolean; nagad: boolean; rocket: boolean; upay: boolean; mcash: boolean };
    min_order_amount: number;
    order_instructions: string;
    terms_checkbox_text: string;
  };
  shipping: { free_threshold: number };
  tax: { inclusive: boolean };
  announcement: { enabled: boolean; text: string; href: string };
  pixels: { ga4: string; meta: string; tiktok: string };
  card: StorefrontCardSettings;
  product: StorefrontProductPageSettings;
  shop: StorefrontShopPageSettings;
  header: StorefrontHeaderFooterSettings;
  animations: StorefrontAnimationSettings;
  delivery: StorefrontDeliverySettings;
  payments: StorefrontPaymentsSettings;
}

export const DEFAULT_CARD: StorefrontCardSettings = {
  style: "classic",
  corner_px: 12,
  shadow: "soft",
  image_ratio: "tall",
  hover: "zoom",
  show_wishlist: false,
  show_category: false,
  show_price: true,
  show_add_to_cart: false,
  show_buy_now: false,
  card_bg: "",
  card_border: "",
  price_color: "",
  button_layout: "side",
  button_position: "below",
  add_to_cart_icon: "cart",
  buy_now_icon: "zap",
  add_to_cart_bg: "",
  add_to_cart_text: "",
  buy_now_bg: "",
  buy_now_text: "",
  buy_now_border: "",
  font: "theme",
  spacing: "theme",
};

export const DEFAULT_PRODUCT: StorefrontProductPageSettings = {
  layout: "classic",
  image_shape: "portrait",
  video_style: "first",
  info_panel: "card",
  related_per_row_pc: 4,
  related_per_row_phone: 2,
  accent_override: "",
  atc_corners: "rounded",
  atc_height: "default",
  atc_arrangement: "stacked",
  price_in_button: false,
  atc_fill: "solid",
  atc_color: "",
  atc_text_color: "",
  buy_corners: "rounded",
  buy_height: "default",
  buy_fill: "outline",
  buy_color: "",
  buy_text_color: "",
  show_category_label: false,
  show_wishlist: false,
  show_size_chart: false,
  show_sku: false,
  show_quantity: true,
  show_price_breakdown: false,
  show_stock_status: true,
  show_sold_count: false,
  show_share: false,
  trust_badges: ["Cash on delivery", "Fast delivery", "Easy returns"],
};

export const DEFAULT_SHOP: StorefrontShopPageSettings = {
  per_page: 12,
  columns_pc: 4,
  columns_phone: 2,
  heading: "Shop",
  heading_desc: "",
  result_count: true,
  show_sorting: false,
  show_filters: false,
  price_bands: [0, 500, 1000, 2000, 5000],
  pagination: "buttons",
};

export const DEFAULT_HEADER: StorefrontHeaderFooterSettings = {
  show_dark_toggle: false,
  custom_icons: [],
  custom_links: [],
  show_footer_cta: false,
};

export const DEFAULT_ANIMATIONS: StorefrontAnimationSettings = {
  enabled: false,
  effect: "fade",
  speed_ms: 700,
  strength: "medium",
  cascade: false,
  cascade_gap_ms: 70,
  play_once: true,
  animate_on_load: false,
  animate_on_phones: true,
};

export const DEFAULT_DELIVERY: StorefrontDeliverySettings = {
  default_charge: 0,
  default_label: "Delivery",
  cod_enabled: true,
  cod_instructions: "",
  non_refundable: false,
  per_product: false,
  show_upazila: true,
  simple_address: false,
  advance_payment_enabled: false,
  advance_percent: 0,
};

const defPay = (): StorefrontPaymentMethod => ({ label: "", type: "send-money", account_name: "", account_number: "", instructions: "", ask_for_phone: false });

export const DEFAULT_PAYMENTS: StorefrontPaymentsSettings = {
  bkash: defPay(),
  nagad: defPay(),
  rocket: defPay(),
  upay: defPay(),
  mcash: defPay(),
  cod: { instructions: "" },
};

// deep-merge helper: for a group, walk DEFAULT + raw — value at each leaf is raw if raw is a
// non-null primitive / array of the right shape, else default.
function pick(inb: any, def: any): any {
  if (Array.isArray(def)) return Array.isArray(inb) ? inb : def;
  if (def !== null && typeof def === "object") {
    const out: any = {};
    for (const k of Object.keys(def)) out[k] = pick(inb?.[k], def[k]);
    return out;
  }
  return inb === undefined || inb === null ? def : inb;
}

export function mergeSettings(raw: any): StorefrontSettings {
  const base = DEFAULT_STOREFRONT_SETTINGS;
  const c = raw?.checkout || {};
  return {
    checkout: {
      methods: mergeMethods(c.methods),
      min_order_amount: Number.isFinite(Number(c.min_order_amount)) ? Number(c.min_order_amount) : 0,
      order_instructions: typeof c.order_instructions === "string" ? c.order_instructions : "",
      terms_checkbox_text: typeof c.terms_checkbox_text === "string" ? c.terms_checkbox_text : "",
    },
    shipping: { free_threshold: Number.isFinite(Number(raw?.shipping?.free_threshold)) ? Number(raw.shipping.free_threshold) : 0 },
    tax: { inclusive: raw?.tax?.inclusive !== false },
    announcement: {
      enabled: !!raw?.announcement?.enabled,
      text: raw?.announcement?.text || "",
      href: raw?.announcement?.href || "",
    },
    pixels: {
      ga4: raw?.pixels?.ga4 || "",
      meta: raw?.pixels?.meta || "",
      tiktok: raw?.pixels?.tiktok || "",
    },
    card: pick(raw?.card, DEFAULT_CARD),
    product: pick(raw?.product, DEFAULT_PRODUCT),
    shop: pick(raw?.shop, DEFAULT_SHOP),
    header: pick(raw?.header, DEFAULT_HEADER),
    animations: pick(raw?.animations, DEFAULT_ANIMATIONS),
    delivery: pick(raw?.delivery, DEFAULT_DELIVERY),
    payments: pick(raw?.payments, DEFAULT_PAYMENTS),
  };
}

export function mergeMethods(raw: any): StorefrontSettings["checkout"]["methods"] {
  return {
    cod: raw?.cod !== false,
    bkash: raw?.bkash !== false,
    nagad: raw?.nagad !== false,
    rocket: raw?.rocket === true,
    upay: raw?.upay === true,
    mcash: raw?.mcash === true,
  };
}

export const DEFAULT_STOREFRONT_SETTINGS: StorefrontSettings = {
  checkout: { methods: { cod: true, bkash: true, nagad: true, rocket: false, upay: false, mcash: false }, min_order_amount: 0, order_instructions: "", terms_checkbox_text: "" },
  shipping: { free_threshold: 0 },
  tax: { inclusive: false },
  announcement: { enabled: false, text: "", href: "" },
  pixels: { ga4: "", meta: "", tiktok: "" },
  card: DEFAULT_CARD,
  product: DEFAULT_PRODUCT,
  shop: DEFAULT_SHOP,
  header: DEFAULT_HEADER,
  animations: DEFAULT_ANIMATIONS,
  delivery: DEFAULT_DELIVERY,
  payments: DEFAULT_PAYMENTS,
};

/** Validation rules (≥1 method enabled, min_order ≥ 0); returns problems. */
export function validateSettings(s: StorefrontSettings): string[] {
  const errs: string[] = [];
  const methods = s.checkout.methods;
  if (!methods.cod && !methods.bkash && !methods.nagad && !methods.rocket && !methods.upay && !methods.mcash) errs.push("At least one payment method must stay enabled");
  if (!Number.isFinite(Number(s.checkout.min_order_amount)) || Number(s.checkout.min_order_amount) < 0) {
    errs.push("Minimum order amount must be ≥ 0");
  }
  if (Number(s.shipping.free_threshold) < 0) errs.push("Free shipping threshold must be ≥ 0");
  if (!Number.isFinite(s.shop.per_page) || s.shop.per_page < 4 || s.shop.per_page > 48) errs.push("Products per page must be 4–48");
  return errs;
}
