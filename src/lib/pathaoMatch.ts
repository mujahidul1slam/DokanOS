// Shared Pathao city/zone/area address-to-ID matcher.
// Designed so callers can match a zone (and back-fill its city) or match an
// area (and back-fill its zone + city) directly from a free-text address —
// no need for the city to be selected first.

const LOCATION_WORD_BLACKLIST = new Set([
  "address", "area", "bari", "bazar", "block", "building", "city", "district", "door", "flat",
  "floor", "gate", "goli", "gram", "house", "lane", "market", "moor", "para", "post", "road",
  "sector", "street", "thana", "union", "upazila", "village", "word", "zilla", "zip",
]);

const LOCATION_ALIAS_GROUPS: string[][] = [
  ["bbaria", "brahmanbaria"],
  ["barisal", "barishal"],
  ["bogra", "bogura"],
  ["chittagong", "chattogram"],
  ["cumilla", "comilla"],
  ["jashore", "jessore"],
  ["lakshmipur", "laxmipur", "lokkhipur"],
  ["munsiganj", "munshiganj"],
  ["narshingdi", "narsingdi"],
  ["gopalgonj", "gopalganj"],
  ["bashundhara", "basundhara", "bashundhara r/a", "bashundhara residential area", "boshundhora", "boshundhara", "bosundhora"],
  ["mirpur", "mirpur 1", "mirpur 2", "mirpur 10", "mirpur 11", "mirpur 12", "mirpur 13", "mirpur 14"],
  ["uttara", "uttara sector 1", "uttara sector 3", "uttara sector 4", "uttara sector 7", "uttara sector 10", "uttara sector 11", "uttara sector 13", "uttara sector 14"],
  ["dhanmondi", "dhanmondi r/a"],
  ["badda", "middle badda", "merul badda", "north badda", "south badda"],
  ["khilgaon", "khilgaon r/a"],
  ["cantonment", "dhaka cantonment"],
  ["farmgate", "farm gate"],
];

// --- Bangla → Latin transliteration -----------------------------------------
// Lightweight phonetic transliteration so users typing addresses in Bangla
// (e.g. "ঢাকা", "মিরপুর", "সেকশন ১০") still match the Pathao English city/
// zone/area lists. We don't need linguistic perfection — just enough overlap
// so the existing matcher's prefix / contains / edit-distance checks fire.

const BANGLA_DIGITS: Record<string, string> = {
  "০": "0", "১": "1", "২": "2", "৩": "3", "৪": "4",
  "৫": "5", "৬": "6", "৭": "7", "৮": "8", "৯": "9",
};

// Order matters: multi-char clusters first so they're consumed before
// individual characters. Values use common Banglish spellings that align with
// Pathao's English location names (e.g. "ঢ" → "dh", "চট্টগ্রাম" → "chottogram").
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
    // Bangla digit?
    const digit = BANGLA_DIGITS[input[i]];
    if (digit) { out += digit; i += 1; continue; }
    // Try multi-char clusters first
    let matched = false;
    for (const [src, tgt] of BANGLA_MAP) {
      if (src.length > 1 && input.startsWith(src, i)) {
        out += tgt; i += src.length; matched = true; break;
      }
    }
    if (matched) continue;
    // Single char map
    const ch = input[i];
    const single = BANGLA_MAP.find(([s]) => s === ch);
    if (single) { out += single[1]; i += 1; continue; }
    out += ch; i += 1;
  }
  return out;
};

const normalize = (v: string) => transliterateBangla(v).toLowerCase().replace(/[^a-z0-9]/g, "");


const editDistance = (a: string, b: string): number => {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const m: number[][] = [];
  for (let i = 0; i <= a.length; i++) m[i] = [i];
  for (let j = 0; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      m[i][j] = Math.min(
        m[i - 1][j] + 1,
        m[i][j - 1] + 1,
        m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return m[a.length][b.length];
};

const expandAliases = (value: string): Set<string> => {
  const n = normalize(value);
  const out = new Set<string>();
  if (!n) return out;
  out.add(n);
  for (const group of LOCATION_ALIAS_GROUPS) {
    if (group.includes(n)) group.forEach((a) => out.add(a));
  }
  return out;
};

export function buildAddressCandidates(
  values: Array<string | null | undefined>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (v?: string | null) => {
    const t = v?.trim();
    if (!t) return;
    const n = normalize(t);
    if (!n || seen.has(n)) return;
    seen.add(n);
    out.push(t);
  };
  for (const rawValue of values) {
    if (!rawValue) continue;
    // Also feed a transliterated copy of the whole address so multi-word
    // Bangla phrases produce Latin segments after splitting.
    const variants = hasBangla(rawValue) ? [rawValue, transliterateBangla(rawValue)] : [rawValue];
    for (const value of variants) {
      add(value);
      for (const segment of value.split(/[\n,।]/)) {
        const t = segment.trim();
        if (!t) continue;
        add(t);
        const afterColon = t.includes(":") ? t.split(":").slice(1).join(":").trim() : "";
        add(afterColon);
        add(t.replace(/^(?:village|road|house|flat|sector|block|union|upazila|thana|zilla|district|city)\s*:?\s*/i, ""));
        for (const word of t.split(/\s+/)) {
          const nw = normalize(word);
          if (nw.length >= 3 && !LOCATION_WORD_BLACKLIST.has(nw) && !/^\d+$/.test(nw)) add(word);
        }
      }
    }
  }
  return out;
}

// Strict matcher: prefers exact / alias / prefix / contains, with bounded edit distance.
// Returns undefined when the top two candidates tie (ambiguous).
export function strictMatch<T>(
  items: T[],
  getText: (item: T) => string,
  queries: string[],
): T | undefined {
  const ranked = items
    .map((item) => {
      const itemVariants = expandAliases(getText(item));
      let best: number | null = null;
      for (const raw of queries) {
        const qVariants = expandAliases(raw.trim());
        for (const iv of itemVariants) {
          for (const qv of qVariants) {
            if (!qv || qv.length < 3) continue;
            let s: number | null = null;
            if (iv === qv) s = 0;
            else if (Math.min(iv.length, qv.length) >= 5 && (iv.startsWith(qv) || qv.startsWith(iv))) s = 1;
            else if (Math.min(iv.length, qv.length) >= 5 && (iv.includes(qv) || qv.includes(iv))) s = 2;
            else {
              const d = editDistance(iv, qv);
              const th = Math.max(1, Math.floor(Math.max(iv.length, qv.length) * 0.18));
              if (Math.min(iv.length, qv.length) >= 5 && d <= th) s = 10 + d;
            }
            if (s !== null && (best === null || s < best)) best = s;
          }
        }
      }
      return best === null ? null : { item, score: best, text: normalize(getText(item)) };
    })
    .filter((e): e is { item: T; score: number; text: string } => e !== null)
    .sort((a, b) => a.score - b.score || a.text.localeCompare(b.text));
  if (ranked.length === 0) return undefined;
  if (ranked.length > 1 && ranked[0].score === ranked[1].score) return undefined;
  return ranked[0].item;
}

// Looser fallback used after the strict matcher fails — used for in-scope
// (city-narrowed zone, zone-narrowed area) matching where ambiguity is rarer.
export function fuzzyMatch<T>(
  items: T[],
  getText: (item: T) => string,
  queries: string[],
): T | undefined {
  for (const raw of queries) {
    const q = normalize(raw);
    if (!q) continue;
    let best = items.find((it) => normalize(getText(it)) === q);
    if (best) return best;
    best = items.find((it) => {
      const v = normalize(getText(it));
      return v.startsWith(q) || q.startsWith(v);
    });
    if (best) return best;
    best = items.find((it) => {
      const v = normalize(getText(it));
      return v.includes(v) && (v.includes(q) || q.includes(v));
    });
    if (best) return best;
    let minD = Infinity;
    let closest: T | undefined;
    for (const it of items) {
      const d = editDistance(q, normalize(getText(it)));
      const th = Math.max(2, Math.floor(q.length * 0.35));
      if (d < minD && d <= th) {
        minD = d;
        closest = it;
      }
    }
    if (closest) return closest;
  }
  return undefined;
}
