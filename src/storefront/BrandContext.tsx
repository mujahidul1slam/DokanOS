import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { type BrandSlug, type Storefront, loadStorefront } from "./lib/brand";

interface Ctx {
  brand: BrandSlug;
  storefront: Storefront;
}

const BrandContext = createContext<Ctx | null>(null);

export function useBrand(): Ctx {
  const v = useContext(BrandContext);
  if (!v) throw new Error("useBrand must be used inside <BrandProvider>");
  return v;
}

export function BrandProvider({ brand, children }: { brand: BrandSlug; children: ReactNode }) {
  const [sf, setSf] = useState<Storefront | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Set data-brand attribute for CSS theming
  useEffect(() => {
    document.documentElement.setAttribute("data-brand", brand);
    return () => {
      document.documentElement.removeAttribute("data-brand");
    };
  }, [brand]);

  // Set data-theme attribute when storefront loads (drives CSS themes)
  useEffect(() => {
    if (sf) {
      const theme = sf.theme || brand;
      document.documentElement.setAttribute("data-theme", theme);
      document.title = sf.hero_title
        ? `${sf.name} — ${sf.hero_title}`
        : sf.name;

      // Inject accent color as a CSS custom property
      if (sf.accent_hex) {
        document.documentElement.style.setProperty("--sf-accent-hex", sf.accent_hex);
      }

      // Set favicon if configured
      if (sf.favicon_url) {
        let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
        if (!link) {
          link = document.createElement("link");
          link.rel = "icon";
          document.head.appendChild(link);
        }
        link.href = sf.favicon_url;
      }
    }
    return () => {
      document.documentElement.removeAttribute("data-theme");
      document.documentElement.style.removeProperty("--sf-accent-hex");
    };
  }, [sf, brand]);

  useEffect(() => {
    loadStorefront(brand)
      .then((s) => {
        if (!s) setErr("Storefront not found");
        else setSf(s);
      })
      .catch(() => setErr("Could not load storefront"));
  }, [brand]);

  if (err) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
        <p className="text-muted-foreground">{err}</p>
      </div>
    );
  }
  if (!sf) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  return <BrandContext.Provider value={{ brand, storefront: sf }}>{children}</BrandContext.Provider>;
}
