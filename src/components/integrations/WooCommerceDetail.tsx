import { useState } from "react";
import { Globe, RefreshCw, Trash2, Loader2, ExternalLink, CheckCircle, Webhook, Eye, EyeOff, Pencil, Save, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

interface Props {
  store: {
    id: string;
    name: string;
    url: string;
    status: string;
    last_synced_at: string | null;
    orderCount: number;
    productCount: number;
    consumer_key?: string;
    consumer_secret?: string;
  };
  syncingId: string | null;
  onSync: (id: string) => void;
  onDelete: (id: string) => void;
  onRefresh: () => void;
}

const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/woo-webhook`;

const WooCommerceDetail = ({ store, syncingId, onSync, onDelete, onRefresh }: Props) => {
  const [showKey, setShowKey] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: store.name,
    url: store.url,
    consumer_key: store.consumer_key || "",
    consumer_secret: store.consumer_secret || "",
  });
  const { toast } = useToast();

  const handleSave = async () => {
    setSaving(true);
    const { error } = await supabase.from("stores").update({
      name: form.name,
      url: form.url.replace(/\/+$/, ""),
      consumer_key: form.consumer_key || null,
      consumer_secret: form.consumer_secret || null,
    }).eq("id", store.id);
    setSaving(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Store updated" });
      setEditing(false);
      onRefresh();
    }
  };

  return (
    <div className="space-y-4 max-w-2xl">
      {/* Connection Info */}
      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-lg font-semibold">Connection Details</h2>
          <div className="flex items-center gap-2">
            {!editing && (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)} className="gap-1.5">
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
            )}
            <Badge className={`border-0 text-xs ${store.status === "connected" ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
              {store.status === "connected" ? <><CheckCircle className="h-3 w-3 mr-1" /> Connected</> : store.status}
            </Badge>
          </div>
        </div>

        {editing ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Store Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Store URL</Label>
              <Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Consumer Key</Label>
              <Input value={form.consumer_key} onChange={(e) => setForm({ ...form, consumer_key: e.target.value })} placeholder="ck_..." />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Consumer Secret</Label>
              <Input type="password" value={form.consumer_secret} onChange={(e) => setForm({ ...form, consumer_secret: e.target.value })} placeholder="cs_..." />
            </div>
            <div className="flex gap-2 pt-2">
              <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setEditing(false); setForm({ name: store.name, url: store.url, consumer_key: store.consumer_key || "", consumer_secret: store.consumer_secret || "" }); }}>
                <X className="h-3.5 w-3.5 mr-1" /> Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 text-sm">
            <div className="flex justify-between py-2 border-b border-border">
              <span className="text-muted-foreground">Store URL</span>
              <a href={store.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-primary hover:underline">
                {store.url} <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <div className="flex justify-between py-2 border-b border-border">
              <span className="text-muted-foreground">Orders Synced</span>
              <span className="font-medium">{store.orderCount}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-border">
              <span className="text-muted-foreground">Products Synced</span>
              <span className="font-medium">{store.productCount}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-border">
              <span className="text-muted-foreground">Last Synced</span>
              <span className="font-medium">{store.last_synced_at ? new Date(store.last_synced_at).toLocaleString() : "Never"}</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-muted-foreground">Auto-Sync</span>
              <span className="font-medium text-success">Every 15 minutes</span>
            </div>
          </div>
        )}
      </div>

      {/* API Credentials (view mode only) */}
      {!editing && (
        <div className="rounded-lg border border-border bg-card p-6 space-y-3">
          <h2 className="font-heading text-lg font-semibold">API Credentials</h2>
          <div className="grid gap-2 text-sm">
            <div className="flex items-center justify-between py-2 border-b border-border">
              <span className="text-muted-foreground text-xs">Consumer Key</span>
              <div className="flex items-center gap-2">
                <code className="text-xs font-mono max-w-[220px] truncate">
                  {showKey ? (store.consumer_key || "Not set") : "••••••••••••"}
                </code>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowKey(!showKey)} aria-label={showKey ? "Hide consumer key" : "Show consumer key"}>
                  {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-muted-foreground text-xs">Consumer Secret</span>
              <div className="flex items-center gap-2">
                <code className="text-xs font-mono max-w-[220px] truncate">
                  {showSecret ? (store.consumer_secret || "Not set") : "••••••••••••"}
                </code>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowSecret(!showSecret)} aria-label={showSecret ? "Hide consumer secret" : "Show consumer secret"}>
                  {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Webhook Setup */}
      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Webhook className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-heading text-lg font-semibold">Webhook (Real-time Orders)</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Set up a webhook in WooCommerce (Settings → Advanced → Webhooks) to receive orders instantly.
        </p>
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Delivery URL</p>
          <code className="block rounded-md bg-muted px-3 py-2 text-xs break-all select-all">
            {webhookUrl}
          </code>
        </div>
        <div className="grid grid-cols-2 gap-4 text-xs">
          <div>
            <p className="font-medium text-muted-foreground mb-1">Topic</p>
            <p>Order created</p>
          </div>
          <div>
            <p className="font-medium text-muted-foreground mb-1">Status</p>
            <p>Active</p>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <Button
          variant="outline"
          disabled={syncingId === store.id}
          onClick={() => onSync(store.id)}
          className="gap-1.5"
        >
          {syncingId === store.id ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Sync Now
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="default" className="gap-1.5">
              <Trash2 className="h-4 w-4" /> Remove Integration
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove WooCommerce Store</AlertDialogTitle>
              <AlertDialogDescription>
                This will remove the store connection. Synced products and orders will remain in the database.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => onDelete(store.id)}>Remove</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
};

export default WooCommerceDetail;
