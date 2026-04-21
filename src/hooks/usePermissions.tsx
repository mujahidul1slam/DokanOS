import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { Database } from "@/integrations/supabase/types";

export type AppPermission = Database["public"]["Enums"]["app_permission"];

interface PermissionsContextType {
  permissions: AppPermission[];
  storeIds: string[]; // empty = all stores accessible
  loading: boolean;
  largeDiscountPercent: number;
  largeDiscountAmount: number | null;
  can: (perm: AppPermission) => boolean;
  canAny: (perms: AppPermission[]) => boolean;
  hasStoreAccess: (storeId: string | null | undefined) => boolean;
  refresh: () => Promise<void>;
}

const PermissionsContext = createContext<PermissionsContextType | undefined>(undefined);

export const PermissionsProvider = ({ children }: { children: ReactNode }) => {
  const { user, isAdmin } = useAuth();
  const [permissions, setPermissions] = useState<AppPermission[]>([]);
  const [storeIds, setStoreIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [largeDiscountPercent, setLargeDiscountPercent] = useState(10);
  const [largeDiscountAmount, setLargeDiscountAmount] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      setPermissions([]);
      setStoreIds([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [permsRes, storesRes, settingsRes] = await Promise.all([
      supabase.rpc("get_user_permissions", { _user_id: user.id }),
      supabase.rpc("get_user_store_ids", { _user_id: user.id }),
      supabase.from("permission_settings").select("large_discount_percent, large_discount_amount").maybeSingle(),
    ]);
    setPermissions((permsRes.data as AppPermission[]) || []);
    setStoreIds((storesRes.data as string[]) || []);
    if (settingsRes.data) {
      setLargeDiscountPercent(Number(settingsRes.data.large_discount_percent ?? 10));
      setLargeDiscountAmount(settingsRes.data.large_discount_amount != null ? Number(settingsRes.data.large_discount_amount) : null);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const can = useCallback((perm: AppPermission) => isAdmin || permissions.includes(perm), [isAdmin, permissions]);
  const canAny = useCallback((perms: AppPermission[]) => isAdmin || perms.some((p) => permissions.includes(p)), [isAdmin, permissions]);
  const hasStoreAccess = useCallback((storeId: string | null | undefined) => {
    if (isAdmin) return true;
    if (!storeId) return true;
    if (storeIds.length === 0) return true; // unrestricted
    return storeIds.includes(storeId);
  }, [isAdmin, storeIds]);

  return (
    <PermissionsContext.Provider
      value={{ permissions, storeIds, loading, largeDiscountPercent, largeDiscountAmount, can, canAny, hasStoreAccess, refresh: load }}
    >
      {children}
    </PermissionsContext.Provider>
  );
};

export const usePermissions = () => {
  const ctx = useContext(PermissionsContext);
  if (!ctx) throw new Error("usePermissions must be used within PermissionsProvider");
  return ctx;
};

/** Catalog of permissions grouped for UI display */
export const PERMISSION_GROUPS: { group: string; items: { key: AppPermission; label: string; hint?: string }[] }[] = [
  {
    group: "Dashboard",
    items: [{ key: "dashboard.view", label: "View dashboard" }],
  },
  {
    group: "Orders",
    items: [
      { key: "orders.view", label: "View orders" },
      { key: "orders.create", label: "Create orders" },
      { key: "orders.edit", label: "Edit orders" },
      { key: "orders.delete", label: "Delete / trash orders" },
      { key: "orders.change_status", label: "Change order status" },
      { key: "orders.dispatch", label: "Send to courier (Pathao)" },
      { key: "orders.refund", label: "Issue order refunds" },
      { key: "orders.log_payment", label: "Log payments" },
      { key: "orders.discount_large", label: "Apply large discounts (above threshold)" },
    ],
  },
  {
    group: "Pre-orders",
    items: [
      { key: "preorders.view", label: "View pre-orders" },
      { key: "preorders.manage", label: "Manage pre-orders" },
    ],
  },
  {
    group: "Customers",
    items: [
      { key: "customers.view", label: "View customers" },
      { key: "customers.edit", label: "Edit customers" },
      { key: "customers.delete", label: "Delete customers" },
    ],
  },
  {
    group: "Products",
    items: [
      { key: "products.view", label: "View products" },
      { key: "products.create", label: "Create products" },
      { key: "products.edit", label: "Edit products" },
      { key: "products.delete", label: "Delete products" },
      { key: "products.view_cost", label: "View cost / margin" },
      { key: "products.edit_cost", label: "Edit cost price" },
    ],
  },
  {
    group: "POS",
    items: [
      { key: "pos.use", label: "Use POS" },
      { key: "pos.discount_large", label: "Apply large discounts in POS" },
      { key: "pos.refund", label: "Process POS returns" },
      { key: "pos.shift_close", label: "Close POS shifts" },
    ],
  },
  {
    group: "Analytics",
    items: [
      { key: "analytics.view", label: "View analytics" },
      { key: "analytics.view_revenue", label: "View revenue / profit figures" },
    ],
  },
  {
    group: "Integrations & Stores",
    items: [
      { key: "integrations.view", label: "View integrations" },
      { key: "integrations.manage", label: "Manage integrations" },
      { key: "stores.view", label: "View stores" },
      { key: "stores.manage", label: "Manage stores" },
    ],
  },
  {
    group: "Settings & Team",
    items: [
      { key: "settings.view", label: "View settings" },
      { key: "settings.manage", label: "Manage settings" },
      { key: "team.view", label: "View team" },
      { key: "team.manage", label: "Manage team & permissions" },
      { key: "audit.view", label: "View audit log" },
    ],
  },
];

export const ALL_PERMISSIONS: AppPermission[] = PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.key));
