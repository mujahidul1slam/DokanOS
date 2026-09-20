import { Link } from "react-router-dom";
import { ShoppingBag, Zap, ArrowRight, Plus } from "lucide-react";
import { brandBasePath } from "../lib/brand";
import { useBrand } from "../BrandContext";
import { useCurrency } from "../lib/useCurrency";
import { useCart } from "../lib/cart";
import { mergeSettings } from "../lib/settings";
import type { StorefrontProduct } from "../lib/catalog";

const RATIO_CLASS: Record<string, string> = {
  square: "aspect-square",
  tall: "aspect-[4/5]",
  wide: "aspect-[4/3]",
};

const FONT_CLASS: Record<string, string> = {
  inter: "font-sans",
  poppins: "font-sans",
  montserrat: "font-sans",
  playfair: "font-serif",
  lora: "font-serif",
  space: "font-sans",
  dm: "font-sans",
  theme: "",
};

export default function ProductCard({ p }: { p: StorefrontProduct }) {
  const { brand, storefront } = useBrand();
  const fmt = useCurrency();
  const { add } = useCart(brand);
  const settings = mergeSettings(storefront.settings);
  const c = settings.card;
  const img = p.image_urls?.[0] || p.image_url || "";

  const radius = { borderRadius: `${c.corner_px}px` };
  const shadowCls = c.shadow === "soft" ? "shadow-sm" : c.shadow === "medium" ? "shadow-lg" : "";
  const hoverCls =
    c.hover === "zoom" ? "transition-transform duration-500 hover:scale-[1.02]" :
    c.hover === "lift" ? "transition-transform duration-300 hover:-translate-y-1 hover:shadow-xl" :
    "";
  const surfaceCls =
    c.style === "minimal" ? "bg-transparent" :
    c.style === "bordered" ? "border border-border bg-background" :
    c.style === "elevated" ? `bg-card ${shadowCls}` :
    "sf-glass";

  const btnCls = "inline-flex items-center justify-center gap-1.5 text-xs font-medium h-9 px-3 rounded-md w-full";
  const btnStyle = {
    background: c.add_to_cart_bg || undefined,
    color: c.add_to_cart_text || undefined,
  };

  function AtcIcon() {
    if (c.add_to_cart_icon === "cart") return <ShoppingBag className="h-3.5 w-3.5" />;
    if (c.add_to_cart_icon === "bag") return <ShoppingBag className="h-3.5 w-3.5" />;
    if (c.add_to_cart_icon === "plus") return <Plus className="h-3.5 w-3.5" />;
    return null;
  }
  function BuyIcon() {
    if (c.buy_now_icon === "zap") return <Zap className="h-3.5 w-3.5" />;
    if (c.buy_now_icon === "arrow") return <ArrowRight className="h-3.5 w-3.5" />;
    if (c.buy_now_icon === "bag") return <ShoppingBag className="h-3.5 w-3.5" />;
    if (c.buy_now_icon === "cart") return <ShoppingBag className="h-3.5 w-3.5" />;
    return null;
  }

  function quickAdd(e: React.MouseEvent) {
    e.preventDefault();
    add({ product_id: p.id, name: p.name, price: p.price, image_url: img, quantity: 1 });
  }
  function quickBuy(e: React.MouseEvent) {
    e.preventDefault();
    add({ product_id: p.id, name: p.name, price: p.price, image_url: img, quantity: 1 });
    window.location.href = `${brandBasePath(brand)}/checkout`;
  }

  const hasBtns = c.show_add_to_cart || c.show_buy_now;

  return (
    <div style={{ ...radius }} className={`group relative overflow-hidden ${surfaceCls} ${hoverCls} ${FONT_CLASS[c.font] ?? ""}`} role="article" aria-label={p.name}>
      {/* Image area — whole card links except the action buttons */}
      <Link to={`${brandBasePath(brand)}/product/${p.slug}`} className="block">
        <div className={`${RATIO_CLASS[c.image_ratio] ?? "aspect-[4/5]"} overflow-hidden bg-muted relative`}>
          {img ? (
            <img src={img} alt={p.name} loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full flex items-center justify-center text-muted-foreground text-xs">No image</div>
          )}
        {p.badge && (
          <span className="absolute top-3 left-3 bg-primary text-primary-foreground text-[10px] uppercase tracking-wider px-2 py-1 rounded-full">
            {p.badge}
          </span>
        )}
        {/* On-image-hover button variant */}
        {hasBtns && c.button_position === "overlay" && (
            <div className="absolute inset-x-3 bottom-3 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
              <div className={`flex gap-1.5 ${c.button_layout === "stacked" ? "flex-col" : ""}`}>
                {c.show_add_to_cart && (
                  <button className={btnCls} style={btnStyle} onClick={quickAdd} aria-label={`Add ${p.name} to cart`}>
                    <AtcIcon /> Add to Cart
                  </button>
                )}
                {c.show_buy_now && (
                  <button
                    className={`${btnCls} bg-primary text-primary-foreground`}
                    style={{ background: c.buy_now_bg || undefined, color: c.buy_now_text || undefined }}
                    onClick={quickBuy}
                  >
                    <BuyIcon /> Buy Now
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </Link>

      {/* Details */}
      <div className="p-4 space-y-1" style={{ background: c.card_bg || undefined }}>
        {c.show_category && (p as any).category && (
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{(p as any).category}</p>
        )}
        <Link to={`${brandBasePath(brand)}/product/${p.slug}`} className="block">
          <h3 className="text-sm font-medium line-clamp-1 group-hover:text-primary transition-colors">{p.name}</h3>
        </Link>
        {c.show_price && (
          <p className="text-sm font-medium" style={{ color: c.price_color || undefined }}>{fmt(p.price)}</p>
        )}

        {/* Below-details buttons (default) */}
        {hasBtns && c.button_position === "below" && (
          <div className={`flex gap-1.5 pt-2 ${c.button_layout === "stacked" ? "flex-col" : ""}`}>
            {c.show_add_to_cart && (
              <button className={btnCls} style={btnStyle} onClick={quickAdd}>
                <AtcIcon /> Add to Cart
              </button>
            )}
            {c.show_buy_now && (
              <button
                className={`${btnCls} bg-primary text-primary-foreground`}
                style={{ background: c.buy_now_bg || undefined, color: c.buy_now_text || undefined }}
                onClick={quickBuy}
              >
                <BuyIcon /> Buy Now
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
