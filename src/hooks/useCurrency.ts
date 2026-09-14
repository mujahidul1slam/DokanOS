import { useEffect, useMemo } from "react";
import { useBusinessContext } from "@/hooks/useBusinessContext";
import {
  DEFAULT_CURRENCY,
  fmtAmount,
  setActiveCurrency,
  symbolFor,
} from "@/lib/currency";

/**
 * W2d: the one currency hook for the operator app. Derives the currency code
 * from the active business (Business Account tab). Falls back to BDT when no
 * business is active — matching every pre-existing literal.
 *
 * - symbol: bare currency symbol
 * - fmt(n): symbol + thousands-separated amount (e.g. 1,234.50 with symbol prefix)
 * - fmtPlain(n): thousands-separated amount without symbol (e.g. 1,234.50)
 */
export function useCurrency() {
  const { active } = useBusinessContext();
  const code = active?.currency ?? DEFAULT_CURRENCY;

  // Keep the module-level registry in sync for non-React lib builders.
  useEffect(() => {
    setActiveCurrency(code);
  }, [code]);

  return useMemo(() => {
    const fmt = (n: number) => fmtAmount(n, code);
    const fmtPlain = (n: number) =>
      (Number.isFinite(n) ? n : 0).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    return { code, symbol: symbolFor(code), fmt, fmtPlain };
  }, [code]);
}
