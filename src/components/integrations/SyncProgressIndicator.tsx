import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Progress } from "@/components/ui/progress";

interface SyncingStore {
  id: string;
  name: string;
  startedAt: number; // ms timestamp when we first saw this store as syncing
}

interface Props {
  /** Stores currently syncing (status === "syncing") */
  syncingStores: { id: string; name: string; updated_at?: string | null }[];
}

/**
 * Floating bottom-right indicator for in-progress syncs.
 * Since woo-sync runs in the background without granular progress,
 * we display an indeterminate animated bar plus elapsed time.
 */
const SyncProgressIndicator = ({ syncingStores }: Props) => {
  const [tracked, setTracked] = useState<Map<string, SyncingStore>>(new Map());
  const [now, setNow] = useState(Date.now());

  // Reconcile: add new syncing stores, remove ones that are no longer syncing
  useEffect(() => {
    setTracked((prev) => {
      const next = new Map(prev);
      const activeIds = new Set(syncingStores.map((s) => s.id));

      // Remove finished
      for (const id of next.keys()) {
        if (!activeIds.has(id)) next.delete(id);
      }
      // Add new
      for (const s of syncingStores) {
        if (!next.has(s.id)) {
          next.set(s.id, {
            id: s.id,
            name: s.name,
            startedAt: s.updated_at ? new Date(s.updated_at).getTime() : Date.now(),
          });
        }
      }
      return next;
    });
  }, [syncingStores]);

  // Tick clock for elapsed display while any sync is active
  useEffect(() => {
    if (tracked.size === 0) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [tracked.size]);

  if (tracked.size === 0) return null;

  const items = Array.from(tracked.values());

  const formatElapsed = (start: number) => {
    const sec = Math.max(0, Math.floor((now - start) / 1000));
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m ${s}s`;
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card shadow-lg overflow-hidden animate-in slide-in-from-bottom-4">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-secondary/40">
        <RefreshCw className="h-3.5 w-3.5 text-primary animate-spin" />
        <p className="text-xs font-medium text-card-foreground flex-1">
          Syncing {items.length} {items.length === 1 ? "store" : "stores"}…
        </p>
      </div>
      <div className="divide-y divide-border max-h-64 overflow-y-auto">
        {items.map((s) => (
          <div key={s.id} className="px-4 py-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Loader2 className="h-3 w-3 text-muted-foreground animate-spin shrink-0" />
                <p className="text-xs font-medium text-card-foreground truncate">{s.name}</p>
              </div>
              <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">
                {formatElapsed(s.startedAt)}
              </span>
            </div>
            <IndeterminateBar />
          </div>
        ))}
      </div>
    </div>
  );
};

const IndeterminateBar = () => (
  <div className="relative h-1 w-full overflow-hidden rounded-full bg-secondary">
    <div className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-primary animate-[sync-slide_1.4s_ease-in-out_infinite]" />
    <style>{`
      @keyframes sync-slide {
        0%   { transform: translateX(-100%); }
        100% { transform: translateX(400%); }
      }
    `}</style>
  </div>
);

export default SyncProgressIndicator;
