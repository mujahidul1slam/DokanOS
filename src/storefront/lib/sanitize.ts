/**
 * Strips HTML markup from merchant/imported text so the UI never prints
 * raw tags (Woo descriptions carry `<div class="...">` junk). Block-level
 * closing tags become line breaks; entities are decoded; whitespace is
 * collapsed. Safe for browser and Deno (no DOM APIs).
 */

const LT = "&" + "lt;";
const GT = "&" + "gt;";
const QUOT = "&" + "quot;";
const APOS = "&" + "apos;";
const AMP = "&" + "amp;";
const NBSP = "&" + "nbsp;";

export function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(new RegExp(NBSP, "gi"), " ")
    .replace(new RegExp(LT, "gi"), "<")
    .replace(new RegExp(GT, "gi"), ">")
    .replace(new RegExp(QUOT, "gi"), '"')
    .replace(new RegExp(APOS + "|&#x27;", "gi"), "'")
    .replace(new RegExp(AMP, "gi"), "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
