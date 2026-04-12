import { useEffect, useState } from "react";
import { Globe, Wifi, WifiOff, Plus, RefreshCw, Trash2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import StatusBadge from "@/components/StatusBadge";
import { StatsSkeleton } from "@/components/ui/loading-states";

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
  const [dialogOpen, setDialogOpen] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: "", url: "", consumer_key: "", consumer_secret: "" });
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const loadStores = async () => {
    const { data: storesData } = await supabase.from("stores").select("id, name, url, status, last_synced_at");
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

  useEffect(() => { loadStores(); }, []);

  const handleAddStore = async () => {
    if (!formData.name || !formData.url) return;
    setSaving(true);
    const { error } = await supabase.from("stores").insert({
      name: formData.name,
      url: formData.url.replace(/\/+$/, ""),
      consumer_key: formData.consumer_key || null,
      consumer_secret: formData.consumer_secret || null,
    });
    setSaving(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Store added" });
      setDialogOpen(false);
      setFormData({ name: "", url: "", consumer_key: "", consumer_secret: "" });
      loadStores();
    }
  };

  const handleSync = async (storeId: string) => {
    setSyncingId(storeId);
    try {
      const { data, error } = await supabase.functions.invoke("woo-sync", {
        body: { store_id: storeId },
      });
      if (error) throw error;
      toast({
        title: "Sync complete",
        description: `Products: ${data.summary.products}, Orders: ${data.summary.orders}, Customers: ${data.summary.customers}`,
      });
      loadStores();
    } catch (err: any) {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    } finally {
      setSyncingId(null);
    }
  };

  const handleDelete = async (storeId: string) => {
    const { error } = await supabase.from("stores").delete().eq("id", storeId);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Store deleted" });
      loadStores();
    }
  };

  if (loading) return (
    <div className="space-y-6">
      <div><h1 className="font-heading text-2xl font-semibold">Stores</h1></div>
      <StatsSkeleton count={3} />
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Stores</h1>
          <p className="text-sm text-muted-foreground">Connected storefronts & channels</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Add Store</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add WooCommerce Store</DialogTitle>
              <DialogDescription>Enter your store details and WooCommerce REST API credentials.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>Store Name</Label>
                <Input placeholder="My Store" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Store URL</Label>
                <Input placeholder="https://mystore.com" value={formData.url} onChange={(e) => setFormData({ ...formData, url: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Consumer Key</Label>
                <Input placeholder="ck_..." value={formData.consumer_key} onChange={(e) => setFormData({ ...formData, consumer_key: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Consumer Secret</Label>
                <Input type="password" placeholder="cs_..." value={formData.consumer_secret} onChange={(e) => setFormData({ ...formData, consumer_secret: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleAddStore} disabled={saving || !formData.name || !formData.url}>
                {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Add Store
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {stores.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
          <Globe className="h-10 w-10" />
          <p>No stores connected yet. Add your first WooCommerce store.</p>
        </div>
      ) : (
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
                    <p className="text-xs text-muted-foreground truncate max-w-[180px]">{store.url}</p>
                  </div>
                </div>
                <StatusBadge status={store.status} />
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

              {store.last_synced_at && (
                <p className="text-xs text-muted-foreground">
                  Last synced: {new Date(store.last_synced_at).toLocaleString()}
                </p>
              )}

              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  disabled={syncingId === store.id}
                  onClick={() => handleSync(store.id)}
                >
                  {syncingId === store.id ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-1" />
                  )}
                  Sync Now
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete Store</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will remove the store connection. Synced products and orders will remain in the database.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => handleDelete(store.id)}>Delete</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Stores;
