import { supabase } from "@/integrations/supabase/client";
import { postWooOrderNote } from "@/lib/wooNotes";

export interface TimelineMetadata {
  [key: string]: unknown;
  // Set to true to skip mirroring this entry to the WooCommerce order notes timeline.
  skip_woo_note?: boolean;
  // Set to true to mark the mirrored Woo note as a customer-visible note.
  woo_customer_note?: boolean;
}

/**
 * Insert one or more order_timeline entries with the current user attached
 * to metadata so the UI can show "by <user>" attribution.
 *
 * Use this everywhere on the client instead of calling supabase.from("order_timeline").insert(...)
 * directly so that user attribution is consistent.
 */
export async function addOrderTimeline(
  entries:
    | { order_id: string; event: string; description: string; metadata?: TimelineMetadata }
    | Array<{ order_id: string; event: string; description: string; metadata?: TimelineMetadata }>
) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    const meta = user?.user_metadata as Record<string, unknown> | undefined;
    const userName = (typeof meta?.full_name === "string" ? meta.full_name : null) ?? user?.email ?? null;
    const userInfo: Record<string, string | null> = {
      user_id: user?.id ?? null,
      user_email: user?.email ?? null,
      user_name: userName,
    };

    const arr = Array.isArray(entries) ? entries : [entries];
    const rows = arr.map((e) => ({
      order_id: e.order_id,
      event: e.event,
      description: e.description,
      metadata: { ...userInfo, ...(e.metadata || {}) },
    }));

    const { error } = await supabase.from("order_timeline").insert(rows as any);
    if (error) console.warn("addOrderTimeline failed:", error.message);
  } catch (e) {
    console.warn("addOrderTimeline failed:", e);
  }
}
