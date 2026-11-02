import { useParams, useLocation } from "react-router-dom";

/**
 * Resolve the active storefront slug inside the /storefronts admin tree
 * (review E3: the Health panel needed its own slug path — worked standalone,
 * dead in-shell; that pattern risk applies to every tab).
 *
 * Resolution order:
 *  1. an explicit override (inline mode — StorefrontsPage already knows the sf)
 *  2. a real :slug route param (deep-linked routes that declare it)
 *  3. the /storefronts/* wildcard catch-all param
 *  4. the pathname's first segment (last resort)
 */
export function useAdminSlug(override?: string): string | undefined {
  const params = useParams() as Record<string, string | undefined>;
  const { pathname } = useLocation();
  return (
    override ||
    params.slug ||
    params["*"]?.split("/").filter(Boolean)[0] ||
    pathname.match(/^\/storefronts\/([^/]+)/)?.[1]
  );
}