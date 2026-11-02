import type { SectionProps } from "./registry";

export default function Gallery({ props }: { props: SectionProps }) {
  const images: { url?: string; alt?: string }[] = Array.isArray(props.images)
    ? props.images.filter((i: any) => i && typeof i.url === "string" && i.url)
    : [];
  if (!images.length) return null;

  return (
    <section className="max-w-7xl mx-auto px-4 lg:px-8 py-16">
      {props.title ? (
        <div className="mb-10">
          <h2 className="sf-display text-3xl md:text-4xl">{String(props.title)}</h2>
        </div>
      ) : null}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 lg:gap-4">
        {images.map((img, i) => (
          <div key={i} className="sf-glass overflow-hidden aspect-square bg-muted">
            <img src={img.url!} alt={img.alt || ""} loading="lazy" className="h-full w-full object-cover" />
          </div>
        ))}
      </div>
    </section>
  );
}
