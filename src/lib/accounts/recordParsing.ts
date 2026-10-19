/** Shared defensive readers for untrusted PostgREST/RPC payloads. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function errorMessage(error: unknown): string {
  if (!isRecord(error)) return "";
  return typeof error.message === "string" ? error.message : "";
}

export function errorCode(error: unknown): string {
  if (!isRecord(error)) return "";
  return typeof error.code === "string" ? error.code : "";
}
