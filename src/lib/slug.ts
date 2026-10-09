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
 * Store/brand slug derivation aligned EXACTLY to the create_my_brand_store
 * RPC (migration 20261006121000_create_my_brand_store.sql): lowercase, collapse runs
 * of non-alphanumerics to '-', trim leading/trailing '-', deterministic
 * literal "store" when the cleaned base is under 2 chars (no random suffix —
 * the preview must match the RPC's reserved slug), truncated at 60
 * (left(v_slug_base, 60)).
 *
 * Display-only parity: the server derivation stays authoritative; after the
 * RPC runs, the slug it RETURNs supersedes this preview. The signup core's
 * random business-slug fallback does not apply to this derivation.
 */
export const generateStoreSlug = (name: string): string => {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (base.length < 2) {
    return "store";
  }
  return base.slice(0, 60);
};
