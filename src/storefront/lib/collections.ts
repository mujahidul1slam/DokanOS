import { supabase } from "@/integrations/supabase/client";
import type { StorefrontProduct } from "./catalog";

/**
 * Collections runtime (Phase 2). Reads the storefront_collections +
 * storefront_collection_products tables (public read policies, fact 10).
 * The junction's product_id has NO FK, so rows whose product no longer
 * exists are filtered by the catalog mapping (getProductsByIds).
 */

export interface StorefrontCollection {
  id: string;
  storefront_id: string;
  slug: string;
  title: string;
  description: string | null;
  position: number;
  is_active: boolean;
}

export interface CollectionWithProducts extends StorefrontCollection {
  products: StorefrontProduct[];
}

export async function listCollections(storefrontId: string): Promise<StorefrontCollection[]> {
  const { data } = await supabase
    .from("storefront_collections")
    .select("id,storefront_id,slug,title,description,position,is_active")
    .eq("storefront_id", storefrontId)
    .eq("is_active", true)
    .order("position", { ascending: true })
    .order("title", { ascending: true });
  return (data as unknown as StorefrontCollection[]) || [];
}

export async function getCollectionBySlug(
  storefrontId: string,
  slug: string,
): Promise<StorefrontCollection | null> {
  const { data } = await supabase
    .from("storefront_collections")
    .select("id,storefront_id,slug,title,description,position,is_active")
    .eq("storefront_id", storefrontId)
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();
  return (data as unknown as StorefrontCollection) || null;
}

/** Junction rows for a collection, ordered by position (then insertion). */
export async function listCollectionProductIds(collectionId: string): Promise<string[]> {
  const { data } = await supabase
    .from("storefront_collection_products")
    .select("product_id, position")
    .eq("collection_id", collectionId)
    .order("position", { ascending: true });
  return ((data as any[]) || []).map((r) => r.product_id);
}

export async function getCollectionWithProducts(
  storefrontId: string,
  slug: string,
): Promise<{ collection: StorefrontCollection; products: any[] } | null> {
  const { getProductsByIds } = await import("./catalog");
  const collection = await getCollectionBySlug(storefrontId, slug);
  if (!collection) return null;
  const ids = await listCollectionProductIds(collection.id);
  const products = await getProductsByIds(ids);
  return { collection, products };
}
