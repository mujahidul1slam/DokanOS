import { supabase } from "@/integrations/supabase/client";

export type BrandSlug = "enveil" | "vincent";

export interface Storefront {
  id: string;
  slug: BrandSlug;
  name: string;
  store_id: string | null;
  accent_hex: string;
  theme: string;
  hero_title: string;
  hero_subtitle: string;
  hero_image_url: string;
  logo_url: string;
  favicon_url: string;
  about_md: string;
  contact_email: string;
  contact_phone: string;
  social: Record<string, string>;
  policies: Record<string, string>;
  currency: string;
  is_active: boolean;
}

/** Detect brand from hostname or ?brand= param. Returns null when on the dashboard. */
export function detectBrand(): BrandSlug | null {
  if (typeof window === "undefined") return null;
  const host = window.location.hostname.toLowerCase();
  const params = new URLSearchParams(window.location.search);
  const qBrand = params.get("brand")?.toLowerCase();
  if (qBrand === "enveil" || qBrand === "vincent") return qBrand;
  if (host.startsWith("enveil.") || host.includes("enveilbd")) return "enveil";
  if (host.startsWith("vincent.") || host.includes("vincentdhaka")) return "vincent";

  // Path-based fallback: /storefront/:brand
  const m = window.location.pathname.match(/^\/storefront\/(enveil|vincent)(\/|$)/);
  if (m) return m[1] as BrandSlug;
  return null;
}

export async function loadStorefront(slug: BrandSlug): Promise<Storefront | null> {
  const { data, error } = await supabase
    .from("storefronts")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as Storefront;
}

export function brandBasePath(slug: BrandSlug): string {
  // When on a host-detected brand we still expose path-based for now
  return `/storefront/${slug}`;
}

export function fmtBDT(n: number): string {
  return `৳${Math.round(n).toLocaleString("en-BD")}`;
}
