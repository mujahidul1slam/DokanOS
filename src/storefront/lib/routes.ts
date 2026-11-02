import type { BrandSlug } from "./brand";

/**
 * Single source of truth for storefront route shapes (plan §5.1, hoisted from
 * Phase 4 — L4). The actual product route is /product/:slug (singular),
 * matching the route table in StorefrontApp.tsx. Every Link, canonical and
 * sitemap path derives from these helpers — no inline route constants.
 *
 * Supports both:
 * - 2-arg: (brand, slug) => `/storefront/${brand}/product/${slug}` (in-app links)
 * - 1-arg: (slug) => `/product/${slug}` (canonicals, root storefronts, sitemaps)
 */

export function productUrl(slug: string): string;
export function productUrl(brand: BrandSlug, slug: string): string;
export function productUrl(brandOrSlug: string, slug?: string): string {
  if (slug !== undefined) {
    return `${brandBase(brandOrSlug)}/product/${encodeURIComponent(slug)}`;
  }
  return `/product/${encodeURIComponent(brandOrSlug)}`;
}

export function collectionUrl(slug: string): string;
export function collectionUrl(brand: BrandSlug, slug: string): string;
export function collectionUrl(brandOrSlug: string, slug?: string): string {
  if (slug !== undefined) {
    return `${brandBase(brandOrSlug)}/collections/${encodeURIComponent(slug)}`;
  }
  return `/collections/${encodeURIComponent(brandOrSlug)}`;
}

export function pageUrl(slug: string): string;
export function pageUrl(brand: BrandSlug, slug: string): string;
export function pageUrl(brandOrSlug: string, slug?: string): string {
  if (slug !== undefined) {
    return `${brandBase(brandOrSlug)}/pages/${encodeURIComponent(slug)}`;
  }
  return `/pages/${encodeURIComponent(brandOrSlug)}`;
}

export function shopUrl(brand?: BrandSlug): string {
  return brand ? `${brandBase(brand)}/shop` : "/shop";
}

export function homeUrl(brand?: BrandSlug): string {
  return brand ? brandBase(brand) : "/";
}

export function brandBase(brand: BrandSlug): string {
  return `/storefront/${brand}`;
}
