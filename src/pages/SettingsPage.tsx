import { useEffect, useMemo, useState } from "react";
import {
  Settings, Package, FileText, ScrollText, ShoppingCart, Tags, Ruler,
  Building2, Hash, Hourglass, Search, ChevronRight, ArrowLeft, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useTheme } from "@/hooks/useTheme";
import { useIsMobile } from "@/hooks/use-mobile";
import { logAction, logChange } from "@/lib/auditLog";
import { SettingsSection, SaveButton } from "@/components/settings/SettingsSection";
import InvoiceSettingsTab from "@/components/settings/InvoiceSettingsTab";
import PosSettingsTab from "@/components/settings/PosSettingsTab";
import OrdersSettingsTab from "@/components/settings/OrdersSettingsTab";
import AuditLogTab from "@/components/settings/AuditLogTab";
import OrderSourcesTab from "@/components/settings/OrderSourcesTab";
import MeasurementsTab from "@/components/settings/MeasurementsTab";
import BusinessProfileTab from "@/components/settings/BusinessProfileTab";
import PreOrdersSettingsTab from "@/components/settings/PreOrdersSettingsTab";
import InstallAppButton from "@/components/InstallAppButton";
import { setGlobalStockEnabled, useGlobalStockEnabled } from "@/lib/stockSettings";

type TabId =
  | "general" | "inventory" | "pos" | "orders"
  | "preorders" | "measurements" | "invoice" | "sources" | "audit";

type TabDef = {
  id: TabId;
  label: string;
  icon: typeof Settings;
  description: string;
  /** extra keywords for search */
  keywords?: string;
};

type GroupDef = {
  id: string;
  label: string;
  tabs: TabDef[];
};

const groups: GroupDef[] = [
  {
    id: "business",
    label: "Business",
    tabs: [
      { id: "general", label: "General & Business Profile", icon: Settings, description: "Name, branding, logo, currency, timezone, theme", keywords: "appearance dark light mode currency timezone install business profile logo contact branding tagline address phone email" },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    tabs: [
      { id: "inventory", label: "Inventory", icon: Package, description: "Global stock management", keywords: "stock quantity tracking" },
      { id: "pos", label: "POS Settings", icon: ShoppingCart, description: "Point of sale preferences", keywords: "checkout receipt sound" },
      { id: "orders", label: "Orders", icon: Hash, description: "Order numbering and rules" },
      { id: "preorders", label: "Pre-Orders", icon: Hourglass, description: "Pre-order categories and behavior", keywords: "preorder categories" },
      { id: "measurements", label: "Measurements", icon: Ruler, description: "Size presets and measurement fields" },
    ],
  },
  {
    id: "documents",
    label: "Documents & Sources",
    tabs: [
      { id: "invoice", label: "Invoice / Pickup Slip", icon: FileText, description: "Print layouts and content" },
      { id: "sources", label: "Order Sources", icon: Tags, description: "Channels orders come from" },
    ],
  },
  {
    id: "system",
    label: "System",
    tabs: [
      { id: "audit", label: "Activity Log", icon: ScrollText, description: "Audit trail of system changes", keywords: "history audit log" },
    ],
  },
];

const allTabs: TabDef[] = groups.flatMap((g) => g.tabs);

const SettingsPage = () => {
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState<TabId | null>(null);
  const [search, setSearch] = useState("");

  const persistedGlobalStock = useGlobalStockEnabled();
  const [globalStock, setGlobalStock] = useState<boolean>(persistedGlobalStock);
  const [saving, setSaving] = useState(false);
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    setGlobalStock(persistedGlobalStock);
  }, [persistedGlobalStock]);

  // On desktop, default to first tab if none selected
  useEffect(() => {
    if (!isMobile && activeTab === null) setActiveTab("general");
  }, [isMobile, activeTab]);

  // Business settings
  const [businessName, setBusinessName] = useState(() => localStorage.getItem("omnisync-business-name") || "DokanOS");
  const [currency, setCurrency] = useState(() => localStorage.getItem("omnisync-currency") || "৳");
  const [timezone, setTimezone] = useState(() => localStorage.getItem("omnisync-timezone") || "Asia/Dhaka");

  const handleSaveGeneral = async () => {
    const before = {
      businessName: localStorage.getItem("omnisync-business-name") || "DokanOS",
      currency: localStorage.getItem("omnisync-currency") || "৳",
      timezone: localStorage.getItem("omnisync-timezone") || "Asia/Dhaka",
    };
    localStorage.setItem("omnisync-business-name", businessName);
    localStorage.setItem("omnisync-currency", currency);
    localStorage.setItem("omnisync-timezone", timezone);
    await logChange("settings_general", undefined, before, { businessName, currency, timezone });
    toast.success("Settings saved");
  };

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => ({
        ...g,
        tabs: g.tabs.filter((t) => {
          const hay = `${t.label} ${t.description} ${t.keywords ?? ""}`.toLowerCase();
          return hay.includes(q);
        }),
      }))
      .filter((g) => g.tabs.length > 0);
  }, [search]);

  const renderContent = (id: TabId) => {
    switch (id) {
      case "general":
        return (
          <div className="space-y-4">
            <SettingsSection
              title="General Settings"
              description="Basic system preferences and defaults."
              footer={<SaveButton onClick={handleSaveGeneral} />}
            >
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Business Name</Label>
                  <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
            </SettingsSection>
            <BusinessProfileTab />
          </div>
        );
      case "inventory":
        return (
          <SettingsSection
            title="Inventory Settings"
            description="Control how stock is tracked across all channels."
            footer={
              <SaveButton
                saving={saving}
                onClick={async () => {
                  setSaving(true);
                  try {
                    await setGlobalStockEnabled(globalStock);
                    await logChange("settings_inventory", undefined, { globalStock: persistedGlobalStock }, { globalStock });
                    toast.success("Inventory settings saved");
                  } catch {
                    toast.error("Inventory settings could not be saved");
                  } finally {
                    setSaving(false);
                  }
                }}
              />
            }
          >
            <div className="rounded-lg border border-border p-4 space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5 min-w-0">
                  <Label className="text-sm font-medium">Enable Global Stock Management</Label>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Track inventory quantities for all products across POS and WooCommerce.
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
          </SettingsSection>
        );
      case "pos": return <PosSettingsTab />;
      case "orders": return <OrdersSettingsTab />;
      case "preorders": return <PreOrdersSettingsTab />;
      case "invoice": return <InvoiceSettingsTab />;
      case "sources": return <OrderSourcesTab />;
      case "measurements": return <MeasurementsTab />;
      case "audit": return <AuditLogTab />;
    }
  };

  const currentTab = activeTab ? allTabs.find((t) => t.id === activeTab) : null;

  // ============== MOBILE: drill-down ==============
  if (isMobile) {
    if (activeTab && currentTab) {
      return (
        <div className="space-y-4">
          <button
            onClick={() => setActiveTab(null)}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground -ml-1"
          >
            <ArrowLeft className="h-4 w-4" />
            Settings
          </button>
          <div>
            <h1 className="font-heading text-xl font-semibold flex items-center gap-2">
              <currentTab.icon className="h-5 w-5" />
              {currentTab.label}
            </h1>
          </div>
          <div className={cn(currentTab.id !== "audit" && "max-w-2xl")}>
            {renderContent(currentTab.id)}
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground">System configuration</p>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search settings…"
            className="pl-9 pr-9 h-11"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="space-y-5">
          {filteredGroups.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No settings match "{search}"</p>
          )}
          {filteredGroups.map((g) => (
            <div key={g.id} className="space-y-1.5">
              <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground px-1">
                {g.label}
              </h2>
              <div className="rounded-lg border border-border bg-card overflow-hidden divide-y divide-border">
                {g.tabs.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setActiveTab(t.id)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-secondary/40 transition-colors min-h-[56px]"
                  >
                    <div className="h-9 w-9 rounded-md bg-secondary/60 flex items-center justify-center shrink-0">
                      <t.icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{t.label}</div>
                      <div className="text-xs text-muted-foreground truncate">{t.description}</div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ============== DESKTOP: grouped left rail ==============
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">System configuration</p>
      </div>

      <div className="flex gap-6">
        <nav className="w-60 shrink-0 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search settings…"
              className="pl-8 h-9 text-sm"
            />
          </div>

          {filteredGroups.length === 0 && (
            <p className="text-xs text-muted-foreground px-3">No matches</p>
          )}

          {filteredGroups.map((g) => (
            <div key={g.id} className="space-y-0.5">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-3 mb-1.5">
                {g.label}
              </h2>
              {g.tabs.map((t) => (
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
            </div>
          ))}
        </nav>

        <div className={cn("flex-1 space-y-4", activeTab === "audit" ? "max-w-none" : "max-w-2xl")}>
          {activeTab && renderContent(activeTab)}
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
