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

  useEffect(() => {
    document.documentElement.setAttribute("data-brand", brand);
    document.title = brand === "enveil" ? "Enveil — quiet luxury" : "Vincent — tailored for the night";
    return () => {
      document.documentElement.removeAttribute("data-brand");
    };
  }, [brand]);

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
