import { Globe, RefreshCw, Trash2, Loader2, ExternalLink, CheckCircle, Webhook } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface Props {
  store: {
    id: string;
    name: string;
    url: string;
    status: string;
    last_synced_at: string | null;
    orderCount: number;
    productCount: number;
  };
  syncingId: string | null;
  onSync: (id: string) => void;
  onDelete: (id: string) => void;
  onRefresh: () => void;
}

const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/woo-webhook`;

const WooCommerceDetail = ({ store, syncingId, onSync, onDelete }: Props) => {
  return (
    <div className="space-y-4 max-w-2xl">
      {/* Connection Info */}
      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-lg font-semibold">Connection Details</h2>
          <Badge className={`border-0 text-xs ${store.status === "connected" ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
            {store.status === "connected" ? <><CheckCircle className="h-3 w-3 mr-1" /> Connected</> : store.status}
          </Badge>
        </div>

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
      </div>

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
