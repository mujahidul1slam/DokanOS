import { useState } from "react";
import { Settings, Package, FileText, ScrollText, ShoppingCart, Tags, Ruler, Building2, Hash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useTheme } from "@/hooks/useTheme";
import { logAction } from "@/lib/auditLog";
import InvoiceSettingsTab from "@/components/settings/InvoiceSettingsTab";
import PosSettingsTab from "@/components/settings/PosSettingsTab";
import OrdersSettingsTab from "@/components/settings/OrdersSettingsTab";
import AuditLogTab from "@/components/settings/AuditLogTab";
import OrderSourcesTab from "@/components/settings/OrderSourcesTab";
import MeasurementsTab from "@/components/settings/MeasurementsTab";
import BusinessProfileTab from "@/components/settings/BusinessProfileTab";
import InstallAppButton from "@/components/InstallAppButton";
import { getGlobalStockEnabled, setGlobalStockEnabled } from "@/lib/stockSettings";

const tabs = [
  { id: "general", label: "General", icon: Settings },
  { id: "business", label: "Business Profile", icon: Building2 },
  { id: "inventory", label: "Inventory", icon: Package },
  { id: "pos", label: "POS Settings", icon: ShoppingCart },
  { id: "orders", label: "Orders", icon: Hash },
  { id: "measurements", label: "Measurements", icon: Ruler },
  { id: "invoice", label: "Invoice/Pick up Slip", icon: FileText },
  { id: "sources", label: "Order Sources", icon: Tags },
  { id: "audit", label: "Activity Log", icon: ScrollText },
] as const;

type TabId = (typeof tabs)[number]["id"];

const SettingsPage = () => {
  const [activeTab, setActiveTab] = useState<TabId>("general");
  const [globalStock, setGlobalStock] = useState<boolean>(() => getGlobalStockEnabled());
  const [saving, setSaving] = useState(false);
  const { theme, toggleTheme } = useTheme();

  // Business settings
  const [businessName, setBusinessName] = useState(() => localStorage.getItem("omnisync-business-name") || "OmniSync");
  const [currency, setCurrency] = useState(() => localStorage.getItem("omnisync-currency") || "৳");
  const [timezone, setTimezone] = useState(() => localStorage.getItem("omnisync-timezone") || "Asia/Dhaka");

  const handleSaveGeneral = () => {
    localStorage.setItem("omnisync-business-name", businessName);
    localStorage.setItem("omnisync-currency", currency);
    localStorage.setItem("omnisync-timezone", timezone);
    logAction("update", "settings_general", undefined, { businessName, currency, timezone });
    toast.success("Settings saved");
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
        <div className={cn("flex-1 space-y-4", activeTab === "audit" ? "max-w-none" : "max-w-2xl")}>
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

                <InstallAppButton />
              </div>

              <div className="flex justify-end pt-2">
                <Button onClick={handleSaveGeneral}>Save Changes</Button>
              </div>
            </div>
          )}

          {activeTab === "business" && <BusinessProfileTab />}

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
                <Button onClick={() => { setSaving(true); setGlobalStockEnabled(globalStock); logAction("update", "settings_inventory", undefined, { globalStock }); toast.success("Inventory settings saved"); setSaving(false); }} disabled={saving}>
                  {saving ? "Saving…" : "Save Changes"}
                </Button>
              </div>
            </div>
          )}

          {activeTab === "pos" && <PosSettingsTab />}

          {activeTab === "orders" && <OrdersSettingsTab />}

          {activeTab === "invoice" && <InvoiceSettingsTab />}

          {activeTab === "sources" && <OrderSourcesTab />}

          {activeTab === "measurements" && <MeasurementsTab />}

          {activeTab === "audit" && <AuditLogTab />}
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
