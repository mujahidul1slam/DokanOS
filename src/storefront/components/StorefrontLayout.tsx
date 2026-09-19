import { Link, useLocation } from "react-router-dom";
import { ReactNode, useMemo, useState } from "react";
import { ShoppingBag, Menu, X, Camera, Share2, Music2, MessageCircle, Phone } from "lucide-react";
import { useBrand } from "../BrandContext";
import { useCart } from "../lib/cart";
import { brandBasePath } from "../lib/brand";
import { mergeSettings } from "../lib/settings";
import { useScrollAnimations } from "../lib/animations";

const ICON_STYLE = "inline-flex h-9 w-9 items-center justify-center rounded-full border border-border hover:border-primary hover:text-primary transition";

export default function StorefrontLayout({ children }: { children: ReactNode }) {
  const { brand, storefront } = useBrand();
  const { count } = useCart(brand);
  const base = brandBasePath(brand);
  const loc = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const settings = useMemo(() => mergeSettings(storefront.settings), [storefront.settings]);
  useScrollAnimations(settings.animations);
  const announcement = settings.announcement;
  const h = settings.header;
  const social = (storefront.social || {}) as Record<string, string>;
  const policies = (storefront.policies || {}) as Record<string, string>;

  // Editable nav (Phase 1 builder): storefronts.nav rows win when non-empty;
  // custom menu links from settings append BOTH there or replace defaults when alone.
  const navRows = Array.isArray(storefront.nav) ? storefront.nav : [];
  const nav = navRows.length
    ? navRows.map((n) => ({
        label: n.label,
        to: /^https?:\/\//i.test(n.href) ? n.href : `${base}${n.href.startsWith("/") ? n.href : `/${n.href}`}`,
      }))
    : [
        { label: "Shop", to: `${base}/shop` },
        { label: "About", to: `${base}/about` },
        { label: "Track", to: `${base}/track` },
        { label: "Contact", to: `${base}/contact` },
        ...h.custom_links
          .filter((l) => l.label && l.href)
          .map((l) => ({
            label: l.label,
            to: /^https?:\/\//i.test(l.href) ? l.href : l.href.startsWith("/") ? l.href : `/${l.href}`,
          })),
      ];
  const isExternal = (to: string) => /^https?:\/\//i.test(to);

  const socials = [
    { key: "instagram", label: "Instagram", icon: Camera, href: (v: string) => (v.startsWith("http") ? v : `https://instagram.com/${v.replace("@", "")}`) },
    { key: "facebook", label: "Facebook", icon: Share2, href: (v: string) => (v.startsWith("http") ? v : `https://facebook.com/${v}`) },
    { key: "tiktok", label: "TikTok", icon: Music2, href: (v: string) => (v.startsWith("http") ? v : `https://tiktok.com/@${v.replace("@", "")}`) },
    { key: "whatsapp", label: "WhatsApp", icon: MessageCircle, href: (v: string) => `https://wa.me/${v.replace(/[^0-9]/g, "")}` },
  ].filter((s) => (social[s.key] || "").trim());

  const hasPolicies = ["shipping", "returns", "privacy"].some((k) => (policies[k] || "").trim());
  const effectiveAnnouncement = announcement.enabled && announcement.text
    ? {
        text: announcement.text,
        href: announcement.href,
      }
    : null;

  return (
    <div className="min-h-screen bg-background text-foreground sf-body">
      {effectiveAnnouncement?.text && (
        <aside
          aria-label="Announcement"
          className="bg-primary text-primary-foreground text-xs py-2 px-4 text-center font-medium transition-colors"
        >
          {effectiveAnnouncement.href ? (
            <a href={effectiveAnnouncement.href} className="underline underline-offset-2 hover:opacity-90">
              {effectiveAnnouncement.text}
            </a>
          ) : (
            <span>{effectiveAnnouncement.text}</span>
          )}
        </aside>
      )}

      <header className="sticky top-0 z-50 backdrop-blur-xl bg-background/70 border-b border-border">
        <div className="max-w-7xl mx-auto flex items-center justify-between px-4 lg:px-8 py-4 gap-3">
          {/* Logo / brand */}
          <Link to={base} className="sf-display text-2xl lg:text-3xl tracking-tight inline-flex items-center gap-2 shrink-0">
            {storefront.logo_url ? (
              <img src={storefront.logo_url} alt={storefront.name} className="h-9 w-auto max-h-10 object-contain" />
            ) : (
              storefront.name.toUpperCase()
            )}
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-6 text-sm flex-1 justify-center">
            {nav.map((n) =>
              isExternal(n.to) ? (
                <a key={n.to} href={n.to} target="_blank" rel="noreferrer" className="hover:text-primary transition-colors text-foreground/80">
                  {n.label}
                </a>
              ) : (
                <Link
                  key={n.to}
                  to={n.to}
                  className={`hover:text-primary transition-colors ${loc.pathname === n.to ? "text-primary" : "text-foreground/80"}`}
                >
                  {n.label}
                </Link>
              ),
            )}
          </nav>

          {/* Right cluster */}
          <div className="flex items-center gap-1.5 shrink-0">
            {h.custom_icons.filter((c) => c.href).map((ic, i) => (
              <a key={i} href={ic.href} target="_blank" rel="noreferrer" className={ICON_STYLE} aria-label={ic.icon}>
                {ic.icon === "Phone" ? <Phone className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}
              </a>
            ))}
            <Link
              to={`${base}/cart`}
              className="relative inline-flex items-center gap-2 px-3 py-2 rounded-full border border-border hover:border-primary transition"
            >
              <ShoppingBag className="h-4 w-4" />
              <span className="text-sm hidden sm:inline">Cart</span>
              {count > 0 && (
                <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center">
                  {count}
                </span>
              )}
            </Link>
            <button
              type="button"
              className={`${ICON_STYLE} md:hidden`}
              onClick={() => setMenuOpen((o) => !o)}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
            >
              {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <nav className="md:hidden border-t border-border bg-background/95 backdrop-blur-xl">
            <div className="max-w-7xl mx-auto px-4 py-3 flex flex-col">
              {nav.map((n) =>
                isExternal(n.to) ? (
                  <a key={n.to} href={n.to} target="_blank" rel="noreferrer" className="py-3 text-sm uppercase tracking-widest text-foreground/80">
                    {n.label}
                  </a>
                ) : (
                  <Link
                    key={n.to}
                    to={n.to}
                    onClick={() => setMenuOpen(false)}
                    className={`py-3 text-sm uppercase tracking-widest ${loc.pathname === n.to ? "text-primary" : "text-foreground/80"}`}
                  >
                    {n.label}
                  </Link>
                ),
              )}
              {hasPolicies && (
                <Link
                  to={`${base}/policies`}
                  onClick={() => setMenuOpen(false)}
                  className="py-3 text-sm uppercase tracking-widest text-foreground/80"
                >
                  Policies
                </Link>
              )}
            </div>
          </nav>
        )}
      </header>

      <main className="relative">{children}</main>

      <footer className="border-t border-border mt-24">
        <div className="max-w-7xl mx-auto px-4 lg:px-8 py-12 grid md:grid-cols-3 gap-8">
          <div>
            <div className="sf-display text-xl mb-3">{storefront.name.toUpperCase()}</div>
            <p className="text-sm text-muted-foreground max-w-xs">{storefront.hero_subtitle}</p>
            {socials.length > 0 && (
              <div className="flex gap-3 mt-5">
                {socials.map((s) => {
                  const Icon = s.icon;
                  return (
                    <a
                      key={s.key}
                      href={s.href(social[s.key])}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={s.label}
                      className={ICON_STYLE}
                    >
                      <Icon className="h-4 w-4" />
                    </a>
                  );
                })}
              </div>
            )}
          </div>
          <div className="text-sm space-y-2">
            <div className="font-medium mb-2">Shop</div>
            {nav.map((n) => (
              <Link key={n.to} to={n.to} className="block text-muted-foreground hover:text-foreground">
                {n.label}
              </Link>
            ))}
            {hasPolicies && (
              <Link to={`${base}/policies`} className="block text-muted-foreground hover:text-foreground">
                Policies
              </Link>
            )}
          </div>
          <div className="text-sm space-y-2">
            <div className="font-medium mb-2">Contact</div>
            {storefront.contact_email && <div className="text-muted-foreground">{storefront.contact_email}</div>}
            {storefront.contact_phone && <div className="text-muted-foreground">{storefront.contact_phone}</div>}
          </div>
        </div>

        {h.show_footer_cta && (
          <div className="border-t border-border">
            <div className="max-w-7xl mx-auto px-4 lg:px-8 py-8 text-center">
              <p className="text-sm mb-2">Need help or want to chat before ordering?</p>
              <a href={`${base}/contact`} className="text-sm text-primary underline underline-offset-2">Contact us →</a>
            </div>
          </div>
        )}

        <div className="border-t border-border py-6 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} {storefront.name}. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
