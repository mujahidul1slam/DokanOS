import { useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

interface SyncingStore {
  id: string;
  name: string;
  startedAt: number;
}

const STORAGE_KEY = "omnisync.syncStartTimes.v1";

const loadStarts = (): Record<string, number> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const saveStarts = (data: Record<string, number>) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* ignore */
  }
};

/**
 * Floating, route-persistent indicator for in-progress WooCommerce syncs.
 * Polls `stores` for status === "syncing" every 5s while authenticated.
 * Persists per-store start times in localStorage so elapsed time survives reloads.
 */
const GlobalSyncIndicator = () => {
  const { user } = useAuth();
  const [items, setItems] = useState<SyncingStore[]>([]);
  const [now, setNow] = useState(Date.now());
  const startsRef = useRef<Record<string, number>>(loadStarts());

  // Poll syncing stores
  useEffect(() => {
    if (!user) {
      setItems([]);
      return;
    }
    let cancelled = false;

    const fetchSyncing = async () => {
      const { data, error } = await supabase
        .from("stores")
        .select("id, name, status, updated_at")
        .eq("status", "syncing");
      if (cancelled || error || !data) return;

      const starts = startsRef.current;
      const activeIds = new Set(data.map((s) => s.id));

      // Drop finished
      let changed = false;
      for (const id of Object.keys(starts)) {
        if (!activeIds.has(id)) {
          delete starts[id];
          changed = true;
        }
      }
      // Add new
      for (const s of data) {
        if (!starts[s.id]) {
          starts[s.id] = s.updated_at ? new Date(s.updated_at).getTime() : Date.now();
          changed = true;
        }
      }
      if (changed) saveStarts(starts);

      setItems(
        data.map((s) => ({
          id: s.id,
          name: s.name,
          startedAt: starts[s.id],
        })),
      );
    };

    fetchSyncing();
    const id = setInterval(fetchSyncing, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [user]);

  // Tick clock while active
  useEffect(() => {
    if (items.length === 0) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [items.length]);

  if (!user || items.length === 0) return null;

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
            <div className="relative h-1 w-full overflow-hidden rounded-full bg-secondary">
              <div className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-primary animate-[sync-slide_1.4s_ease-in-out_infinite]" />
            </div>
          </div>
        ))}
      </div>
      <style>{`
        @keyframes sync-slide {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
      `}</style>
    </div>
  );
};

export default GlobalSyncIndicator;
