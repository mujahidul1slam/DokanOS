import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useBrand } from "../BrandContext";
import { listCollections, type StorefrontCollection } from "../lib/collections";
import { collectionUrl } from "../lib/routes";
import type { SectionProps } from "./registry";

export default function CollectionGrid({ props }: { props: SectionProps }) {
  const { brand, storefront } = useBrand();
  const [collections, setCollections] = useState<StorefrontCollection[] | null>(null);

  useEffect(() => {
    listCollections(storefront.id).then((all) => {
      const ids: string[] = Array.isArray(props.collection_ids)
        ? props.collection_ids.filter((i: any) => typeof i === "string")
        : [];
      const picked = ids.length ? all.filter((c) => ids.includes(c.id)) : all;
      setCollections(picked);
    });
  }, [storefront.id, props.collection_ids]);

  const columns = [2, 3, 4].includes(Number(props.columns)) ? Number(props.columns) : 3;
  const colClass = columns === 2 ? "grid-cols-2" : columns === 3 ? "grid-cols-2 lg:grid-cols-3" : "grid-cols-2 lg:grid-cols-4";

  if (collections === null) return null;
  if (!collections.length) return null; // empty state until collections exist (Phase 2 data)

  return (
    <section className="max-w-7xl mx-auto px-4 lg:px-8 py-16">
      {props.title ? (
        <div className="mb-10">
          <h2 className="sf-display text-3xl md:text-4xl">{String(props.title)}</h2>
        </div>
      ) : null}
      <div className={`grid ${colClass} gap-4 lg:gap-6`}>
        {collections.map((c) => (
          <Link
            key={c.id}
            to={collectionUrl(brand, c.slug)}
            className="group sf-glass p-8 flex flex-col items-center justify-center text-center min-h-[10rem] transition hover:-translate-y-1 hover:shadow-2xl duration-500"
          >
            <span className="sf-display text-2xl">{c.title}</span>
            {c.description ? (
              <span className="text-sm text-muted-foreground mt-2 line-clamp-2">{c.description}</span>
            ) : null}
          </Link>
        ))}
      </div>
    </section>
  );
}
