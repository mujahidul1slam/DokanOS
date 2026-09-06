import { useBrand } from "../BrandContext";
import { Markdown } from "../lib/md";

interface PolicyShape {
  shipping?: string;
  returns?: string;
  privacy?: string;
}

export default function Policies() {
  const { storefront } = useBrand();
  const p = (storefront.policies || {}) as PolicyShape;

  const sections = [
    { id: "shipping", title: "Shipping", body: p.shipping },
    { id: "returns", title: "Returns & exchanges", body: p.returns },
    { id: "privacy", title: "Privacy", body: p.privacy },
  ].filter((s) => (s.body || "").trim());

  return (
    <div className="max-w-3xl mx-auto px-4 py-20">
      <div className="text-xs uppercase tracking-[0.25em] text-primary mb-4">Policies</div>
      <h1 className="sf-display text-5xl mb-12">{storefront.name}</h1>
      {sections.length === 0 ? (
        <p className="text-muted-foreground">
          Policies haven&apos;t been published yet. Contact us if you have any questions.
        </p>
      ) : (
        <div className="space-y-12">
          {sections.map((s) => (
            <section key={s.id} id={s.id}>
              <h2 className="sf-display text-2xl mb-4 pb-2 border-b border-border">{s.title}</h2>
              <Markdown text={s.body || ""} className="text-foreground/85" />
            </section>
          ))}
        </div>
      )}
    </div>
  );
}