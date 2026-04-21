import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { PERMISSION_GROUPS, type AppPermission } from "@/hooks/usePermissions";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  userId: string;
  userName: string;
  currentRole: string;
  onSaved?: () => void;
}

interface CustomRole { id: string; name: string; permissions: AppPermission[] }
interface Store { id: string; name: string }

const UserAccessDialog = ({ open, onOpenChange, userId, userName, currentRole, onSaved }: Props) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [role, setRole] = useState(currentRole);
  const [allRoles, setAllRoles] = useState<CustomRole[]>([]);
  const [assignedRoleIds, setAssignedRoleIds] = useState<string[]>([]);
  // overrides: permission -> granted/revoked
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [stores, setStores] = useState<Store[]>([]);
  const [storeAccess, setStoreAccess] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setRole(currentRole);
    (async () => {
      setLoading(true);
      const [rolesRes, assignedRes, overridesRes, storesRes, storeAccessRes] = await Promise.all([
        supabase.from("custom_roles").select("id, name, permissions").order("name"),
        supabase.from("user_custom_roles").select("custom_role_id").eq("user_id", userId),
        supabase.from("user_permissions").select("permission, granted").eq("user_id", userId),
        supabase.from("stores").select("id, name").order("name"),
        supabase.from("user_store_access").select("store_id").eq("user_id", userId),
      ]);
      setAllRoles((rolesRes.data as CustomRole[]) || []);
      setAssignedRoleIds((assignedRes.data || []).map((r: any) => r.custom_role_id));
      const ov: Record<string, boolean> = {};
      (overridesRes.data || []).forEach((o: any) => { ov[o.permission] = o.granted; });
      setOverrides(ov);
      setStores((storesRes.data as Store[]) || []);
      setStoreAccess((storeAccessRes.data || []).map((s: any) => s.store_id));
      setLoading(false);
    })();
  }, [open, userId, currentRole]);

  const toggleRole = (id: string) => {
    setAssignedRoleIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };
  const toggleStore = (id: string) => {
    setStoreAccess((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };
  const cycleOverride = (key: AppPermission) => {
    setOverrides((prev) => {
      const next = { ...prev };
      const cur = next[key];
      if (cur === undefined) next[key] = true;
      else if (cur === true) next[key] = false;
      else delete next[key];
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      // 1. Role preset
      if (role !== currentRole) {
        const { data, error } = await supabase.functions.invoke("team-manage", {
          body: { action: "update_role", user_id: userId, role },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
      }
      // 2. Custom role assignments — wipe and re-insert
      await supabase.from("user_custom_roles").delete().eq("user_id", userId);
      if (assignedRoleIds.length) {
        await supabase.from("user_custom_roles").insert(
          assignedRoleIds.map((rid) => ({ user_id: userId, custom_role_id: rid }))
        );
      }
      // 3. Overrides — wipe and re-insert
      await supabase.from("user_permissions").delete().eq("user_id", userId);
      const overrideRows = Object.entries(overrides).map(([permission, granted]) => ({
        user_id: userId, permission: permission as AppPermission, granted,
      }));
      if (overrideRows.length) {
        await supabase.from("user_permissions").insert(overrideRows);
      }
      // 4. Store access — wipe and re-insert
      await supabase.from("user_store_access").delete().eq("user_id", userId);
      if (storeAccess.length) {
        await supabase.from("user_store_access").insert(
          storeAccess.map((sid) => ({ user_id: userId, store_id: sid }))
        );
      }
      toast.success("Access updated");
      onOpenChange(false);
      onSaved?.();
    } catch (err: any) {
      toast.error(err.message || "Failed to save access");
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Manage Access — {userName}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : (
          <Tabs defaultValue="role" className="flex-1 overflow-hidden flex flex-col">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="role">Role</TabsTrigger>
              <TabsTrigger value="custom">Custom Roles</TabsTrigger>
              <TabsTrigger value="overrides">Overrides</TabsTrigger>
              <TabsTrigger value="stores">Stores</TabsTrigger>
            </TabsList>

            <TabsContent value="role" className="space-y-3 mt-4">
              <Label>Preset Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin (full access)</SelectItem>
                  <SelectItem value="staff">Staff (default operations)</SelectItem>
                  <SelectItem value="viewer">Viewer (read-only basics)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Preset role provides the baseline. Custom roles and overrides layer on top.</p>
            </TabsContent>

            <TabsContent value="custom" className="mt-4">
              <ScrollArea className="h-[380px] rounded-md border border-border p-3">
                {allRoles.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No custom roles defined yet</p>
                ) : (
                  <div className="space-y-1.5">
                    {allRoles.map((r) => (
                      <label key={r.id} className="flex items-center gap-3 rounded-md p-2 hover:bg-muted cursor-pointer">
                        <Checkbox checked={assignedRoleIds.includes(r.id)} onCheckedChange={() => toggleRole(r.id)} />
                        <div className="flex-1">
                          <p className="text-sm font-medium">{r.name}</p>
                          <p className="text-xs text-muted-foreground">{r.permissions.length} permissions</p>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>

            <TabsContent value="overrides" className="mt-4">
              <p className="text-xs text-muted-foreground mb-2">Click a permission to cycle: <Badge variant="outline" className="mx-1">inherit</Badge> → <Badge className="mx-1 bg-success/20 text-success">grant</Badge> → <Badge variant="destructive" className="mx-1">revoke</Badge></p>
              <ScrollArea className="h-[340px] rounded-md border border-border p-3">
                <div className="space-y-3">
                  {PERMISSION_GROUPS.map((g) => (
                    <div key={g.group}>
                      <p className="mb-1.5 text-sm font-semibold">{g.group}</p>
                      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                        {g.items.map((it) => {
                          const v = overrides[it.key];
                          return (
                            <button
                              key={it.key}
                              type="button"
                              onClick={() => cycleOverride(it.key)}
                              className="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-left hover:bg-muted"
                            >
                              <span className="text-xs">{it.label}</span>
                              {v === true && <Badge className="bg-success/20 text-success text-[10px]">Grant</Badge>}
                              {v === false && <Badge variant="destructive" className="text-[10px]">Revoke</Badge>}
                              {v === undefined && <Badge variant="outline" className="text-[10px]">Inherit</Badge>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="stores" className="mt-4">
              <p className="text-xs text-muted-foreground mb-2">Empty selection = access to all stores. Pick stores to restrict.</p>
              <ScrollArea className="h-[380px] rounded-md border border-border p-3">
                {stores.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No stores configured</p>
                ) : (
                  <div className="space-y-1.5">
                    {stores.map((s) => (
                      <label key={s.id} className="flex items-center gap-3 rounded-md p-2 hover:bg-muted cursor-pointer">
                        <Checkbox checked={storeAccess.includes(s.id)} onCheckedChange={() => toggleStore(s.id)} />
                        <span className="text-sm">{s.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
          </Tabs>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save Access
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default UserAccessDialog;
