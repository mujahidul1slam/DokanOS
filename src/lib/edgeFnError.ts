/**
 * Extract the JSON error body from a supabase-js FunctionsHttpError.
 *
 * functions-js throws FunctionsHttpError(response) for non-2xx statuses and
 * leaves `data` null — the edge fn's {error, message} contract lives only on
 * the response body (error.context), which is readable once. Callers use
 * this to surface real error codes instead of the generic
 * "Edge Function returned a non-2xx status code".
 */
export async function readEdgeFnError(
  err: unknown
): Promise<{ error?: string; message?: string } | null> {
  const ctx = (err as { context?: Response } | null | undefined)?.context;
  if (!ctx || typeof ctx.json !== "function") return null;
  try {
    const body = await ctx.json();
    if (body && typeof body === "object") {
      return body as { error?: string; message?: string };
    }
    return null;
  } catch {
    return null;
  }
}
