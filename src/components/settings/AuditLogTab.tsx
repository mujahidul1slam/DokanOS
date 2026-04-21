import { useEffect, useState, useMemo } from "react";
import { format } from "date-fns";
import { Search, Filter, Download } from "lucide-react";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { downloadCsv } from "@/lib/exportCsv";
import { TableSkeleton } from "@/components/ui/loading-states";

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

export default function AuditLogTab() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");
  const [page, setPage] = useState(1);

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
        (e.entity_id || "").toLowerCase().includes(q);
      const matchAction = actionFilter === "all" || e.action === actionFilter;
      const matchEntity = entityFilter === "all" || e.entity_type === entityFilter;
      return matchSearch && matchAction && matchEntity;
    });
  }, [entries, search, actionFilter, entityFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleExport = () => {
    const headers = ["Date", "User", "Action", "Entity", "Entity ID", "Details"];
    const rows = filtered.map((e) => [
      format(new Date(e.created_at), "yyyy-MM-dd HH:mm"),
      e.user_email || "",
      e.action,
      e.entity_type,
      e.entity_id || "",
      JSON.stringify(e.details || {}),
    ]);
    downloadCsv(`audit-log-${format(new Date(), "yyyy-MM-dd")}.csv`, headers, rows);
  };

  if (loading) return <TableSkeleton rows={8} cols={5} />;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-heading text-lg font-semibold">Activity Log</h2>
            <p className="text-sm text-muted-foreground">Track all system activities and changes</p>
          </div>
          <Button variant="outline" size="sm" onClick={handleExport} className="gap-1.5">
            <Download className="h-4 w-4" /> Export
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search user, action, entity..." className="pl-9" />
          </div>
          <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v); setPage(1); }}>
            <SelectTrigger className="w-[140px]"><SelectValue placeholder="Action" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Actions</SelectItem>
              {actions.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={entityFilter} onValueChange={(v) => { setEntityFilter(v); setPage(1); }}>
            <SelectTrigger className="w-[140px]"><SelectValue placeholder="Entity" /></SelectTrigger>
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
                <TableHead className="w-[140px]">Date</TableHead>
                <TableHead className="w-[220px]">User</TableHead>
                <TableHead className="w-[120px]">Action</TableHead>
                <TableHead className="w-[200px]">Entity</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginated.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                    No audit log entries found
                  </TableCell>
                </TableRow>
              ) : paginated.map((entry) => {
                const detailsStr = entry.details ? JSON.stringify(entry.details, null, 2) : "—";
                const detailsPreview = entry.details ? JSON.stringify(entry.details) : "—";
                return (
                  <TableRow key={entry.id}>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {format(new Date(entry.created_at), "MMM d, h:mm a")}
                    </TableCell>
                    <TableCell className="text-sm">{entry.user_email || "System"}</TableCell>
                    <TableCell>
                      <Badge className={actionColors[entry.action] || "bg-muted text-muted-foreground"}>
                        {entry.action}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{entry.entity_type}</span>
                      {entry.entity_id && (
                        <span className="text-xs text-muted-foreground ml-1">#{entry.entity_id.slice(0, 8)}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <TooltipProvider delayDuration={150}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className="block w-full max-w-[600px] truncate text-left cursor-help font-mono"
                              title=""
                            >
                              {detailsPreview}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent
                            side="left"
                            align="start"
                            className="max-w-[520px] max-h-[400px] overflow-auto whitespace-pre-wrap break-all font-mono text-xs"
                          >
                            {detailsStr}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableCell>
                  </TableRow>
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
