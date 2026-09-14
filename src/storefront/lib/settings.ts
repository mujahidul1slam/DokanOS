/**
 * Storefront settings object (Phase 5) — single source of truth for the
 * checkout/UX settings schema and its defaults-merge (`lib/settings.ts` on the
 * client + edge fn). Defaults reproduce today's behavior exactly: `{}` =
 * flat-rate COD/bKash/Nagad, no threshold, no announcement.
 */

export interface StorefrontSettings {
  checkout: {
    methods: { cod: boolean; bkash: boolean; nagad: boolean };
    min_order_amount: number;
    order_instructions: string;
    terms_checkbox_text: string;
  };
  shipping: { free_threshold: number };
  tax: { inclusive: boolean };
  announcement: { enabled: boolean; text: string; href: string };
  pixels: { ga4: string; meta: string; tiktok: string };
}

export const DEFAULT_STOREFRONT_SETTINGS: StorefrontSettings = {
  checkout: { methods: { cod: true, bkash: true, nagad: true }, min_order_amount: 0, order_instructions: "", terms_checkbox_text: "" },
  shipping: { free_threshold: 0 },
  tax: { inclusive: false },
  announcement: { enabled: false, text: "", href: "" },
  pixels: { ga4: "", meta: "", tiktok: "" },
};

function mergeMethods(raw: any): StorefrontSettings["checkout"]["methods"] {
  return {
    cod: raw?.cod !== false,
    bkash: raw?.bkash !== false,
    nagad: raw?.nagad !== false,
  };
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
  };
}

/** Validation rules (≥1 method enabled, min_order ≥ 0); returns problems. */
export function validateSettings(s: StorefrontSettings): string[] {
  const errs: string[] = [];
  const methods = s.checkout.methods;
  if (!methods.cod && !methods.bkash && !methods.nagad) errs.push("At least one payment method must stay enabled");
  if (!Number.isFinite(Number(s.checkout.min_order_amount)) || Number(s.checkout.min_order_amount) < 0) {
    errs.push("Minimum order amount must be ≥ 0");
  }
  if (Number(s.shipping.free_threshold) < 0) errs.push("Free shipping threshold must be ≥ 0");
  return errs;
}