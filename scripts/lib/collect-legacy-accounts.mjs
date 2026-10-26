import pg from "pg";
import { REQUIRED_TABLES, SEMANTIC_REFERENCE_TARGETS } from "../../src/lib/accounts/legacy-readiness.ts";

const quote = (identifier) => `"${identifier.replaceAll('"', '""')}"`;
const qualified = (table) => table.split(".").map(quote).join(".");
const SAFE_VALUES = new Set([
  "type", "role", "permission", "granted", "permissions", "allowed_store_ids",
  "enforce_store_scoping", "is_active", "accepted_at",
]);
const REQUIRED_COLUMNS = {
  "auth.users": ["id"], businesses: ["id"],
  user_business_access: ["id", "user_id", "business_id", "role"],
  brands: ["id", "business_id", "woo_store_id"], stores: ["id"],
  storefronts: ["id", "brand_id", "store_id"], locations: ["id", "business_id", "brand_id", "type"],
  selling_points: ["id", "business_id", "brand_id", "location_id", "woo_store_id", "storefront_id", "type"],
  user_roles: ["id", "user_id", "role"], user_permissions: ["id", "user_id", "permission", "granted"],
  user_store_access: ["id", "user_id", "store_id"], user_custom_roles: ["id", "user_id", "custom_role_id"],
  custom_roles: ["id", "permissions"], permission_settings: ["id", "enforce_store_scoping"],
  invitations: ["id", "role", "accepted_at"],
};

/** No caller SQL, writes, RPCs, migrations, app env discovery, or partial RLS inventories. */
export async function collectLegacyInventory(connectionString) {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10000, application_name: "dokanos-account-readiness" });
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query("SET LOCAL row_security = off");
    const { rows: [session] } = await client.query(`
      SELECT current_database() AS database, current_setting('transaction_read_only') = 'on' AS read_only,
             (rolsuper OR rolbypassrls) AS full_inventory
      FROM pg_roles WHERE rolname = current_user
    `);
    if (!session?.read_only || !session.full_inventory) {
      throw new Error("Complete inventory requires an explicitly supplied SELECT-capable BYPASSRLS auditor; RLS-filtered results are not readiness evidence.");
    }
    const { rows: columns } = await client.query(`
      SELECT CASE WHEN n.nspname = 'auth' THEN 'auth.users' ELSE c.relname END AS table_name,
             a.attname AS column_name, t.typname AS data_type,
             EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indisprimary AND a.attnum = ANY(i.indkey)) AS primary_key
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      JOIN pg_type t ON t.oid = a.atttypid
      WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition
        AND (n.nspname = 'public' OR (n.nspname = 'auth' AND c.relname = 'users'))
      ORDER BY table_name, a.attnum
    `);
    const byTable = new Map();
    for (const column of columns) {
      if (!byTable.has(column.table_name)) byTable.set(column.table_name, []);
      byTable.get(column.table_name).push(column);
    }
    for (const table of REQUIRED_TABLES) {
      const available = new Set((byTable.get(table) ?? []).map((c) => c.column_name));
      if (!available.size || REQUIRED_COLUMNS[table].some((column) => !available.has(column))) {
        throw new Error(`Incomplete legacy schema: required table/columns missing for ${table}. No ready report produced.`);
      }
    }
    const { rows: foreignKeys } = await client.query(`
      SELECT c.relname AS table_name, a.attname AS column_name,
             CASE WHEN tn.nspname = 'public' THEN tc.relname ELSE tn.nspname || '.' || tc.relname END AS target,
             ta.attname AS target_column, cardinality(k.conkey) AS key_columns
      FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_class tc ON tc.oid = k.confrelid JOIN pg_namespace tn ON tn.oid = tc.relnamespace
      CROSS JOIN LATERAL unnest(k.conkey, k.confkey) AS pair(source_num, target_num)
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = pair.source_num
      JOIN pg_attribute ta ON ta.attrelid = tc.oid AND ta.attnum = pair.target_num
      WHERE k.contype = 'f' AND n.nspname = 'public' AND NOT c.relispartition
      ORDER BY c.relname, a.attname
    `);
    const references = [];
    for (const fk of foreignKeys) {
      if (fk.key_columns !== 1 || !byTable.has(fk.target)) throw new Error(`Unsupported relationship ${fk.table_name}.${fk.column_name}; explicit collector review required.`);
      references.push({ table: fk.table_name, column: fk.column_name, target: fk.target, targetColumn: fk.target_column });
    }
    // Several legacy identifiers (notably storefronts.store_id) have no FK.
    for (const [table, tableColumns] of byTable) for (const column of tableColumns) {
      const target = SEMANTIC_REFERENCE_TARGETS[column.column_name];
      if (target && !references.some((r) => r.table === table && r.column === column.column_name)) {
        references.push({ table, column: column.column_name, target, targetColumn: "id" });
      }
    }
    const tables = {};
    for (const [table, tableColumns] of byTable) {
      const primary = tableColumns.filter((c) => c.primary_key).map((c) => c.column_name);
      const selected = tableColumns.filter((c) => c.primary_key || c.column_name === "id" || c.column_name.endsWith("_id")
        || SAFE_VALUES.has(c.column_name) || references.some((r) => r.target === table && r.targetColumn === c.column_name));
      // Full payload stays in PostgreSQL. Only a SHA-256 fingerprint leaves the server.
      const hash = "encode(sha256(convert_to(to_jsonb(t)::text, 'UTF8')), 'hex')";
      const fields = selected.map((c) => `t.${quote(c.column_name)}`).join(", ");
      const hasId = selected.some((c) => c.column_name === "id");
      const identity = hasId ? "" : `, ${primary.length ? `jsonb_build_array(${primary.map((c) => `t.${quote(c)}`).join(", ")})::text` : hash} AS id`;
      const opaque = tableColumns.filter((c) => ["json", "jsonb"].includes(c.data_type) && !SAFE_VALUES.has(c.column_name));
      const opaqueFields = opaque.length ? `ARRAY_REMOVE(ARRAY[${opaque.map((c) =>
        `CASE WHEN t.${quote(c.column_name)} IS NOT NULL AND t.${quote(c.column_name)}::text NOT IN ('{}', '[]', 'null') THEN '${c.column_name.replaceAll("'", "''")}' END`).join(", ")}], NULL)` : "ARRAY[]::text[]";
      const { rows } = await client.query(`SELECT ${fields ? fields + ", " : ""}${hash} AS row_hash${identity}, ${opaqueFields} AS opaque_columns FROM ${qualified(table)} t`);
      tables[table] = rows.map((row) => ({ ...row, id: String(row.id) })).sort((a, b) => a.id.localeCompare(b.id));
    }
    const { rows: authorization } = await client.query(`
      SELECT 'policy' AS kind, schemaname || '.' || tablename || ':' || policyname AS id,
             encode(sha256(convert_to(row_to_json(p)::text, 'UTF8')), 'hex') AS row_hash
      FROM pg_policies p WHERE schemaname = 'public'
      UNION ALL
      SELECT 'function', p.oid::regprocedure::text,
             encode(sha256(convert_to(pg_get_functiondef(p.oid) || COALESCE(p.proacl::text, '') || p.proowner::text, 'UTF8')), 'hex')
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname IN
        ('has_permission', 'has_role', 'get_user_permissions', 'user_can_access_store', 'user_has_store_access',
         'is_business_member', 'my_business_role', 'can_manage_business_access')
      UNION ALL
      SELECT 'table-security', n.nspname || '.' || c.relname,
             encode(sha256(convert_to(jsonb_build_object('acl', c.relacl, 'owner', c.relowner,
               'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity)::text, 'UTF8')), 'hex')
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition
        AND (n.nspname = 'public' OR (n.nspname = 'auth' AND c.relname = 'users'))
      UNION ALL
      SELECT 'column-security', n.nspname || '.' || c.relname || '.' || a.attname,
             encode(sha256(convert_to(COALESCE(a.attacl::text, ''), 'UTF8')), 'hex')
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition
        AND (n.nspname = 'public' OR (n.nspname = 'auth' AND c.relname = 'users'))
      UNION ALL
      SELECT 'schema-security', nspname,
             encode(sha256(convert_to(jsonb_build_object('acl', nspacl, 'owner', nspowner)::text, 'UTF8')), 'hex')
      FROM pg_namespace WHERE nspname IN ('public', 'auth')
      UNION ALL
      SELECT 'role-security', rolname,
             encode(sha256(convert_to(jsonb_build_object('superuser', rolsuper, 'inherit', rolinherit,
               'bypassrls', rolbypassrls, 'login', rolcanlogin)::text, 'UTF8')), 'hex')
      FROM pg_roles
      UNION ALL
      SELECT 'role-membership', roleid::text || ':' || member::text,
             encode(sha256(convert_to(to_jsonb(m)::text, 'UTF8')), 'hex')
      FROM pg_auth_members m
      ORDER BY kind, id
    `);
    return {
      version: 1, tables, references, authorization,
      source: { kind: "database", database: session.database, transactionReadOnly: true, collectedAt: new Date().toISOString() },
    };
  } finally {
    // Always rollback, including after a successful read. No deployed state is changed.
    try { await client.query("ROLLBACK"); } catch { /* Connection may have failed. */ }
    await client.end();
  }
}
