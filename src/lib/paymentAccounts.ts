/**
 * Task 10 (domain revamp, spec §4): business-level payment accounts and the
 * per-order-source accepted payment methods.
 *
 * One payment account per business (bKash, Nagad, Stripe, card…) — never per
 * brand. `credentials` is provider-specific and write-only in the UI (never
 * echoed back in plaintext). There are no legacy payment integration tables
 * (payments were free text on orders), so no legacy_* mapping applies.
 *
 * Each order source toggles which payment methods it accepts; cash / manual
 * is always available for staff-entered orders regardless of those toggles.
 */

export type PaymentProviderCode = "bkash" | "nagad" | "stripe" | "card";

export interface PaymentCredentialField {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
}

export interface PaymentProviderInfo {
  code: PaymentProviderCode;
  label: string;
  fields: PaymentCredentialField[];
}

export const PAYMENT_PROVIDERS: readonly PaymentProviderInfo[] = [
  {
    code: "bkash",
    label: "bKash",
    fields: [
      { key: "app_key", label: "App key", secret: true },
      { key: "app_secret", label: "App secret", secret: true },
      { key: "username", label: "Account username" },
      { key: "password", label: "Account password", secret: true },
    ],
  },
  {
    code: "nagad",
    label: "Nagad",
    fields: [
      { key: "merchant_id", label: "Merchant ID" },
      { key: "api_key", label: "API key", secret: true },
      { key: "api_secret", label: "API secret", secret: true },
    ],
  },
  {
    code: "stripe",
    label: "Stripe",
    fields: [
      { key: "publishable_key", label: "Publishable key" },
      { key: "secret_key", label: "Secret key", secret: true },
    ],
  },
  {
    code: "card",
    label: "Card",
    fields: [
      { key: "merchant_id", label: "Merchant ID" },
      { key: "api_key", label: "API key", secret: true },
    ],
  },
];

const PROVIDER_MAP: Record<string, PaymentProviderInfo> = Object.fromEntries(
  PAYMENT_PROVIDERS.map((p) => [p.code, p]),
);

export function paymentProviderInfo(code: string): PaymentProviderInfo | undefined {
  return PROVIDER_MAP[code];
}

export function paymentProviderLabel(code: string): string {
  return PROVIDER_MAP[code]?.label ?? code;
}

export interface PaymentAccountRow {
  id: string;
  business_id: string;
  provider: string;
  name: string;
  credentials: Record<string, unknown> | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Display state for an account: inactive, configured (all credential fields
 * present), or still needing setup. Credentials are stored but never rendered.
 */
export function paymentAccountState(
  account: Pick<PaymentAccountRow, "provider" | "credentials" | "is_active">,
): "inactive" | "configured" | "needs_setup" {
  if (!account.is_active) return "inactive";
  const fields = paymentProviderInfo(account.provider)?.fields ?? [];
  const credentials = account.credentials ?? {};
  const configured = fields.every((f) => {
    const value = credentials[f.key];
    return typeof value === "string" && value.trim().length > 0;
  });
  return configured ? "configured" : "needs_setup";
}

/* ─── Payment methods (order_sources.accepted_payment_methods) ─── */

export interface PaymentMethodInfo {
  code: string;
  label: string;
}

/** Known method codes — must stay in sync with the migration's CHECK list. */
export const PAYMENT_METHODS: readonly PaymentMethodInfo[] = [
  { code: "cod", label: "Cash on delivery" },
  { code: "cash", label: "Cash / manual" },
  { code: "bkash", label: "bKash" },
  { code: "nagad", label: "Nagad" },
  { code: "stripe", label: "Card (Stripe)" },
  { code: "card", label: "Card" },
];

const METHOD_MAP: Record<string, PaymentMethodInfo> = Object.fromEntries(
  PAYMENT_METHODS.map((m) => [m.code, m]),
);

export function paymentMethodLabel(code: string): string {
  return METHOD_MAP[code]?.label ?? code;
}

/** The default every fresh source ships with (matches the migration default). */
export const DEFAULT_ACCEPTED_METHODS: readonly string[] = ["cod", "cash"];

/**
 * Normalize the stored `accepted_payment_methods` jsonb: keep known codes in
 * registry order, drop unknown junk, fall back to the default when the value
 * is not an array with at least one known code (never an unusable empty set).
 */
export function normalizeAcceptedMethods(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_ACCEPTED_METHODS];
  const known = (value as unknown[]).filter(
    (v): v is string => typeof v === "string" && v in METHOD_MAP,
  );
  if (known.length === 0) return [...DEFAULT_ACCEPTED_METHODS];
  return PAYMENT_METHODS.filter((m) => known.includes(m.code)).map((m) => m.code);
}

/**
 * The methods a staff-entered order may use for a source: its accepted
 * methods, plus cash / manual ALWAYS available (spec §4 acceptance:
 * "Manual/cash always available for staff-entered orders").
 */
export function staffPaymentOptions(accepted: unknown): PaymentMethodInfo[] {
  const codes = new Set(normalizeAcceptedMethods(accepted));
  codes.add("cash");
  return PAYMENT_METHODS.filter((m) => codes.has(m.code));
}
