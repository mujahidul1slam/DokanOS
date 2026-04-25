import { useEffect, useState } from "react";

const KEY = "omnisync-global-stock";

export const getGlobalStockEnabled = (): boolean => {
  const v = localStorage.getItem(KEY);
  // default ON when never set
  if (v === null) return true;
  return v === "true";
};

export const setGlobalStockEnabled = (enabled: boolean) => {
  localStorage.setItem(KEY, String(enabled));
  window.dispatchEvent(new CustomEvent("omnisync-global-stock-change", { detail: enabled }));
};

/** React hook that reflects current global stock toggle. */
export const useGlobalStockEnabled = (): boolean => {
  const [enabled, setEnabled] = useState<boolean>(() => getGlobalStockEnabled());
  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setEnabled(typeof detail === "boolean" ? detail : getGlobalStockEnabled());
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setEnabled(getGlobalStockEnabled());
    };
    window.addEventListener("omnisync-global-stock-change", onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("omnisync-global-stock-change", onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return enabled;
};

interface StockableProduct {
  manage_stock?: boolean | null;
  stock_quantity?: number | null;
  stock_status?: string | null;
}

/**
 * Returns effective stock state given the global toggle.
 *
 * Rules (when global stock is OFF):
 *  - Products with manage_stock === true (set manually) keep their tracked stock.
 *  - Products manually marked stock_status === "outofstock" remain OOS.
 *  - Everything else is treated as unlimited (in stock, no OOS badge).
 *
 * When global stock is ON: standard behavior (use stock_quantity / stock_status).
 */
export const getEffectiveStock = (
  p: StockableProduct,
  globalEnabled: boolean,
): { tracked: boolean; quantity: number; outOfStock: boolean } => {
  const manuallyTracked = p.manage_stock === true;
  const manuallyOOS = (p.stock_status || "").toLowerCase() === "outofstock";
  const qty = Number(p.stock_quantity || 0);

  if (!globalEnabled && !manuallyTracked && !manuallyOOS) {
    return { tracked: false, quantity: Infinity, outOfStock: false };
  }

  if (manuallyOOS) return { tracked: true, quantity: qty, outOfStock: true };

  if (manuallyTracked || globalEnabled) {
    return { tracked: true, quantity: qty, outOfStock: qty <= 0 };
  }

  return { tracked: false, quantity: Infinity, outOfStock: false };
};
