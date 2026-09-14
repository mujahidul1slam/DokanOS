import type { SectionProps } from "./registry";

export default function Testimonials({ props }: { props: SectionProps }) {
  const items: { quote?: string; author?: string; role?: string }[] = Array.isArray(props.items)
    ? props.items.filter((i: any) => i && typeof i.quote === "string" && i.quote.trim())
    : [];
  if (!items.length) return null;

  return (
    <section className="max-w-7xl mx-auto px-4 lg:px-8 py-16">
      {props.title ? (
        <div className="mb-10">
          <h2 className="sf-display text-3xl md:text-4xl">{String(props.title)}</h2>
        </div>
      ) : null}
      <div className="grid md:grid-cols-3 gap-4 lg:gap-6">
        {items.map((t, i) => (
          <figure key={i} className="sf-glass p-6">
            <blockquote className="text-foreground/85 leading-relaxed">“{t.quote}”</blockquote>
            <figcaption className="mt-4 text-sm text-muted-foreground">
              {t.author}
              {t.role ? <span className="text-muted-foreground/70"> · {t.role}</span> : null}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
