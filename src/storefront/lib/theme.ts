/**
 * Accent-color runtime theming.
 *
 * Storefront tokens use the shadcn "HSL triplet" convention:
 *   --primary: 13 35% 36%;   consumed as hsl(var(--primary))
 *
 * The dashboard lets operators pick an accent hex per storefront (accent_hex).
 * This module converts that hex into HSL triplets and returns the CSS custom
 * properties to override. BrandContext applies them as inline styles on <html>,
 * and inline vars win over the per-theme blocks in storefront.css.
 *
 * Safety rule: primary/ring/accent tokens are only overridden when the accent
 * is actually visible against the active theme's background (lightness delta
 * >= 25). Without this, a black accent on the dark "cinematic" theme would
 * make primary buttons invisible. The decorative glow (--sf-accent) is always
 * applied since it is harmless.
 */

export type AccentVars = Record<string, string>;

/** Parse "#rgb" / "#rrggbb" → [h(0-360), s(0-100), l(0-100)]. Returns null when invalid. */
export function hexToHsl(hex: string): [number, number, number] | null {
  let h6 = hex.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(h6)) {
    h6 = h6
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (!/^[0-9a-f]{6}$/i.test(h6)) return null;

  const int = parseInt(h6, 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return [0, 0, Math.round(l * 100)]; // achromatic

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;

  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}

/**
 * Lightness (0-100) of the active theme's --background token
 * (e.g. "35 30% 96%" → 96). Falls back to a light background (90) when the
 * token cannot be read. Call AFTER data-theme has been set on <html>.
 */
export function activeBackgroundLightness(): number {
  if (typeof window === "undefined") return 90;
  const token = getComputedStyle(document.documentElement)
    .getPropertyValue("--background")
    .trim();
  const parts = token.split(/\s+/);
  const l = parseFloat(parts[2] ?? "");
  return Number.isFinite(l) ? l : 90;
}

/**
 * Compute the inline CSS-var overrides for a storefront accent color.
 * Returns only the decorative vars when the accent would be invisible on the
 * theme background (e.g. #000000 on the dark cinematic theme).
 */
export function computeAccentVars(accentHex: string, bgLightness: number): AccentVars | null {
  const hsl = hexToHsl(accentHex);
  if (!hsl) return null;

  const [h, s, l] = hsl;
  const triplet = `${h} ${s}% ${l}%`;
  // Soft tint: deep tint when the accent itself is light, light wash otherwise
  const soft = l > 55 ? `${h} ${s}% 18%` : `${h} ${Math.min(s, 40)}% 90%`;

  const decorative: AccentVars = {
    "--sf-accent": triplet,
    "--sf-accent-soft": soft,
  };

  const visible = Math.abs(l - bgLightness) >= 25;
  if (!visible) return decorative;

  const fg = l > 55 ? "0 0% 10%" : "0 0% 98%";
  return {
    ...decorative,
    "--primary": triplet,
    "--primary-foreground": fg,
    "--ring": triplet,
    "--accent": triplet,
    "--accent-foreground": fg,
  };
}