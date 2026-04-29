import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const KEY = "omnisync-global-stock";
const DB_KEY = "global_stock_enabled";
const EVENT = "omnisync-global-stock-change";

export const getGlobalStockEnabled = (): boolean => {
  const v = localStorage.getItem(KEY);
  // default ON when never set
  if (v === null) return true;
  return v === "true";
};

const writeLocal = (enabled: boolean) => {
  localStorage.setItem(KEY, String(enabled));
  window.dispatchEvent(new CustomEvent(EVENT, { detail: enabled }));
};

export const setGlobalStockEnabled = async (enabled: boolean) => {
  writeLocal(enabled);
  // Persist to DB so it survives cache clears and syncs across devices
  try {
    await supabase
      .from("app_settings" as any)
      .upsert({ key: DB_KEY, value: { enabled } }, { onConflict: "key" });
  } catch (e) {
    console.warn("Failed to persist global stock setting to DB", e);
  }
};

/**
 * Fetch from DB. Returns the authoritative boolean (or null if no row exists / error).
 * Concurrent calls share the same in-flight promise.
 */
let inflight: Promise<boolean | null> | null = null;
export const fetchGlobalStockFromDB = (): Promise<boolean | null> => {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data, error } = await supabase
        .from("app_settings" as any)
        .select("value")
        .eq("key", DB_KEY)
        .maybeSingle();
      if (error) return null;
      if (data && (data as any).value && typeof (data as any).value.enabled === "boolean") {
        const enabled = (data as any).value.enabled;
        writeLocal(enabled);
        return enabled;
      }
      return null;
    } catch {
      return null;
    } finally {
      setTimeout(() => { inflight = null; }, 0);
    }
  })();
  return inflight;
};

/** React hook that reflects current global stock toggle. */
export const useGlobalStockEnabled = (): boolean => {
  const [enabled, setEnabled] = useState<boolean>(() => getGlobalStockEnabled());
  useEffect(() => {
    let cancelled = false;
    fetchGlobalStockFromDB().then((v) => {
      if (cancelled) return;
      if (v !== null) setEnabled(v);
    });
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
      cancelled = true;
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
