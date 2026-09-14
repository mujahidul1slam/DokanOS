// W2d: single currency source for the operator app.
// Pipeline: businesses.currency (Business Account tab) → useCurrency() → output.
// Storefront is exempt by design: it binds to storefronts.currency per store.

export const CURRENCY_SYMBOLS: Record<string, string> = {
  BDT: "৳",
  USD: "$",
  EUR: "€",
  GBP: "£",
  INR: "₹",
  MYR: "RM",
  SAR: "﷼",
  AED: "د.إ",
};

export const DEFAULT_CURRENCY = "BDT";

// Module-level cache of the active business currency, synced by useCurrency().
// Lets non-React lib builders (print HTML, timeline rows) default to the
// active business currency without a hook. The source of truth remains
// businesses.currency — this is only a cache of the context value.
let activeCurrency: string | null = null;

export function setActiveCurrency(code: string): void {
  activeCurrency = code;
}

export function getActiveCurrency(): string {
  return activeCurrency ?? DEFAULT_CURRENCY;
}

export function symbolFor(code: string | null | undefined): string {
  if (!code) return CURRENCY_SYMBOLS[DEFAULT_CURRENCY];
  return CURRENCY_SYMBOLS[code] ?? code;
}

/** Format with symbol prefix: ৳1,234.50 */
export function fmtAmount(n: number, code: string | null | undefined): string {
  const safe = Number.isFinite(n) ? n : 0;
  return `${symbolFor(code)}${safe.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
