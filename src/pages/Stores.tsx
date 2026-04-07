import { useEffect, useState } from "react";
import { Globe, Wifi, WifiOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface StoreRow {
  id: string;
  name: string;
  url: string;
  status: string;
  last_synced_at: string | null;
  orderCount: number;
  productCount: number;
}

const Stores = () => {
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const { data: storesData } = await supabase.from("stores").select("id, name, url, status, last_synced_at");

      // Get counts per store
      const storeRows: StoreRow[] = [];
      for (const s of storesData || []) {
        const [{ count: orderCount }, { count: productCount }] = await Promise.all([
          supabase.from("orders").select("id", { count: "exact", head: true }).eq("store_id", s.id),
          supabase.from("products").select("id", { count: "exact", head: true }).eq("store_id", s.id),
        ]);
        storeRows.push({ ...s, orderCount: orderCount || 0, productCount: productCount || 0 });
      }
      setStores(storeRows);
      setLoading(false);
    };
    load();
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64 text-muted-foreground">Loading...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Stores</h1>
        <p className="text-sm text-muted-foreground">Connected storefronts & channels</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {stores.map((store) => (
          <div key={store.id} className="rounded-lg border border-border bg-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="font-heading text-sm font-semibold text-card-foreground">{store.name}</p>
                  <p className="text-xs text-muted-foreground">{store.url}</p>
                </div>
              </div>
              {store.status === "connected" ? (
                <Wifi className="h-4 w-4 text-success" />
              ) : (
                <WifiOff className="h-4 w-4 text-destructive" />
              )}
            </div>
            <div className="flex gap-6">
              <div>
                <p className="font-heading text-lg font-semibold text-card-foreground">{store.orderCount}</p>
                <p className="text-xs text-muted-foreground">Orders</p>
              </div>
              <div>
                <p className="font-heading text-lg font-semibold text-card-foreground">{store.productCount}</p>
                <p className="text-xs text-muted-foreground">Products</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Stores;
