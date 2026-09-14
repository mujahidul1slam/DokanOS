import type { SectionProps } from "./registry";

const HEIGHTS: Record<string, string> = {
  s: "h-48 md:h-64",
  m: "h-72 md:h-96",
  l: "h-[28rem] md:h-[36rem]",
};

export default function ImageBanner({ props }: { props: SectionProps }) {
  const height = HEIGHTS[String(props.height || "m")] || HEIGHTS.m;
  const overlay = Math.min(100, Math.max(0, Number(props.overlay ?? 20)));
  const href = String(props.href || "").trim();
  const inner = (
    <>
      {props.image_url && (
        <img src={String(props.image_url)} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}
      <div className="absolute inset-0 bg-background" style={{ opacity: overlay / 100 }} />
    </>
  );
  return (
    <section className="max-w-7xl mx-auto px-4 lg:px-8 py-10">
      <div className={`relative overflow-hidden sf-glass ${height}`}>
        {href ? (
          <a href={href} target={/^https?:\/\//i.test(href) ? "_blank" : undefined} rel="noreferrer" className="block h-full w-full">
            {inner}
          </a>
        ) : (
          inner
        )}
      </div>
    </section>
  );
}
