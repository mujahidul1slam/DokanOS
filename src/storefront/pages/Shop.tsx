import { useEffect, useState } from "react";
import { useBrand } from "../BrandContext";
import { listStorefrontProducts, type StorefrontProduct } from "../lib/catalog";
import ProductCard from "../components/ProductCard";
import { Loader2 } from "lucide-react";

export default function Shop() {
  const { storefront } = useBrand();
  const [products, setProducts] = useState<StorefrontProduct[] | null>(null);

  useEffect(() => {
    listStorefrontProducts(storefront.id).then(setProducts);
  }, [storefront.id]);

  return (
    <div className="max-w-7xl mx-auto px-4 lg:px-8 py-16">
      <div className="mb-12">
        <div className="text-xs uppercase tracking-[0.25em] text-primary mb-3">Shop</div>
        <h1 className="sf-display text-5xl md:text-6xl">All pieces</h1>
      </div>
      {!products ? (
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : products.length === 0 ? (
        <p className="text-muted-foreground">No products yet.</p>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
          {products.map((p) => <ProductCard key={p.id} p={p} />)}
        </div>
      )}
    </div>
  );
}
