import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface BusinessProfile {
  id: string;
  business_name: string;
  logo_url: string | null;
  tagline?: string | null;
}

interface BusinessProfileContextValue {
  active: BusinessProfile | null;
  profiles: BusinessProfile[];
  loading: boolean;
  setActive: (id: string) => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<BusinessProfileContextValue | undefined>(undefined);

const STORAGE_KEY = "dokanos-active-business";

export const BusinessProfileProvider = ({ children }: { children: ReactNode }) => {
  const [profiles, setProfiles] = useState<BusinessProfile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from("invoice_settings" as any)
      .select("id, business_name, logo_url, tagline")
      .order("business_name", { ascending: true });
    const rows = (data as any as BusinessProfile[]) || [];
    setProfiles(rows);
    setLoading(false);
    if (rows.length > 0) {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored || !rows.find((r) => r.id === stored)) {
        setActiveId(rows[0].id);
        localStorage.setItem(STORAGE_KEY, rows[0].id);
      }
    }
  }, []);

  useEffect(() => {
    refresh();
    // Listen for updates from BusinessProfileTab
    const channel = supabase
      .channel("business-profile-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "invoice_settings" }, () => {
        refresh();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [refresh]);

  const setActive = (id: string) => {
    setActiveId(id);
    localStorage.setItem(STORAGE_KEY, id);
  };

  const active = profiles.find((p) => p.id === activeId) || profiles[0] || null;

  return (
    <Ctx.Provider value={{ active, profiles, loading, setActive, refresh }}>
      {children}
    </Ctx.Provider>
  );
};

export const useBusinessProfile = () => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useBusinessProfile must be used within BusinessProfileProvider");
  return ctx;
};
