import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useBrand } from "../BrandContext";
import { brandBasePath } from "../lib/brand";
import { useCurrency } from "../lib/useCurrency";
import { getStorefrontProductBySlug, type StorefrontProduct, type StorefrontVariation } from "../lib/catalog";
import { useCart } from "../lib/cart";
import { parseVariationAttributes, formatVariationLabel } from "@/lib/variations";
import { mergeSettings } from "../lib/settings";
import { Loader2, Minus, Plus, ShoppingBag, Share2, Ruler, Tag } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { usePageMeta } from "../lib/seo";
import { ProductJsonLd, BreadcrumbListJsonLd } from "../lib/jsonld";
import { productUrl } from "../lib/routes";

export default function Product({ slugOverride }: { slugOverride?: string }) {
  const params = useParams();
  const slug = slugOverride || params.slug;
  const navigate = useNavigate();
  const { brand, storefront } = useBrand();
  const fmt = useCurrency();
  const { add } = useCart(brand);
  const [p, setP] = useState<StorefrontProduct | null | undefined>(undefined);
  const [qty, setQty] = useState(1);
  const [imgIdx, setImgIdx] = useState(0);

  // Selected variation attributes: { [attributeName]: selectedOption }
  const [selectedAttrs, setSelectedAttrs] = useState<Record<string, string>>({});

  const settings = useMemo(() => mergeSettings(storefront.settings), [storefront.settings]);
  const sp = settings.product;

  useEffect(() => {
    if (!slug) return;
    getStorefrontProductBySlug(storefront.id, slug).then((d) => {
      setP(d);
      setSelectedAttrs({});
      setImgIdx(0);
    });
  }, [slug, storefront.id]);

  const variations = p?.variations || [];
  const hasVariations = variations.length > 0;

  const attributeGroups = useMemo(() => {
    if (!hasVariations) return [];
    const map = new Map<string, Set<string>>();
    for (const v of variations) {
      for (const attr of parseVariationAttributes(v.attributes)) {
        if (!map.has(attr.name)) map.set(attr.name, new Set());
        map.get(attr.name)!.add(attr.option);
      }
    }
    return Array.from(map.entries()).map(([name, optionsSet]) => ({ name, options: Array.from(optionsSet) }));
  }, [variations, hasVariations]);

  const matchedVariation: StorefrontVariation | null = useMemo(() => {
    if (!hasVariations) return null;
    if (attributeGroups.length === 0) return null;
    const allSelected = attributeGroups.every((g) => selectedAttrs[g.name]);
    if (!allSelected) return null;
    return (
      variations.find((v) => {
        const parsed = parseVariationAttributes(v.attributes);
        if (parsed.length === 0) return false;
        return attributeGroups.every((g) => parsed.find((a) => a.name.toLowerCase() === g.name.toLowerCase())?.option === selectedAttrs[g.name]);
      }) || null
    );
  }, [hasVariations, attributeGroups, selectedAttrs, variations]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const canonicalUrl = p ? `${origin}${productUrl(p.slug)}` : "";

  usePageMeta({
    title: p ? `${p.name} — ${storefront.name}` : undefined,
    description: p ? (p.description ? p.description.slice(0, 160) : `Buy ${p.name} at ${storefront.name}`) : undefined,
    canonicalPath: p ? productUrl(p.slug) : undefined,
    ogImageUrl: p ? (p.image_urls?.[0] || p.image_url) : undefined,
    ogType: "product",
  });

  if (p === undefined) {
    return (
      <div className="flex justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (!p) {
    return <div className="max-w-3xl mx-auto px-4 py-32 text-center text-muted-foreground">Product not found.</div>;
  }

  const images = p.image_urls?.length ? p.image_urls : p.image_url ? [p.image_url] : [];

  // Effective price: selected variation's price when chosen, else parent product price
  const effectivePrice = matchedVariation ? matchedVariation.price : p.price;
  const priceLabel = sp.price_in_button ? `${fmt(effectivePrice * qty)}` : "";  const outOfStock = hasVariations
    ? matchedVariation
      ? matchedVariation.manage_stock && matchedVariation.stock_quantity <= 0
      : false
    : p.manage_stock && p.stock_quantity <= 0;
  const canAddToCart = hasVariations ? !!matchedVariation && !outOfStock : !outOfStock;

  function handleSelectOption(attrName: string, option: string) {
    setSelectedAttrs((prev) => ({ ...prev, [attrName]: option }));
  }

  function handleAdd() {
    if (hasVariations && !matchedVariation) {
      toast({ title: "Please choose options", description: "Select all options before adding to cart.", variant: "destructive" });
      return;
    }
    add({
      product_id: p!.id,
      variation_id: matchedVariation?.id,
      variation_label: matchedVariation ? formatVariationLabel(parseVariationAttributes(matchedVariation.attributes)) : undefined,
      name: p!.name,
      price: effectivePrice,
      image_url: images[0],
      quantity: qty,
    });
    toast({ title: "Added to cart", description: p!.name });
  }

  function handleBuyNow() {
    handleAdd();
    navigate(`${brandBasePath(brand)}/checkout`);
  }

  async function handleShare() {
    const url = window.location.href;
    await navigator.clipboard?.writeText(url).catch(() => undefined);
    toast({ title: "Link copied", description: "Share this product." });
  }

  // Image shape → aspect-ratio class
  const imgAspect = sp.image_shape === "landscape" ? "aspect-[4/3]" : sp.image_shape === "square" ? "aspect-square" : "aspect-[4/5]";

  const btnBase = "inline-flex items-center justify-center gap-2 transition disabled:opacity-50 disabled:cursor-not-allowed text-sm uppercase tracking-widest";
  const btnCorners = sp.atc_corners === "pill" ? "rounded-full" : sp.atc_corners === "square" ? "rounded-none" : "rounded-xl";
  const btnHeight = sp.atc_height === "compact" ? "h-10 px-4" : sp.atc_height === "large" ? "h-14 px-7" : "h-12 px-6";
  const fillCls = (f: "solid" | "outline" | "tinted") =>
    f === "solid" ? "bg-primary text-primary-foreground hover:opacity-90"
    : f === "outline" ? "border border-primary text-primary hover:bg-primary/5"
    : "bg-primary/10 text-primary hover:bg-primary/20";

  return (
    <div className="max-w-6xl mx-auto px-4 lg:px-8 py-12 lg:py-16">
      <ProductJsonLd
        name={p.name}
        description={p.description}
        image={images[0] || p.image_url}
        price={effectivePrice}
        currency="BDT"
        manage_stock={p.manage_stock}
        stock_quantity={p.stock_quantity}
        url={canonicalUrl}
      />
      <BreadcrumbListJsonLd
        items={[
          { name: "Home", url: `${origin}/` },
          { name: "Shop", url: `${origin}/shop` },
          { name: p.name, url: canonicalUrl },
        ]}
      />

      {/* class: layout split → flex (split focus); gallery-left → same grid but image narrower; classic default 2-col */}
      <div className={`grid gap-8 lg:gap-16 ${sp.layout === "split" ? "md:grid-cols-[65%_35%]" : sp.layout === "gallery-left" ? "md:grid-cols-[58%_42%]" : "md:grid-cols-2"}`}>
        <div>
          <div className={`sf-glass overflow-hidden ${imgAspect} bg-muted`}>
            {images[imgIdx] && <img src={images[imgIdx]} alt={p.name} className="h-full w-full object-cover" />}
          </div>
          {images.length > 1 && (
            <div className="flex gap-3 mt-4">
              {images.map((src, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setImgIdx(i)}
                  className={`h-20 w-20 rounded-lg overflow-hidden border-2 transition ${i === imgIdx ? "border-primary" : "border-transparent opacity-70"}`}
                >
                  <img src={src} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={`lg:pt-0 ${sp.info_panel === "card" ? "p-5 rounded-xl border border-border bg-card" : ""}`}>
          {/* Category label */}
          {sp.show_category_label && (
            <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2 inline-flex items-center gap-1">
              <Tag className="h-3 w-3" /> Product
            </p>
          )}

          <h1 className="sf-display text-4xl md:text-5xl mb-4">{p.name}</h1>

          {/* Price breakdown + accent */}
          <div className="flex items-baseline gap-3 mb-2">
            <div className="text-2xl" style={sp.accent_override ? { color: sp.accent_override } : undefined}>
              {fmt(effectivePrice)}
            </div>
          </div>

          {sp.show_price_breakdown && (p as any).compare_at_price && (p as any).compare_at_price > p.price && (
            <div className="text-sm text-muted-foreground mb-4">
              <span className="line-through">{fmt((p as any).compare_at_price)}</span>{" "}
              <span className="text-emerald-600">Save {fmt((p as any).compare_at_price - effectivePrice)}</span>
            </div>
          )}

          <div className="flex items-center gap-4 mb-4">
            {sp.show_stock_status && (
              <p className={`text-xs ${outOfStock ? "text-destructive" : "text-emerald-600"}`}>{outOfStock ? "Out of stock" : "In stock"}</p>
            )}
            {(p as any).sku && sp.show_sku && <p className="text-xs text-muted-foreground">SKU: {(p as any).sku}</p>}
          </div>

          {hasVariations && (
            <div className="space-y-4 mb-8">
              {attributeGroups.map((group) => (
                <div key={group.name}>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                    {group.name}: <span className="text-foreground font-medium">{selectedAttrs[group.name] || "Select"}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {group.options.map((opt) => {
                      const isSelected = selectedAttrs[group.name] === opt;
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => handleSelectOption(group.name, opt)}
                          className={`px-4 py-2 text-sm rounded-full border transition-all ${
                            isSelected ? "bg-primary text-primary-foreground border-primary" : "border-border hover:border-primary/50 text-foreground bg-background"
                          }`}
                        >
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {sp.show_size_chart && (p as any).size_chart_url && (
                <a href={(p as any).size_chart_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                  <Ruler className="h-3.5 w-3.5" /> Size chart
                </a>
              )}
            </div>
          )}

          {p.description && <div className="text-muted-foreground leading-relaxed mb-10 whitespace-pre-line">{p.description}</div>}

          {/* Buttons row */}
          <div className={`flex items-stretch gap-3 mb-3 ${sp.atc_arrangement === "stacked" ? "flex-col" : ""}`}>
            {sp.show_quantity && (
              <div className="inline-flex items-center border border-border rounded-full">
                <button type="button" onClick={() => setQty(Math.max(1, qty - 1))} className="p-3 hover:text-primary" aria-label="Decrease quantity">
                  <Minus className="h-4 w-4" />
                </button>
                <span className="w-10 text-center">{qty}</span>
                <button type="button" onClick={() => setQty(qty + 1)} className="p-3 hover:text-primary" aria-label="Increase quantity">
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            )}
            <button type="button" onClick={handleAdd} disabled={!canAddToCart} className={`flex-1 ${btnBase} ${btnCorners} ${btnHeight} ${fillCls(sp.atc_fill)}`}
              style={sp.atc_fill !== "solid" ? {} : { background: sp.atc_color || undefined, color: sp.atc_text_color || undefined }}
            >
              <ShoppingBag className="h-4 w-4" />
              <span>{outOfStock ? "Sold out" : priceLabel ? `Add to cart — ${priceLabel}` : "Add to cart"}</span>
            </button>
          </div>

          {canAddToCart && (
            <button type="button" onClick={handleBuyNow}
              className={`${btnBase} ${btnCorners} ${btnHeight} w-full ${fillCls(sp.buy_fill)}`}
              style={sp.buy_color || sp.buy_text_color ? { background: sp.buy_color || undefined, color: sp.buy_text_color || undefined } : undefined}
            >
              <span>{priceLabel ? `Buy now — ${priceLabel}` : "Buy now"}</span>
            </button>
          )}

          {sp.trust_badges.filter(Boolean).length > 0 && (
            <div className="flex flex-wrap gap-2 mt-6">
              {sp.trust_badges.filter(Boolean).map((b, i) => (
                <span key={i} className="inline-flex items-center gap-1 text-xs text-muted-foreground border border-border rounded-full px-2 py-1">
                  {b}
                </span>
              ))}
            </div>
          )}

          {sp.show_share && (
            <div className="flex gap-3 mt-4">
              <button type="button" onClick={handleShare} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                <Share2 className="h-4 w-4" /> Share
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Related */}
      <RelatedProducts storefront={storefront.id} currentId={p.id} sp={sp} brandBase={brandBasePath(brand)} fmt={fmt} />
    </div>
  );
}

function RelatedProducts({ storefront, currentId, sp, brandBase, fmt }: {
  storefront: string; currentId: string; sp: ReturnType<typeof mergeSettings>["product"]; brandBase: string; fmt: (n: number) => string;
}) {
  const [items, setItems] = useState<StorefrontProduct[] | null>(null);

  useEffect(() => {
    import("../lib/catalog").then(async (m) => {
      const all = await m.listStorefrontProducts(storefront);
      setItems(all.filter((p) => p.id !== currentId).slice(0, sp.related_per_row_pc * 2));
    });
  }, [storefront, currentId, sp.related_per_row_pc]);

  if (!items || items.length === 0) return null;

  const PHONE_COLS: Record<number, string> = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3" };
  const PC_COLS: Record<number, string> = { 3: "md:grid-cols-3", 4: "md:grid-cols-4", 5: "md:grid-cols-5" };

  return (
    <div className="mt-16">
      <h2 className="sf-display text-3xl mb-6">You Might Also Like</h2>
      <div className={`grid ${PHONE_COLS[sp.related_per_row_phone] || "grid-cols-2"} ${PC_COLS[sp.related_per_row_pc] || "md:grid-cols-4"} gap-4`}>
        {items.map((it) => (
          <Link key={it.id} to={`${brandBase}/product/${it.slug}`} className="group block">
            <div className="aspect-square overflow-hidden rounded-md bg-muted mb-2">
              {(it.image_urls?.[0] || it.image_url) && (
                <img src={it.image_urls?.[0] || it.image_url || ""} alt={it.name} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
              )}
            </div>
            <p className="text-sm font-medium line-clamp-1">{it.name}</p>
            <p className="text-sm text-muted-foreground">{fmt(it.price)}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
