import { supabase } from "@/integrations/supabase/client";

/**
 * BrandSlug is now a generic string — any slug stored in the `storefronts` table is valid.
 * Legacy code that relied on the literal union "enveil" | "vincent" still works because
 * those are valid strings.
 */
export type BrandSlug = string;

export interface Storefront {
  id: string;
  slug: string;
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

// ---------------------------------------------------------------------------
// Lightweight in-memory cache of active storefronts.
// Populated once on first `detectBrand()` call, refreshed at most every 5 min.
// ---------------------------------------------------------------------------
interface SlugEntry {
  slug: string;
  name: string;
  /** Custom domain aliases stored in social->"custom_domains" */
  custom_domains: string[];
}

let _slugCache: SlugEntry[] | null = null;
let _slugCacheFetchedAt = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/** Fetch all active storefront slugs (cached). */
async function fetchSlugs(): Promise<SlugEntry[]> {
  if (_slugCache && Date.now() - _slugCacheFetchedAt < CACHE_TTL) return _slugCache;

  const { data } = await supabase
    .from("storefronts")
    .select("slug, name, social")
    .eq("is_active", true)
    .order("name");

  _slugCache = (data || []).map((row: any) => ({
    slug: row.slug,
    name: row.name,
    // Allow operators to store custom_domains inside the `social` jsonb column
    // e.g. { "custom_domains": ["enveilbd.com"] }
    custom_domains: Array.isArray(row.social?.custom_domains) ? row.social.custom_domains : [],
  }));
  _slugCacheFetchedAt = Date.now();
  return _slugCache!;
}

/** Pre-warm the slug cache. Call early in app boot so `detectBrand` is fast. */
export function prefetchSlugs(): void {
  fetchSlugs().catch(() => { /* swallow — not critical */ });
}

/** Invalidate slug cache (call after creating/updating storefronts). */
export function invalidateSlugCache(): void {
  _slugCache = null;
  _slugCacheFetchedAt = 0;
}

/**
 * Detect brand from query param or path — synchronous, no DB call needed.
 * Returns null when on the dashboard (no storefront matched).
 *
 *   1. ?brand=<slug> query param
 *   2. /storefront/<slug> path
 */
export function detectBrand(): BrandSlug | null {
  if (typeof window === "undefined") return null;

  const params = new URLSearchParams(window.location.search);
  const qBrand = params.get("brand")?.toLowerCase();
  if (qBrand) return qBrand;

  // Path-based: /storefront/:slug (any alphanumeric slug with hyphens/underscores)
  const m = window.location.pathname.match(/^\/storefront\/([a-z0-9][a-z0-9_-]*)(\/|$)/i);
  if (m) return m[1].toLowerCase();

  return null;
}

/**
 * Async brand detection that also matches custom domains / subdomains.
 * Called from <Root> during the initial render to resolve host-based storefronts.
 */
export async function detectBrandAsync(): Promise<BrandSlug | null> {
  // Quick sync check first
  const sync = detectBrand();
  if (sync) return sync;

  if (typeof window === "undefined") return null;
  const host = window.location.hostname.toLowerCase();

  // Don't match the main app host(s) as a storefront
  const appHosts = ["localhost", "127.0.0.1", "shohoz.biz", "dokanos.vercel.app"];
  if (appHosts.some((h) => host === h || host.endsWith(`.${h}`))) {
    // But check subdomain: <brand>.shohoz.biz
    const subdomain = host.split(".")[0];
    if (subdomain && !["www", "app", "api", "admin"].includes(subdomain)) {
      const slugs = await fetchSlugs();
      const match = slugs.find((s) => s.slug === subdomain);
      if (match) return match.slug;
    }
    return null;
  }

  // Check custom domain mappings
  const slugs = await fetchSlugs();
  const domainMatch = slugs.find((s) =>
    s.custom_domains.some((d) => host === d || host === `www.${d}`),
  );
  if (domainMatch) return domainMatch.slug;

  // Check subdomain match against any slug
  const subdomain = host.split(".")[0];
  if (subdomain && subdomain !== "www") {
    const subMatch = slugs.find((s) => s.slug === subdomain);
    if (subMatch) return subMatch.slug;
  }

  // Check if hostname contains a slug (legacy: "enveilbd" in hostname matches "enveil")
  const hostMatch = slugs.find((s) => host.includes(s.slug));
  if (hostMatch) return hostMatch.slug;

  return null;
}

export async function loadStorefront(slug: BrandSlug): Promise<Storefront | null> {
  const { data, error } = await supabase
    .from("storefronts")
    .select("*")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as Storefront;
}

export function brandBasePath(slug: BrandSlug): string {
  return `/storefront/${slug}`;
}

export function fmtBDT(n: number): string {
  return `৳${Math.round(n).toLocaleString("en-BD")}`;
}

/** Return the currency formatter based on storefront currency. */
export function fmtCurrency(n: number, currency = "BDT"): string {
  if (currency === "BDT") return fmtBDT(n);
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
}
