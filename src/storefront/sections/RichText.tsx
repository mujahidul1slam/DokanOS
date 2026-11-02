import { Markdown } from "../lib/md";
import type { SectionProps } from "./registry";

export default function RichText({ props }: { props: SectionProps }) {
  const title = props.title ? String(props.title) : "";
  const markdown = String(props.markdown || "");
  return (
    <section className="max-w-3xl mx-auto px-4 py-16">
      {title && <h2 className="sf-display text-3xl md:text-4xl mb-8">{title}</h2>}
      <Markdown text={markdown} className="text-foreground/85" />
    </section>
  );
}
