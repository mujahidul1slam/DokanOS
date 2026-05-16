import { Link, useLocation } from "react-router-dom";
import { ReactNode } from "react";
import { ShoppingBag, Menu } from "lucide-react";
import { useBrand } from "../BrandContext";
import { useCart } from "../lib/cart";
import { brandBasePath } from "../lib/brand";

export default function StorefrontLayout({ children }: { children: ReactNode }) {
  const { brand, storefront } = useBrand();
  const { count } = useCart(brand);
  const base = brandBasePath(brand);
  const loc = useLocation();

  const nav = [
    { label: "Shop", to: `${base}/shop` },
    { label: "About", to: `${base}/about` },
    { label: "Track", to: `${base}/track` },
    { label: "Contact", to: `${base}/contact` },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground sf-body">
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-background/70 border-b border-border">
        <div className="max-w-7xl mx-auto flex items-center justify-between px-4 lg:px-8 py-4">
          <Link to={base} className="sf-display text-2xl lg:text-3xl tracking-tight">
            {storefront.name.toUpperCase()}
          </Link>
          <nav className="hidden md:flex items-center gap-8 text-sm">
            {nav.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className={`hover:text-primary transition-colors ${loc.pathname === n.to ? "text-primary" : "text-foreground/80"}`}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <Link
            to={`${base}/cart`}
            className="relative inline-flex items-center gap-2 px-4 py-2 rounded-full border border-border hover:border-primary transition"
          >
            <ShoppingBag className="h-4 w-4" />
            <span className="text-sm">Cart</span>
            {count > 0 && (
              <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center">
                {count}
              </span>
            )}
          </Link>
        </div>
      </header>

      <main className="relative">{children}</main>

      <footer className="border-t border-border mt-24">
        <div className="max-w-7xl mx-auto px-4 lg:px-8 py-12 grid md:grid-cols-3 gap-8">
          <div>
            <div className="sf-display text-xl mb-3">{storefront.name.toUpperCase()}</div>
            <p className="text-sm text-muted-foreground max-w-xs">{storefront.hero_subtitle}</p>
          </div>
          <div className="text-sm space-y-2">
            <div className="font-medium mb-2">Shop</div>
            {nav.map((n) => (
              <Link key={n.to} to={n.to} className="block text-muted-foreground hover:text-foreground">
                {n.label}
              </Link>
            ))}
          </div>
          <div className="text-sm space-y-2">
            <div className="font-medium mb-2">Contact</div>
            {storefront.contact_email && <div className="text-muted-foreground">{storefront.contact_email}</div>}
            {storefront.contact_phone && <div className="text-muted-foreground">{storefront.contact_phone}</div>}
          </div>
        </div>
        <div className="border-t border-border py-6 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} {storefront.name}. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
