import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { SectionProps } from "./registry";

export default function Faq({ props }: { props: SectionProps }) {
  const items: { q?: string; a?: string }[] = Array.isArray(props.items)
    ? props.items.filter((i: any) => i && typeof i.q === "string" && i.q.trim())
    : [];
  const [open, setOpen] = useState<number | null>(null);
  if (!items.length) return null;

  return (
    <section className="max-w-3xl mx-auto px-4 py-16">
      {props.title ? (
        <div className="mb-10">
          <h2 className="sf-display text-3xl md:text-4xl">{String(props.title)}</h2>
        </div>
      ) : null}
      <div className="divide-y divide-border border border-border rounded-xl overflow-hidden">
        {items.map((item, i) => (
          <div key={i}>
            <button
              type="button"
              onClick={() => setOpen(open === i ? null : i)}
              className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-muted/40 transition"
              aria-expanded={open === i}
            >
              <span className="font-medium">{item.q}</span>
              <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open === i ? "rotate-180" : ""}`} />
            </button>
            {open === i && (
              <div className="px-5 pb-5 text-sm text-muted-foreground whitespace-pre-line">{item.a}</div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
