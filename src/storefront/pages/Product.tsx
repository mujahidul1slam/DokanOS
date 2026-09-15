import { useEffect, useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useBrand } from "../BrandContext";
import { brandBasePath } from "../lib/brand";
import { useCurrency } from "../lib/useCurrency";
import { getStorefrontProductBySlug, type StorefrontProduct, type StorefrontVariation } from "../lib/catalog";
import { useCart } from "../lib/cart";
import { parseVariationAttributes, formatVariationLabel, type ParsedAttr } from "@/lib/variations";
import { Loader2, Minus, Plus, ShoppingBag } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { usePageMeta } from "../lib/seo";
import { ProductJsonLd, BreadcrumbListJsonLd } from "../lib/jsonld";
import { productUrl } from "../lib/routes";

export default function Product() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { brand, storefront } = useBrand();
  const fmt = useCurrency();
  const { add } = useCart(brand);
  const [p, setP] = useState<StorefrontProduct | null | undefined>(undefined);
  const [qty, setQty] = useState(1);
  const [imgIdx, setImgIdx] = useState(0);

  // Selected variation attributes: { [attributeName]: selectedOption }
  const [selectedAttrs, setSelectedAttrs] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!slug) return;
    getStorefrontProductBySlug(storefront.id, slug).then((d) => {
      setP(d);
      setSelectedAttrs({});
    });
  }, [slug, storefront.id]);

  const variations = p?.variations || [];
  const hasVariations = variations.length > 0;

  // Extract all attribute names and their unique options across variations
  const attributeGroups = useMemo(() => {
    if (!hasVariations) return [];
    const map = new Map<string, Set<string>>();
    for (const v of variations) {
      const parsed = parseVariationAttributes(v.attributes);
      for (const attr of parsed) {
        if (!map.has(attr.name)) map.set(attr.name, new Set());
        map.get(attr.name)!.add(attr.option);
      }
    }
    return Array.from(map.entries()).map(([name, optionsSet]) => ({
      name,
      options: Array.from(optionsSet),
    }));
  }, [variations, hasVariations]);

  // Find variation matching current attribute selection
  const matchedVariation: StorefrontVariation | null = useMemo(() => {
    if (!hasVariations) return null;
    if (attributeGroups.length === 0) return null;
    // Check if every attribute group has a selection
    const allSelected = attributeGroups.every((g) => selectedAttrs[g.name]);
    if (!allSelected) return null;

    return (
      variations.find((v) => {
        const parsed = parseVariationAttributes(v.attributes);
        if (parsed.length === 0) return false;
        return attributeGroups.every((g) => {
          const match = parsed.find((a) => a.name.toLowerCase() === g.name.toLowerCase());
          return match && match.option === selectedAttrs[g.name];
        });
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

  // Effective price: selected variation's price when chosen, else parent product price (POS mirror)
  const effectivePrice = matchedVariation ? matchedVariation.price : p.price;

  // Availability gate: manage_stock && stock_quantity <= 0 (deliberately ignores stock_status per M2/fact 13)
  const outOfStock = hasVariations
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
      toast({
        title: "Please choose options",
        description: "Select all options before adding to cart.",
        variant: "destructive",
      });
      return;
    }

    const variationLabel = matchedVariation
      ? formatVariationLabel(parseVariationAttributes(matchedVariation.attributes))
      : undefined;

    add({
      product_id: p!.id,
      variation_id: matchedVariation?.id,
      variation_label: variationLabel,
      name: p!.name,
      price: effectivePrice,
      image_url: images[0],
      quantity: qty,
    });
    toast({
      title: "Added to cart",
      description: variationLabel ? `${p!.name} (${variationLabel})` : p!.name,
    });
  }

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
      <div className="grid md:grid-cols-2 gap-8 lg:gap-16">
        <div>
          <div className="sf-glass overflow-hidden aspect-[4/5] bg-muted">
            {images[imgIdx] && <img src={images[imgIdx]} alt={p.name} className="h-full w-full object-cover" />}
          </div>
          {images.length > 1 && (
            <div className="flex gap-3 mt-4">
              {images.map((src, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setImgIdx(i)}
                  className={`h-20 w-20 rounded-lg overflow-hidden border-2 transition ${
                    i === imgIdx ? "border-primary" : "border-transparent opacity-70"
                  }`}
                >
                  <img src={src} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="lg:pt-8">
          <h1 className="sf-display text-4xl md:text-5xl mb-4">{p.name}</h1>
          <div className="text-2xl mb-6">{fmt(effectivePrice)}</div>

          {/* Variation Attribute Selectors */}
          {hasVariations && (
            <div className="space-y-4 mb-8">
              {attributeGroups.map((group) => (
                <div key={group.name}>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                    {group.name}:{" "}
                    <span className="text-foreground font-medium">
                      {selectedAttrs[group.name] || "Select"}
                    </span>
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
                            isSelected
                              ? "bg-primary text-primary-foreground border-primary"
                              : "border-border hover:border-primary/50 text-foreground bg-background"
                          }`}
                        >
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {p.description && (
            <div className="text-muted-foreground leading-relaxed mb-10 whitespace-pre-line">{p.description}</div>
          )}

          <div className="flex items-center gap-4 mb-8">
            <div className="inline-flex items-center border border-border rounded-full">
              <button
                type="button"
                onClick={() => setQty(Math.max(1, qty - 1))}
                className="p-3 hover:text-primary"
                aria-label="Decrease quantity"
              >
                <Minus className="h-4 w-4" />
              </button>
              <span className="w-10 text-center">{qty}</span>
              <button
                type="button"
                onClick={() => setQty(qty + 1)}
                className="p-3 hover:text-primary"
                aria-label="Increase quantity"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={handleAdd}
              disabled={!canAddToCart}
              className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-4 rounded-full bg-primary text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
            >
              <ShoppingBag className="h-4 w-4" />
              <span className="text-sm uppercase tracking-widest">
                {outOfStock
                  ? "Sold out"
                  : hasVariations && !matchedVariation
                  ? "Choose options"
                  : "Add to cart"}
              </span>
            </button>
          </div>

          {canAddToCart && (
            <button
              type="button"
              onClick={() => {
                handleAdd();
                navigate(`${brandBasePath(brand)}/checkout`);
              }}
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
