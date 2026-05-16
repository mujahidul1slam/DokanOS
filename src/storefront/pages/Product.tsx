import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useBrand } from "../BrandContext";
import { brandBasePath, fmtBDT } from "../lib/brand";
import { getStorefrontProductBySlug, type StorefrontProduct } from "../lib/catalog";
import { useCart } from "../lib/cart";
import { Loader2, Minus, Plus, ShoppingBag } from "lucide-react";
import { toast } from "@/hooks/use-toast";

export default function Product() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { brand, storefront } = useBrand();
  const { add } = useCart(brand);
  const [p, setP] = useState<StorefrontProduct | null | undefined>(undefined);
  const [qty, setQty] = useState(1);
  const [imgIdx, setImgIdx] = useState(0);

  useEffect(() => {
    if (!slug) return;
    getStorefrontProductBySlug(storefront.id, slug).then((d) => setP(d));
  }, [slug, storefront.id]);

  if (p === undefined) {
    return <div className="flex justify-center py-32"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }
  if (!p) {
    return <div className="max-w-3xl mx-auto px-4 py-32 text-center text-muted-foreground">Product not found.</div>;
  }

  const images = p.image_urls?.length ? p.image_urls : (p.image_url ? [p.image_url] : []);
  const outOfStock = p.manage_stock && p.stock_quantity <= 0;

  function handleAdd() {
    add({
      product_id: p!.id,
      name: p!.name,
      price: p!.price,
      image_url: images[0],
      quantity: qty,
    });
    toast({ title: "Added to cart", description: p!.name });
  }

  return (
    <div className="max-w-6xl mx-auto px-4 lg:px-8 py-12 lg:py-16">
      <div className="grid md:grid-cols-2 gap-8 lg:gap-16">
        <div>
          <div className="sf-glass overflow-hidden aspect-[4/5] bg-muted">
            {images[imgIdx] && (
              <img src={images[imgIdx]} alt={p.name} className="h-full w-full object-cover" />
            )}
          </div>
          {images.length > 1 && (
            <div className="flex gap-3 mt-4">
              {images.map((src, i) => (
                <button
                  key={i}
                  onClick={() => setImgIdx(i)}
                  className={`h-20 w-20 rounded-lg overflow-hidden border-2 transition ${i === imgIdx ? "border-primary" : "border-transparent opacity-70"}`}
                >
                  <img src={src} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="lg:pt-8">
          <h1 className="sf-display text-4xl md:text-5xl mb-4">{p.name}</h1>
          <div className="text-2xl mb-8">{fmtBDT(p.price)}</div>
          {p.description && (
            <div className="text-muted-foreground leading-relaxed mb-10 whitespace-pre-line">{p.description}</div>
          )}

          <div className="flex items-center gap-4 mb-8">
            <div className="inline-flex items-center border border-border rounded-full">
              <button onClick={() => setQty(Math.max(1, qty - 1))} className="p-3 hover:text-primary">
                <Minus className="h-4 w-4" />
              </button>
              <span className="w-10 text-center">{qty}</span>
              <button onClick={() => setQty(qty + 1)} className="p-3 hover:text-primary">
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <button
              onClick={handleAdd}
              disabled={outOfStock}
              className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-4 rounded-full bg-primary text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
            >
              <ShoppingBag className="h-4 w-4" />
              <span className="text-sm uppercase tracking-widest">
                {outOfStock ? "Sold out" : "Add to cart"}
              </span>
            </button>
          </div>

          {!outOfStock && (
            <button
              onClick={() => { handleAdd(); navigate(`${brandBasePath(brand)}/checkout`); }}
              className="w-full px-6 py-4 rounded-full border border-border hover:border-primary transition text-sm uppercase tracking-widest"
            >
              Buy now
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
