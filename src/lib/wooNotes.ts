import { supabase } from "@/integrations/supabase/client";

/**
 * Kick the sync-worker immediately so queue rows created by a user action are
 * drained within seconds instead of waiting for the (throttled-to-4.5h on this
 * repo) GitHub Actions schedule. Fire-and-forget by design: the queue itself
 * is durable — this only makes delivery fast. Safe to call repeatedly; the
 * claim RPC's SKIP LOCKED means concurrent drains never double-process.
 */
export async function kickSyncWorker(): Promise<void> {
  try {
    await supabase.functions.invoke("sync-worker", { body: {} });
  } catch {
    /* fire-and-forget; the cron fallback still drains the queue */
  }
}

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
