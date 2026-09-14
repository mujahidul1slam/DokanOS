import { useEffect, useState } from "react";
import { useBrand } from "../BrandContext";
import { getProductsByIds, type StorefrontProduct } from "../lib/catalog";
import ProductCard from "../components/ProductCard";
import type { SectionProps } from "./registry";

export default function ProductGrid({ props }: { props: SectionProps }) {
  const { storefront } = useBrand();
  const [products, setProducts] = useState<StorefrontProduct[] | null>(null);

  useEffect(() => {
    const ids: string[] = Array.isArray(props.product_ids) ? props.product_ids.filter((i: any) => typeof i === "string") : [];
    getProductsByIds(ids).then(setProducts);
  }, [storefront.id, props.product_ids]);

  const columns = [2, 3, 4].includes(Number(props.columns)) ? Number(props.columns) : 4;
  const colClass = columns === 2 ? "grid-cols-2" : columns === 3 ? "grid-cols-2 lg:grid-cols-3" : "grid-cols-2 lg:grid-cols-4";

  if (products === null) return null;
  if (!products.length) return null;

  return (
    <section className="max-w-7xl mx-auto px-4 lg:px-8 py-16">
      {props.title ? (
        <div className="mb-10">
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
