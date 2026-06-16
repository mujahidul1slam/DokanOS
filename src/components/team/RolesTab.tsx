import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Shield, Loader2 } from "lucide-react";
import { PERMISSION_GROUPS, type AppPermission } from "@/hooks/usePermissions";
import ConfirmDialog from "@/components/ConfirmDialog";

interface CustomRole {
  id: string;
  name: string;
  description: string | null;
  permissions: AppPermission[];
  is_system: boolean;
}

const RolesTab = ({ onChange }: { onChange?: () => void }) => {
  const [roles, setRoles] = useState<CustomRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<CustomRole | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const fetchRoles = async () => {
    setLoading(true);
    const { data } = await supabase.from("custom_roles").select("*").order("name");
    setRoles((data as CustomRole[]) || []);
    setLoading(false);
  };
  useEffect(() => { fetchRoles(); }, []);

  const openNew = () => {
    setEditing({ id: "", name: "", description: "", permissions: [], is_system: false });
    setDialogOpen(true);
  };
  const openEdit = (r: CustomRole) => {
    setEditing({ ...r, permissions: [...r.permissions] });
    setDialogOpen(true);
  };

  const togglePerm = (key: AppPermission) => {
    if (!editing) return;
    setEditing({
      ...editing,
      permissions: editing.permissions.includes(key)
        ? editing.permissions.filter((p) => p !== key)
        : [...editing.permissions, key],
    });
  };

  const toggleGroup = (groupKeys: AppPermission[], allOn: boolean) => {
    if (!editing) return;
    setEditing({
      ...editing,
      permissions: allOn
        ? editing.permissions.filter((p) => !groupKeys.includes(p))
        : Array.from(new Set([...editing.permissions, ...groupKeys])),
    });
  };

  const save = async () => {
    if (!editing || !editing.name.trim()) return;
    setSaving(true);
    const payload = {
      name: editing.name.trim(),
      description: editing.description?.trim() || null,
      permissions: editing.permissions,
    };
    const { error } = editing.id
      ? await supabase.from("custom_roles").update(payload).eq("id", editing.id)
      : await supabase.from("custom_roles").insert(payload);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(editing.id ? "Role updated" : "Role created");
    setDialogOpen(false);
    fetchRoles();
    onChange?.();
  };

  const removeRole = async (id: string) => {
    const { error } = await supabase.from("custom_roles").delete().eq("id", id);
    setDeleteId(null);
    if (error) { toast.error(error.message); return; }
    toast.success("Role deleted");
    fetchRoles();
    onChange?.();
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg"><Shield className="h-5 w-5" />Custom Roles</CardTitle>
          <CardDescription>Reusable permission sets you can assign to team members</CardDescription>
        </div>
        <Button size="sm" onClick={openNew}><Plus className="mr-2 h-4 w-4" />New Role</Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading roles...</p>
        ) : roles.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No custom roles yet</p>
        ) : (
          roles.map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-md border border-border p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium">{r.name}</p>
                  {r.is_system && <Badge variant="outline" className="text-xs">System</Badge>}
                  <Badge variant="secondary" className="text-xs">{r.permissions.length} permissions</Badge>
                </div>
                {r.description && <p className="text-xs text-muted-foreground mt-0.5">{r.description}</p>}
              </div>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" onClick={() => openEdit(r)} aria-label="Edit role"><Pencil className="h-4 w-4" /></Button>
                {!r.is_system && (
                  <Button size="icon" variant="ghost" onClick={() => setDeleteId(r.id)} aria-label="Delete role">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </div>
            </div>
          ))
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit Role" : "New Role"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Name</Label>
                  <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Cashier" />
                </div>
                <div className="space-y-1.5">
                  <Label>Description</Label>
                  <Input value={editing.description || ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} placeholder="What this role does" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Permissions</Label>
                <ScrollArea className="h-[360px] rounded-md border border-border p-3">
                  <div className="space-y-4">
                    {PERMISSION_GROUPS.map((g) => {
                      const groupKeys = g.items.map((i) => i.key);
                      const onCount = groupKeys.filter((k) => editing.permissions.includes(k)).length;
                      const allOn = onCount === groupKeys.length;
                      return (
                        <div key={g.group}>
                          <div className="mb-2 flex items-center justify-between">
                            <p className="text-sm font-semibold">{g.group}</p>
                            <button
                              type="button"
                              onClick={() => toggleGroup(groupKeys, allOn)}
                              className="text-xs text-primary hover:underline"
                            >
                              {allOn ? "Clear all" : "Select all"}
                            </button>
                          </div>
                          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                            {g.items.map((it) => (
                              <label key={it.key} className="flex items-start gap-2 rounded-md p-1.5 hover:bg-muted cursor-pointer">
                                <Checkbox
                                  checked={editing.permissions.includes(it.key)}
                                  onCheckedChange={() => togglePerm(it.key)}
                                  className="mt-0.5"
                                />
                                <span className="text-sm leading-tight">{it.label}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving || !editing?.name.trim()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(o) => !o && setDeleteId(null)}
        title="Delete role?"
        description="Users assigned to this role will lose its permissions."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => deleteId && removeRole(deleteId)}
      />
    </Card>
  );
};

export default RolesTab;
