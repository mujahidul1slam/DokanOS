import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useBrand } from "../BrandContext";
import { brandBasePath } from "../lib/brand";
import { getDraftPage, getPublishedPage, type PublishedPage } from "../lib/pages";
import PublishedPageView from "../sections/PublishedPageView";
import { usePageMeta } from "../lib/seo";
import { pageUrl } from "../lib/routes";

/** A builder page rendered at /pages/:slug (published only → 404 view). */
export default function CustomPage() {
  const { slug } = useParams();
  const { brand, storefront, draftPageSlug } = useBrand();
  const [data, setData] = useState<PublishedPage | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    if (draftPageSlug) {
      getDraftPage(storefront.id, draftPageSlug).then((d) => alive && setData(d));
      return () => {
        alive = false;
      };
    }
    if (!slug) {
      setData(null);
      return;
    }
    getPublishedPage(storefront.id, slug).then((d) => alive && setData(d));
    return () => {
      alive = false;
    };
  }, [storefront.id, slug, draftPageSlug]);

  usePageMeta({
    title: data?.seo?.title || (data ? `${data.page.title} — ${storefront.name}` : undefined),
    description: data?.seo?.description || undefined,
    canonicalPath: slug ? pageUrl(slug) : undefined,
  });

  if (data === undefined) {
    return (
      <div className="flex justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-32 text-center">
        <h1 className="sf-display text-4xl mb-4">Page not found</h1>
        <Link to={brandBasePath(brand)} className="text-sm underline underline-offset-4">
          Back to home
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="max-w-5xl mx-auto px-4 pt-16 text-center">
        <h1 className="sf-display text-4xl md:text-5xl">{data.page.title}</h1>
      </div>
      <PublishedPageView sections={data.sections} />
    </div>
  );
}
