import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useBrand } from "../BrandContext";
import { brandBasePath } from "../lib/brand";
import { getCollectionWithProducts } from "../lib/collections";
import type { StorefrontProduct } from "../lib/catalog";
import ProductCard from "../components/ProductCard";
import { usePageMeta } from "../lib/seo";
import { BreadcrumbListJsonLd } from "../lib/jsonld";
import { collectionUrl } from "../lib/routes";

/** Browsable collection page at /collections/:slug (Phase 2). */
export default function Collection() {
  const { slug } = useParams();
  const { brand, storefront } = useBrand();
  const [state, setState] = useState<{ title: string; description: string | null; products: StorefrontProduct[] } | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    if (!slug) {
      setState(null);
      return;
    }
    getCollectionWithProducts(storefront.id, slug).then((d) => {
      if (!alive) return;
      setState(d ? { title: d.collection.title, description: d.collection.description, products: d.products } : null);
    });
    return () => {
      alive = false;
    };
  }, [storefront.id, slug]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const canonicalPath = slug ? collectionUrl(slug) : "/";

  usePageMeta({
    title: state ? `${state.title} — ${storefront.name}` : undefined,
    description: state?.description || undefined,
    canonicalPath,
  });

  if (state === undefined) {
    return (
      <div className="flex justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (!state) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-32 text-center">
        <h1 className="sf-display text-4xl mb-4">Collection not found</h1>
        <Link to={`${brandBasePath(brand)}/shop`} className="text-sm underline underline-offset-4">
          Browse the shop
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 lg:px-8 py-16">
      <BreadcrumbListJsonLd
        items={[
          { name: "Home", url: `${origin}/` },
          { name: state.title, url: `${origin}${canonicalPath}` },
        ]}
      />
      <div className="mb-12">
        <div className="text-xs uppercase tracking-[0.25em] text-primary mb-3">Collection</div>
        <h1 className="sf-display text-5xl md:text-6xl">
          {state.title}
        </h1>
        {state.description ? <p className="text-muted-foreground mt-4 max-w-2xl">{state.description}</p> : null}
      </div>
      {state.products.length === 0 ? (
        <p className="text-muted-foreground">No pieces in this collection yet.</p>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
          {state.products.map((p) => (
            <ProductCard key={p.id} p={p} />
          ))}
        </div>
      )}
    </div>
  );
}
