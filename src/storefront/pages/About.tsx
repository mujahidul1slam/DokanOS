import { useBrand } from "../BrandContext";

export default function About() {
  const { storefront } = useBrand();
  return (
    <div className="max-w-3xl mx-auto px-4 py-24">
      <div className="text-xs uppercase tracking-[0.25em] text-primary mb-4">About</div>
      <h1 className="sf-display text-5xl mb-10">{storefront.name}</h1>
      <div className="prose prose-lg max-w-none text-foreground/85 leading-relaxed whitespace-pre-line">
        {storefront.about_md || `${storefront.name} is a clothing house built on craft, restraint, and the belief that what you wear should outlive the season.`}
      </div>
    </div>
  );
}
