import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { X, Minus, Plus, Trash2, ShoppingBag, Truck } from "lucide-react";
import { useBrand } from "../BrandContext";
import { useCart } from "../lib/cart";
import { brandBasePath } from "../lib/brand";
import { useCurrency } from "../lib/useCurrency";
import { mergeSettings } from "../lib/settings";

/**
 * Slide-over cart drawer (Phase B1 / Bonik parity): opens from the header
 * cart icon; full-page /cart remains the fallback route. Mirrors saved cart
 * state from localStorage per brand.
 */
export default function CartDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { brand, storefront } = useBrand();
  const { items, subtotal, update, remove } = useCart(brand);
  const fmt = useCurrency();
  const settings = mergeSettings(storefront.settings);
  const freeThreshold = settings.shipping.free_threshold;
  const progress = freeThreshold > 0 ? Math.min(100, Math.round((subtotal / freeThreshold) * 100)) : 0;

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label="Shopping cart">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <aside className="absolute right-0 top-0 h-full w-full max-w-md bg-background border-l border-border shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="sf-display text-xl inline-flex items-center gap-2">
            <ShoppingBag className="h-5 w-5" /> Your bag ({items.length})
          </h2>
          <button onClick={onClose} aria-label="Close cart" className="h-9 w-9 rounded-full border border-border hover:border-primary flex items-center justify-center transition">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Free shipping progress */}
        {freeThreshold > 0 && (
          <div className="px-5 py-3 border-b border-border">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1.5">
              <Truck className="h-3.5 w-3.5" />
              {subtotal >= freeThreshold
                ? <span className="text-emerald-600 font-medium">You've unlocked free delivery!</span>
                : <span>Add {fmt(freeThreshold - subtotal)} more for free delivery</span>}
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {/* Items */}
        <div className="flex-1 overflow-auto px-5 py-4 space-y-4">
          {items.length === 0 ? (
            <div className="text-center py-16 space-y-3">
              <ShoppingBag className="h-10 w-10 mx-auto text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Your bag is empty.</p>
              <Link to={`${brandBasePath(brand)}/shop`} onClick={onClose} className="text-sm text-primary underline underline-offset-2">
                Continue shopping
              </Link>
            </div>
          ) : (
            items.map((it, idx) => (
              <div key={`${it.product_id}-${it.variation_id || idx}`} className="flex gap-3">
                <div className="h-20 w-16 bg-muted rounded-md overflow-hidden shrink-0">
                  {it.image_url && <img src={it.image_url} alt={it.name} className="h-full w-full object-cover" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium line-clamp-2">{it.name}</p>
                    <button onClick={() => remove(it.product_id, it.variation_id)} aria-label={`Remove ${it.name}`} className="text-muted-foreground hover:text-destructive transition shrink-0">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  {it.variation_label && <p className="text-xs text-primary font-medium">{it.variation_label}</p>}
                  <div className="flex items-center justify-between mt-2">
                    <div className="inline-flex items-center border border-border rounded-full">
                      <button onClick={() => update(it.product_id, it.variation_id, it.quantity - 1)} className="p-1.5 hover:text-primary" aria-label="Decrease">
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="w-8 text-center text-sm">{it.quantity}</span>
                      <button onClick={() => update(it.product_id, it.variation_id, it.quantity + 1)} className="p-1.5 hover:text-primary" aria-label="Increase">
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                    <p className="text-sm font-medium">{fmt(it.price * it.quantity)}</p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        {items.length > 0 && (
          <div className="border-t border-border px-5 py-4 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-medium">{fmt(subtotal)}</span>
            </div>
            <p className="text-[11px] text-muted-foreground">Shipping calculated at checkout.</p>
            <Link
              to={`${brandBasePath(brand)}/checkout`}
              onClick={onClose}
              className="block w-full py-3.5 rounded-full bg-primary text-primary-foreground text-sm uppercase tracking-widest text-center hover:opacity-90 transition"
            >
              Proceed to checkout
            </Link>
            <Link to={`${brandBasePath(brand)}/cart`} onClick={onClose} className="block text-center text-xs text-muted-foreground hover:text-foreground">
              View full bag
            </Link>
          </div>
        )}
      </aside>
    </div>
  );
}
