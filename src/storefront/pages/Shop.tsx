import { useEffect, useMemo, useState } from "react";
import { useBrand } from "../BrandContext";
import { listStorefrontProducts, type StorefrontProduct } from "../lib/catalog";
import { listCollections, listCollectionProductIds, type StorefrontCollection } from "../lib/collections";
import ProductCard from "../components/ProductCard";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { usePageMeta } from "../lib/seo";
import { BreadcrumbListJsonLd } from "../lib/jsonld";
import { mergeSettings } from "../lib/settings";

type SortKey = "featured" | "price-asc" | "price-desc" | "newest";

const SORTS: { value: SortKey; label: string }[] = [
  { value: "featured", label: "Featured" },
  { value: "price-asc", label: "Price: Low to High" },
  { value: "price-desc", label: "Price: High to Low" },
  { value: "newest", label: "Newest" },
];

export default function Shop() {
  const { storefront } = useBrand();
  const [products, setProducts] = useState<StorefrontProduct[] | null>(null);
  const [collections, setCollections] = useState<StorefrontCollection[]>([]);
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  const [collectionProductIdsMap, setCollectionProductIdsMap] = useState<Record<string, Set<string>>>({});
  const [loadingCollection, setLoadingCollection] = useState(false);
  const [sort, setSort] = useState<SortKey>("featured");
  const [page, setPage] = useState(1);
  const [activePriceBand, setActivePriceBand] = useState<number | null>(null);

  const shop = mergeSettings(storefront.settings).shop;

  useEffect(() => {
    listStorefrontProducts(storefront.id).then(setProducts);
    listCollections(storefront.id).then(setCollections);
  }, [storefront.id]);

  useEffect(() => {
    setPage(1);
    setSort("featured");
  }, [activeCollectionId]);

  useEffect(() => {
    setPage(1);
  }, [activePriceBand]);

  async function handleSelectCollection(collectionId: string | null) {
    setActiveCollectionId(collectionId);
    if (!collectionId || collectionProductIdsMap[collectionId]) return;

    setLoadingCollection(true);
    try {
      const ids = await listCollectionProductIds(collectionId);
      setCollectionProductIdsMap((prev) => ({ ...prev, [collectionId]: new Set(ids) }));
    } finally {
      setLoadingCollection(false);
    }
  }

  const filtered = useMemo(() => {
    if (!products) return null;
    let list = products;
    if (activeCollectionId) {
      const allowed = collectionProductIdsMap[activeCollectionId];
      if (allowed) list = list.filter((p) => allowed.has(p.id));
      else list = [];
    }
    // Price band: band i covers [bands[i], bands[i+1] ?? Infinity)
    if (activePriceBand != null && shop.price_bands.length > 0) {
      const lo = shop.price_bands[activePriceBand];
      const hi = activePriceBand + 1 < shop.price_bands.length ? shop.price_bands[activePriceBand + 1] : Infinity;
      list = list.filter((p) => p.price >= lo && p.price < hi);
    }
    return list;
  }, [products, activeCollectionId, collectionProductIdsMap, activePriceBand, shop.price_bands]);

  const sortedFiltered = useMemo(() => {
    if (!filtered) return null;
    const list = [...filtered];
    if (sort === "price-asc") list.sort((a, b) => a.price - b.price);
    else if (sort === "price-desc") list.sort((a, b) => b.price - a.price);
    else if (sort === "newest") list.sort((a, b) => (b.position ?? 0) - (a.position ?? 0));
    return list;
  }, [filtered, sort]);

  const totalPages = sortedFiltered ? Math.max(1, Math.ceil(sortedFiltered.length / shop.per_page)) : 1;
  const paged = sortedFiltered ? sortedFiltered.slice((page - 1) * shop.per_page, page * shop.per_page) : null;

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  usePageMeta({
    title: `${shop.heading} — ${storefront.name}`,
    description: shop.heading_desc || `Browse all pieces from ${storefront.name}`,
    canonicalPath: "/shop",
  });

  // Price band labels like "৳0–৳500", "৳500+", derived from bands
  const bandLabels = useMemo(() => {
    return shop.price_bands.map((band, i) => {
      if (i + 1 >= shop.price_bands.length) return `৳${band}+`;
      return `৳${band}–৳${shop.price_bands[i + 1]}`;
    });
  }, [shop.price_bands]);

  const showCounter = shop.result_count && paged && sortedFiltered;
  const from = showCounter && sortedFiltered!.length ? (page - 1) * shop.per_page + 1 : 0;
  const to = showCounter && sortedFiltered ? Math.min(page * shop.per_page, sortedFiltered.length) : 0;

  return (
    <div className="max-w-7xl mx-auto px-4 lg:px-8 py-16">
      <BreadcrumbListJsonLd
        items={[
          { name: "Home", url: `${origin}/` },
          { name: shop.heading || "Shop", url: `${origin}/shop` },
        ]}
      />
      <div className="mb-8 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-xs uppercase tracking-[0.25em] text-primary mb-3">{shop.heading}</div>
          <h1 className="sf-display text-5xl md:text-6xl">{shop.heading_desc || "All pieces"}</h1>
        </div>
        {showCounter && (
          <p className="text-xs text-muted-foreground pb-2">
            Showing {from} to {to} of {sortedFiltered!.length} products
          </p>
        )}
      </div>

      {/* Shopify-style collection chips (kept) + optional sorting/filter row */}
      {collections.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-4 mb-6 no-scrollbar">
          <button
            type="button"
            onClick={() => handleSelectCollection(null)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${
              activeCollectionId === null ? "bg-primary text-primary-foreground" : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
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
                activeCollectionId === col.id ? "bg-primary text-primary-foreground" : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {col.title}
            </button>
          ))}
        </div>
      )}

      {shop.show_sorting && (
        <div className="flex items-center justify-end gap-2 mb-4">
          <label className="text-xs text-muted-foreground">Sort</label>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          >
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      )}

      {/* Price band chips — simple, honest chips above the grid */}
      {shop.show_filters && shop.price_bands.length > 0 && (
        <div className="flex gap-2 flex-wrap mb-4">
          {bandLabels.map((lbl, i) => (
            <button
              key={lbl}
              type="button"
              onClick={() => setActivePriceBand(activePriceBand === i ? null : i)}
              className={`px-3 py-1 rounded-full text-xs border transition ${
                activePriceBand === i ? "border-primary bg-primary/5 text-primary" : "border-border bg-background hover:border-primary/50"
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>
      )}

      {!paged || loadingCollection ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : paged.length === 0 ? (
        <p className="text-muted-foreground py-12">No products match these filters.</p>
      ) : (
        <>
        <div className="sf-shop-grid" data-sf-anim-cascade>
          <style>{`
            .sf-shop-grid { display: grid; gap: 1rem; grid-template-columns: repeat(${shop.columns_phone}, minmax(0, 1fr)); }
            @media (min-width: 1024px) { .sf-shop-grid { grid-template-columns: repeat(${shop.columns_pc}, minmax(0, 1fr)); gap: 1.5rem; } }
          `}</style>
          {paged.map((p) => (
            <ProductCard key={p.id} p={p} />
          ))}
        </div>

        {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-10">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs disabled:opacity-50 disabled:cursor-not-allowed hover:bg-muted"
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Previous
              </button>
              {shop.pagination === "buttons" && (
                <div className="flex gap-1">
                  {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                    const startPage = Math.max(1, Math.min(page - 3, totalPages - 6));
                    const num = startPage + i;
                    if (num > totalPages) return null;
                    return (
                      <button
                        key={num}
                        onClick={() => setPage(num)}
                        className={`h-8 w-8 rounded text-xs transition ${num === page ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"}`}
                      >
                        {num}
                      </button>
                    );
                  })}
                </div>
              )}
              {shop.pagination === "numbers" && (
                <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
              )}
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs disabled:opacity-50 disabled:cursor-not-allowed hover:bg-muted"
              >
                Next <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}