import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Multi-business restructure Phase 1: the REAL business context.
 *
 * Hierarchy: User → Business (org) → Brand → {Locations, Selling points,
 * Connectors}. One login may belong to multiple businesses
 * (user_business_access). The active business is persisted in localStorage
 * ("dokanos-active-business-id").
 *
 * Falls back gracefully: if no businesses exist yet (fresh install), the
 * context exposes an empty list and UI keeps working with legacy
 * invoice_settings-based branding.
 */

export interface Business {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  currency: string;
  timezone: string;
  address: string | null;
  email: string | null;
  phone: string | null;
  is_active: boolean;
}

export interface Brand {
  id: string;
  business_id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  woo_store_id: string | null;
  is_active: boolean;
}

interface BusinessContextValue {
  /** The active business (first membership if none persisted). */
  active: Business | null;
  /** All businesses the user belongs to. */
  businesses: Business[];
  /** Brands under the active business. */
  brands: Brand[];
  /** The active brand (persisted per business; null = all brands). */
  activeBrand: Brand | null;
  loading: boolean;
  setActive: (id: string) => void;
  setActiveBrand: (id: string | null) => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<BusinessContextValue | undefined>(undefined);

const STORAGE_KEY = "dokanos-active-business-id";
const BRAND_STORAGE_PREFIX = "dokanos-active-brand-";

export const BusinessContextProvider = ({ children }: { children: ReactNode }) => {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [activeId, setActiveId] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_KEY)
  );
  const [activeBrandId, setActiveBrandId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    // user_business_access RLS: users see their own rows. Join to businesses.
    const { data: memberships } = await supabase
      .from("user_business_access")
      .select("business_id, businesses(*)");
    const rows = (memberships || [])
      .map((m: { businesses: Business | null }) => m.businesses)
      .filter((b: Business | null): b is Business => !!b);
    setBusinesses(rows);
    setLoading(false);

    if (rows.length > 0) {
      const stored = localStorage.getItem(STORAGE_KEY);
      const effective =
        stored && rows.find((b) => b.id === stored) ? stored : rows[0].id;
      if (effective !== stored) localStorage.setItem(STORAGE_KEY, effective);
      setActiveId(effective);

      const brandStored = localStorage.getItem(BRAND_STORAGE_PREFIX + effective);
      setActiveBrandId(brandStored && brandStored !== "null" ? brandStored : null);
    }
  }, []);

  useEffect(() => {
    refresh();
    const channel = supabase
      .channel("business-context-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_business_access" },
        () => refresh()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [refresh]);

  // Load brands whenever the active business changes.
  useEffect(() => {
    if (!activeId) {
      setBrands([]);
      return;
    }
    let cancelled = false;
    supabase
      .from("brands")
      .select("*")
      .eq("business_id", activeId)
      .order("name")
      .then(({ data }) => {
        if (!cancelled) setBrands((data as Brand[]) || []);
      });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  const setActive = (id: string) => {
    setActiveId(id);
    localStorage.setItem(STORAGE_KEY, id);
    // Per-business brand selection resets on switch.
    const brandStored = localStorage.getItem(BRAND_STORAGE_PREFIX + id);
    setActiveBrandId(brandStored && brandStored !== "null" ? brandStored : null);
  };

  const setActiveBrand = (id: string | null) => {
    setActiveBrandId(id);
    if (activeId) {
      localStorage.setItem(BRAND_STORAGE_PREFIX + activeId, id ?? "null");
    }
  };

  const active = businesses.find((b) => b.id === activeId) || businesses[0] || null;
  const activeBrand =
    brands.find((b) => b.id === activeBrandId) || null;

  return (
    <Ctx.Provider
      value={{
        active,
        businesses,
        brands,
        activeBrand,
        loading,
        setActive,
        setActiveBrand,
        refresh,
      }}
    >
      {children}
    </Ctx.Provider>
  );
};

export const useBusinessContext = () => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useBusinessContext must be used within BusinessContextProvider");
  return ctx;
};
