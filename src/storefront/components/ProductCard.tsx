import { Link } from "react-router-dom";
import { fmtBDT, brandBasePath } from "../lib/brand";
import { useBrand } from "../BrandContext";
import type { StorefrontProduct } from "../lib/catalog";

export default function ProductCard({ p }: { p: StorefrontProduct }) {
  const { brand } = useBrand();
  const img = p.image_urls?.[0] || p.image_url || "";
  return (
    <Link
      to={`${brandBasePath(brand)}/product/${p.slug}`}
      className="group block sf-glass overflow-hidden transition hover:-translate-y-1 hover:shadow-2xl duration-500"
    >
      <div className="aspect-[4/5] overflow-hidden bg-muted relative">
        {img ? (
          <img
            src={img}
            alt={p.name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-muted-foreground text-xs">No image</div>
        )}
        {p.badge && (
          <span className="absolute top-3 left-3 bg-primary text-primary-foreground text-[10px] uppercase tracking-wider px-2 py-1 rounded-full">
            {p.badge}
          </span>
        )}
      </div>
      <div className="p-4">
        <h3 className="sf-display text-lg mb-1 line-clamp-1">{p.name}</h3>
        <div className="text-sm text-muted-foreground">{fmtBDT(p.price)}</div>
      </div>
    </Link>
  );
}
