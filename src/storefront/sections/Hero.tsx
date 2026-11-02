import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { brandBasePath } from "../lib/brand";
import { useBrand } from "../BrandContext";
import type { SectionProps } from "./registry";

export default function Hero({ props }: { props: SectionProps }) {
  const { brand } = useBrand();
  const overlay = Math.min(100, Math.max(0, Number(props.overlay ?? 30)));
  const align = props.align === "left" ? "text-left" : "text-center";
  const rawHref = String(props.cta_href || "").trim();
  const isExternal = /^https?:\/\//i.test(rawHref);
  const ctaTo = rawHref && !isExternal ? `${brandBasePath(brand)}${rawHref.startsWith("/") ? rawHref : `/${rawHref}`}` : "";

  const label = props.cta_label ? String(props.cta_label) : "";

  return (
    <section className="relative">
      {props.image_url && (
        <>
          <img
            src={String(props.image_url)}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div
            className="absolute inset-0 bg-background"
            style={{ opacity: overlay / 100 }}
          />
        </>
      )}
      <div className={`relative max-w-5xl mx-auto px-4 py-24 lg:py-32 flex flex-col ${align === "text-left" ? "items-start" : "items-center"} ${align}`}>
        <h1 className="sf-display text-5xl md:text-7xl mb-6">{String(props.title || "")}</h1>
        {props.subtitle ? (
          <p className="text-lg text-muted-foreground max-w-xl mb-10 leading-relaxed">{String(props.subtitle)}</p>
        ) : null}
        {(label || ctaTo || isExternal) && (
          isExternal ? (
            <a
              href={rawHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-3 px-7 py-4 rounded-full bg-primary text-primary-foreground hover:opacity-90 transition"
            >
              <span className="text-sm uppercase tracking-widest">{label || "Shop"}</span>
              <ArrowRight className="h-4 w-4" />
            </a>
          ) : (
            <Link
              to={ctaTo || `${brandBasePath(brand)}/shop`}
              className="inline-flex items-center gap-3 px-7 py-4 rounded-full bg-primary text-primary-foreground hover:opacity-90 transition"
            >
              <span className="text-sm uppercase tracking-widest">{label || "Shop"}</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          )
        )}
      </div>
    </section>
  );
}
