import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Settings, Package, FileText, ScrollText, ShoppingCart, Ruler,
  Building2, Hash, Hourglass, Search, ChevronRight, ArrowLeft, X,
  Palette, User, Printer, Warehouse, CreditCard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useTheme } from "@/hooks/useTheme";
import { useIsMobile } from "@/hooks/use-mobile";
import { logChange } from "@/lib/auditLog";
import { SettingsSection, SettingsSaveHandler } from "@/components/settings/SettingsSection";
import InvoiceSettingsTab from "@/components/settings/InvoiceSettingsTab";
import PosSettingsTab from "@/components/settings/PosSettingsTab";
import OrdersSettingsTab from "@/components/settings/OrdersSettingsTab";
import AuditLogTab from "@/components/settings/AuditLogTab";
import WarehousesTab from "@/components/settings/WarehousesTab";
import PaymentAccountsTab from "@/components/settings/PaymentAccountsTab";
import MeasurementsTab from "@/components/settings/MeasurementsTab";
import BusinessProfileTab from "@/components/settings/BusinessProfileTab";
import BusinessAccountTab from "@/components/settings/BusinessAccountTab";
import BrandSettingsTab from "@/components/settings/BrandSettingsTab";
import ProfileSettingsTab from "@/components/settings/ProfileSettingsTab";
import PreOrdersSettingsTab from "@/components/settings/PreOrdersSettingsTab";
import InstallAppButton from "@/components/InstallAppButton";
import { setGlobalStockEnabled, useGlobalStockEnabled } from "@/lib/stockSettings";
import { useBusinessContext } from "@/hooks/useBusinessContext";
import { SettingsDirtyContext, useSettingsDirty, useRegisterDirty } from "@/hooks/useSettingsDirty";
import { runSettingsSaveHandlers } from "@/lib/settingsSaveRegistry";
import { useSettingsNavGuard, type SettingsNavTarget } from "@/lib/settingsNavGuard";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

type TabId =
  | "profile" | "account" | "brands"
  | "general" | "payments" | "printheader" | "inventory" | "warehouses" | "pos" | "orders"
  | "preorders" | "measurements" | "invoice" | "audit";

/**
 * Issue #25: one pending unsaved-changes decision at a time — either a tab
 * switch inside /settings or a route-away from it (guarded SPA navigation).
 */
type PendingAction =
  | { kind: "tab"; next: TabId | null }
  | { kind: "leave"; target: SettingsNavTarget };

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
    id: "account",
    label: "Account",
    tabs: [
      { id: "profile", label: "My Profile", icon: User, description: "Your name, photo, password and session", keywords: "profile user personal account name avatar photo password email sign out" },
      { id: "account", label: "Business Account", icon: Building2, description: "Active business details, contact and currency", keywords: "business organization company currency timezone address logo contact phone email" },
      { id: "brands", label: "Brand Settings", icon: Palette, description: "Selling identities under this business", keywords: "brand identity logo slug active woo store" },
    ],
  },
  {
    id: "business",
    label: "Business",
    tabs: [
      { id: "general", label: "General", icon: Settings, description: "Theme and install preferences", keywords: "appearance dark light mode theme install pwa" },
      { id: "payments", label: "Payment accounts", icon: CreditCard, description: "Payment gateway accounts for the whole business", keywords: "payment bkash nagad stripe card gateway cod cash checkout" },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    tabs: [
      { id: "inventory", label: "Inventory", icon: Package, description: "Global stock management", keywords: "stock quantity tracking" },
      { id: "warehouses", label: "Warehouses", icon: Warehouse, description: "Stock holders, on-hand, transfers", keywords: "warehouse stock holder transfer showroom fulfillment" },
      { id: "pos", label: "POS Settings", icon: ShoppingCart, description: "Point of sale preferences", keywords: "checkout receipt sound" },
      { id: "orders", label: "Orders", icon: Hash, description: "Order numbering and rules" },
      { id: "preorders", label: "Pre-Orders", icon: Hourglass, description: "Pre-order categories and behavior", keywords: "preorder categories" },
      { id: "measurements", label: "Measurements", icon: Ruler, description: "Size presets and measurement fields" },
    ],
  },
  {
    id: "documents",
    label: "Documents",
    tabs: [
      { id: "printheader", label: "Print Header", icon: Printer, description: "Business name/logo/contact on invoices", keywords: "invoice header logo print brand tagline contact" },
      { id: "invoice", label: "Invoice / Pickup Slip", icon: FileText, description: "Print layouts and content" },
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

  // W6: dirty-state guard — chokepoint + beforeunload. Issue #25 adds the
  // sticky save bar and the route-away guard on top of the same registry.
  const { registerDirty, isDirty } = useSettingsDirty();
  const activeTabRef = useRef<TabId | null>(null);
  activeTabRef.current = activeTab;
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  const setTabDirty = useCallback((dirty: boolean) => {
    if (activeTabRef.current) registerDirty(activeTabRef.current, dirty);
  }, [registerDirty]);

  // One "unsaved changes" dialog for tab switches and route-aways alike.
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const pendingActionRef = useRef<PendingAction | null>(pendingAction);
  pendingActionRef.current = pendingAction;
  const [contentNonce, setContentNonce] = useState(0);
  const [barSaving, setBarSaving] = useState(false);

  // Route-away guard: warns before SPA navigation away from /settings while
  // any tab is dirty (back/forward and anchor clicks included).
  const navigate = useNavigate();
  useSettingsNavGuard({
    isBlocked: () => isDirtyRef.current,
    onBlocked: (target) => setPendingAction({ kind: "leave", target }),
    navigateTo: (path, opts) => navigate(path, { replace: opts.replace, state: opts.state }),
  });

  const handleTabChange = useCallback((next: TabId | null) => {
    if (isDirty) { setPendingAction({ kind: "tab", next }); return; }
    setActiveTab(next);
  }, [isDirty]);

  /**
   * Save from the sticky bar or the dialog, generically through the SaveButton
   * registry. After the handlers resolve, the tabs' own dirty bookkeeping must
   * have cleared — otherwise the save failed and we keep the user here instead
   * of silently losing the edits.
   */
  const handleSaveChanges = useCallback(async () => {
    setBarSaving(true);
    let ok = false;
    try {
      ok = await runSettingsSaveHandlers();
      // Let the tabs' dirty-state effects commit before re-checking.
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      setBarSaving(false);
    }
    if (!ok || isDirtyRef.current) {
      toast.error("Your changes could not be saved — review them and try again");
      return;
    }
    const action = pendingActionRef.current;
    if (!action) return;
    setPendingAction(null);
    if (action.kind === "tab") setActiveTab(action.next);
    else action.target.proceed();
  }, []);

  /**
   * Discard the pending edits: drop the dirty flags and remount the active tab
   * so its forms reset to the saved values. From the dialog, continue the
   * blocked action afterwards.
   */
  const handleDiscardChanges = useCallback(() => {
    if (activeTabRef.current) registerDirty(activeTabRef.current, false);
    setContentNonce((n) => n + 1);
    const action = pendingActionRef.current;
    if (!action) return;
    setPendingAction(null);
    if (action.kind === "tab") setActiveTab(action.next);
    else action.target.proceed();
  }, [registerDirty]);

  const handleStay = useCallback(() => {
    const action = pendingActionRef.current;
    setPendingAction(null);
    if (action?.kind === "leave") action.target.cancel();
  }, []);

  const { theme, toggleTheme } = useTheme();

  // On desktop, default to first tab if none selected
  useEffect(() => {
    if (!isMobile && activeTab === null) setActiveTab(groups[0].tabs[0].id);
  }, [isMobile, activeTab]);

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
      case "profile": return <ProfileSettingsTab />;
      case "account": return <BusinessAccountTab />;
      case "brands": return <BrandSettingsTab />;
      case "printheader": return <BusinessProfileTab />;
      case "general":
        return (
          <div className="space-y-4">
            <SettingsSection
              title="General Settings"
              description="Basic system preferences and defaults."
            >
              <div className="space-y-4">
                <div className="rounded-lg border border-border p-4 space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <div className="space-y-0.5 min-w-0">
                      <Label className="text-sm font-medium">Dark mode</Label>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Switch between light and dark appearance. Also available in the sidebar.
                      </p>
                    </div>
                    <Switch checked={theme === "dark"} onCheckedChange={() => toggleTheme()} />
                  </div>
                </div>

                <InstallAppButton />
              </div>
            </SettingsSection>
            <GeneralRedirectCard onGoToAccount={() => handleTabChange("account")} />
          </div>
        );
      case "inventory":
        return <InventorySettings />;
      case "pos": return <PosSettingsTab />;
      case "orders": return <OrdersSettingsTab />;
      case "preorders": return <PreOrdersSettingsTab />;
      case "invoice": return <InvoiceSettingsTab />;
      case "warehouses": return <WarehousesTab />;
      case "payments": return <PaymentAccountsTab />;
      case "measurements": return <MeasurementsTab />;
      case "audit": return <AuditLogTab />;
    }
  };

  const currentTab = activeTab ? allTabs.find((t) => t.id === activeTab) : null;

  // ============== MOBILE: drill-down ==============
  if (isMobile) {
    if (activeTab && currentTab) {
      return (
        <SettingsDirtyContext.Provider value={setTabDirty}>
        <div className="space-y-4">
          <button
            onClick={() => handleTabChange(null)}
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
          <div className={cn(currentTab.id !== "audit" && "max-w-2xl")} key={contentNonce}>
            {renderContent(currentTab.id)}
          </div>
          {isDirty && (
            <StickySaveBar saving={barSaving} onSave={handleSaveChanges} onDiscard={handleDiscardChanges} />
          )}
          <UnsavedChangesDialog
            open={pendingAction !== null}
            saving={barSaving}
            onSave={handleSaveChanges}
            onDiscard={handleDiscardChanges}
            onStay={handleStay}
          />
        </div>
        </SettingsDirtyContext.Provider>
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
                    onClick={() => handleTabChange(t.id)}
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
    <SettingsDirtyContext.Provider value={setTabDirty}>
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
                  onClick={() => handleTabChange(t.id)}
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

        <div
          className={cn("flex-1 space-y-4", activeTab === "audit" ? "max-w-none" : "max-w-2xl")}
          key={contentNonce}
        >
          {activeTab && renderContent(activeTab)}
        </div>
      </div>
      {isDirty && (
        <StickySaveBar saving={barSaving} onSave={handleSaveChanges} onDiscard={handleDiscardChanges} />
      )}
      <UnsavedChangesDialog
        open={pendingAction !== null}
        saving={barSaving}
        onSave={handleSaveChanges}
        onDiscard={handleDiscardChanges}
        onStay={handleStay}
      />
    </div>
    </SettingsDirtyContext.Provider>
  );
};

/**
 * Issue #25: the sticky save bar. Appears while any registered settings tab is
 * dirty and saves generically through the SaveButton registry. Sticky inside
 * the app's scrolling main area, above the mobile bottom nav.
 */
const StickySaveBar = ({
  saving,
  onSave,
  onDiscard,
}: {
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) => (
  <div className="sticky bottom-20 lg:bottom-6 z-30">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/95 px-4 py-3 shadow-lg backdrop-blur">
      <p className="text-sm font-medium">You have unsaved changes</p>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={onDiscard} disabled={saving}>
          Discard
        </Button>
        <Button size="sm" onClick={onSave} disabled={saving} className="min-w-[120px]">
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  </div>
);

/**
 * W6 / issue #25: the discard/save dialog, shared by tab switches and
 * route-aways. Save persists the edits and continues; Discard drops them and
 * continues; Stay cancels the pending navigation.
 */
const UnsavedChangesDialog = ({
  open,
  saving,
  onSave,
  onDiscard,
  onStay,
}: {
  open: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onStay: () => void;
}) => (
  // Plain Dialog (not AlertDialog) on purpose: the alert variant swallows all
  // outside interaction, which turned a spurious prompt into a full dead-end
  // ("the screen went dark and nothing was selectable"). Here any outside
  // click / Escape / X resolves to "Stay" — the safe, non-destructive choice.
  <Dialog open={open} onOpenChange={(o) => { if (!o) onStay(); }}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>You have unsaved changes</DialogTitle>
        <DialogDescription>
          Leaving now will discard your edits. Save them first, or discard to continue.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" onClick={onStay} disabled={saving}>Stay</Button>
        <Button variant="outline" onClick={onDiscard} disabled={saving}>Discard</Button>
        <Button onClick={onSave} disabled={saving} className="min-w-[120px]">
          {saving ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

/**
 * W2a: the old General tab's business fields (name/currency/timezone) wrote to
 * localStorage only — a per-device, invisible surface. This card shows the LIVE
 * values from the active business and routes edits to Business Account.
 */
const GeneralRedirectCard = ({ onGoToAccount }: { onGoToAccount: () => void }) => {
  const { active } = useBusinessContext();
  return (
    <SettingsSection
      title="Business basics"
      description="Name, currency and timezone are managed with the business account."
      icon={Building2}
    >
      <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">Business name</span>
          <span className="font-medium truncate">{active?.name || "—"}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">Currency</span>
          <span className="font-medium">{active?.currency || "BDT"}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">Timezone</span>
          <span className="font-medium">{active?.timezone || "Asia/Dhaka"}</span>
        </div>
        <div className="pt-2">
          <Button size="sm" variant="outline" onClick={onGoToAccount}>
            Edit in Business Account
          </Button>
        </div>
      </div>
    </SettingsSection>
  );
};

/**
 * Inventory tab content (shell-owned). Registers its dirty state through the
 * same context the standalone tabs use, so the sticky save bar and the
 * route-away guard cover it without any per-tab wiring.
 */
const InventorySettings = () => {
  const setDirty = useRegisterDirty();
  const persistedGlobalStock = useGlobalStockEnabled();
  const [globalStock, setGlobalStock] = useState<boolean>(persistedGlobalStock);
  const [saving, setSaving] = useState(false);
  const changed = globalStock !== persistedGlobalStock;

  useEffect(() => {
    setGlobalStock(persistedGlobalStock);
  }, [persistedGlobalStock]);

  useEffect(() => {
    setDirty(changed);
    return () => setDirty(false);
  }, [changed, setDirty]);

  const handleSaveInventory = async () => {
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
  };

  return (
    <>
      {/* Universal save: the sticky save bar commits the stock toggle. */}
      <SettingsSaveHandler
        label="Save Inventory Settings"
        disabled={saving || !changed}
        run={handleSaveInventory}
      />
      <SettingsSection
        title="Inventory Settings"
        description="Control how stock is tracked across all channels."
      >
      <div className="rounded-lg border border-border p-4 space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5 min-w-0">
            <Label className="text-sm font-medium">Enable Global Stock Management</Label>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Track inventory quantities for all products across POS and your storefront channels.
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
    </>
  );
};

export default SettingsPage;
