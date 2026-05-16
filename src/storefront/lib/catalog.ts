import { supabase } from "@/integrations/supabase/client";

export interface StorefrontProduct {
  id: string;
  name: string;
  slug: string;
  price: number;
  image_url: string | null;
  image_urls: string[];
  description: string | null;
  stock_quantity: number;
  manage_stock: boolean;
  stock_status: string;
  is_featured: boolean;
  badge: string;
  position: number;
}

function slugify(s: string, id: string): string {
  const base = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return base ? `${base}-${id.slice(0, 6)}` : id.slice(0, 8);
}

export async function listStorefrontProducts(storefront_id: string): Promise<StorefrontProduct[]> {
  const { data: links, error } = await supabase
    .from("storefront_products")
    .select("product_id, position, is_featured, badge")
    .eq("storefront_id", storefront_id)
    .order("position", { ascending: true });
  if (error || !links?.length) return [];
  const ids = links.map((l) => l.product_id);
  const { data: products } = await supabase
    .from("products")
    .select("id,name,price,image_url,image_urls,description,stock_quantity,manage_stock,stock_status,is_active")
    .in("id", ids)
    .eq("is_active", true);
  if (!products) return [];
  const map = new Map(products.map((p) => [p.id, p]));
  return links
    .map((l) => {
      const p = map.get(l.product_id);
      if (!p) return null;
      return {
        id: p.id,
        name: p.name,
        slug: slugify(p.name, p.id),
        price: Number(p.price),
        image_url: p.image_url,
        image_urls: (p.image_urls as string[]) || [],
        description: p.description,
        stock_quantity: p.stock_quantity,
        manage_stock: p.manage_stock,
        stock_status: p.stock_status,
        is_featured: l.is_featured,
        badge: l.badge || "",
        position: l.position,
      } as StorefrontProduct;
    })
    .filter(Boolean) as StorefrontProduct[];
}

export async function getStorefrontProductBySlug(
  storefront_id: string,
  slug: string,
): Promise<StorefrontProduct | null> {
  const all = await listStorefrontProducts(storefront_id);
  return all.find((p) => p.slug === slug) || null;
}
