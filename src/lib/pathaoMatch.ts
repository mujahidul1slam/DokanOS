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
];

const normalize = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");

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
  for (const value of values) {
    if (!value) continue;
    add(value);
    for (const segment of value.split(/[\n,]/)) {
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
