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

/**
 * Shallow-diff two objects and return only the fields that changed,
 * along with full before/after snapshots (changed fields only).
 *
 * Returns null when nothing changed.
 */
export function diffObjects<T extends Record<string, any>>(
  before: T | null | undefined,
  after: T | null | undefined,
  options: { ignore?: string[] } = {}
): {
  changes: Record<string, { from: unknown; to: unknown }>;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
} | null {
  const ignore = new Set(options.ignore ?? []);
  const b = before || ({} as T);
  const a = after || ({} as T);
  const keys = new Set<string>([...Object.keys(b), ...Object.keys(a)]);
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const beforeOut: Record<string, unknown> = {};
  const afterOut: Record<string, unknown> = {};

  for (const k of keys) {
    if (ignore.has(k)) continue;
    const bv = (b as any)[k];
    const av = (a as any)[k];
    // Treat null/undefined/"" as equivalent to reduce noise
    const norm = (v: unknown) => (v === undefined || v === null ? "" : v);
    const isEqual =
      typeof bv === "object" || typeof av === "object"
        ? JSON.stringify(bv ?? null) === JSON.stringify(av ?? null)
        : norm(bv) === norm(av);
    if (!isEqual) {
      changes[k] = { from: bv ?? null, to: av ?? null };
      beforeOut[k] = bv ?? null;
      afterOut[k] = av ?? null;
    }
  }

  if (Object.keys(changes).length === 0) return null;
  return { changes, before: beforeOut, after: afterOut };
}

/**
 * Convenience: log an "update" action with computed before/after diff.
 * Skips writing the audit entry entirely when nothing changed.
 */
export async function logChange<T extends Record<string, any>>(
  entityType: string,
  entityId: string | undefined,
  before: T | null | undefined,
  after: T | null | undefined,
  extra?: Record<string, unknown>,
  options: { ignore?: string[]; action?: string } = {}
) {
  const diff = diffObjects(before, after, { ignore: options.ignore });
  if (!diff) return;
  await logAction(options.action ?? "update", entityType, entityId, {
    ...(extra || {}),
    changes: diff.changes,
    before: diff.before,
    after: diff.after,
  });
}
