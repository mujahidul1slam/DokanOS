import { supabase } from "@/integrations/supabase/client";

export async function logAction(
  action: string,
  entityType: string,
  entityId?: string,
  details?: Record<string, unknown>
) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("audit_log" as any).insert({
      user_id: user?.id || null,
      user_email: user?.email || null,
      action,
      entity_type: entityType,
      entity_id: entityId || null,
      details: details || {},
    } as any);
  } catch (e) {
    console.warn("Audit log failed:", e);
  }
}
