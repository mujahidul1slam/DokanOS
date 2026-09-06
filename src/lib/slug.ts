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
