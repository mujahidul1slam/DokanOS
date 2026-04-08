import { useState } from "react";
import { Settings, Package, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const tabs = [
  { id: "general", label: "General", icon: Settings },
  { id: "inventory", label: "Inventory", icon: Package },
  { id: "integrations", label: "Integrations", icon: Plug },
] as const;

type TabId = (typeof tabs)[number]["id"];

const SettingsPage = () => {
  const [activeTab, setActiveTab] = useState<TabId>("general");
  const [globalStock, setGlobalStock] = useState(true);
  const [saving, setSaving] = useState(false);

  const handleSave = () => {
    setSaving(true);
    setTimeout(() => setSaving(false), 600);
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
        <div className="flex-1 max-w-2xl">
          {activeTab === "general" && (
            <div className="rounded-lg border border-border bg-card p-6">
              <h2 className="font-heading text-lg font-semibold mb-1">General Settings</h2>
              <p className="text-sm text-muted-foreground">Basic system preferences and defaults.</p>
              <div className="mt-6 text-sm text-muted-foreground">General configuration options coming soon.</div>
            </div>
          )}

          {activeTab === "inventory" && (
            <div className="space-y-4">
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
                        variations across POS and WooCommerce stores. Turning this off disables all
                        inventory tracking system-wide — stock counts will not be enforced or synced.
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
                  <Button onClick={handleSave} disabled={saving}>
                    {saving ? "Saving…" : "Save Changes"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {activeTab === "integrations" && (
            <div className="rounded-lg border border-border bg-card p-6">
              <h2 className="font-heading text-lg font-semibold mb-1">Integrations</h2>
              <p className="text-sm text-muted-foreground">Manage connected services and API credentials.</p>
              <div className="mt-6 text-sm text-muted-foreground">Integration management coming soon.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
