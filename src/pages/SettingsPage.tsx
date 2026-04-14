import { useState, useEffect } from "react";
import { Settings, Package, Plug, Store, RefreshCw, CheckCircle, AlertTriangle, FileText, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useTheme } from "@/hooks/useTheme";
import InvoiceSettingsTab from "@/components/settings/InvoiceSettingsTab";
import AuditLogTab from "@/components/settings/AuditLogTab";

const tabs = [
  { id: "general", label: "General", icon: Settings },
  { id: "inventory", label: "Inventory", icon: Package },
  { id: "invoice", label: "Invoice", icon: FileText },
  { id: "integrations", label: "Integrations", icon: Plug },
  { id: "audit", label: "Activity Log", icon: ScrollText },
] as const;

type TabId = (typeof tabs)[number]["id"];

interface StoreRow {
  id: string;
  name: string;
  url: string;
  status: string;
  last_synced_at: string | null;
}

const SettingsPage = () => {
  const [activeTab, setActiveTab] = useState<TabId>("general");
  const [globalStock, setGlobalStock] = useState(true);
  const [saving, setSaving] = useState(false);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [syncingStoreId, setSyncingStoreId] = useState<string | null>(null);
  const { theme, toggleTheme } = useTheme();

  // Business settings
  const [businessName, setBusinessName] = useState(() => localStorage.getItem("omnisync-business-name") || "OmniSync");
  const [currency, setCurrency] = useState(() => localStorage.getItem("omnisync-currency") || "৳");
  const [timezone, setTimezone] = useState(() => localStorage.getItem("omnisync-timezone") || "Asia/Dhaka");

  useEffect(() => {
    supabase.from("stores").select("id, name, url, status, last_synced_at").order("name").then(({ data }) => {
      setStores((data || []) as StoreRow[]);
    });
  }, []);

  const handleSaveGeneral = () => {
    localStorage.setItem("omnisync-business-name", businessName);
    localStorage.setItem("omnisync-currency", currency);
    localStorage.setItem("omnisync-timezone", timezone);
    toast.success("Settings saved");
  };

  const handleSaveInventory = () => {
    setSaving(true);
    localStorage.setItem("omnisync-global-stock", String(globalStock));
    setTimeout(() => { setSaving(false); toast.success("Inventory settings saved"); }, 400);
  };

  const handleSyncStore = async (storeId: string) => {
    setSyncingStoreId(storeId);
    try {
      await supabase.functions.invoke("woo-sync", { body: { store_id: storeId } });
      toast.success("Sync completed");
      const { data } = await supabase.from("stores").select("id, name, url, status, last_synced_at").order("name");
      setStores((data || []) as StoreRow[]);
    } catch {
      toast.error("Sync failed");
    }
    setSyncingStoreId(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">System configuration</p>
      </div>

      <div className="flex gap-6">
        {/* Left nav */}
        <nav className="w-48 shrink-0 space-y-0.5">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                activeTab === t.id
                  ? "bg-secondary text-foreground font-medium"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
              )}
            >
              <t.icon className="h-4 w-4" />
              {t.label}
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="flex-1 max-w-2xl space-y-4">
          {activeTab === "general" && (
            <div className="rounded-lg border border-border bg-card p-6 space-y-6">
              <div>
                <h2 className="font-heading text-lg font-semibold mb-1">General Settings</h2>
                <p className="text-sm text-muted-foreground">Basic system preferences and defaults.</p>
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Business Name</Label>
                  <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Currency Symbol</Label>
                    <Input value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-24" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Timezone</Label>
                    <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} />
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border p-4">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium">Theme</Label>
                    <p className="text-xs text-muted-foreground">Switch between dark and light mode</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={toggleTheme} className="gap-2">
                    {theme === "dark" ? "☀️ Light Mode" : "🌙 Dark Mode"}
                  </Button>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <Button onClick={handleSaveGeneral}>Save Changes</Button>
              </div>
            </div>
          )}

          {activeTab === "inventory" && (
            <div className="rounded-lg border border-border bg-card p-6 space-y-6">
              <div>
                <h2 className="font-heading text-lg font-semibold mb-1">Inventory Settings</h2>
                <p className="text-sm text-muted-foreground">Control how stock is tracked across all channels.</p>
              </div>

              <div className="rounded-lg border border-border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium">Enable Global Stock Management</Label>
                    <p className="text-xs text-muted-foreground leading-relaxed max-w-md">
                      When enabled, the system tracks inventory quantities for all products and
                      variations across POS and WooCommerce stores.
                    </p>
                  </div>
                  <Switch checked={globalStock} onCheckedChange={setGlobalStock} />
                </div>

                {!globalStock && (
                  <div className="rounded-md bg-warning/10 border border-warning/20 px-3 py-2">
                    <p className="text-xs text-warning font-medium">
                      ⚠ Stock management is disabled. Products will show unlimited availability.
                    </p>
                  </div>
                )}
              </div>

              <div className="flex justify-end pt-2">
                <Button onClick={handleSaveInventory} disabled={saving}>
                  {saving ? "Saving…" : "Save Changes"}
                </Button>
              </div>
            </div>
          )}

          {activeTab === "invoice" && <InvoiceSettingsTab />}

          {activeTab === "integrations" && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-card p-6">
                <h2 className="font-heading text-lg font-semibold mb-1">Integrations</h2>
                <p className="text-sm text-muted-foreground mb-6">Manage connected WooCommerce stores and API services.</p>

                {stores.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Store className="h-10 w-10 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No stores connected yet. Go to Stores page to add one.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {stores.map((s) => (
                      <div key={s.id} className="flex items-center justify-between rounded-lg border border-border p-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Store className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm font-medium">{s.name}</span>
                            <Badge variant={s.status === "connected" ? "default" : "secondary"} className={s.status === "connected" ? "bg-success/15 text-success border-0" : ""}>
                              {s.status === "connected" ? <><CheckCircle className="h-3 w-3 mr-1" /> Connected</> : s.status}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">{s.url}</p>
                          {s.last_synced_at && (
                            <p className="text-xs text-muted-foreground">
                              Last synced: {new Date(s.last_synced_at).toLocaleString()}
                            </p>
                          )}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={syncingStoreId === s.id}
                          onClick={() => handleSyncStore(s.id)}
                          className="gap-1.5"
                        >
                          <RefreshCw className={`h-3.5 w-3.5 ${syncingStoreId === s.id ? "animate-spin" : ""}`} />
                          Sync
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-border bg-card p-6">
                <h3 className="text-sm font-semibold mb-3">Pathao Courier</h3>
                <div className="flex items-center gap-2">
                  <Badge className="bg-success/15 text-success border-0">
                    <CheckCircle className="h-3 w-3 mr-1" /> Connected
                  </Badge>
                  <span className="text-xs text-muted-foreground">Production API</span>
                </div>
              </div>
            </div>
          )}

          {activeTab === "audit" && <AuditLogTab />}
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
