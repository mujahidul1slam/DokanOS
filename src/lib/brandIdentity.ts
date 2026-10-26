/**
 * Pure helpers for resolving and presenting brand identity.
 *
 * A brand owns a WooCommerce store binding (`woo_store_id`). Legacy order and
 * product rows carry that binding as `store_id`; a binding is only considered
 * safe when it resolves to exactly one brand.
 */

export interface BrandIdentityBrand {
  readonly id: string;
  readonly name: string;
  readonly woo_store_id: string | null;
}

export interface BrandIdentityProduct {
  readonly store_id?: string | null;
}

/**
 * Resolve a store binding only when it identifies one brand unambiguously.
 * Duplicate bindings are intentionally treated as unresolved rather than
 * guessing between brands.
 */
export function deriveBrandForStore<B extends BrandIdentityBrand>(
  brands: readonly B[] | null | undefined,
  storeId: string | null | undefined,
): B | undefined {
  if (!storeId || !Array.isArray(brands)) return undefined;
  const matches = brands.filter((brand) => brand.woo_store_id === storeId);
  return matches.length === 1 ? matches[0] : undefined;
}

/** Resolve a product's brand through its legacy `store_id` binding. */
export function deriveBrandForProduct<B extends BrandIdentityBrand>(
  brands: readonly B[] | null | undefined,
  product: BrandIdentityProduct | null | undefined,
): B | undefined {
  return deriveBrandForStore(brands, product?.store_id);
}

type BrandName = string | Pick<BrandIdentityBrand, "name"> | null | undefined;

/**
 * Return a compact two-character fallback for a brand identity.
 *
 * Multi-word names use the first character of the first two words; one-word
 * names use their first two characters. Empty names use a visible placeholder.
 */
export function brandMonogram(input: BrandName): string {
  const name = typeof input === "string" ? input : input?.name;
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return Array.from(words[0]).slice(0, 2).join("").toUpperCase();
  return `${Array.from(words[0])[0] ?? ""}${Array.from(words[1])[0] ?? ""}`.toUpperCase();
}

/** Stable, reusable accent palette for brand identity surfaces. */
export const BRAND_ACCENTS = [
  "#0f766e",
  "#2563eb",
  "#7c3aed",
  "#c2410c",
  "#be123c",
  "#047857",
  "#a16207",
  "#4338ca",
] as const;

/**
 * Choose a stable accent from the brand id, so a brand keeps the same color
 * across selectors, order lists, and printed identity surfaces.
 */
export function brandAccent(brandId: string): (typeof BRAND_ACCENTS)[number] {
  let hash = 2166136261;
  for (const character of brandId) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return BRAND_ACCENTS[(hash >>> 0) % BRAND_ACCENTS.length];
}
