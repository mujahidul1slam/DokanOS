import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useBrand } from "../BrandContext";
import { brandBasePath, fmtBDT } from "../lib/brand";
import { listStorefrontProducts, type StorefrontProduct } from "../lib/catalog";
import ProductCard from "../components/ProductCard";

/**
 * Determine the homepage layout style based on the storefront's `theme` field.
 * - "editorial" or legacy "enveil" → light editorial magazine layout
 * - "cinematic" or legacy "vincent" → dark cinematic layout
 * - default → editorial layout
 */
function getLayoutStyle(theme: string): "editorial" | "cinematic" {
  const t = theme.toLowerCase();
  if (t === "cinematic" || t === "vincent" || t.includes("dark") || t.includes("cinematic")) {
    return "cinematic";
  }
  return "editorial";
}

export default function Home() {
  const { brand, storefront } = useBrand();
  const [products, setProducts] = useState<StorefrontProduct[]>([]);

  useEffect(() => {
    listStorefrontProducts(storefront.id).then(setProducts);
  }, [storefront.id]);

  const featured = products.filter((p) => p.is_featured).slice(0, 4);
  const hero = featured[0] || products[0];
  const grid = products.slice(0, 8);
  const layout = getLayoutStyle(storefront.theme);

  if (layout === "editorial") {
    return (
      <div>
        {/* Editorial Magazine hero */}
        <section className="relative max-w-7xl mx-auto px-4 lg:px-8 pt-16 pb-24">
          <div className="sf-liquid-bg" />
          <div className="relative grid lg:grid-cols-12 gap-12 items-center">
            <div className="lg:col-span-7">
              <div className="text-xs uppercase tracking-[0.25em] text-primary/80 mb-6">
                {storefront.name}
              </div>
              <h1 className="sf-display text-6xl md:text-7xl lg:text-8xl mb-8 text-foreground">
                {storefront.hero_title || `Welcome to ${storefront.name}`}
              </h1>
              <p className="text-lg md:text-xl text-muted-foreground max-w-xl mb-10 leading-relaxed">
                {storefront.hero_subtitle}
              </p>
              <Link
                to={`${brandBasePath(brand)}/shop`}
                className="inline-flex items-center gap-3 px-7 py-4 rounded-full bg-primary text-primary-foreground hover:opacity-90 transition group"
              >
                <span className="text-sm uppercase tracking-widest">Explore the collection</span>
                <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition" />
              </Link>
            </div>

            {hero && (
              <div className="lg:col-span-5">
                <Link
                  to={`${brandBasePath(brand)}/product/${hero.slug}`}
                  className="block sf-glass overflow-hidden group"
                >
                  <div className="aspect-[3/4] overflow-hidden bg-muted">
                    {(hero.image_urls?.[0] || hero.image_url) && (
                      <img
                        src={hero.image_urls?.[0] || hero.image_url!}
                        alt={hero.name}
                        className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-700"
                      />
                    )}
                  </div>
                  <div className="p-6">
                    <div className="text-xs uppercase tracking-widest text-primary mb-2">Featured</div>
                    <div className="sf-display text-2xl mb-1">{hero.name}</div>
                    <div className="text-sm text-muted-foreground">{fmtBDT(hero.price)}</div>
                  </div>
                </Link>
              </div>
            )}
          </div>
        </section>

        {/* Editorial grid */}
        <section className="max-w-7xl mx-auto px-4 lg:px-8 py-20">
          <div className="flex items-end justify-between mb-12">
            <div>
              <div className="text-xs uppercase tracking-[0.25em] text-primary/80 mb-3">The Collection</div>
              <h2 className="sf-display text-4xl md:text-5xl">Newly arrived</h2>
            </div>
            <Link to={`${brandBasePath(brand)}/shop`} className="text-sm underline underline-offset-4">
              View all
            </Link>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
            {grid.map((p) => <ProductCard key={p.id} p={p} />)}
          </div>
        </section>
      </div>
    );
  }

  // Cinematic layout
  return (
    <div>
      <section className="relative min-h-[92vh] flex items-center justify-center overflow-hidden">
        <div className="sf-liquid-bg" />
        {hero && (hero.image_urls?.[0] || hero.image_url) && (
          <img
            src={hero.image_urls?.[0] || hero.image_url!}
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-40 mix-blend-luminosity"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/60 to-background" />
        <div className="relative max-w-5xl mx-auto px-4 text-center">
          <div className="text-xs uppercase tracking-[0.4em] text-foreground/60 mb-8">{storefront.name}</div>
          <h1 className="sf-display text-7xl md:text-9xl lg:text-[10rem] leading-[0.85] mb-10">
            {(storefront.hero_title || storefront.name).toUpperCase()}
          </h1>
          <p className="text-base md:text-lg text-muted-foreground max-w-xl mx-auto mb-12 uppercase tracking-wider">
            {storefront.hero_subtitle}
          </p>
          <Link
            to={`${brandBasePath(brand)}/shop`}
            className="inline-flex items-center gap-3 px-8 py-4 rounded-full bg-primary text-primary-foreground hover:opacity-90 transition"
          >
            <span className="text-xs uppercase tracking-[0.3em]">Enter the collection</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* Hero product capsule */}
      {hero && (
        <section className="max-w-6xl mx-auto px-4 py-32">
          <Link to={`${brandBasePath(brand)}/product/${hero.slug}`} className="block sf-glass overflow-hidden group">
            <div className="grid md:grid-cols-2">
              <div className="aspect-square bg-muted overflow-hidden">
                {(hero.image_urls?.[0] || hero.image_url) && (
                  <img src={hero.image_urls?.[0] || hero.image_url!} alt={hero.name}
                    className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-700"/>
                )}
              </div>
              <div className="p-12 flex flex-col justify-center">
                <div className="text-xs uppercase tracking-[0.3em] text-muted-foreground mb-4">Signature piece</div>
                <h3 className="sf-display text-4xl md:text-5xl mb-6">{hero.name.toUpperCase()}</h3>
                <div className="text-2xl mb-8">{fmtBDT(hero.price)}</div>
                <div className="inline-flex items-center gap-2 text-sm uppercase tracking-widest">
                  View piece <ArrowRight className="h-4 w-4" />
                </div>
              </div>
            </div>
          </Link>
        </section>
      )}

      <section className="max-w-7xl mx-auto px-4 lg:px-8 py-24">
        <div className="flex items-end justify-between mb-12">
          <h2 className="sf-display text-4xl md:text-5xl">THE COLLECTION</h2>
          <Link to={`${brandBasePath(brand)}/shop`} className="text-xs uppercase tracking-[0.3em] underline underline-offset-4">
            View all
          </Link>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
          {grid.map((p) => <ProductCard key={p.id} p={p} />)}
        </div>
      </section>
    </div>
  );
}
