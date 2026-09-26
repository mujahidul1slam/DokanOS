import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { type BrandSlug, type Storefront, loadStorefront } from "./lib/brand";
import { computeAccentVars, activeBackgroundLightness, hexToHslTriplet } from "./lib/theme";

/** Load a Google Fonts family (idempotent per family). */
function loadGoogleFont(family: string) {
  const id = `sf-font-${family.toLowerCase().replace(/\s+/g, "-")}`;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@400;500;600;700&display=swap`;
  document.head.appendChild(link);
}

interface Ctx {
  brand: BrandSlug;
  storefront: Storefront;
  /** Set only inside the admin preview route — the working-copy page slug being previewed. */
  draftPageSlug?: string;
}

const BrandContext = createContext<Ctx | null>(null);

export function useBrand(): Ctx {
  const v = useContext(BrandContext);
  if (!v) throw new Error("useBrand must be used inside <BrandProvider>");
  return v;
}

export function BrandProvider({
  brand,
  children,
  storefrontOverride,
  draftPageSlug,
}: {
  brand: BrandSlug;
  children: ReactNode;
  /** Admin preview: skip the anon fetch and use this row (staff-loaded). */
  storefrontOverride?: Storefront | null;
  /** Admin preview: render this page's working copy instead of published content. */
  draftPageSlug?: string;
}) {
  const [sf, setSf] = useState<Storefront | null>(storefrontOverride ?? null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (storefrontOverride !== undefined) {
      setSf(storefrontOverride);
      setErr(storefrontOverride ? null : "Storefront not found");
    }
  }, [storefrontOverride]);

  // Set data-brand attribute for CSS theming
  useEffect(() => {
    document.documentElement.setAttribute("data-brand", brand);
    return () => {
      document.documentElement.removeAttribute("data-brand");
    };
  }, [brand]);

  // Set data-theme attribute when storefront loads (drives CSS themes)
  useEffect(() => {
    const applied: string[] = [];
    if (sf) {
      const theme = sf.theme || brand;
      document.documentElement.setAttribute("data-theme", theme);
      document.title = sf.hero_title
        ? `${sf.name} — ${sf.hero_title}`
        : sf.name;

      // Accent color: expose the raw hex AND recolor the HSL tokens so the
      // operator's pick actually recolors the storefront (lib/theme.ts holds
      // the visibility safety rules).
      if (sf.accent_hex) {
        document.documentElement.style.setProperty("--sf-accent-hex", sf.accent_hex);
        applied.push("--sf-accent-hex");

        const vars = computeAccentVars(sf.accent_hex, activeBackgroundLightness());
        if (vars) {
          for (const [name, value] of Object.entries(vars)) {
            document.documentElement.style.setProperty(name, value);
            applied.push(name);
          }
        }
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

      // Overhaul 4.2: theme token customizer — granular tokens override the
      // theme's CSS values. Fonts load from Google Fonts when a family is set.
      const tokens = (sf as any).tokens as Record<string, any> | undefined;
      if (tokens) {
        const hexVars: Record<string, string> = {
          "--primary": tokens.color_primary,
          "--secondary": tokens.color_secondary,
          "--card": tokens.color_surface,
          "--background": tokens.color_surface,
          "--foreground": tokens.color_text,
          "--muted-foreground": tokens.color_muted,
          "--border": tokens.color_border,
          "--sf-accent-hex": tokens.color_accent,
        };
        for (const [name, hex] of Object.entries(hexVars)) {
          if (hex) {
            document.documentElement.style.setProperty(name, hexToHslTriplet(hex) ?? hex);
            applied.push(name);
          }
        }
        if (tokens.font_display) {
          document.documentElement.style.setProperty("--font-display", `"${tokens.font_display}", sans-serif`);
          applied.push("--font-display");
          loadGoogleFont(tokens.font_display);
        }
        if (tokens.font_body) {
          document.documentElement.style.setProperty("--font-body", `"${tokens.font_body}", sans-serif`);
          applied.push("--font-body");
          loadGoogleFont(tokens.font_body);
        }
        if (Number.isFinite(Number(tokens.corner_radius_px))) {
          document.documentElement.style.setProperty("--radius", `${tokens.corner_radius_px}px`);
          applied.push("--radius");
        }
      }
    }
    return () => {
      document.documentElement.removeAttribute("data-theme");
      applied.forEach((name) => document.documentElement.style.removeProperty(name));
    };
  }, [sf, brand]);

  useEffect(() => {
    if (storefrontOverride !== undefined) return; // preview mode: nothing to load
    loadStorefront(brand)
      .then((s) => {
        if (!s) setErr("Storefront not found");
        else setSf(s);
      })
      .catch(() => setErr("Could not load storefront"));
  }, [brand, storefrontOverride]);

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
  return (
    <BrandContext.Provider value={{ brand, storefront: sf, draftPageSlug }}>
      {children}
    </BrandContext.Provider>
  );
}
