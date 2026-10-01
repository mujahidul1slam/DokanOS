/**
 * Lowercase, hyphenated slug safe for URL columns (brands.slug,
 * businesses.slug, storefronts.slug). Empty input yields "".
 */
export const slugify = (input: string): string =>
  input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

/**
 * Produces a valid business/storefront slug with a random fallback
 * for names that strip to nothing (e.g. pure Bengali, emoji, symbols),
 * matching the server-side logic in signup_create_business_core.
 */
export const generateStoreSlug = (name: string): string => {
  const base = slugify(name);
  if (base.length >= 2) {
    return base;
  }
  const randomSuffix = Math.random().toString(36).substring(2, 6);
  return `store-${randomSuffix}`;
};
