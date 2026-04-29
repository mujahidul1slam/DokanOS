import { Fragment, useEffect, useState, useMemo } from "react";
import { format } from "date-fns";
import { Search, Download, ChevronDown, ChevronRight, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { downloadCsv } from "@/lib/exportCsv";
import { TableSkeleton } from "@/components/ui/loading-states";
import { cn } from "@/lib/utils";

interface AuditEntry {
  id: string;
  user_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: any;
  created_at: string;
}

const PAGE_SIZE = 20;

const actionColors: Record<string, string> = {
  create: "bg-emerald-500/15 text-emerald-400",
  update: "bg-primary/15 text-primary",
  delete: "bg-red-500/15 text-red-400",
  login: "bg-amber-500/15 text-amber-400",
  sync: "bg-cyan-500/15 text-cyan-400",
};

// ──────────────────────────────────────────────────────────────
// Helpers to normalize old + new audit-log payload shapes into a
// uniform { changes: { field: { from, to } } } structure.
// ──────────────────────────────────────────────────────────────

interface NormalizedChange { field: string; from: unknown; to: unknown }

function normalizeChanges(details: any): NormalizedChange[] {
  if (!details || typeof details !== "object") return [];

  // New shape: details.changes = { field: {from, to}, ... }
  if (details.changes && typeof details.changes === "object" && !Array.isArray(details.changes)) {
    const ch = details.changes as Record<string, { from: unknown; to: unknown }>;
    return Object.entries(ch).map(([field, v]) => ({ field, from: v?.from, to: v?.to }));
  }

  // Single from/to with optional field hint
  if ("from" in details && "to" in details) {
    const field = (details.field as string) || guessFieldFromKeys(details) || "value";
    return [{ field, from: details.from, to: details.to }];
  }

  // Legacy free-form changes: string[]
  if (Array.isArray(details.changes)) {
    return details.changes.map((s: string) => ({ field: "change", from: null, to: s }));
  }

  return [];
}

function guessFieldFromKeys(d: any): string | null {
  // e.g. order_status update with from/to → field is "status"
  if (d.entity_subtype) return d.entity_subtype;
  return null;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

function humanizeField(f: string): string {
  return f
    .replace(/_/g, " ")
    .replace(/\bid\b/gi, "ID")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildSummary(entry: AuditEntry): string {
  const d = entry.details || {};
  const changes = normalizeChanges(d);
  if (changes.length === 0) {
    // Fallbacks
    if (d.order_number) return `Order #${d.order_number}`;
    if (d.name) return String(d.name);
    if (d.count !== undefined) return `${d.count} item(s)`;
    if (Array.isArray(d.ids)) return `${d.ids.length} item(s)${d.to ? ` → ${d.to}` : ""}`;
    return "—";
  }
  const parts = changes.slice(0, 2).map((c) =>
    `${humanizeField(c.field)}: ${truncate(formatValue(c.from), 18)} → ${truncate(formatValue(c.to), 18)}`
  );
  if (changes.length > 2) parts.push(`+${changes.length - 2} more`);
  return parts.join(", ");
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// ──────────────────────────────────────────────────────────────

export default function AuditLogTab() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("audit_log")
        .select("id, user_email, action, entity_type, entity_id, details, created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      setEntries((data || []) as AuditEntry[]);
      setLoading(false);
    };
    load();
  }, []);

  const actions = useMemo(() => [...new Set(entries.map((e) => e.action))], [entries]);
  const entities = useMemo(() => [...new Set(entries.map((e) => e.entity_type))], [entries]);

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      const q = search.toLowerCase();
      const matchSearch = !q ||
        (e.user_email || "").toLowerCase().includes(q) ||
        e.action.toLowerCase().includes(q) ||
        e.entity_type.toLowerCase().includes(q) ||
        (e.entity_id || "").toLowerCase().includes(q) ||
        JSON.stringify(e.details || {}).toLowerCase().includes(q);
      const matchAction = actionFilter === "all" || e.action === actionFilter;
      const matchEntity = entityFilter === "all" || e.entity_type === entityFilter;
      return matchSearch && matchAction && matchEntity;
    });
  }, [entries, search, actionFilter, entityFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleExport = () => {
    const headers = ["Date", "User", "Action", "Entity", "Entity ID", "Field", "Before", "After"];
    const rows: string[][] = [];
    filtered.forEach((e) => {
      const changes = normalizeChanges(e.details);
      const baseRow = [
        format(new Date(e.created_at), "yyyy-MM-dd HH:mm"),
        e.user_email || "",
        e.action,
        e.entity_type,
        e.entity_id || "",
      ];
      if (changes.length === 0) {
        rows.push([...baseRow, "", "", JSON.stringify(e.details || {})]);
      } else {
        changes.forEach((c) => {
          rows.push([...baseRow, c.field, formatValue(c.from), formatValue(c.to)]);
        });
      }
    });
    downloadCsv(`audit-log-${format(new Date(), "yyyy-MM-dd")}.csv`, headers, rows);
  };

  if (loading) return <TableSkeleton rows={8} cols={5} />;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-4 sm:p-6">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <div>
            <h2 className="font-heading text-lg font-semibold">Activity Log</h2>
            <p className="text-sm text-muted-foreground">Track every change with full before / after detail.</p>
          </div>
          <Button variant="outline" size="sm" onClick={handleExport} className="gap-1.5">
            <Download className="h-4 w-4" /> Export
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search user, action, entity, value..." className="pl-9" />
          </div>
          <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v); setPage(1); }}>
            <SelectTrigger className="w-[140px]"><SelectValue placeholder="Action" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Actions</SelectItem>
              {actions.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={entityFilter} onValueChange={(v) => { setEntityFilter(v); setPage(1); }}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Entity" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Entities</SelectItem>
              {entities.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary hover:bg-secondary">
                <TableHead className="w-[40px]"></TableHead>
                <TableHead className="w-[150px]">Date</TableHead>
                <TableHead className="w-[200px]">User</TableHead>
                <TableHead className="w-[100px]">Action</TableHead>
                <TableHead className="w-[180px]">Entity</TableHead>
                <TableHead>Change Summary</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginated.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                    No audit log entries found
                  </TableCell>
                </TableRow>
              ) : paginated.map((entry) => {
                const changes = normalizeChanges(entry.details);
                const isOpen = expanded.has(entry.id);
                const hasDetail = changes.length > 0 || (entry.details && Object.keys(entry.details).length > 0);
                return (
                  <Fragment key={entry.id}>
                    <TableRow className={cn("group", hasDetail && "cursor-pointer")} onClick={() => hasDetail && toggleExpand(entry.id)}>
                      <TableCell>
                        {hasDetail ? (
                          isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        ) : null}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {format(new Date(entry.created_at), "MMM d, h:mm a")}
                      </TableCell>
                      <TableCell className="text-sm truncate max-w-[200px]">{entry.user_email || "System"}</TableCell>
                      <TableCell>
                        <Badge className={actionColors[entry.action] || "bg-muted text-muted-foreground"}>
                          {entry.action}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">{entry.entity_type}</div>
                        {entry.entity_id && (
                          <div className="text-[11px] text-muted-foreground font-mono">#{entry.entity_id.slice(0, 8)}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {buildSummary(entry)}
                      </TableCell>
                    </TableRow>
                    {isOpen && hasDetail && (
                      <TableRow key={entry.id + "-detail"} className="bg-muted/20 hover:bg-muted/20">
                        <TableCell colSpan={6} className="p-0">
                          <DiffPanel entry={entry} changes={changes} />
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-3 text-sm text-muted-foreground">
            <span>Page {page} of {totalPages} ({filtered.length} entries)</span>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Detail panel: side-by-side before/after for changed fields,
// plus extra context fields (order_number etc.) and raw JSON.
// ──────────────────────────────────────────────────────────────
function DiffPanel({ entry, changes }: { entry: AuditEntry; changes: NormalizedChange[] }) {
  const d = entry.details || {};
  // Surface extra context fields (anything not in changes/before/after)
  const reservedKeys = new Set(["changes", "before", "after", "from", "to", "field"]);
  const contextEntries = Object.entries(d).filter(([k, v]) =>
    !reservedKeys.has(k) && v !== null && v !== undefined && v !== ""
  );

  return (
    <div className="p-4 space-y-4 border-t border-border">
      {contextEntries.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {contextEntries.map(([k, v]) => (
            <div key={k}>
              <span className="text-muted-foreground">{humanizeField(k)}: </span>
              <span className="font-mono text-foreground">{truncate(formatValue(v), 80)}</span>
            </div>
          ))}
        </div>
      )}

      {changes.length > 0 ? (
        <div className="rounded-md border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left font-medium text-xs uppercase tracking-wide text-muted-foreground px-3 py-2 w-[180px]">Field</th>
                <th className="text-left font-medium text-xs uppercase tracking-wide text-muted-foreground px-3 py-2">Before</th>
                <th className="w-[40px]"></th>
                <th className="text-left font-medium text-xs uppercase tracking-wide text-muted-foreground px-3 py-2">After</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((c, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-3 py-2 align-top font-medium text-foreground">{humanizeField(c.field)}</td>
                  <td className="px-3 py-2 align-top">
                    <code className="block whitespace-pre-wrap break-all font-mono text-xs rounded bg-red-500/10 text-red-300 px-2 py-1">
                      {formatValue(c.from)}
                    </code>
                  </td>
                  <td className="px-2 py-2 align-top text-muted-foreground"><ArrowRight className="h-3.5 w-3.5" /></td>
                  <td className="px-3 py-2 align-top">
                    <code className="block whitespace-pre-wrap break-all font-mono text-xs rounded bg-emerald-500/10 text-emerald-300 px-2 py-1">
                      {formatValue(c.to)}
                    </code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-xs text-muted-foreground italic">No field-level diff recorded for this action.</div>
      )}

      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Raw payload</summary>
        <pre className="mt-2 max-h-[300px] overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] bg-background border border-border rounded p-2">
{JSON.stringify(entry.details, null, 2)}
        </pre>
      </details>
    </div>
  );
}
