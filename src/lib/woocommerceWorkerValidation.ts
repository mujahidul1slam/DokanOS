type RpcResult<T> = { data: T; error: { message: string } | null };

const FAILURE_LIMIT = 1000;
const SECRET_KEY = /(authorization|cookie|token|secret|password|credential|consumer_key|consumer_secret|body|request)/i;
// Every alternation must consume the credential itself, not just the label in
// front of it. Two shapes were previously left in the clear:
//   "Authorization: Basic <base64>"  -> the optional "(?:bearer\s+)?" meant the
//      scheme was never consumed, so the match stopped after the word "Basic".
//   "?consumer_key=...&consumer_secret=..." -> the query group matched exactly
//      one parameter, because it had no repetition.
// The worker authenticates with `Authorization: Basic btoa(key:secret)`, and
// this text is persisted to last_error columns the operator UI reads back.
const SECRET_TEXT = new RegExp(
  [
    // A URL carrying credential query parameters — repeated so every parameter
    // is redacted, not just the first one.
    String.raw`(?:https?:\/\/[^\s?]+)(?:(?:[?&])[^\s=&#]*(?:token|secret|password|key|credential|auth)[^\s=&#]*=[^\s&#]+)+`,
    // An auth header line. The scheme is consumed together with its token so a
    // scheme other than "Bearer" cannot leave the credential behind.
    String.raw`(?:proxy-)?authorization\s*[:=]\s*(?:[A-Za-z][A-Za-z0-9_-]*\s+)?[^\s,;]+`,
    // Any x-* header whose name marks it as a credential.
    String.raw`x-[^\s:]*?(?:token|secret|key|auth)[^\s:]*\s*[:=]\s*[^\s,;]+`,
    // A bare scheme + credential, for a message that quotes only the value.
    String.raw`(?:bearer|basic)\s+[A-Za-z0-9+/=._-]+`,
  ].join("|"),
  "gi",
);

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
