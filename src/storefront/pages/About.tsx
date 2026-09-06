import { useBrand } from "../BrandContext";
import { Markdown } from "../lib/md";

export default function About() {
  const { storefront } = useBrand();
  return (
    <div className="max-w-3xl mx-auto px-4 py-24">
      <div className="text-xs uppercase tracking-[0.25em] text-primary mb-4">About</div>
      <h1 className="sf-display text-5xl mb-10">{storefront.name}</h1>
      <Markdown
        text={storefront.about_md || `${storefront.name} is a clothing house built on craft, restraint, and the belief that what you wear should outlive the season.`}
        className="text-lg text-foreground/85"
      />
    </div>
  );
}
