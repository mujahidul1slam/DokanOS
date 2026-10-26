import { supabase } from "@/integrations/supabase/client";

/**
 * Runtime reader for published storefront pages (Phase 1 builder).
 *
 * The anon runtime reads ONLY storefront_pages — sections are parsed from the
 * page row's `published_snapshot` jsonb. It NEVER queries the
 * storefront_page_sections table (that table has no anon policy at all, H4;
 * the working copy is staff-only).
 */

export interface SectionSnapshot {
  type: string;
  position: number;
  is_visible: boolean;
  props: Record<string, any>;
}

export interface StorefrontPageRow {
  id: string;
  storefront_id: string;
  slug: string;
  title: string;
  type: "home" | "custom" | "landing";
  status: "draft" | "published";
  seo: { title?: string; description?: string; og_image_url?: string };
  published_snapshot: SectionSnapshot[] | null;
  published_at: string | null;
}

export interface PublishedPage {
  page: StorefrontPageRow;
  sections: SectionSnapshot[];
  seo?: { title?: string; description?: string; og_image_url?: string };
}

const PAGE_COLUMNS =
  "id,storefront_id,slug,title,type,status,seo,published_snapshot,published_at";

/** Normalize a published_snapshot jsonb array into ordered, typed sections. */
export function normalizeSnapshot(snapshot: unknown): SectionSnapshot[] {
  if (!Array.isArray(snapshot)) return [];
  return snapshot
    .filter((s: any): s is Record<string, any> => !!s && typeof s.type === "string")
    .map((s, i) => ({
      type: s.type,
      position: Number.isFinite(s.position) ? Number(s.position) : i,
      is_visible: s.is_visible !== false,
      props: s.props && typeof s.props === "object" ? s.props : {},
    }))
    .sort((a, b) => a.position - b.position);
}

/** Published page by slug (sections from published_snapshot) — anon-safe. */
export async function getPublishedPage(
  storefrontId: string,
  slug: string,
): Promise<PublishedPage | null> {
  const { data: page } = await supabase
    .from("storefront_pages")
    .select(PAGE_COLUMNS)
    .eq("storefront_id", storefrontId)
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();
  if (!page) return null;
  const row = page as unknown as StorefrontPageRow;
  return { page: row, sections: normalizeSnapshot(row.published_snapshot), seo: row.seo };
}

/** All published pages (nav / sitemap consumers). */
export async function listPublishedPages(storefrontId: string): Promise<StorefrontPageRow[]> {
  const { data } = await supabase
    .from("storefront_pages")
    .select(PAGE_COLUMNS)
    .eq("storefront_id", storefrontId)
    .eq("status", "published")
    .order("title", { ascending: true });
  return (data as unknown as StorefrontPageRow[]) || [];
}

/**
 * Draft/working-copy reader for the authenticated preview route. Uses the
 * admin client's staff session (RLS permits staff; an anon session would get
 * nothing back — the server-side enforcement is RLS, not this flag).
 */
export async function getDraftPage(storefrontId: string, slug: string): Promise<PublishedPage | null> {
  const { data: page } = await supabase
    .from("storefront_pages")
    .select(PAGE_COLUMNS)
    .eq("storefront_id", storefrontId)
    .eq("slug", slug)
    .maybeSingle();
  if (!page) return null;
  const row = page as unknown as StorefrontPageRow;
  const { data: sections } = await supabase
    .from("storefront_page_sections")
    .select("type, position, is_visible, props")
    .eq("page_id", row.id)
    .order("position", { ascending: true });
    return {
      page: row,
      sections: ((sections as unknown as SectionSnapshot[]) || []).map((s) => ({
        type: s.type,
        position: Number(s.position ?? 0),
        is_visible: s.is_visible !== false,
        props: (s.props && typeof s.props === "object" ? s.props : {}) as Record<string, any>,
      })),
      seo: row.seo,
    };
}

/**
 * Storefront initialization scaffolding (overhaul 3.3): create the essential
 * pages for a new storefront based on its theme — a Home page with themed
 * starter sections and a Contact page. Non-essential boilerplate is skipped.
 * Idempotent: skips pages that already exist.
 */
export async function scaffoldStorefront(storefrontId: string, name: string, theme: string): Promise<void> {
  const { data: existing } = await supabase
    .from("storefront_pages")
    .select("slug")
    .eq("storefront_id", storefrontId);
  const have = new Set((existing || []).map((r: any) => r.slug));

  // Themed starter hero copy per vertical (4.1 blueprints seed these too)
  const heroCopy: Record<string, { title: string; sub: string }> = {
    digital: { title: `Welcome to ${name}`, sub: "Instant downloads, clean catalog, zero waiting." },
    gadgets: { title: `Welcome to ${name}`, sub: "Specs, comparisons and the latest gear." },
    fashion: { title: `Welcome to ${name}`, sub: "New season. New fits. Lookbook inside." },
    food: { title: `Welcome to ${name}`, sub: "Fresh, fast and delivered to your door." },
  };
  const bp = heroCopy[themeToBlueprint(theme)] || { title: `Welcome to ${name}`, sub: `Explore the collection.` };

  if (!have.has("home")) {
    const { data: home } = await supabase
      .from("storefront_pages")
      .insert({ storefront_id: storefrontId, slug: "home", title: "Home", type: "home", status: "draft", is_active: true, seo: {} })
      .select()
      .single();
    if (home) {
      await supabase.from("storefront_page_sections").insert([
        { page_id: (home as any).id, type: "hero", position: 0, is_visible: true, props: { title: bp.title, subtitle: bp.sub } },
        { page_id: (home as any).id, type: "featured-products", position: 1, is_visible: true, props: {} },
      ]);
    }
  }

  if (!have.has("contact")) {
    await supabase
      .from("storefront_pages")
      .insert({ storefront_id: storefrontId, slug: "contact", title: "Contact", type: "custom", status: "draft", is_active: true, seo: {} });
  }
}

/** Map a theme preset key to its industry blueprint (overhaul 4.1). */
export function themeToBlueprint(theme: string): string {
  const t = (theme || "").toLowerCase();
  if (t.includes("saffron") || t.includes("food")) return "food";
  if (t.includes("nimbus") || t.includes("tech") || t.includes("gadget")) return "gadgets";
  if (t.includes("fashion") || t.includes("apparel") || t.includes("boutique")) return "fashion";
  if (t.includes("digital") || t.includes("download")) return "digital";
  return "fashion";
}
