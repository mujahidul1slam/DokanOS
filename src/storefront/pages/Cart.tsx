import { Link } from "react-router-dom";
import { Minus, Plus, Trash2 } from "lucide-react";
import { useBrand } from "../BrandContext";
import { useCart } from "../lib/cart";
import { brandBasePath, fmtBDT } from "../lib/brand";

export default function Cart() {
  const { brand } = useBrand();
  const { items, update, remove, subtotal } = useCart(brand);

  if (!items.length) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-32 text-center">
        <h1 className="sf-display text-4xl mb-4">Your bag is empty</h1>
        <p className="text-muted-foreground mb-8">Pieces you love will live here.</p>
        <Link to={`${brandBasePath(brand)}/shop`} className="inline-block px-7 py-4 rounded-full bg-primary text-primary-foreground text-sm uppercase tracking-widest">
          Continue shopping
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 lg:px-8 py-16">
      <h1 className="sf-display text-5xl mb-12">Your bag</h1>
      <div className="grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-4">
          {items.map((it) => (
            <div key={`${it.product_id}-${it.variation_id || ""}`} className="sf-glass p-4 flex gap-4 items-center">
              <div className="h-24 w-20 bg-muted rounded-lg overflow-hidden flex-shrink-0">
                {it.image_url && <img src={it.image_url} alt="" className="h-full w-full object-cover" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="sf-display text-lg truncate">{it.name}</div>
                {it.variation_label && <div className="text-xs text-muted-foreground">{it.variation_label}</div>}
                <div className="text-sm text-muted-foreground mt-1">{fmtBDT(it.price)}</div>
              </div>
              <div className="inline-flex items-center border border-border rounded-full">
                <button onClick={() => update(it.product_id, it.variation_id, it.quantity - 1)} className="p-2"><Minus className="h-3 w-3" /></button>
                <span className="w-8 text-center text-sm">{it.quantity}</span>
                <button onClick={() => update(it.product_id, it.variation_id, it.quantity + 1)} className="p-2"><Plus className="h-3 w-3" /></button>
              </div>
              <div className="w-24 text-right font-medium">{fmtBDT(it.price * it.quantity)}</div>
              <button onClick={() => remove(it.product_id, it.variation_id)} className="p-2 text-muted-foreground hover:text-destructive">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
        <aside className="sf-glass p-6 h-fit sticky top-24">
          <h2 className="sf-display text-2xl mb-6">Summary</h2>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{fmtBDT(subtotal)}</span>
          </div>
          <div className="flex justify-between text-sm mb-6">
            <span className="text-muted-foreground">Shipping</span>
            <span>Calculated at checkout</span>
          </div>
          <div className="border-t border-border pt-4 mb-6 flex justify-between text-lg">
            <span>Total</span>
            <span className="font-medium">{fmtBDT(subtotal)}</span>
          </div>
          <Link to={`${brandBasePath(brand)}/checkout`} className="block w-full text-center py-4 rounded-full bg-primary text-primary-foreground text-sm uppercase tracking-widest hover:opacity-90 transition">
            Checkout
          </Link>
        </aside>
      </div>
    </div>
  );
}
