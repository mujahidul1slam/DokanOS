export type ReconciliationWindow = {
  start: string;
  end: string;
  watermarkBefore: string | null;
};

export type ReconciliationFailure = "auth" | "rate_limit" | "server" | "transport" | "permanent";

const OVERLAP_MINUTES = 10;
const MAX_RETRY_DELAY_MS = 15 * 60_000;

export function buildReconciliationWindow(
  watermark: string | null | undefined,
  now: string,
  overlapMinutes = OVERLAP_MINUTES,
): ReconciliationWindow {
  const endDate = new Date(now);
  if (Number.isNaN(endDate.getTime())) throw new Error("invalid_reconciliation_end");
  const watermarkDate = watermark ? new Date(watermark) : null;
  if (watermarkDate && Number.isNaN(watermarkDate.getTime())) throw new Error("invalid_reconciliation_watermark");
  const startDate = watermarkDate
    ? new Date(watermarkDate.getTime() - Math.max(0, overlapMinutes) * 60_000)
    : new Date(endDate.getTime() - 24 * 60 * 60_000);
  if (startDate >= endDate) throw new Error("reconciliation_window_not_forward");
  return {
    start: startDate.toISOString(),
    end: endDate.toISOString(),
    watermarkBefore: watermarkDate?.toISOString() ?? null,
  };
}

export function reconciliationRequestUrl(baseUrl: string, window: ReconciliationWindow): string {
  const url = new URL("/wp-json/wc/v3/orders", `${baseUrl.replace(/\/$/, "")}/`);
  url.search = new URLSearchParams({
    after: window.start,
    before: window.end,
    orderby: "modified",
    order: "asc",
    per_page: "100",
    page: "1",
  }).toString();
  return url.toString();
}

/** Parse RFC 5988 Link values while allowing link parameters and rel="prev next". */
export function nextWooPageUrl(responseUrl: string, linkHeader: string | null, configuredBaseUrl = responseUrl): string | null {
  if (!linkHeader) return null;
  const base = canonicalWooOrigin(configuredBaseUrl);
  for (const value of splitLinkHeader(linkHeader)) {
    const match = value.match(/^\s*<([^>]+)>\s*(?:;\s*(.*))?$/);
    if (!match) continue;
    const params = parseLinkParameters(match[2] ?? "");
    const rel = params.get("rel")?.split(/\s+/).map((item) => item.toLowerCase()) ?? [];
    if (!rel.includes("next")) continue;
    let next: URL;
    try { next = new URL(match[1], responseUrl); }
    catch { throw new Error("woocommerce_pagination_url_invalid"); }
    if (next.protocol !== "https:") throw new Error("woocommerce_pagination_https_required");
    if (next.hostname !== base.hostname || next.port !== base.port) throw new Error("woocommerce_pagination_origin_invalid");
    return next.toString();
  }
  return null;
}

function canonicalWooOrigin(value: string): URL {
  let url: URL;
  try { url = new URL(value.endsWith("/") ? value : `${value}/`); }
  catch { throw new Error("woocommerce_connector_url_invalid"); }
  if (url.protocol !== "https:") throw new Error("woocommerce_connector_https_required");
  return url;
}

function splitLinkHeader(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let quoted = false;
  let angleDepth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '"' && value[index - 1] !== "\\") quoted = !quoted;
    else if (!quoted && character === "<") angleDepth += 1;
    else if (!quoted && character === ">") angleDepth -= 1;
    else if (!quoted && angleDepth === 0 && character === ",") {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function parseLinkParameters(value: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const parameter of value.split(";")) {
    const separator = parameter.indexOf("=");
    if (separator < 0) continue;
    const key = parameter.slice(0, separator).trim().toLowerCase();
    const rawValue = parameter.slice(separator + 1).trim();
    result.set(key, rawValue.replace(/^"|"$/g, ""));
  }
  return result;
}

export function classifyReconciliationFailure(status: number | null): ReconciliationFailure {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status === null) return "transport";
  if (status >= 500) return "server";
  return "permanent";
}

export function retryDelayMs(attempt: number, random = Math.random()): number {
  const boundedAttempt = Math.max(1, Math.min(attempt, 8));
  const jitter = 0.75 + Math.max(0, Math.min(1, random)) * 0.5;
  return Math.round(Math.min(MAX_RETRY_DELAY_MS, 1_000 * 2 ** (boundedAttempt - 1)) * jitter);
}
