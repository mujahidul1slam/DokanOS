import { useEffect, useState, useMemo } from "react";
import { useBrand } from "../BrandContext";
import { listStorefrontProducts, type StorefrontProduct } from "../lib/catalog";
import { listCollections, listCollectionProductIds, type StorefrontCollection } from "../lib/collections";
import ProductCard from "../components/ProductCard";
import { Loader2 } from "lucide-react";
import { usePageMeta } from "../lib/seo";
import { BreadcrumbListJsonLd } from "../lib/jsonld";

export default function Shop() {
  const { storefront } = useBrand();
  const [products, setProducts] = useState<StorefrontProduct[] | null>(null);
  const [collections, setCollections] = useState<StorefrontCollection[]>([]);
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  const [collectionProductIdsMap, setCollectionProductIdsMap] = useState<Record<string, Set<string>>>({});
  const [loadingCollection, setLoadingCollection] = useState(false);

  useEffect(() => {
    listStorefrontProducts(storefront.id).then(setProducts);
    listCollections(storefront.id).then(setCollections);
  }, [storefront.id]);

  async function handleSelectCollection(collectionId: string | null) {
    setActiveCollectionId(collectionId);
    if (!collectionId || collectionProductIdsMap[collectionId]) return;

    setLoadingCollection(true);
    try {
      const ids = await listCollectionProductIds(collectionId);
      setCollectionProductIdsMap((prev) => ({
        ...prev,
        [collectionId]: new Set(ids),
      }));
    } finally {
      setLoadingCollection(false);
    }
  }

  const displayedProducts = useMemo(() => {
    if (!products) return null;
    if (!activeCollectionId) return products;
    const allowed = collectionProductIdsMap[activeCollectionId];
    if (!allowed) return products;
    return products.filter((p) => allowed.has(p.id));
  }, [products, activeCollectionId, collectionProductIdsMap]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  usePageMeta({
    title: `Shop — ${storefront.name}`,
    description: `Browse all pieces from ${storefront.name}`,
    canonicalPath: "/shop",
  });

  return (
    <div className="max-w-7xl mx-auto px-4 lg:px-8 py-16">
      <BreadcrumbListJsonLd
        items={[
          { name: "Home", url: `${origin}/` },
          { name: "Shop", url: `${origin}/shop` },
        ]}
      />
      <div className="mb-8">
        <div className="text-xs uppercase tracking-[0.25em] text-primary mb-3">Shop</div>
        <h1 className="sf-display text-5xl md:text-6xl">All pieces</h1>
      </div>

      {collections.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-4 mb-8 no-scrollbar">
          <button
            type="button"
            onClick={() => handleSelectCollection(null)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${
              activeCollectionId === null
                ? "bg-primary text-primary-foreground"
                : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            All
          </button>
          {collections.map((col) => (
            <button
              key={col.id}
              type="button"
              onClick={() => handleSelectCollection(col.id)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${
                activeCollectionId === col.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {col.title}
            </button>
          ))}
        </div>
      )}

      {!displayedProducts || loadingCollection ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : displayedProducts.length === 0 ? (
        <p className="text-muted-foreground py-12">No products found in this collection.</p>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
          {displayedProducts.map((p) => (
            <ProductCard key={p.id} p={p} />
          ))}
        </div>
      )}
    </div>
  );
}
