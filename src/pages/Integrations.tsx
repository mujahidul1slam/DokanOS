import { useEffect, useState } from "react";
import {
  Globe, Truck, Plus, RefreshCw, Trash2, Loader2, ChevronLeft,
  CheckCircle, AlertTriangle, Settings2, ExternalLink,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { StatsSkeleton } from "@/components/ui/loading-states";
import WooCommerceDetail from "@/components/integrations/WooCommerceDetail";
import PathaoDetail from "@/components/integrations/PathaoDetail";

interface StoreRow {
  id: string;
  name: string;
  url: string;
  status: string;
  last_synced_at: string | null;
  orderCount: number;
  productCount: number;
}

type DetailView = { type: "woocommerce"; store: StoreRow } | { type: "pathao" } | null;

const Integrations = () => {
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [addType, setAddType] = useState<"woocommerce" | "pathao" | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: "", url: "", consumer_key: "", consumer_secret: "" });
  const [pathaoForm, setPathaoForm] = useState({ client_id: "", client_secret: "", username: "", password: "" });
  const [saving, setSaving] = useState(false);
  const [detailView, setDetailView] = useState<DetailView>(null);
  const { toast } = useToast();

  // Check if Pathao is connected (secrets exist)
  const [pathaoConnected, setPathaoConnected] = useState(true); // Secrets are already configured

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
      toast({ title: "WooCommerce store added" });
      setAddType(null);
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

  // Detail views
  if (detailView) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setDetailView(null)}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="font-heading text-2xl font-semibold">
              {detailView.type === "woocommerce" ? detailView.store.name : "Pathao Courier"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {detailView.type === "woocommerce" ? "WooCommerce Integration" : "Courier Integration"}
            </p>
          </div>
        </div>
        {detailView.type === "woocommerce" ? (
          <WooCommerceDetail
            store={detailView.store}
            syncingId={syncingId}
            onSync={handleSync}
            onDelete={(id) => { handleDelete(id); setDetailView(null); }}
            onRefresh={loadStores}
          />
        ) : (
          <PathaoDetail />
        )}
      </div>
    );
  }

  if (loading) return (
    <div className="space-y-6">
      <div><h1 className="font-heading text-2xl font-semibold">Integrations</h1></div>
      <StatsSkeleton count={3} />
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Integrations</h1>
          <p className="text-sm text-muted-foreground">Connected services & channels</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Add Integration</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setAddType("woocommerce")}>
              <Globe className="h-4 w-4 mr-2" /> WooCommerce Store
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setAddType("pathao")} disabled={pathaoConnected}>
              <Truck className="h-4 w-4 mr-2" /> Pathao Courier
              {pathaoConnected && <span className="ml-2 text-xs text-muted-foreground">(Connected)</span>}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Connected Integrations */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* Pathao Card */}
        {pathaoConnected && (
          <button
            onClick={() => setDetailView({ type: "pathao" })}
            className="rounded-lg border border-border bg-card p-5 space-y-4 text-left hover:border-primary/40 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-orange-500/15">
                  <Truck className="h-4 w-4 text-orange-500" />
                </div>
                <div>
                  <p className="font-heading text-sm font-semibold text-card-foreground">Pathao Courier</p>
                  <p className="text-xs text-muted-foreground">Delivery & logistics</p>
                </div>
              </div>
              <Badge className="bg-success/15 text-success border-0 text-xs">
                <CheckCircle className="h-3 w-3 mr-1" /> Connected
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Bulk dispatch, tracking, city/zone/area lookups
            </p>
          </button>
        )}

        {/* WooCommerce Store Cards */}
        {stores.map((store) => (
          <button
            key={store.id}
            onClick={() => setDetailView({ type: "woocommerce", store })}
            className="rounded-lg border border-border bg-card p-5 space-y-4 text-left hover:border-primary/40 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-purple-500/15">
                  <Globe className="h-4 w-4 text-purple-500" />
                </div>
                <div>
                  <p className="font-heading text-sm font-semibold text-card-foreground">{store.name}</p>
                  <p className="text-xs text-muted-foreground truncate max-w-[180px]">{store.url}</p>
                </div>
              </div>
              <Badge className={`border-0 text-xs ${store.status === "connected" ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
                {store.status === "connected" ? <><CheckCircle className="h-3 w-3 mr-1" /> Connected</> : store.status}
              </Badge>
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
          </button>
        ))}
      </div>

      {stores.length === 0 && !pathaoConnected && (
        <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
          <Settings2 className="h-10 w-10" />
          <p>No integrations connected yet.</p>
        </div>
      )}

      {/* Add WooCommerce Dialog */}
      <Dialog open={addType === "woocommerce"} onOpenChange={(o) => !o && setAddType(null)}>
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
  );
};

export default Integrations;
