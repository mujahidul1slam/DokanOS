import { useEffect, useState } from "react";
import { useBrand } from "../BrandContext";
import { Markdown } from "../lib/md";
import { getDraftPage, getPublishedPage, type PublishedPage } from "../lib/pages";
import PublishedPageView from "../sections/PublishedPageView";
import { usePageMeta } from "../lib/seo";

export default function About() {
  const { brand, storefront, draftPageSlug } = useBrand();
  const [page, setPage] = useState<PublishedPage | null | undefined>(draftPageSlug ? null : undefined);

  usePageMeta({
    title: page?.seo?.title || `About — ${storefront.name}`,
    description: page?.seo?.description || `Learn about ${storefront.name}`,
    canonicalPath: "/about",
  });

  useEffect(() => {
    let alive = true;
    if (draftPageSlug === "about") {
      getDraftPage(storefront.id, "about").then((d) => alive && setPage(d));
    } else if (!draftPageSlug) {
      getPublishedPage(storefront.id, "about").then((d) => alive && setPage(d));
    }
    return () => {
      alive = false;
    };
  }, [storefront.id, draftPageSlug]);

  // Published/draft builder page wins; legacy about_md fallback otherwise.
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

