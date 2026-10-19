/** Offline, non-mutating readiness report. A reviewed candidate is not a migration. */
export type LegacyRow = { id: string; row_hash: string; [column: string]: unknown };
export type LegacyReference = { table: string; column: string; target: string; targetColumn?: string };
export type LegacyInventory = {
  version: 1;
  tables: Record<string, LegacyRow[]>;
  references: LegacyReference[];
  authorization?: { kind: string; id: string; row_hash: string }[];
  source?: { kind: string; database?: string; transactionReadOnly?: boolean; collectedAt?: string };
};
export type ReviewedMapping = {
  resource: string;
  rowHash: string;
  brandId: string;
  disposition: "store" | "retain-legacy";
  storeType?: "physical" | "online";
  reviewedBy: string;
  evidence: string;
};
export const REQUIRED_TABLES = [
  "auth.users", "businesses", "user_business_access", "brands", "stores", "storefronts",
  "locations", "selling_points", "user_roles", "user_permissions", "user_store_access",
  "user_custom_roles", "custom_roles", "permission_settings", "invitations",
];
const RESOURCE_TABLES = ["stores", "storefronts", "locations", "selling_points"];
const CORE_REFERENCES: LegacyReference[] = [
  { table: "user_business_access", column: "user_id", target: "auth.users" },
  { table: "user_business_access", column: "business_id", target: "businesses" },
  { table: "brands", column: "business_id", target: "businesses" },
  { table: "brands", column: "woo_store_id", target: "stores" },
  ...["storefronts", "locations", "selling_points"].map((table) => ({ table, column: "brand_id", target: "brands" })),
  ...["locations", "selling_points"].map((table) => ({ table, column: "business_id", target: "businesses" })),
  { table: "storefronts", column: "store_id", target: "stores" },
  { table: "selling_points", column: "woo_store_id", target: "stores" },
  { table: "selling_points", column: "storefront_id", target: "storefronts" },
  { table: "selling_points", column: "location_id", target: "locations" },
  { table: "user_store_access", column: "store_id", target: "stores" },
  ...["user_roles", "user_permissions", "user_store_access", "user_custom_roles"].map((table) => ({ table, column: "user_id", target: "auth.users" })),
  { table: "user_custom_roles", column: "custom_role_id", target: "custom_roles" },
];
type Blocker = { code: string; resource: string; detail: string };
type Resource = {
  resource: string;
  brandIds: string[];
  businessIds: string[];
  storeType: "physical" | "online" | null;
  status: "reviewed" | "blocked";
};

function validateInventory(inventory: LegacyInventory) {
  if (inventory?.version !== 1 || !inventory.tables || Array.isArray(inventory.tables) || !Array.isArray(inventory.references)) {
    throw new Error("Invalid inventory: expected version 1, tables and references.");
  }
  for (const [table, rows] of Object.entries(inventory.tables)) {
    if (!Array.isArray(rows)) throw new Error(`Invalid inventory table ${table}.`);
    const ids = new Set<string>();
    for (const row of rows) {
      if (!row || typeof row.id !== "string" || !row.id || typeof row.row_hash !== "string" || !row.row_hash || ids.has(row.id)) {
        throw new Error(`Invalid or duplicate row evidence in ${table}.`);
      }
      ids.add(row.id);
    }
  }
  for (const ref of inventory.references) {
    if (![ref?.table, ref?.column, ref?.target].every((value) => typeof value === "string" && value.length)) {
      throw new Error("Invalid inventory relationship evidence.");
    }
  }
}

export function auditLegacyAccounts(inventory: LegacyInventory, mappings: ReviewedMapping[] = []) {
  validateInventory(inventory);
  if (!Array.isArray(mappings)) throw new Error("Reviewed mappings must be an array.");
  const blockers: Blocker[] = [];
  const rows = (table: string) => inventory.tables[table] ?? [];
  const block = (code: string, resource: string, detail: string) => blockers.push({ code, resource, detail });
  for (const table of REQUIRED_TABLES) {
    if (!Array.isArray(inventory.tables[table])) block("incomplete-inventory", table, "Required table was not collected.");
  }
  for (const [table, tableRows] of Object.entries(inventory.tables)) for (const row of tableRows) {
    if (Array.isArray(row.opaque_columns) && row.opaque_columns.length) {
      block("opaque-reference", `${table}:${row.id}`, `Review non-empty embedded payload columns: ${row.opaque_columns.join(", ")}. Values are fingerprinted, never interpreted as ownership.`);
    }
  }
  for (const business of rows("businesses")) {
    const owners = rows("user_business_access").filter((m) => m.business_id === business.id && m.role === "owner");
    if (owners.length !== 1) block(owners.length ? "multiple-owners" : "missing-owner", `businesses:${business.id}`, "Keep all memberships; reviewed ownership decision required.");
  }
  for (const member of rows("user_business_access")) {
    if (!["owner", "member"].includes(String(member.role))) block("membership-authority", `user_business_access:${member.id}`, "Legacy admin/viewer authority cannot silently become owner/member.");
  }
  for (const table of ["user_roles", "user_permissions", "user_custom_roles", "user_store_access", "invitations"]) {
    for (const row of rows(table)) block("global-authority", `${table}:${row.id}`, "Review global authority, restrictions and invitation intent; never infer account membership.");
  }

  // Only relationship evidence propagates here, never inferred selling-operation types.
  const nodes = new Map<string, { row: LegacyRow; brands: Set<string>; businesses: Set<string>; edges: Set<string> }>();
  for (const table of ["brands", ...RESOURCE_TABLES]) {
    for (const row of rows(table)) nodes.set(`${table}:${row.id}`, {
      row, brands: new Set(table === "brands" ? [row.id] : []),
      businesses: new Set(row.business_id ? [String(row.business_id)] : []), edges: new Set(),
    });
  }
  for (const ref of CORE_REFERENCES) {
    for (const row of rows(ref.table)) {
      const from = nodes.get(`${ref.table}:${row.id}`);
      const targetKey = `${ref.target}:${row[ref.column]}`;
      const to = nodes.get(targetKey);
      if (from && to) { from.edges.add(targetKey); to.edges.add(`${ref.table}:${row.id}`); }
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes.values()) for (const edge of node.edges) {
      const other = nodes.get(edge);
      for (const field of ["brands", "businesses"] as const) for (const value of other[field]) {
        if (!node[field].has(value)) { node[field].add(value); changed = true; }
      }
    }
  }
  const resources: Resource[] = RESOURCE_TABLES.flatMap((table) => rows(table).map((row) => {
    const resource = `${table}:${row.id}`;
    const node = nodes.get(resource);
    const brandIds = [...node.brands].sort();
    const businessIds = [...node.businesses].sort();
    const linked = brandIds.length === 1 && businessIds.length === 1;
    if (!brandIds.length || !businessIds.length) block("unlinked-resource", resource, "No single parent brand and business account are established.");
    if (brandIds.length > 1 || businessIds.length > 1) block("shared-resource", resource, "Conflicting parents require review; do not choose a first match.");
    const decisions = mappings.filter((item) => item.resource === resource);
    const mapping = decisions[0];
    const reviewed = linked && decisions.length === 1 && mapping.brandId === brandIds[0]
      && mapping.rowHash === row.row_hash && mapping.reviewedBy?.trim() && mapping.evidence?.trim()
      && (mapping.disposition === "retain-legacy" || (mapping.disposition === "store" && ["physical", "online"].includes(mapping.storeType)));
    if (!reviewed) block("mapping-review", resource, "Review against this row hash: retain legacy resource or explicitly map a physical/online operation. Channel/location type is not store type.");
    return {
      resource, brandIds, businessIds,
      storeType: reviewed && mapping.disposition === "store" ? mapping.storeType : null,
      status: reviewed ? "reviewed" : "blocked",
    };
  }));
  for (const mapping of mappings) {
    if (!resources.some((resource) => resource.resource === mapping?.resource)) block("unknown-mapping", mapping?.resource ?? "mapping", "Reviewed decision does not match an inventoried legacy resource.");
  }
  const references = [...CORE_REFERENCES, ...inventory.references].filter((ref, i, all) =>
    all.findIndex((other) => JSON.stringify(other) === JSON.stringify(ref)) === i);
  const allRows = new Map<string, { row: LegacyRow; businesses: Set<string>; parents: string[] }>();
  for (const [table, tableRows] of Object.entries(inventory.tables)) for (const row of tableRows) {
    allRows.set(`${table}:${row.id}`, {
      row, businesses: new Set(table === "businesses" ? [row.id] : nodes.get(`${table}:${row.id}`)?.businesses ?? []), parents: [],
    });
  }
  const scopedTables = new Set(["businesses", "brands", ...RESOURCE_TABLES]);
  // Resolve indirect history too (e.g. order items -> order, stock -> product/location).
  changed = true;
  while (changed) {
    changed = false;
    for (const ref of references) {
      if (scopedTables.has(ref.target) && !scopedTables.has(ref.table)) { scopedTables.add(ref.table); changed = true; }
    }
  }
  for (const ref of references) for (const row of rows(ref.table)) {
    const value = row[ref.column];
    if (value === null || value === undefined) continue;
    const target = rows(ref.target).find((other) => other[ref.targetColumn ?? "id"] === value);
    if (!target) block("orphan-reference", `${ref.table}:${row.id}`, `${ref.column} points to missing ${ref.target}:${String(value)}.`);
    else if (scopedTables.has(ref.target)) allRows.get(`${ref.table}:${row.id}`).parents.push(`${ref.target}:${target.id}`);
  }
  changed = true;
  while (changed) {
    changed = false;
    for (const node of allRows.values()) for (const parent of node.parents) {
      for (const business of allRows.get(parent).businesses) {
        if (!node.businesses.has(business)) { node.businesses.add(business); changed = true; }
      }
    }
  }
  const operations: { resource: string; businessIds: string[] }[] = [];
  for (const [table, tableRows] of Object.entries(inventory.tables)) for (const row of tableRows) {
    const resource = `${table}:${row.id}`;
    const businessIds = [...allRows.get(resource).businesses].sort();
    if (businessIds.length > 1) block("cross-account-reference", resource, "References span business accounts; preserve and review the affected history.");
    if (scopedTables.has(table) && !["businesses", "brands", ...RESOURCE_TABLES, "user_business_access", "user_store_access"].includes(table)) {
      operations.push({ resource, businessIds });
      if (!businessIds.length) block("unscoped-operation", resource, "Operational history has no established account path.");
    }
  }
  return {
    version: 1,
    ready: blockers.length === 0,
    blockers,
    resources,
    operations,
    inventory,
    access: {
      memberships: rows("user_business_access"),
      globalRoles: rows("user_roles"), permissionOverrides: rows("user_permissions"),
      customRoleAssignments: rows("user_custom_roles"), customRoles: rows("custom_roles"),
      storeAssignments: rows("user_store_access"), settings: rows("permission_settings"), invitations: rows("invitations"),
    },
  };
}

/** Strict rehearsal: only additive rows/tables/references are allowed by this slice. */
export function rehearsePreservation(before: LegacyInventory, after: LegacyInventory) {
  validateInventory(before);
  validateInventory(after);
  const violations: Blocker[] = [];
  for (const [table, originalRows] of Object.entries(before.tables)) {
    const remaining = after.tables[table];
    if (!remaining) {
      violations.push({ code: "table-removed", resource: table, detail: "Legacy reader boundary was removed." });
      continue;
    }
    for (const original of originalRows) {
      const row = remaining.find((candidate) => candidate.id === original.id);
      if (!row) violations.push({ code: "row-removed", resource: `${table}:${original.id}`, detail: "Legacy identifier/history/access must survive." });
      else if (Object.keys(original).some((key) => JSON.stringify(original[key]) !== JSON.stringify(row[key]))) {
        violations.push({ code: "row-changed", resource: `${table}:${original.id}`, detail: "Legacy row fingerprint or relationship/access changed; separate reviewed migration required." });
      }
    }
  }
  for (const ref of before.references) {
    if (!after.references.some((candidate) => candidate.table === ref.table && candidate.column === ref.column
      && candidate.target === ref.target && (candidate.targetColumn ?? "id") === (ref.targetColumn ?? "id"))) {
      violations.push({ code: "reference-removed", resource: `${ref.table}.${ref.column}`, detail: "Legacy relationship contract was removed." });
    }
  }
  for (const original of before.authorization ?? []) {
    if (!after.authorization?.some((entry) => entry.kind === original.kind && entry.id === original.id && entry.row_hash === original.row_hash)) {
      violations.push({ code: "authority-changed", resource: `${original.kind}:${original.id}`, detail: "Legacy server-side authorization changed; separate policy/access rehearsal required." });
    }
  }
  return { preserved: violations.length === 0, violations };
}
