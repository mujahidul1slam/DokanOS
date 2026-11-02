/**
 * Pure decision logic for measurement configuration — no I/O, no Supabase.
 * Callers fetch rows and pass plain data in.
 *
 * Semantics (issue #28):
 * - A group assignment targets a product OR a category (matching the
 *   `measurement_assignments` shape). Category assignments carry a scope:
 *   - `direct` (default): only products in the assigned category itself.
 *   - `cascade_all`: the assigned category and all of its subcategories.
 *   - `cascade_selected`: the assigned category plus the subtrees of the
 *     explicitly selected subcategories.
 *   - `cascade_except`: like `cascade_all`, minus the excluded subtrees
 *     (an exclusion covers the excluded category and its whole subtree).
 *   All cascades resolve against the category tree AT MATCH TIME —
 *   subcategories created after the assignment are included (dynamic
 *   cascade, no snapshot).
 * - All matching assignments union: a group applies if ANY assignment matches.
 * - The per-product never-measure override wins over every assignment.
 */

export type MeasurementScope = "direct" | "cascade_all" | "cascade_selected" | "cascade_except";

/** Minimal category shape needed to walk the tree (`categories.id`, `categories.parent_id`). */
export interface CategoryNode {
  id: string;
  parent_id?: string | null;
}

/** A measurement group's attachment to a product or category, with scope modifiers. */
export interface AssignmentRule {
  groupId: string;
  productId?: string | null;
  categoryId?: string | null;
  /** Category assignments only; defaults to "direct". */
  scope?: MeasurementScope;
  /** `cascade_selected` only: subcategories whose subtrees are included. */
  includedCategoryIds?: string[];
  /** `cascade_except` only: category ids whose subtrees are excluded. */
  excludedCategoryIds?: string[];
}

export interface ResolveGroupsInput {
  productId: string;
  productCategoryIds: string[];
  categories: CategoryNode[];
  assignments: AssignmentRule[];
  /** Products flagged "never measure" — wins over every assignment. */
  neverMeasureProductIds?: Iterable<string> | null;
}

/** True when candidateId is rootId or a descendant of rootId (cycle-safe). */
export function isSameOrDescendant(
  categories: CategoryNode[],
  candidateId: string,
  rootId: string
): boolean {
  if (candidateId === rootId) return true;
  const parentById = new Map<string, string | null>();
  categories.forEach((c) => parentById.set(c.id, c.parent_id ?? null));
  const seen = new Set<string>();
  let cur: string | null = candidateId;
  while (cur != null && !seen.has(cur)) {
    if (cur === rootId) return true;
    seen.add(cur);
    cur = parentById.get(cur) ?? null;
  }
  return false;
}

/**
 * Resolve the ids of the measurement groups that apply to a product.
 * Returns unique ids in first-match assignment order.
 */
export function resolveGroupIdsForProduct(input: ResolveGroupsInput): string[] {
  const { productId, productCategoryIds, categories, assignments } = input;

  // Per-product never-measure override wins over every assignment.
  if (input.neverMeasureProductIds) {
    for (const id of input.neverMeasureProductIds) {
      if (id === productId) return [];
    }
  }

  const matched: string[] = [];
  const seen = new Set<string>();

  const add = (groupId: string) => {
    if (!seen.has(groupId)) {
      seen.add(groupId);
      matched.push(groupId);
    }
  };

  for (const a of assignments) {
    if (a.productId != null) {
      if (a.productId === productId) add(a.groupId);
      continue;
    }
    if (a.categoryId == null) continue;

    const scope: MeasurementScope = a.scope ?? "direct";
    if (scope === "direct") {
      if (productCategoryIds.includes(a.categoryId)) add(a.groupId);
      continue;
    }

    // cascade_all / cascade_selected / cascade_except: the product matches
    // through any of its categories reached from the assigned category,
    // walked against the live tree (no snapshot).
    for (const c of productCategoryIds) {
      let hit: boolean;
      if (scope === "cascade_selected") {
        hit =
          c === a.categoryId ||
          (a.includedCategoryIds ?? []).some((i) => isSameOrDescendant(categories, c, i));
      } else {
        hit = isSameOrDescendant(categories, c, a.categoryId);
      }
      if (!hit) continue;
      if (scope === "cascade_except") {
        const excluded = a.excludedCategoryIds ?? [];
        // Excluding a category excludes its whole subtree.
        const inExcludedSubtree = excluded.some((e) =>
          isSameOrDescendant(categories, c, e)
        );
        if (inExcludedSubtree) continue;
      }
      add(a.groupId);
      break;
    }
  }

  return matched;
}

/* ------------------------------------------------------------------------- *
 * Deferred measurement entry
 *
 * Orders are never blocked on measurements: they save with whatever is (not)
 * captured and measurements are entered later. These helpers decide the
 * entry status so slips can print "Measurements pending" markers and order
 * surfaces can badge items that still need capture.
 * ------------------------------------------------------------------------- */

export type MeasurementEntryStatus = "not_required" | "pending" | "partial" | "complete";

/** A group the product is expected to be measured for. */
export interface ExpectedGroupRef {
  id?: string;
  name: string;
}

/** A captured measurement row (matches `CapturedMeasurement` structurally). */
export interface CapturedMeasurementRef {
  groupId?: string;
  groupName: string;
  values?: { name: string; value: string }[];
}

/** "pant measurements (size l)" → "pant measurements" (preset rows carry a size suffix). */
function normalizeGroupName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s*\(\s*size\b[^)]*\)\s*$/i, "")
    .trim();
}

function hasFilledValue(m: CapturedMeasurementRef): boolean {
  return (m.values || []).some((v) => v.value && String(v.value).trim() !== "");
}

/** A captured row covers an expected group when ids (when both known) or names agree. */
function covers(expected: ExpectedGroupRef, captured: CapturedMeasurementRef): boolean {
  if (!hasFilledValue(captured)) return false;
  if (expected.id && captured.groupId) return expected.id === captured.groupId;
  return normalizeGroupName(expected.name) === normalizeGroupName(captured.groupName);
}

/** Expected groups that have no covering captured measurement yet. */
export function getMissingMeasurementGroups(
  expected: ExpectedGroupRef[],
  captured: CapturedMeasurementRef[]
): ExpectedGroupRef[] {
  return expected.filter((e) => !captured.some((c) => covers(e, c)));
}

/**
 * Expected groups that have NO row at all yet. Unlike
 * `getMissingMeasurementGroups`, a row with empty values still covers its
 * group here — an open-but-untouched entry is "being entered", not missing —
 * so a UI offering "add measurements" never duplicates an entry that is
 * already on screen. Matching is name-based (rows carry no group id), so
 * preset rows whose group name carries a "(Size X)" suffix cover their group
 * too.
 */
export function getGroupsWithoutRows<T extends ExpectedGroupRef>(
  expected: T[],
  captured: CapturedMeasurementRef[]
): T[] {
  return expected.filter(
    (e) => !captured.some((c) => normalizeGroupName(c.groupName) === normalizeGroupName(e.name))
  );
}

/**
 * Entry status for a product/order item:
 * - "not_required": no groups are expected (nothing blocks; measurements optional)
 * - "pending":     groups expected, none captured yet
 * - "partial":     some expected groups captured, some missing
 * - "complete":    every expected group captured with values
 */
export function getMeasurementEntryStatus(
  expected: ExpectedGroupRef[],
  captured: CapturedMeasurementRef[]
): MeasurementEntryStatus {
  if (expected.length === 0) return "not_required";
  const missing = getMissingMeasurementGroups(expected, captured);
  if (missing.length === 0) return "complete";
  return missing.length < expected.length ? "partial" : "pending";
}

/**
 * The "Measurements pending" marker for slips, or null when no marker applies.
 * `missingNames` (from getMissingMeasurementGroups) is appended on partial entries.
 */
export function formatMeasurementPendingMarker(
  status: MeasurementEntryStatus,
  missingNames: string[] = []
): string | null {
  if (status === "not_required" || status === "complete") return null;
  if (missingNames.length === 0) return "Measurements pending";
  return `Measurements pending: ${missingNames.join(", ")}`;
}

/** All descendant ids of rootId (never rootId itself), breadth-first, cycle-safe. */
export function getDescendantIds(categories: CategoryNode[], rootId: string): string[] {
  const childrenOf = new Map<string, string[]>();
  categories.forEach((c) => {
    if (c.parent_id == null) return;
    if (!childrenOf.has(c.parent_id)) childrenOf.set(c.parent_id, []);
    childrenOf.get(c.parent_id)!.push(c.id);
  });
  const out: string[] = [];
  const seen = new Set<string>([rootId]);
  const queue = [...(childrenOf.get(rootId) || [])];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    queue.push(...(childrenOf.get(id) || []));
  }
  return out;
}

/* ------------------------------------------------------------------------- *
 * Rules config (persisted in app_settings under the "measurement_rules" key)
 * ------------------------------------------------------------------------- */

export type CascadeScope = Exclude<MeasurementScope, "direct">;

/** Scope modifier for one category assignment row. */
export interface CategoryScopeRule {
  scope: CascadeScope;
  includedCategoryIds: string[];
  excludedCategoryIds: string[];
}

/** Per-product override — never-measure wins over every assignment. */
export interface ProductOverrideRule {
  neverMeasure: boolean;
}

export interface MeasurementRulesConfig {
  /** Scope modifiers keyed by `measurement_assignments.id` (category rows). */
  categoryScopes: Record<string, CategoryScopeRule>;
  /** Per-product overrides keyed by product id. */
  productOverrides: Record<string, ProductOverrideRule>;
}

export function emptyMeasurementRulesConfig(): MeasurementRulesConfig {
  return { categoryScopes: {}, productOverrides: {} };
}

function toStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Tolerant normalizer for the ad-hoc JSON stored in app_settings: unknown
 * shapes are dropped instead of throwing so a bad payload can never break
 * measurement resolution or the settings tab.
 */
export function parseMeasurementRulesConfig(value: unknown): MeasurementRulesConfig {
  const out = emptyMeasurementRulesConfig();
  if (typeof value !== "object" || value === null) return out;
  const raw = value as { categoryScopes?: unknown; productOverrides?: unknown };

  const scopes = raw.categoryScopes;
  if (typeof scopes === "object" && scopes !== null) {
    for (const [key, entry] of Object.entries(scopes as Record<string, unknown>)) {
      if (typeof entry !== "object" || entry === null) continue;
      const e = entry as {
        scope?: unknown;
        includedCategoryIds?: unknown;
        excludedCategoryIds?: unknown;
      };
      if (e.scope !== "cascade_all" && e.scope !== "cascade_selected" && e.scope !== "cascade_except") {
        continue;
      }
      out.categoryScopes[key] = {
        scope: e.scope,
        includedCategoryIds: toStringArray(e.includedCategoryIds),
        excludedCategoryIds: toStringArray(e.excludedCategoryIds),
      };
    }
  }

  const overrides = raw.productOverrides;
  if (typeof overrides === "object" && overrides !== null) {
    for (const [key, entry] of Object.entries(overrides as Record<string, unknown>)) {
      if (typeof entry !== "object" || entry === null) continue;
      if ((entry as { neverMeasure?: unknown }).neverMeasure === true) {
        out.productOverrides[key] = { neverMeasure: true };
      }
    }
  }
  return out;
}
