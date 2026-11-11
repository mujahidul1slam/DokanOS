type RpcResult<T> = { data: T; error: { message: string } | null };

const FAILURE_LIMIT = 1000;
const SECRET_KEY = /(authorization|cookie|token|secret|password|credential|consumer_key|consumer_secret|body|request)/i;
const SECRET_TEXT = /((?:https?:\/\/[^\s?]+)[?&](?:[^\s=]*?(?:token|secret|password|key|credential|auth)[^\s=]*)=[^\s&]+)|((?:authorization|proxy-authorization|x-[^\s:]*token|x-api-key)\s*[:=]\s*(?:bearer\s+)?[^\s,;]+)|((?:bearer|basic)\s+[A-Za-z0-9+/=._-]+)/gi;

function sanitizeText(value: string): string {
  return value.replace(SECRET_TEXT, "[redacted]").replace(/\[object Object\]/g, "[unserializable_object]").slice(0, FAILURE_LIMIT);
}

function safeJson(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (key, nested) => {
      if (SECRET_KEY.test(key)) return "[redacted]";
      if (typeof nested === "string") return sanitizeText(nested);
      if (nested && typeof nested === "object") {
        if (seen.has(nested)) return "[circular]";
        seen.add(nested);
      }
      return nested;
    });
  } catch {
    return "";
  }
}

export function serializeWorkerFailure(cause: unknown): string {
  let result: string;
  if (cause instanceof Error) {
    const error = cause as Error & { code?: unknown; status?: unknown; details?: unknown; hint?: unknown };
    const metadata = { name: error.name, message: error.message, code: error.code, status: error.status, details: error.details, hint: error.hint };
    result = safeJson(metadata) || error.message;
  } else if (typeof cause === "string") {
    result = cause;
  } else {
    result = safeJson(cause) || String(cause);
  }
  return sanitizeText(result);
}

export function validateOutboundConfirmation(confirmation: unknown, targetStatus: string): void {
  if (!confirmation || typeof confirmation !== "object" || (confirmation as Record<string, unknown>).status !== targetStatus) {
    throw new Error("woocommerce_outbound_confirmation_mismatch");
  }
}

export type OutboundWriteUpdate = {
  error: { message?: string } | null;
  count?: number | null;
};

export function assertOutboundWritePersisted(result: OutboundWriteUpdate): void {
  if (result.error) {
    throw new Error(`woocommerce_outbound_persistence_failed: ${result.error.message ?? "unknown_error"}`);
  }
  if (result.count === 0) {
    throw new Error("woocommerce_outbound_persistence_failed: no_row_updated");
  }
}

export function validateFinishResult(result: RpcResult<unknown>): void {
  if (result.error) throw new Error(`woocommerce_finish_failed: ${sanitizeText(result.error.message)}`);
  if (result.data !== true) throw new Error("woocommerce_finish_failed");
}

export type { RpcResult };
