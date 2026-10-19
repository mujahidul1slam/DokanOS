import { createContext, useContext, useEffect, useRef, useState, ReactNode, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQueryClient } from "@tanstack/react-query";

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
  /** Server-side onboarding done marker (plan 01-04, D-09/D-12). */
  onboarding_completed_at?: string | null;
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
  /** The caller's role in the active business (user_business_access.role). */
  myRole: string | null;
  /** Role map indexed by business_id (Task 2.5). */
  rolesByBusiness: Record<string, string>;
  loading: boolean;
  error: string | null;
  setActive: (id: string) => Promise<boolean>;
  setActiveBrand: (id: string | null) => void;
  refresh: () => Promise<void>;
  /** Count of selling_points rows under the active business (plan 01-04 guard input). */
  sellingPointsCount: number;
  /** Onboarding done marker read from the loaded active business (plan 01-04, D-09/D-12). */
  onboardingCompletedAt: string | null;
}

const Ctx = createContext<BusinessContextValue | undefined>(undefined);

const STORAGE_KEY = "dokanos-active-business-id";
const BRAND_STORAGE_PREFIX = "dokanos-active-brand-";

export const BusinessContextProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?.id;
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const currentBusinesses = useRef<Business[]>([]);
  const [rolesByBusiness, setRolesByBusiness] = useState<Record<string, string>>({});
  const [brands, setBrands] = useState<Brand[]>([]);
  const [activeId, setActiveId] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_KEY)
  );
  const [activeBrandId, setActiveBrandId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sellingPointsCount, setSellingPointsCount] = useState(0);
  const scopedLoadToken = useRef(0);

  // Brands + selling-point count for a business. Called from BOTH the
  // activeId effect and refresh() — the wizard creates the brand mid-session
  // (create_my_brand_store), so refresh() must re-read the scoped state too
  // or brands.length stays stale at 0 and gates built on it (the wizard's
  // Finish button) never re-enable in the same session.
  const loadScoped = useCallback(async (bizId: string) => {
    const token = ++scopedLoadToken.current;
    const [brandsRes, spRes] = await Promise.all([
      supabase.from("brands").select("*").eq("business_id", bizId).order("name"),
      supabase.from("selling_points").select("id", { count: "exact", head: true }).eq("business_id", bizId),
    ]);
    if (token !== scopedLoadToken.current) return; // superseded by a newer load
    setBrands((brandsRes.data as Brand[]) || []);
    setSellingPointsCount(spRes.count ?? 0);
  }, []);

  const clearMemberships = useCallback(() => {
    currentBusinesses.current = [];
    setBusinesses([]);
    setRolesByBusiness({});
    setActiveId(null);
    setActiveBrandId(null);
    setLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!userId) {
      // Auth is still resolving (or the user just signed out). Do not settle
      // the context as "zero memberships" yet: a guard render between this
      // state and the authenticated refresh would bounce a valid account to
      // /accounts. The next refresh with a user settles loading explicitly.
      currentBusinesses.current = [];
      setBusinesses([]);
      setRolesByBusiness({});
      setActiveId(null);
      setActiveBrandId(null);
      return;
    }
    // user_business_access RLS: users see their own rows. Join to businesses.
    const { data: memberships, error: membershipError } = await supabase
      .from("user_business_access")
      .select("role, business_id, businesses(*)")
      .eq("user_id", userId);
    if (membershipError) {
      setError(membershipError.message);
      clearMemberships();
      return;
    }
    const roles: Record<string, string> = {};
    (memberships || []).forEach((m: { role: string | null; business_id: string }) => {
      if (m.role) roles[m.business_id] = m.role;
    });
    setRolesByBusiness(roles);
    const rows = (memberships || [])
      .map((m: { businesses: Business | null }) => m.businesses)
      .filter((b: Business | null): b is Business => !!b);
    currentBusinesses.current = rows;
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

      // Re-read the scoped brand/count state: the active business may have
      // gained its first store/brand since the last load (wizard step 1).
      loadScoped(effective);
    } else {
      localStorage.removeItem(STORAGE_KEY);
      setActiveId(null);
      setActiveBrandId(null);
    }
  }, [clearMemberships, loadScoped, userId]);

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

  // Load brands + selling-point count whenever the active business changes.
  useEffect(() => {
    if (!activeId) {
      scopedLoadToken.current++; // invalidate any in-flight load
      setBrands([]);
      setSellingPointsCount(0);
      return;
    }
    loadScoped(activeId);
  }, [activeId, loadScoped]);

  const setActive = async (id: string) => {
    // Membership can be revoked while an account is still rendered. Re-read
    // the authoritative membership list before accepting any user selection.
    await refresh();
    if (!currentBusinesses.current.some((business) => business.id === id)) return false;

    // Account-scoped React Query results must never survive a tenant switch,
    // even when an older query omitted the account id from its cache key.
    await queryClient.cancelQueries();
    queryClient.removeQueries();
    scopedLoadToken.current++;
    setBrands([]);
    setSellingPointsCount(0);
    setActiveId(id);
    localStorage.setItem(STORAGE_KEY, id);
    // Per-business brand selection resets on switch.
    const brandStored = localStorage.getItem(BRAND_STORAGE_PREFIX + id);
    setActiveBrandId(brandStored && brandStored !== "null" ? brandStored : null);
    await loadScoped(id);
    return true;
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
  const myRole = active ? rolesByBusiness[active.id] ?? null : null;
  const onboardingCompletedAt = active?.onboarding_completed_at ?? null;

  return (
    <Ctx.Provider
      value={{
        active,
        businesses,
        brands,
        activeBrand,
        myRole,
        rolesByBusiness,
        loading,
        error,
        setActive,
        setActiveBrand,
        refresh,
        sellingPointsCount,
        onboardingCompletedAt,
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
