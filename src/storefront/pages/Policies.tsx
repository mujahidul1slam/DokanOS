import { useEffect, useState } from "react";
import { useBrand } from "../BrandContext";
import { Markdown } from "../lib/md";
import { getDraftPage, getPublishedPage, type PublishedPage } from "../lib/pages";
import PublishedPageView from "../sections/PublishedPageView";
import { usePageMeta } from "../lib/seo";

interface PolicyShape {
  shipping?: string;
  returns?: string;
  privacy?: string;
}

export default function Policies() {
  const { storefront, draftPageSlug } = useBrand();
  const [page, setPage] = useState<PublishedPage | null | undefined>(draftPageSlug ? null : undefined);

  usePageMeta({
    title: page?.seo?.title || `Policies — ${storefront.name}`,
    description: page?.seo?.description || `Shipping, return, and privacy policies for ${storefront.name}`,
    canonicalPath: "/policies",
  });

  useEffect(() => {
    let alive = true;
    if (draftPageSlug === "policies") {
      getDraftPage(storefront.id, "policies").then((d) => alive && setPage(d));
    } else if (!draftPageSlug) {
      getPublishedPage(storefront.id, "policies").then((d) => alive && setPage(d));
    }
    return () => {
      alive = false;
    };
  }, [storefront.id, draftPageSlug]);

  // Published/draft builder page wins; legacy policies jsonb fallback otherwise.
  if (page && page.sections.length) {
    return (
      <div>
        <div className="max-w-5xl mx-auto px-4 pt-16 text-center">
          <h1 className="sf-display text-5xl">{page.page.title}</h1>
        </div>
        <PublishedPageView sections={page.sections} />
      </div>
    );
  }

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
