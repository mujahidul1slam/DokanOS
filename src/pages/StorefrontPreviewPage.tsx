import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Loader2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import StorefrontApp from "@/storefront/StorefrontApp";
import type { Storefront } from "@/storefront/lib/brand";

/**
 * Admin draft preview (M3): /storefronts/preview/:slug/:pageSlug — inside the
 * authenticated routes block behind PermissionGuard("storefronts.view"). The
 * working copy is read through the staff client (RLS is the server-side
 * enforcement; an anon session would see nothing).
 */
export default function StorefrontPreviewPage() {
  const { slug, pageSlug } = useParams();
  const { user } = useAuth();
  const [sf, setSf] = useState<Storefront | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    if (!slug) {
      setSf(null);
      return;
    }
    supabase
      .from("storefronts")
      .select("*")
      .eq("slug", slug)
      .maybeSingle()
      .then(({ data }) => alive && setSf((data as unknown as Storefront) || null));
    return () => {
      alive = false;
    };
  }, [slug]);

  if (sf === undefined) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (!sf) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-32 text-center text-muted-foreground">
        Storefront not found.
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] overflow-auto bg-background text-foreground">
      <div className="sticky top-0 z-50 flex items-center justify-between gap-3 border-b border-border bg-background/95 px-4 py-2 backdrop-blur">
        <span className="text-xs uppercase tracking-widest text-muted-foreground">
          Draft preview — {sf.name} / {pageSlug}
          {user?.email ? ` · ${user.email}` : ""}
        </span>
        <Link
          to="/storefronts"
          className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs hover:border-primary"
        >
          <X className="h-3 w-3" /> Exit preview
        </Link>
      </div>
      <StorefrontApp
        brand={sf.slug}
        basePath={`/storefront/${sf.slug}`}
        storefrontOverride={sf}
        draftPageSlug={pageSlug || "home"}
      />
    </div>
  );
}
