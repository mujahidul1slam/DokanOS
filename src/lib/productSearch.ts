/**
 * Pure product-search core — issue #33 ("Patch B: fuzzy product search upgrade").
 *
 * Reusable by all product search surfaces (Add Order picker, Add Order search
 * field, POS catalog). No React, no Fuse, no I/O: callers hand in product and
 * variation rows and get back ranked matches. AI/semantic search is explicitly
 * OUT OF SCOPE (deferred to its own spec) — this module only does lexical
 * fuzzy matching.
 *
 * What this replaces (the old Fuse `threshold: 0.4, name/sku/barcode` search):
 *
 * - **Exact SKU/barcode short-circuit (scanners kept).** When the query equals
 *   a product or variation SKU/barcode (case-, spacing- and punctuation-
 *   insensitive), ONLY exact-code matches are returned, ranked with
 *   product-level codes first. Barcode scanners keep working exactly as today.
 * - **Bangla <-> Latin transliteration tolerance.** Both sides are folded into
 *   the same Latin space using the transliteration approach from
 *   `src/lib/pathaoMatch.ts` (Bangla → Latin + Bangla digits). A Bangla query
 *   matches an English product name and vice versa; residual transliteration
 *   variance ("শার্ট" → "shart" vs "shirt") is absorbed by the fuzzy tier.
 * - **Partial-word matching.** Query tokens match word prefixes and mid-word
 *   fragments ("panj" → "Panjabi", "hirt" → "T-Shirt"), with multi-word
 *   queries requiring every token to match (AND semantics, order-free).
 * - **Typo tolerance.** Bounded edit distance (optimal string alignment, so
 *   transpositions like "shrit" → "shirt" cost 1) with per-token budgets that
 *   grow with query length. Short tokens (< 4 chars) never fuzzy-match, which
 *   keeps the old `minMatchCharLength: 2` noise floor.
 * - **Variation attribute text.** Variation names, parsed attribute
 *   name/option pairs and variation SKUs/barcodes are searchable, so "blue xl"
 *   finds a product whose *name* says nothing about blue or XL. Matches report
 *   `matchedVariationIds` so UIs can jump straight to the right variation.
 * - **Ranked, looser matching.** Instead of one threshold, matches fall into
 *   explicit tiers (exact code > exact name > name prefix > word > substring >
 *   code fragment > variation text > fuzzy) and are ordered by tier, match
 *   quality, then shorter name, then name/id for deterministic ties.
 *
 * Empty / whitespace / punctuation-only queries return `[]`; surfaces treat
 * "no query" as "unfiltered list" themselves (same as the current screens).
 *
 * The Bangla transliteration table is duplicated from `pathaoMatch.ts` on
 * purpose: that module does not export it and this issue owns neither editing
 * it nor reshaping its API. If a third consumer appears, extract a shared
 * `bangla.ts`.
 */

import { getProductVariations, parseVariationAttributes } from "./variations";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Minimal product shape the searcher needs; extra fields are preserved. */
export interface SearchableProduct {
  id: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
}

/** Minimal variation shape the searcher needs; `attributes` is the jsonb column. */
export interface SearchableVariation {
  id: string;
  product_id?: string | null;
  name?: string | null;
  sku?: string | null;
  barcode?: string | null;
  attributes?: unknown;
}

/**
 * The tier a match landed in. Ordered strongest → weakest; see TIER scores.
 * - `exact-code`  — query equals a SKU/barcode (scanner short-circuit)
 * - `exact-name`  — query equals the full product name
 * - `name-prefix` — full name starts with the query
 * - `word`        — every query token is a whole word / word prefix in the name
 * - `substring`   — query (or every token) appears mid-word in the name
 * - `code`        — every query token is a fragment of a SKU/barcode
 * - `variation`   — matched via variation name / attribute text
 * - `fuzzy`       — typo-tolerant edit-distance fallback
 */
export type MatchKind =
  | "exact-code"
  | "exact-name"
  | "name-prefix"
  | "word"
  | "substring"
  | "code"
  | "variation"
  | "fuzzy";

export interface ProductMatch<TProduct extends SearchableProduct = SearchableProduct> {
  product: TProduct;
  kind: MatchKind;
  /** Higher is better. Comparable only within one result set. */
  score: number;
  /** Variations whose code/text produced the match (empty when the name drove it). */
  matchedVariationIds: string[];
}

export interface ProductSearchOptions {
  /** Max results after ranking. Omit for "all matches". */
  limit?: number;
}

export interface IndexedVariation {
  id: string;
  tokens: string[];
  codeCompacts: string[];
}

export interface ProductIndexEntry<TProduct extends SearchableProduct = SearchableProduct> {
  product: TProduct;
  nameCompact: string;
  nameTokens: string[];
  codes: Array<{ compact: string; variationId: string | null }>;
  variations: IndexedVariation[];
  /** name + variation tokens — the fuzzy/variation search space. */
  textTokens: string[];
}

/** Derived data from {@link buildProductIndex}; treat as read-only. */
export interface ProductIndex<TProduct extends SearchableProduct = SearchableProduct> {
  entries: ProductIndexEntry<TProduct>[];
}

// ---------------------------------------------------------------------------
// Normalization: Bangla → Latin folding (approach reused from pathaoMatch.ts)
// ---------------------------------------------------------------------------

const BANGLA_DIGITS: Record<string, string> = {
  "০": "0", "১": "1", "২": "2", "৩": "3", "৪": "4",
  "৫": "5", "৬": "6", "৭": "7", "৮": "8", "৯": "9",
};

// Order matters: multi-char clusters first so they're consumed before
// individual characters. Values use common Banglish spellings so transliterated
// Bangla lands near Latin product-name spellings ("শার্ট" → "shart" ≈ "shirt").
const BANGLA_MAP: Array<[string, string]> = [
  // Conjuncts / common clusters
  ["ক্ষ", "kkh"], ["জ্ঞ", "ggo"], ["ঞ্চ", "nch"], ["ঞ্ছ", "nch"], ["ঞ্জ", "nj"],
  ["ঙ্ক", "nk"], ["ঙ্গ", "ng"], ["ন্দ", "nd"], ["ন্ধ", "ndh"], ["ন্ত", "nt"],
  ["ম্প", "mp"], ["ম্ব", "mb"], ["ম্ম", "mm"], ["ত্ত", "tt"], ["দ্দ", "dd"],
  ["ত্র", "tr"], ["প্র", "pr"], ["ক্র", "kr"], ["গ্র", "gr"], ["ব্র", "br"],
  ["শ্র", "shr"], ["স্ত", "st"], ["স্থ", "sth"], ["ষ্ট", "sht"], ["ষ্ঠ", "shth"],
  ["ট্ট", "tt"], ["দ্ব", "dw"], ["চ্চ", "cch"], ["চ্ছ", "chh"], ["জ্জ", "jj"],
  // Vowels (independent)
  ["আ", "a"], ["ই", "i"], ["ঈ", "i"], ["উ", "u"], ["ঊ", "u"],
  ["ঋ", "ri"], ["এ", "e"], ["ঐ", "oi"], ["ও", "o"], ["ঔ", "ou"], ["অ", "o"],
  // Vowel signs (kar)
  ["া", "a"], ["ি", "i"], ["ী", "i"], ["ু", "u"], ["ূ", "u"],
  ["ৃ", "ri"], ["ে", "e"], ["ৈ", "oi"], ["ো", "o"], ["ৌ", "ou"],
  // Consonants
  ["ক", "k"], ["খ", "kh"], ["গ", "g"], ["ঘ", "gh"], ["ঙ", "ng"],
  ["চ", "ch"], ["ছ", "chh"], ["জ", "j"], ["ঝ", "jh"], ["ঞ", "n"],
  ["ট", "t"], ["ঠ", "th"], ["ড", "d"], ["ঢ", "dh"], ["ণ", "n"],
  ["ত", "t"], ["থ", "th"], ["দ", "d"], ["ধ", "dh"], ["ন", "n"],
  ["প", "p"], ["ফ", "ph"], ["ব", "b"], ["ভ", "bh"], ["ম", "m"],
  ["য", "y"], ["র", "r"], ["ল", "l"], ["শ", "sh"], ["ষ", "sh"],
  ["স", "s"], ["হ", "h"], ["ড়", "r"], ["ঢ়", "rh"], ["য়", "y"],
  ["ৎ", "t"], ["ং", "ng"], ["ঃ", "h"], ["ঁ", ""], ["্", ""],
];

const hasBangla = (v: string) => /[\u0980-\u09FF]/.test(v);

const transliterateBangla = (input: string): string => {
  if (!hasBangla(input)) return input;
  let out = "";
  let i = 0;
  while (i < input.length) {
    const digit = BANGLA_DIGITS[input[i]];
    if (digit) { out += digit; i += 1; continue; }
    let matched = false;
    for (const [src, tgt] of BANGLA_MAP) {
      if (src.length > 1 && input.startsWith(src, i)) {
        out += tgt; i += src.length; matched = true; break;
      }
    }
    if (matched) continue;
    const ch = input[i];
    const single = BANGLA_MAP.find(([s]) => s === ch);
    if (single) { out += single[1]; i += 1; continue; }
    out += ch; i += 1;
  }
  return out;
};

/**
 * Canonical search text: Bangla transliterated to Latin, lowercased, digits
 * Latinized, punctuation collapsed to single spaces.
 * `normalizeSearchText("T-Shirt (Blue)")` → `"t shirt blue"`.
 */
export function normalizeSearchText(input: string): string {
  if (typeof input !== "string" || !input) return "";
  const latin = hasBangla(input) ? transliterateBangla(input) : input;
  return latin.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** {@link normalizeSearchText} split into non-empty tokens. */
export function tokenizeSearchText(input: string): string[] {
  const n = normalizeSearchText(input);
  return n ? n.split(" ") : [];
}

/** Normalized text with spaces removed — spacing/punctuation-insensitive compare. */
const compactText = (input: string): string => normalizeSearchText(input).replace(/ /g, "");

// ---------------------------------------------------------------------------
// Similarity primitives
// ---------------------------------------------------------------------------

/** Optimal string alignment distance (Levenshtein + adjacent transpositions). */
const osaDistance = (a: string, b: string): number => {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const d: number[][] = [];
  for (let i = 0; i <= m; i++) d[i] = [i];
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
};

/** Allowed edit distance for a token of the given length (0 for short tokens). */
const fuzzyBudget = (len: number): number => {
  if (len <= 3) return 0;
  if (len <= 5) return 1;
  if (len <= 7) return 2;
  return Math.floor(len * 0.34);
};

const fuzzyQuality = (qTok: string, dTok: string): number => {
  if (qTok.length < 4) return 0;
  const budget = fuzzyBudget(qTok.length);
  if (Math.abs(qTok.length - dTok.length) > budget) return 0;
  const d = osaDistance(qTok, dTok);
  if (d > budget) return 0;
  return 0.5 - 0.12 * d;
};

/** Exact 1 > word-prefix 0.85 > mid-word substring 0.7 > fuzzy 0..0.5 > none 0. */
const tokenQuality = (qTok: string, dTok: string): number => {
  if (!qTok || !dTok) return 0;
  if (qTok === dTok) return 1;
  if (qTok.length >= 2 && dTok.startsWith(qTok)) return 0.85;
  if (qTok.length >= 3 && dTok.includes(qTok)) return 0.7;
  return fuzzyQuality(qTok, dTok);
};

/** {@link tokenQuality} without the fuzzy fallback (used for tier decisions). */
const hardTokenQuality = (qTok: string, dTok: string): number => {
  if (!qTok || !dTok) return 0;
  if (qTok === dTok) return 1;
  if (qTok.length >= 2 && dTok.startsWith(qTok)) return 0.85;
  if (qTok.length >= 3 && dTok.includes(qTok)) return 0.7;
  return 0;
};

const bestQuality = (qTok: string, docTokens: string[], hardOnly: boolean): number => {
  let best = 0;
  for (const dTok of docTokens) {
    const q = hardOnly ? hardTokenQuality(qTok, dTok) : tokenQuality(qTok, dTok);
    if (q > best) best = q;
    if (best === 1) break;
  }
  return best;
};

/** Code fragments are matched inside the compact code (2+ chars), no fuzzy. */
const codeTokenQuality = (qTok: string, codeCompact: string): number => {
  if (!qTok || !codeCompact) return 0;
  if (codeCompact === qTok) return 1;
  if (qTok.length >= 2 && codeCompact.startsWith(qTok)) return 0.85;
  if (qTok.length >= 2 && codeCompact.includes(qTok)) return 0.7;
  return 0;
};

const mean = (values: number[]): number => {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
};

// ---------------------------------------------------------------------------
// Tier scores (higher = better; + up to 900 quality bonus, +500 own-code)
// ---------------------------------------------------------------------------

const TIER = {
  EXACT_CODE: 100000,
  EXACT_NAME: 90000,
  NAME_PREFIX: 80000,
  WORD: 70000,
  SUBSTRING: 60000,
  CODE: 50000,
  VARIATION: 40000,
  FUZZY: 30000,
} as const;

// ---------------------------------------------------------------------------
// Indexing
// ---------------------------------------------------------------------------

const asString = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * Precompute normalized text for repeated searches (e.g. every keystroke).
 * Variations link to products via `product_id`, trimmed and case-insensitive —
 * the same rule as `getProductVariations` in `./variations`.
 */
export function buildProductIndex<
  TProduct extends SearchableProduct,
  TVariation extends SearchableVariation = SearchableVariation,
>(
  products: readonly TProduct[],
  variations?: readonly TVariation[] | null,
): ProductIndex<TProduct> {
  const productList = Array.isArray(products) ? products : [];
  const variationList = Array.isArray(variations) ? variations : [];

  const entries = productList.map((product) => {
    const nameTokens = tokenizeSearchText(asString(product?.name));
    const codes: Array<{ compact: string; variationId: string | null }> = [];
    const addCode = (value: unknown, variationId: string | null) => {
      const compact = compactText(asString(value));
      if (compact) codes.push({ compact, variationId });
    };
    addCode(product?.sku, null);
    addCode(product?.barcode, null);

    const indexedVariations: IndexedVariation[] = [];
    const variationTokenList: string[] = [];
    for (const v of getProductVariations(product?.id, variationList)) {
      const parsed = parseVariationAttributes(v?.attributes);
      const attrText = parsed.map((a) => `${a.name} ${a.option}`).join(" ");
      const rawAttrText = typeof v?.attributes === "string" ? v.attributes : "";
      const tokens = tokenizeSearchText([asString(v?.name), rawAttrText, attrText].join(" "));
      const variationId = asString(v?.id);
      const codeCompacts: string[] = [];
      for (const value of [v?.sku, v?.barcode]) {
        const compact = compactText(asString(value));
        if (!compact) continue;
        codeCompacts.push(compact);
        codes.push({ compact, variationId: variationId || null });
      }
      if (variationId) indexedVariations.push({ id: variationId, tokens, codeCompacts });
      variationTokenList.push(...tokens);
    }

    return {
      product,
      nameCompact: nameTokens.join(""),
      nameTokens,
      codes,
      variations: indexedVariations,
      textTokens: [...nameTokens, ...variationTokenList],
    };
  });

  return { entries };
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

const variationsMatching = (
  entry: ProductIndexEntry<any>,
  tokens: string[],
  minQuality: number,
): string[] => {
  const out: string[] = [];
  for (const variation of entry.variations) {
    const space = [...entry.nameTokens, ...variation.tokens, ...variation.codeCompacts];
    const all = tokens.every((t) => bestQuality(t, space, minQuality >= 0.7) >= minQuality);
    if (all) out.push(variation.id);
  }
  return out;
};

const matchEntry = <TProduct extends SearchableProduct>(
  entry: ProductIndexEntry<TProduct>,
  compactQ: string,
  tokens: string[],
): ProductMatch<TProduct> | null => {
  const { product } = entry;

  const make = (
    kind: MatchKind,
    tier: number,
    quality: number,
    matchedVariationIds: string[],
    bonus = 0,
  ): ProductMatch<TProduct> => ({
    product,
    kind,
    score: tier + Math.round(Math.min(1, Math.max(0, quality)) * 900) + bonus,
    matchedVariationIds,
  });

  // 1) Exact SKU/barcode — scanner short-circuit. Product-level codes outrank
  //    variation-level ones so a scanned product code surfaces the product row.
  const exactVariationIds: string[] = [];
  let ownCodeExact = false;
  for (const code of entry.codes) {
    if (!code.compact || code.compact !== compactQ) continue;
    if (code.variationId) {
      if (!exactVariationIds.includes(code.variationId)) exactVariationIds.push(code.variationId);
    } else {
      ownCodeExact = true;
    }
  }
  if (ownCodeExact || exactVariationIds.length > 0) {
    return make("exact-code", TIER.EXACT_CODE, 1, exactVariationIds, ownCodeExact ? 500 : 0);
  }

  // 2) Whole-name tiers.
  if (entry.nameCompact && entry.nameCompact === compactQ) {
    return make("exact-name", TIER.EXACT_NAME, 1, []);
  }
  const nameHard = tokens.map((t) => bestQuality(t, entry.nameTokens, true));
  if (entry.nameCompact && compactQ.length >= 2 && entry.nameCompact.startsWith(compactQ)) {
    return make("name-prefix", TIER.NAME_PREFIX, mean(nameHard), []);
  }
  if (nameHard.every((q) => q >= 0.85)) {
    return make("word", TIER.WORD, mean(nameHard), []);
  }
  if (
    (compactQ.length >= 3 && entry.nameCompact.includes(compactQ)) ||
    nameHard.every((q) => q >= 0.7)
  ) {
    return make("substring", TIER.SUBSTRING, mean(nameHard), []);
  }

  // 3) Code fragments (partial SKU/barcode typing — not the scanner path).
  const codeHard = tokens.map((t) =>
    entry.codes.reduce((best, c) => Math.max(best, codeTokenQuality(t, c.compact)), 0),
  );
  if (codeHard.every((q) => q >= 0.7)) {
    return make("code", TIER.CODE, mean(codeHard), variationsMatching(entry, tokens, 0.7));
  }

  // 4) Variation text (attribute values, option names, variation names).
  const textHard = tokens.map((t) => bestQuality(t, entry.textTokens, true));
  if (textHard.every((q) => q >= 0.7)) {
    return make("variation", TIER.VARIATION, mean(textHard), variationsMatching(entry, tokens, 0.7));
  }

  // 5) Typo tolerance: every token within its edit-distance budget somewhere in
  //    the text, or the whole query within budget of a SKU/barcode.
  const codeFuzzy = entry.codes.some((c) => fuzzyQuality(compactQ, c.compact) > 0);
  const textAll = tokens.map((t) => bestQuality(t, entry.textTokens, false));
  if (codeFuzzy || (textAll.every((q) => q >= 0.1) && textAll.some((q) => q > 0))) {
    const quality = codeFuzzy ? Math.max(mean(textAll), 0.3) : mean(textAll);
    return make("fuzzy", TIER.FUZZY, quality, variationsMatching(entry, tokens, 0.1));
  }

  return null;
};

const compareMatches = (a: ProductMatch<any>, b: ProductMatch<any>): number => {
  if (b.score !== a.score) return b.score - a.score;
  const an = asString(a.product?.name);
  const bn = asString(b.product?.name);
  if (an.length !== bn.length) return an.length - bn.length;
  const byName = an.localeCompare(bn);
  if (byName !== 0) return byName;
  return asString(a.product?.id).localeCompare(asString(b.product?.id));
};

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/**
 * Search a prebuilt index. Deterministic ranking:
 * exact-code (scanners) > exact-name > name-prefix > word > substring > code >
 * variation > fuzzy, then match quality, then shorter name, then name/id.
 * If any exact SKU/barcode match exists, ONLY exact-code matches are returned
 * (scanner short-circuit, same behavior as the screens have today).
 */
export function searchProductIndex<TProduct extends SearchableProduct>(
  index: ProductIndex<TProduct>,
  query: string,
  options: ProductSearchOptions = {},
): ProductMatch<TProduct>[] {
  const normalized = normalizeSearchText(query);
  if (!normalized) return [];
  const tokens = normalized.split(" ");
  const compactQ = normalized.replace(/ /g, "");

  const matches: ProductMatch<TProduct>[] = [];
  for (const entry of index?.entries ?? []) {
    const m = matchEntry(entry, compactQ, tokens);
    if (m) matches.push(m);
  }

  const exact = matches.filter((m) => m.kind === "exact-code");
  const final = exact.length > 0 ? exact : matches;
  final.sort(compareMatches);

  const { limit } = options;
  if (typeof limit === "number" && Number.isFinite(limit) && limit >= 0) {
    return final.slice(0, Math.floor(limit));
  }
  return final;
}

/**
 * One-shot search over plain arrays (builds a throwaway index). For per-keystroke
 * search on larger catalogs, build the index once with {@link buildProductIndex}
 * and call {@link searchProductIndex} instead.
 */
export function searchProducts<
  TProduct extends SearchableProduct,
  TVariation extends SearchableVariation = SearchableVariation,
>(
  products: readonly TProduct[],
  query: string,
  options: ProductSearchOptions & { variations?: readonly TVariation[] | null } = {},
): ProductMatch<TProduct>[] {
  const { variations, limit } = options;
  return searchProductIndex(buildProductIndex(products, variations), query, { limit });
}
