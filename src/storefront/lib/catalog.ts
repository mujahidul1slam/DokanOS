import { supabase } from "@/integrations/supabase/client";

export interface StorefrontVariation {
  id: string;
  name: string;
  price: number;
  manage_stock: boolean;
  stock_quantity: number;
  attributes: any;
}

export interface StorefrontProduct {
  id: string;
  name: string;
  slug: string;
  price: number;
  image_url: string | null;
  image_urls: string[];
  created_at: string;
  description: string | null;
  stock_quantity: number;
  manage_stock: boolean;
  stock_status: string;
  is_featured: boolean;
  badge: string;
  position: number;
  variations?: StorefrontVariation[];
}

function slugify(s: string, id: string): string {
  const base = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return base ? `${base}-${id.slice(0, 6)}` : id.slice(0, 8);
}

function mapProduct(
  p: any,
  opts: { is_featured?: boolean; badge?: string; position?: number } = {},
): StorefrontProduct {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug || slugify(p.name, p.id),
    price: Number(p.price),
    image_url: p.image_url,
    image_urls: (p.image_urls as string[]) || [],
    description: p.description,
    stock_quantity: p.stock_quantity,
    manage_stock: p.manage_stock,
    stock_status: p.stock_status,
    is_featured: !!(opts.is_featured ?? p.is_featured),
    badge: opts.badge || "",
    position: opts.position ?? 0,
    created_at: p.created_at || "",
  };
}

export async function listStorefrontProducts(storefront_id: string): Promise<StorefrontProduct[]> {
  // Check if storefront is linked to a store — if so, show all active products from that store
  const { data: sf } = await supabase
    .from("storefronts")
    .select("store_id")
    .eq("id", storefront_id)
    .maybeSingle();

  if (sf?.store_id) {
    const { data: products } = await supabase
      .from("products")
      .select("id,name,slug,price,image_url,image_urls,description,stock_quantity,manage_stock,stock_status,is_featured,created_at")
      .eq("store_id", sf.store_id)
      .eq("is_active", true)
      .order("is_featured", { ascending: false })
      .order("sales_count", { ascending: false })
      .limit(500);
    return (products || []).map((p, i) => mapProduct(p, { position: i }));
  }

  // Fallback: manual curation
  const { data: links } = await supabase
    .from("storefront_products")
    .select("product_id, position, is_featured, badge")
    .eq("storefront_id", storefront_id)
    .order("position", { ascending: true });
  if (!links?.length) return [];
  const ids = links.map((l) => l.product_id);
  const { data: products } = await supabase
    .from("products")
    .select("id,name,slug,price,image_url,image_urls,description,stock_quantity,manage_stock,stock_status,is_active,created_at")
    .in("id", ids)
    .eq("is_active", true);
  if (!products) return [];
  const map = new Map(products.map((p) => [p.id, p]));
  return links
    .map((l) => {
      const p = map.get(l.product_id);
      if (!p) return null;
      return mapProduct(p, { is_featured: l.is_featured, badge: l.badge || "", position: l.position });
    })
    .filter(Boolean) as StorefrontProduct[];
}

export async function getStorefrontProductBySlug(
  storefront_id: string,
  slug: string,
): Promise<StorefrontProduct | null> {
  const all = await listStorefrontProducts(storefront_id);
  const prod = all.find((p) => p.slug === slug) || null;
  if (!prod) return null;

  const { data: variations } = await supabase
    .from("product_variations")
    .select("id,name,price,manage_stock,stock_quantity,attributes")
    .eq("product_id", prod.id);

  return {
    ...prod,
    variations: (variations as any[]) || [],
  };
}

/** Fetch specific active products by id (ProductGrid section). Anon-safe. */
export async function getProductsByIds(ids: string[]): Promise<StorefrontProduct[]> {
  if (!ids.length) return [];
  const { data: products } = await supabase
    .from("products")
    .select("id,name,slug,price,image_url,image_urls,description,stock_quantity,manage_stock,stock_status,is_active,created_at")
    .in("id", ids)
    .eq("is_active", true);
  if (!products) return [];
  const map = new Map((products as any[]).map((p) => [p.id, p]));
  // Preserve the curator's order; drop ids that no longer resolve (junction
  // semantics without an FK).
  return ids
    .map((id) => map.get(id))
    .filter(Boolean)
    .map((p: any) => mapProduct(p));
}
