import { useEffect, useState } from "react";
import { useBrand } from "../BrandContext";
import { useCurrency } from "../lib/useCurrency";
import { listStorefrontProducts, type StorefrontProduct } from "../lib/catalog";
import ProductCard from "../components/ProductCard";
import type { SectionProps } from "./registry";

export default function FeaturedProducts({ props }: { props: SectionProps }) {
  const { storefront } = useBrand();
  const [products, setProducts] = useState<StorefrontProduct[] | null>(null);

  useEffect(() => {
    listStorefrontProducts(storefront.id).then((all) => {
      const featured = all.filter((p) => p.is_featured);
      const rest = all.filter((p) => !p.is_featured);
      const limit = Math.min(12, Math.max(1, Number(props.limit ?? 8)));
      setProducts([...featured, ...rest].slice(0, limit));
    });
  }, [storefront.id, props.limit]);

  const columns = [2, 3, 4].includes(Number(props.columns)) ? Number(props.columns) : 4;
  const colClass = columns === 2 ? "grid-cols-2" : columns === 3 ? "grid-cols-2 lg:grid-cols-3" : "grid-cols-2 lg:grid-cols-4";

  if (products === null) return null;
  if (!products.length) return null;

  return (
    <section className="max-w-7xl mx-auto px-4 lg:px-8 py-16">
      {props.title ? (
        <div className="flex items-end justify-between mb-10">
          <h2 className="sf-display text-3xl md:text-4xl">{String(props.title)}</h2>
        </div>
      ) : null}
      <div className={`grid ${colClass} gap-4 lg:gap-6`}>
        {products.map((p) => (
          <ProductCard key={p.id} p={p} />
        ))}
      </div>
    </section>
  );
}
