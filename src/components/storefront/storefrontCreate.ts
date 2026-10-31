/**
 * Task 14 (spec §6a step 6): the storefront creation pipeline behind the
 * shared sub-onboarding (name/slug → theme → payments → publish). One flow,
 * two entry points: the onboarding wizard's storefront step and the
 * Storefronts area's "create storefront" both run `createStorefrontFromForm`.
 */

import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import type { Json } from "@/integrations/supabase/types";
import type { Brand, Business } from "@/hooks/useBusinessContext";
import { hasStoreScope } from "@/hooks/useActiveBusinessStoreIds";
import { scaffoldStorefront, type SectionSnapshot } from "@/storefront/lib/pages";
import {
  buildStorefrontSettings,
  validateStorefrontSetup,
  type StorefrontSetupValues,
} from "./storefrontSetup";

export interface CreatedStorefront {
  id: string;
  name: string;
  slug: string;
}

const THEME_ACCENTS: Record<string, string> = {
  editorial: "#814037",
  cinematic: "#ffffff",
  minimal: "#000000",
  warm: "#b56149",
  nimbus: "#2563EB",
  saffron: "#C2410C",
};

/**
 * Publish the scaffolded Home page so "publish now" means the storefront is
 * actually visible (the anon runtime renders ONLY published snapshots; a
 * draft-only storefront shows the legacy layout). Best-effort, like scaffolding.
 */
async function publishScaffoldedHome(storefrontId: string): Promise<void> {
  const { data: home } = await supabase
    .from("storefront_pages")
    .select("id")
    .eq("storefront_id", storefrontId)
    .eq("slug", "home")
    .maybeSingle();
  if (!home) return;
  const { data: sections } = await supabase
    .from("storefront_page_sections")
    .select("type, position, is_visible, props")
    .eq("page_id", (home as { id: string }).id)
    .order("position");
  await supabase
    .from("storefront_pages")
    .update({
      status: "published",
      published_at: new Date().toISOString(),
      published_snapshot: ((sections ?? []) as SectionSnapshot[]) as unknown as Json,
    })
    .eq("id", (home as { id: string }).id);
}

export interface CreateStorefrontInput {
  values: StorefrontSetupValues;
  /** Picked brand id, or "__new" to create one named after the storefront. */
  brandChoice: string;
  businessId: string;
  business: Pick<Business, "currency"> | null;
  /** Brands of the business, with their legacy store link (store resolution). */
  brands: Pick<Brand, "id" | "name" | "woo_store_id">[];
  /** The active business's store scope (issue #16 — never unscoped reads). */
  businessStoreIds: string[];
}

/**
 * The full creation pipeline (fix D's brand picker + auto-create, issue #16's
 * fail-closed store resolution — same rules the old create dialog applied):
 * resolve/create the brand, resolve the store, insert the storefront with the
 * sub-onboarding's settings, scaffold starter pages, publish Home when asked.
 * Returns null on failure (errors are toasted here).
 */
export async function createStorefrontFromForm(
  input: CreateStorefrontInput,
): Promise<CreatedStorefront | null> {
  const { values, brandChoice, businessId, business, brands, businessStoreIds } = input;
  const invalid = validateStorefrontSetup(values);
  if (invalid) {
    toast({ title: invalid, variant: "destructive" });
    return null;
  }
  const name = values.name.trim();
  const slug = values.slug.trim();

  // Brand is the root container: use the picked existing brand, or create one.
  let brandId: string | null = null;
  if (businessId) {
    if (brandChoice !== "__new" && brands.some((b) => b.id === brandChoice)) {
      brandId = brandChoice;
    } else {
      const { data: brandRow, error: brandErr } = await supabase
        .from("brands")
        .insert({ name, slug, business_id: businessId })
        .select()
        .single();
      if (brandErr) {
        toast({ title: "Brand creation failed", description: brandErr.message, variant: "destructive" });
        return null;
      }
      brandId = (brandRow as { id: string } | null)?.id ?? null;
    }
  }

  // Scoped store resolution (issue #16): candidates must be within the active
  // business's store scope — never fall back to an unscoped stores read.
  let storeId: string | null = brands.find((b) => b.id === brandId)?.woo_store_id || null;
  if (!storeId) {
    const brandStoreIds = brands.map((b) => b.woo_store_id).filter(Boolean) as string[];
    const candidateIds =
      brandStoreIds.length > 0
        ? brandStoreIds.filter((id) => businessStoreIds.includes(id))
        : businessStoreIds;
    if (hasStoreScope(candidateIds)) {
      const { data: storeData } = await supabase
        .from("stores")
        .select("id")
        .in("id", candidateIds)
        .limit(1)
        .maybeSingle();
      storeId = (storeData as { id: string } | null)?.id || null;
    }
  }

  const { data, error } = await supabase
    .from("storefronts")
    .insert({
      name,
      slug,
      theme: values.theme,
      accent_hex: THEME_ACCENTS[values.theme] || "#000000",
      store_id: storeId,
      brand_id: brandId,
      currency: business?.currency ?? "BDT",
      settings: buildStorefrontSettings(values) as unknown as Json,
    })
    .select()
    .single();
  if (error || !data) {
    toast({
      title: "Failed to create",
      description: error?.message ?? "Unknown error",
      variant: "destructive",
    });
    return null;
  }

  const created = data as unknown as CreatedStorefront;
  try {
    await scaffoldStorefront(created.id, name, values.theme);
    if (values.publishNow) await publishScaffoldedHome(created.id);
  } catch {
    // Scaffolding/publishing is best-effort; pages can be finished in the admin.
  }
  toast({
    title: "Storefront created",
    description: values.publishNow
      ? `Live at /storefront/${slug} — starter pages were published.`
      : "Starter pages (Home, Contact) were created in draft.",
  });
  return created;
}
