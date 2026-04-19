import { supabase } from "@/integrations/supabase/client";

/**
 * Posts a note to the WooCommerce order's notes timeline.
 * Silently no-ops if the order is not linked to a Woo store.
 */
export async function postWooOrderNote(orderId: string, note: string, customerNote = false) {
  try {
    await supabase.functions.invoke("woo-push", {
      body: { action: "post_note", order_id: orderId, note, customer_note: customerNote },
    });
  } catch (e) {
    console.warn("postWooOrderNote failed:", e);
  }
}
